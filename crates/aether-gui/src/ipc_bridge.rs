use aether_protocol::agent::{BlackboardEntryType, CliType};
use aether_protocol::ipc::async_codec::{read_ipc_message, write_ipc_message};
use aether_protocol::ipc::{
    ChatHistoryEntry, ClaimModuleRequest, CreateSnapshotRequest, IpcEvent, IpcMessage, IpcRequest, IpcRequestPayload,
    IpcResponsePayload, MergeWorktreeRequest, ObsidianReadNoteRequest,
    ObsidianUpdateTaskRequest, PaneSpawnedInfo, PaneSummary, ProviderConfig, PtyInputRequest, PublishBlackboardRequest,
    ReleaseModuleRequest, ResizePaneRequest, RollbackSnapshotRequest, SharedContextSummary,
    SpawnPaneRequest, WorktreeDiffRequest, WorktreeDiffSummary,
};
use aether_protocol::{AETHER_SOCK_ENV, DEFAULT_SOCKET_NAME};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State};
use tokio::net::UnixStream;
use tracing::{info, warn};
use uuid::Uuid;

pub struct GuiBridgeState {
    socket_path: PathBuf,
    input_tx: tokio::sync::mpsc::Sender<PtyInputRequest>,
}

impl GuiBridgeState {
    pub fn new() -> Self {
        let socket_path = resolve_socket_path();
        let (input_tx, mut input_rx) = tokio::sync::mpsc::channel::<PtyInputRequest>(2048);
        let worker_socket = socket_path.clone();

        // Spawn a dedicated persistent connection worker for lightning-fast PTY input
        tauri::async_runtime::spawn(async move {
            let mut writer_opt: Option<tokio::net::unix::OwnedWriteHalf> = None;

            while let Some(req) = input_rx.recv().await {
                // Drain any additional requests queued in input_rx to batch them
                let mut batches: Vec<PtyInputRequest> = vec![req];
                while let Ok(next_req) = input_rx.try_recv() {
                    if let Some(last) = batches.last_mut() {
                        if last.pane_id == next_req.pane_id {
                            last.data.extend(next_req.data);
                            continue;
                        }
                    }
                    batches.push(next_req);
                }

                // Connect or reconnect if stream is not established
                if writer_opt.is_none() {
                    match UnixStream::connect(&worker_socket).await {
                        Ok(s) => {
                            let (mut reader, writer) = s.into_split();
                            // Spawn background response drainer so read doesn't block write
                            tauri::async_runtime::spawn(async move {
                                while let Ok(msg) = read_ipc_message(&mut reader).await {
                                    if let IpcMessage::Response(res) = msg {
                                        if let Err(err) = res.payload {
                                            warn!("PTY input error from daemon: [{}] {}", err.code, err.message);
                                        }
                                    }
                                }
                            });
                            writer_opt = Some(writer);
                        }
                        Err(_) => {
                            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                            continue;
                        }
                    }
                }

                if let Some(writer) = writer_opt.as_mut() {
                    for batch in batches {
                        let req_id = format!("in_{}", Uuid::new_v4().simple());
                        let msg = IpcMessage::Request(IpcRequest::new(
                            req_id,
                            IpcRequestPayload::PtyInput(batch),
                        ));

                        if let Err(e) = write_ipc_message(writer, &msg).await {
                            warn!("PTY input write failed: {}", e);
                            writer_opt = None; // Reset so next packet reconnects
                            break;
                        }
                    }
                }
            }
        });

        Self {
            socket_path,
            input_tx,
        }
    }

    pub async fn send_request(&self, payload: IpcRequestPayload) -> Result<IpcResponsePayload, String> {
        let mut stream = UnixStream::connect(&self.socket_path).await.map_err(|e| {
            format!("Cannot connect to aetherd at {}: {}", self.socket_path.display(), e)
        })?;

        let req_id = format!("gui_{}", Uuid::new_v4().simple());
        let msg = IpcMessage::Request(IpcRequest::new(req_id.clone(), payload));

        write_ipc_message(&mut stream, &msg).await.map_err(|e| e.to_string())?;

        loop {
            let resp_msg = read_ipc_message(&mut stream).await.map_err(|e| e.to_string())?;

            match resp_msg {
                IpcMessage::Response(res) if res.reply_to == req_id => match res.payload {
                    Ok(success) => return Ok(success),
                    Err(err) => return Err(format!("[{}] {}", err.code, err.message)),
                },
                IpcMessage::Response(_) => continue,
                IpcMessage::Event(_) => continue,
                other => return Err(format!("Unexpected response: {:?}", other)),
            }
        }
    }
}

/// Spawns background listener streaming events from aetherd into Tauri webview
pub fn start_event_listener(app_handle: AppHandle) {
    ensure_daemon_running();
    let socket_path = resolve_socket_path();

    tauri::async_runtime::spawn(async move {
        loop {
            match UnixStream::connect(&socket_path).await {
                Ok(mut stream) => {
                    info!("Connected GUI event bridge to aetherd at {}", socket_path.display());

                    // Send SubscribeEvents request
                    let sub_req = IpcMessage::Request(IpcRequest::new(
                        "sub_events",
                        IpcRequestPayload::SubscribeEvents { workspace_id: None },
                    ));
                    if let Err(e) = write_ipc_message(&mut stream, &sub_req).await {
                        warn!("Failed to send SubscribeEvents: {}", e);
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        continue;
                    }

                    // Channel to decouple socket reader from the 16ms/32KB flush batcher
                    let (event_tx, event_rx) = tokio::sync::mpsc::channel::<IpcMessage>(1024);
                    let (mut read_half, _write_half) = stream.into_split();

                    let reader_handle = tauri::async_runtime::spawn(async move {
                        loop {
                            match read_ipc_message(&mut read_half).await {
                                Ok(msg) => {
                                    if event_tx.send(msg).await.is_err() {
                                        break;
                                    }
                                }
                                Err(e) => {
                                    warn!("GUI event stream disconnected: {}", e);
                                    break;
                                }
                            }
                        }
                    });

                    // 8ms interval (~120 FPS) and 32KB batch threshold
                    process_event_stream(
                        event_rx,
                        |event_name, event| {
                            let _ = app_handle.emit(event_name, &event);
                        },
                        32 * 1024,
                        8,
                    )
                    .await;

                    reader_handle.abort();
                }
                Err(_) => {
                    // Daemon may be starting up, retry after delay
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        }
    });
}

/// Backpressure Mitigation & Chunk Batching:
/// Batches PTY output chunks per pane up to `chunk_threshold` (e.g. 32KB)
/// or flushes on a `flush_interval_ms` timer (e.g. 16ms / ~60 FPS).
pub async fn process_event_stream<F>(
    mut event_rx: tokio::sync::mpsc::Receiver<IpcMessage>,
    mut emit_fn: F,
    chunk_threshold: usize,
    flush_interval_ms: u64,
) where
    F: FnMut(&str, IpcEvent),
{
    let mut pane_buffers: HashMap<String, (u64, Vec<u8>)> = HashMap::new();
    let start = tokio::time::Instant::now() + std::time::Duration::from_millis(flush_interval_ms);
    let mut flush_interval = tokio::time::interval_at(start, std::time::Duration::from_millis(flush_interval_ms));
    flush_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = flush_interval.tick() => {
                for (pane_id, (start_offset, buf)) in pane_buffers.iter_mut() {
                    if !buf.is_empty() {
                        let event = IpcEvent::PtyOutput {
                            pane_id: pane_id.clone(),
                            data: std::mem::take(buf),
                            offset: *start_offset,
                        };
                        emit_fn("aether:event", event);
                    }
                }
            }
            msg_opt = event_rx.recv() => {
                match msg_opt {
                    Some(IpcMessage::Event(IpcEvent::PtyOutput { pane_id, data, offset })) => {
                        let entry = pane_buffers.entry(pane_id.clone()).or_insert_with(|| (offset, Vec::new()));
                        if entry.1.is_empty() {
                            entry.0 = offset;
                        }
                        entry.1.extend(data);

                        // Adaptive draining: drain queued PTY output only. A non-PTY event
                        // (PaneExited, status change) stops the drain so the main select
                        // branch handles it and keeps event ordering intact.
                        while let Ok(next_msg) = event_rx.try_recv() {
                            match next_msg {
                                IpcMessage::Event(IpcEvent::PtyOutput { pane_id: next_id, data: next_data, offset: next_offset }) => {
                                    let b = pane_buffers.entry(next_id).or_insert_with(|| (next_offset, Vec::new()));
                                    if b.1.is_empty() {
                                        b.0 = next_offset;
                                    }
                                    b.1.extend(next_data);
                                    if b.1.len() >= chunk_threshold {
                                        break;
                                    }
                                }
                                other => {
                                    // Re-inject by handling inline: flush first, then emit.
                                    if let IpcMessage::Event(ref ev) = other {
                                        if let IpcEvent::PaneExited { ref pane_id, .. } = ev {
                                            if let Some((start_offset, buf)) = pane_buffers.get_mut(pane_id) {
                                                if !buf.is_empty() {
                                                    let pty_event = IpcEvent::PtyOutput {
                                                        pane_id: pane_id.clone(),
                                                        data: std::mem::take(buf),
                                                        offset: *start_offset,
                                                    };
                                                    emit_fn("aether:event", pty_event);
                                                }
                                            }
                                        }
                                        emit_fn("aether:event", ev.clone());
                                    }
                                    break;
                                }
                            }
                        }

                        // Contract (see tests): a buffer is flushed only when it reaches
                        // the chunk threshold, when its pane exits, or when the interval
                        // timer fires. Draining never flushes on its own.
                        for (pid, (start_offset, p_buf)) in pane_buffers.iter_mut() {
                            if p_buf.len() >= chunk_threshold {
                                let event = IpcEvent::PtyOutput {
                                    pane_id: pid.clone(),
                                    data: std::mem::take(p_buf),
                                    offset: *start_offset,
                                };
                                emit_fn("aether:event", event);
                            }
                        }
                    }
                    Some(IpcMessage::Event(event)) => {
                        // If a pane exited, flush any pending PTY output for that pane first
                        if let IpcEvent::PaneExited { ref pane_id, .. } = event {
                            if let Some((start_offset, buf)) = pane_buffers.get_mut(pane_id) {
                                if !buf.is_empty() {
                                    let pty_event = IpcEvent::PtyOutput {
                                        pane_id: pane_id.clone(),
                                        data: std::mem::take(buf),
                                        offset: *start_offset,
                                    };
                                    emit_fn("aether:event", pty_event);
                                }
                            }
                        }
                        emit_fn("aether:event", event);
                    }
                    Some(_) => {}
                    None => {
                        // Channel closed: flush all remaining buffers
                        for (pane_id, (start_offset, buf)) in pane_buffers.drain() {
                            if !buf.is_empty() {
                                let event = IpcEvent::PtyOutput { pane_id, data: buf, offset: start_offset };
                                emit_fn("aether:event", event);
                            }
                        }
                        break;
                    }
                }
            }
        }
    }
}

// ----------------------------------------------------------------------------
// Tauri Commands callable from SolidJS / React
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn cmd_spawn_pane(
    state: State<'_, GuiBridgeState>,
    workspace_id: String,
    cli_type: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    working_dir: Option<String>,
    isolated_worktree: bool,
    cols: u16,
    rows: u16,
) -> Result<PaneSpawnedInfo, String> {
    let parsed_cli = cli_type.parse::<CliType>().unwrap_or(CliType::Shell);
    let home_dir = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    let dir = working_dir
        .filter(|s| !s.trim().is_empty() && s != ".")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::current_dir().unwrap_or(home_dir)
        });

    let req = IpcRequestPayload::SpawnPane(SpawnPaneRequest {
        pane_id: None,
        workspace_id,
        cli_type: parsed_cli,
        command,
        args: args.unwrap_or_default(),
        working_dir: dir,
        cols,
        rows,
        isolated_worktree,
        env_vars: HashMap::new(),
    });

    match state.send_request(req).await? {
        IpcResponsePayload::PaneSpawned(info) => Ok(info),
        _ => Err("Unexpected response".to_string()),
    }
}

#[tauri::command]
pub async fn cmd_send_pty_input(
    state: State<'_, GuiBridgeState>,
    pane_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    tracing::debug!("cmd_send_pty_input for pane {}: {} bytes", pane_id, data.len());
    state
        .input_tx
        .send(PtyInputRequest { pane_id, data })
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_resize_pane(
    state: State<'_, GuiBridgeState>,
    pane_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let req = IpcRequestPayload::ResizePane(ResizePaneRequest { pane_id, cols, rows });
    state.send_request(req).await?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_kill_pane(
    state: State<'_, GuiBridgeState>,
    pane_id: String,
    signal: Option<i32>,
) -> Result<(), String> {
    let req = IpcRequestPayload::KillPane(aether_protocol::ipc::KillPaneRequest { pane_id, signal });
    state.send_request(req).await?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_cleanup_all_panes(state: State<'_, GuiBridgeState>) -> Result<(), String> {
    let req = IpcRequestPayload::ListPanes { workspace_id: None };
    if let Ok(IpcResponsePayload::PaneList(panes)) = state.send_request(req).await {
        for p in panes {
            let _ = state.send_request(IpcRequestPayload::KillPane(aether_protocol::ipc::KillPaneRequest {
                pane_id: p.pane_id,
                signal: Some(9),
            })).await;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_check_pane_process(pid: u32, cli_type: String) -> Option<String> {
    if pid == 0 {
        return None;
    }

    // 1. Check if the spawned command itself is a specialized agent CLI
    let is_generic_shell = matches!(
        cli_type.to_lowercase().as_str(),
        "shell" | "bash" | "fish" | "zsh" | "sh"
    );
    if !is_generic_shell {
        return Some(cli_type);
    }

    // 2. Inspect Linux process tree for running child processes (e.g. npm, node, cargo, python, claude)
    #[cfg(target_os = "linux")]
    {
        let children_path = format!("/proc/{pid}/task/{pid}/children");
        if let Ok(content) = std::fs::read_to_string(children_path) {
            for part in content.split_whitespace() {
                if let Ok(child_pid) = part.parse::<u32>() {
                    if let Ok(comm) = std::fs::read_to_string(format!("/proc/{child_pid}/comm")) {
                        let name = comm.trim().to_string();
                        if !name.is_empty() {
                            return Some(name);
                        }
                    }
                }
            }
        }
    }

    None
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ScrollbackResponse {
    pub data: Vec<u8>,
    pub end_offset: u64,
}

#[tauri::command]
pub async fn cmd_get_scrollback(
    state: State<'_, GuiBridgeState>,
    pane_id: String,
) -> Result<ScrollbackResponse, String> {
    let req = IpcRequestPayload::GetScrollback { pane_id };
    match state.send_request(req).await? {
        IpcResponsePayload::ScrollbackData { data, end_offset, .. } => {
            Ok(ScrollbackResponse { data, end_offset })
        }
        _ => Err("Unexpected response".to_string()),
    }
}

#[tauri::command]
pub async fn cmd_list_panes(
    state: State<'_, GuiBridgeState>,
    workspace_id: Option<String>,
) -> Result<Vec<PaneSummary>, String> {
    let req = IpcRequestPayload::ListPanes { workspace_id };
    match state.send_request(req).await? {
        IpcResponsePayload::PaneList(list) => Ok(list),
        _ => Err("Unexpected response".to_string()),
    }
}

#[tauri::command]
pub async fn cmd_get_shared_context(
    state: State<'_, GuiBridgeState>,
    workspace_id: String,
    query: Option<String>,
) -> Result<SharedContextSummary, String> {
    let req = IpcRequestPayload::GetSharedContext(aether_protocol::ipc::GetSharedContextRequest {
        workspace_id,
        query,
    });
    match state.send_request(req).await? {
        IpcResponsePayload::SharedContext(ctx) => Ok(ctx),
        _ => Err("Unexpected response".to_string()),
    }
}

#[tauri::command]
pub async fn cmd_publish_blackboard(
    state: State<'_, GuiBridgeState>,
    workspace_id: String,
    author_agent_id: String,
    entry_type: String,
    title: String,
    content_markdown: String,
    target_agent_id: Option<String>,
) -> Result<i64, String> {
    let parsed_type = entry_type
        .parse::<BlackboardEntryType>()
        .unwrap_or(BlackboardEntryType::Decision);

    let req = IpcRequestPayload::PublishBlackboard(PublishBlackboardRequest {
        workspace_id,
        author_agent_id,
        entry_type: parsed_type,
        title,
        content_markdown,
        target_agent_id,
    });

    match state.send_request(req).await? {
        IpcResponsePayload::BlackboardPublished { entry_id } => Ok(entry_id),
        _ => Err("Unexpected response".to_string()),
    }
}

#[tauri::command]
pub async fn cmd_claim_module(
    state: State<'_, GuiBridgeState>,
    workspace_id: String,
    agent_id: String,
    files: Vec<String>,
    intent: Option<String>,
) -> Result<(bool, Vec<String>), String> {
    let req = IpcRequestPayload::ClaimModule(ClaimModuleRequest {
        workspace_id,
        agent_id,
        files,
        intent,
    });

    match state.send_request(req).await? {
        IpcResponsePayload::ModuleClaimed { granted, conflicts } => Ok((granted, conflicts)),
        _ => Err("Unexpected response".to_string()),
    }
}

#[tauri::command]
pub async fn cmd_release_module(
    state: State<'_, GuiBridgeState>,
    workspace_id: String,
    agent_id: String,
    files: Vec<String>,
) -> Result<(), String> {
    let req = IpcRequestPayload::ReleaseModule(ReleaseModuleRequest {
        workspace_id,
        agent_id,
        files,
    });
    state.send_request(req).await?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_get_worktree_diff(
    state: State<'_, GuiBridgeState>,
    pane_id: String,
    target_branch: Option<String>,
) -> Result<WorktreeDiffSummary, String> {
    let req = IpcRequestPayload::WorktreeDiff(WorktreeDiffRequest { pane_id, target_branch });
    match state.send_request(req).await? {
        IpcResponsePayload::WorktreeDiff(diff) => Ok(diff),
        _ => Err("Unexpected response".to_string()),
    }
}

#[tauri::command]
pub async fn cmd_merge_worktree(
    state: State<'_, GuiBridgeState>,
    pane_id: String,
    target_branch: Option<String>,
    squash: bool,
    commit_message: Option<String>,
) -> Result<String, String> {
    let req = IpcRequestPayload::MergeWorktree(MergeWorktreeRequest {
        pane_id,
        target_branch,
        squash,
        commit_message,
    });
    match state.send_request(req).await? {
        IpcResponsePayload::WorktreeMerged { commit_oid } => Ok(commit_oid),
        _ => Err("Unexpected response".to_string()),
    }
}

#[tauri::command]
pub async fn cmd_create_snapshot(
    state: State<'_, GuiBridgeState>,
    pane_id: String,
    summary: String,
) -> Result<String, String> {
    let req = IpcRequestPayload::CreateSnapshot(CreateSnapshotRequest { pane_id, summary });
    match state.send_request(req).await? {
        IpcResponsePayload::SnapshotCreated { snapshot_id, .. } => Ok(snapshot_id),
        _ => Err("Unexpected response".to_string()),
    }
}

#[tauri::command]
pub async fn cmd_rollback_snapshot(
    state: State<'_, GuiBridgeState>,
    pane_id: String,
    snapshot_id: String,
) -> Result<(), String> {
    let req = IpcRequestPayload::RollbackSnapshot(RollbackSnapshotRequest { pane_id, snapshot_id });
    state.send_request(req).await?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_list_snapshots(
    state: State<'_, GuiBridgeState>,
    pane_id: String,
) -> Result<Vec<aether_protocol::agent::GitSnapshotInfo>, String> {
    let req = IpcRequestPayload::ListSnapshots { pane_id };
    match state.send_request(req).await? {
        IpcResponsePayload::SnapshotList(snaps) => Ok(snaps),
        _ => Err("Unexpected response".to_string()),
    }
}

#[tauri::command]
pub async fn cmd_list_workflows(
    state: State<'_, GuiBridgeState>,
    workspace_id: String,
) -> Result<Vec<aether_protocol::ipc::WorkflowDefinition>, String> {
    let req = IpcRequestPayload::ListWorkflows { workspace_id };
    match state.send_request(req).await? {
        IpcResponsePayload::WorkflowList(list) => Ok(list),
        _ => Err("Unexpected response for ListWorkflows".to_string()),
    }
}

#[tauri::command]
pub async fn cmd_read_obsidian_note(
    state: State<'_, GuiBridgeState>,
    workspace_id: String,
    query_or_path: String,
) -> Result<String, String> {
    let req = IpcRequestPayload::ObsidianReadNote(ObsidianReadNoteRequest {
        workspace_id,
        query_or_path,
    });
    match state.send_request(req).await? {
        IpcResponsePayload::ObsidianNote(note) => Ok(note.raw_content),
        _ => Err("Could not find note".to_string()),
    }
}

#[tauri::command]
pub async fn cmd_update_obsidian_task(
    state: State<'_, GuiBridgeState>,
    workspace_id: String,
    note_path: String,
    task_text: String,
    completed: bool,
) -> Result<(), String> {
    let req = IpcRequestPayload::ObsidianUpdateTask(ObsidianUpdateTaskRequest {
        workspace_id,
        note_path,
        task_text,
        completed,
    });
    state.send_request(req).await?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_detect_available_tools() -> Result<Vec<crate::tool_detector::DetectedTool>, String> {
    Ok(crate::tool_detector::detect_available_tools())
}

#[tauri::command]
pub async fn cmd_validate_tool(
    binary: String,
    category: Option<String>,
) -> Result<crate::tool_detector::DetectedTool, String> {
    crate::tool_detector::validate_custom_tool(&binary, category.as_deref())
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceFileEntry {
    pub name: String,
    pub path: String, // Relative path from workspace root
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size_bytes: u64,
    pub extension: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceSearchMatch {
    pub file_path: String,
    pub line_number: usize,
    pub line_content: String,
    pub match_start: usize,
    pub match_end: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceFileContent {
    pub relative_path: String,
    pub content: String,
    pub total_bytes: u64,
    pub is_truncated: bool,
}

/// Resolve the workspace root directory.
/// Priority:
/// 1. If workspace_id points to an existing directory path, use it directly.
/// 2. If workspace_id is provided, try querying the running aetherd daemon.
/// 3. AETHER_WORKSPACE_ROOT environment variable.
/// 4. Current working directory.
/// 5. HOME directory or ".".
pub async fn resolve_workspace_root_async(workspace_id: Option<&str>) -> PathBuf {
    if let Some(id) = workspace_id {
        let p = PathBuf::from(id);
        if p.is_dir() {
            return p.canonicalize().unwrap_or(p);
        }

        // Try querying daemon for workspace metadata
        let socket_path = resolve_socket_path();
        if let Ok(mut stream) = tokio::net::UnixStream::connect(&socket_path).await {
            let req_id = format!("ws_{}", Uuid::new_v4().simple());
            let msg = IpcMessage::Request(IpcRequest::new(
                req_id.clone(),
                IpcRequestPayload::GetWorkspace {
                    workspace_id: id.to_string(),
                },
            ));
            if write_ipc_message(&mut stream, &msg).await.is_ok() {
                if let Ok(IpcMessage::Response(res)) = read_ipc_message(&mut stream).await {
                    if let Ok(IpcResponsePayload::Workspace(ws_info)) = res.payload {
                        let ws_path = PathBuf::from(&ws_info.root_repo_path);
                        if ws_path.is_dir() {
                            return ws_path.canonicalize().unwrap_or(ws_path);
                        }
                    }
                }
            }
        }
    }

    if let Ok(env_root) = std::env::var("AETHER_WORKSPACE_ROOT") {
        let p = PathBuf::from(env_root);
        if p.is_dir() {
            return p.canonicalize().unwrap_or(p);
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        if cwd.is_dir() {
            return cwd.canonicalize().unwrap_or(cwd);
        }
    }

    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

pub fn read_workspace_directory_impl(
    root: &Path,
    relative_path: Option<&str>,
) -> Result<Vec<WorkspaceFileEntry>, String> {
    let rel = relative_path.unwrap_or("");
    let trimmed = rel.trim_start_matches('/');
    let target_dir = if trimmed.is_empty() || trimmed == "." {
        root.to_path_buf()
    } else {
        root.join(trimmed)
    };

    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let canonical_target = target_dir
        .canonicalize()
        .map_err(|e| format!("Cannot open directory '{}': {}", target_dir.display(), e))?;

    if !canonical_target.starts_with(&canonical_root) {
        return Err(format!(
            "Security violation: directory '{}' escapes workspace root",
            rel
        ));
    }
    if !canonical_target.is_dir() {
        return Err(format!("Path '{}' is not a directory", target_dir.display()));
    }

    let read_dir = std::fs::read_dir(&canonical_target)
        .map_err(|e| format!("Failed to read directory '{}': {}", canonical_target.display(), e))?;

    let mut entries = Vec::new();
    for entry_res in read_dir {
        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };

        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().to_string();

        // Filters out .git, target, node_modules by default
        if name == ".git" || name == "target" || name == "node_modules" {
            continue;
        }

        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        let is_symlink = file_type.is_symlink();
        let full_path = entry.path();
        let is_dir = if is_symlink {
            full_path.is_dir()
        } else {
            file_type.is_dir()
        };

        let metadata = entry.metadata().ok();
        let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let extension = if is_dir {
            None
        } else {
            full_path.extension().map(|ext| ext.to_string_lossy().to_string())
        };

        let entry_rel_path = match full_path.strip_prefix(&canonical_root) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => name.clone(),
        };

        entries.push(WorkspaceFileEntry {
            name,
            path: entry_rel_path,
            is_dir,
            is_symlink,
            size_bytes,
            extension,
        });
    }

    // Sort directories first alphabetically, then files alphabetically
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

#[tauri::command]
pub async fn cmd_read_workspace_directory(
    workspace_id: Option<String>,
    relative_path: Option<String>,
) -> Result<Vec<WorkspaceFileEntry>, String> {
    let root = resolve_workspace_root_async(workspace_id.as_deref()).await;
    read_workspace_directory_impl(&root, relative_path.as_deref())
}

pub fn read_workspace_file_impl(
    root: &Path,
    relative_path: &str,
    max_bytes: Option<usize>,
) -> Result<WorkspaceFileContent, String> {
    let limit = max_bytes.unwrap_or(256 * 1024); // default 256KB
    let trimmed = relative_path.trim_start_matches('/');
    if trimmed.is_empty() {
        return Err("Relative path cannot be empty".to_string());
    }

    let target_file = root.join(trimmed);
    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let canonical_target = target_file
        .canonicalize()
        .map_err(|e| format!("File '{}' not found: {}", relative_path, e))?;

    if !canonical_target.starts_with(&canonical_root) {
        return Err(format!(
            "Security violation: path '{}' escapes workspace root",
            relative_path
        ));
    }
    if !canonical_target.is_file() {
        return Err(format!("Path '{}' is not a file", relative_path));
    }

    let metadata = std::fs::metadata(&canonical_target)
        .map_err(|e| format!("Cannot read metadata for '{}': {}", relative_path, e))?;
    let total_bytes = metadata.len();

    let file = std::fs::File::open(&canonical_target)
        .map_err(|e| format!("Cannot open file '{}': {}", relative_path, e))?;

    use std::io::Read;
    let mut buffer = Vec::new();
    file.take(limit as u64)
        .read_to_end(&mut buffer)
        .map_err(|e| format!("Failed to read file '{}': {}", relative_path, e))?;

    let is_truncated = total_bytes > buffer.len() as u64;
    let content = String::from_utf8_lossy(&buffer).to_string();

    Ok(WorkspaceFileContent {
        relative_path: relative_path.to_string(),
        content,
        total_bytes,
        is_truncated,
    })
}

#[tauri::command]
pub async fn cmd_read_workspace_file(
    workspace_id: Option<String>,
    relative_path: String,
    max_bytes: Option<usize>,
) -> Result<WorkspaceFileContent, String> {
    let root = resolve_workspace_root_async(workspace_id.as_deref()).await;
    read_workspace_file_impl(&root, &relative_path, max_bytes)
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct FsReadFileResponse {
    pub file_path: String,
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub total_lines: usize,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct FsWriteFileResponse {
    pub file_path: String,
    pub bytes_written: usize,
}

#[tauri::command]
pub async fn cmd_fs_list_directory(
    root_path: Option<String>,
    recursive: Option<bool>,
    max_depth: Option<usize>,
    state: State<'_, GuiBridgeState>,
) -> Result<Vec<aether_protocol::ipc::FsEntryInfo>, String> {
    let payload = IpcRequestPayload::FsListDirectory {
        root_path: root_path.unwrap_or_else(|| ".".to_string()),
        recursive: recursive.unwrap_or(true),
        max_depth: max_depth.unwrap_or(5),
    };
    match state.send_request(payload).await? {
        IpcResponsePayload::FsDirectoryListing { entries } => Ok(entries),
        other => Err(format!("Unexpected response payload: {:?}", other)),
    }
}

#[tauri::command]
pub async fn cmd_fs_read_file(
    file_path: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
    state: State<'_, GuiBridgeState>,
) -> Result<FsReadFileResponse, String> {
    let payload = IpcRequestPayload::FsReadFile {
        file_path,
        start_line,
        end_line,
    };
    match state.send_request(payload).await? {
        IpcResponsePayload::FsFileContent {
            file_path,
            content,
            start_line,
            end_line,
            total_lines,
        } => Ok(FsReadFileResponse {
            file_path,
            content,
            start_line,
            end_line,
            total_lines,
        }),
        other => Err(format!("Unexpected response payload: {:?}", other)),
    }
}

#[tauri::command]
pub async fn cmd_fs_write_or_edit_file(
    file_path: String,
    operation: String,
    content: String,
    state: State<'_, GuiBridgeState>,
) -> Result<FsWriteFileResponse, String> {
    let payload = IpcRequestPayload::FsWriteOrEditFile {
        file_path,
        operation,
        content,
    };
    match state.send_request(payload).await? {
        IpcResponsePayload::FsFileModified {
            file_path,
            bytes_written,
        } => Ok(FsWriteFileResponse {
            file_path,
            bytes_written,
        }),
        other => Err(format!("Unexpected response payload: {:?}", other)),
    }
}

#[tauri::command]
pub async fn cmd_fs_delete_path(
    file_path: String,
    state: State<'_, GuiBridgeState>,
) -> Result<String, String> {
    let payload = IpcRequestPayload::FsDeletePath { file_path };
    match state.send_request(payload).await? {
        IpcResponsePayload::FsPathDeleted { file_path } => Ok(file_path),
        other => Err(format!("Unexpected response payload: {:?}", other)),
    }
}

#[derive(Deserialize)]
struct RgJsonMessage {
    r#type: String,
    data: Option<RgJsonData>,
}

#[derive(Deserialize)]
struct RgJsonData {
    path: Option<RgJsonPath>,
    lines: Option<RgJsonLines>,
    line_number: Option<usize>,
    submatches: Option<Vec<RgJsonSubmatch>>,
}

#[derive(Deserialize)]
struct RgJsonPath {
    text: Option<String>,
}

#[derive(Deserialize)]
struct RgJsonLines {
    text: Option<String>,
}

#[derive(Deserialize)]
struct RgJsonSubmatch {
    start: usize,
    end: usize,
}

pub fn search_workspace_files_with_rg(
    root: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<WorkspaceSearchMatch>, String> {
    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut child = std::process::Command::new("rg")
        .arg("--json")
        .arg("--smart-case")
        .arg("-F")
        .arg("-g").arg("!.git")
        .arg("-g").arg("!target")
        .arg("-g").arg("!node_modules")
        .arg("-g").arg("!dist")
        .arg("-g").arg("!.aether")
        .arg("-e").arg(query)
        .arg(&canonical_root)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn rg: {}", e))?;

    let stdout = child.stdout.take().ok_or_else(|| "Failed to capture rg stdout".to_string())?;
    use std::io::BufRead;
    let reader = std::io::BufReader::new(stdout);
    let mut matches = Vec::new();

    for line_res in reader.lines() {
        let line = match line_res {
            Ok(l) => l,
            Err(_) => break,
        };

        if let Ok(msg) = serde_json::from_str::<RgJsonMessage>(&line) {
            if msg.r#type == "match" {
                if let Some(data) = msg.data {
                    let file_path = data
                        .path
                        .and_then(|p| p.text)
                        .map(|p_str| {
                            let p = PathBuf::from(&p_str);
                            p.strip_prefix(&canonical_root)
                                .map(|stripped| stripped.to_string_lossy().replace('\\', "/"))
                                .unwrap_or_else(|_| p_str)
                        })
                        .unwrap_or_default();

                    let line_number = data.line_number.unwrap_or(1);
                    let raw_lines = data.lines.and_then(|l| l.text).unwrap_or_default();
                    let line_content = raw_lines.trim_end_matches(&['\r', '\n'][..]).to_string();

                    if let Some(submatches) = data.submatches {
                        for sub in submatches {
                            matches.push(WorkspaceSearchMatch {
                                file_path: file_path.clone(),
                                line_number,
                                line_content: line_content.clone(),
                                match_start: sub.start,
                                match_end: sub.end,
                            });
                            if matches.len() >= limit {
                                break;
                            }
                        }
                    }

                    if matches.len() >= limit {
                        let _ = child.kill();
                        break;
                    }
                }
            }
        }
    }

    let status = child.wait().map_err(|e| format!("Failed to wait for rg: {}", e))?;
    if !status.success() && matches.is_empty() {
        return Err(format!("rg exited with status {:?} and no matches", status.code()));
    }
    Ok(matches)
}

pub fn search_workspace_files_rust(
    root: &Path,
    query: &str,
    limit: usize,
) -> Vec<WorkspaceSearchMatch> {
    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut matches = Vec::new();
    let mut dirs_to_visit = vec![canonical_root.clone()];

    let query_chars: Vec<char> = query.chars().flat_map(|c| c.to_lowercase()).collect();
    if query_chars.is_empty() {
        return Vec::new();
    }
    let first_q_char = query_chars[0];
    let first_is_ascii = first_q_char.is_ascii();
    let is_case_sensitive = query.chars().any(|c| c.is_uppercase());

    while let Some(current_dir) = dirs_to_visit.pop() {
        let read_dir = match std::fs::read_dir(&current_dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };

        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            // Skip hidden/build directories
            if name == ".git" || name == "target" || name == "node_modules" || name == "dist" || name == ".aether" {
                continue;
            }

            let path = entry.path();
            if let Ok(ft) = entry.file_type() {
                if ft.is_dir() {
                    dirs_to_visit.push(path);
                    continue;
                }
                if !ft.is_file() {
                    continue;
                }
            } else {
                continue;
            }

            // Skip large files (> 5MB)
            if let Ok(meta) = entry.metadata() {
                if meta.len() > 5 * 1024 * 1024 {
                    continue;
                }
            }

            // Check if binary file (first 1024 bytes containing null byte)
            let mut file = match std::fs::File::open(&path) {
                Ok(f) => f,
                Err(_) => continue,
            };

            use std::io::Read;
            let mut header = [0u8; 1024];
            let bytes_read = match file.read(&mut header) {
                Ok(n) => n,
                Err(_) => continue,
            };
            if header[..bytes_read].contains(&0) {
                continue; // Skip binary file
            }

            // Re-open for line-by-line reading
            let file = match std::fs::File::open(&path) {
                Ok(f) => f,
                Err(_) => continue,
            };

            use std::io::BufRead;
            let reader = std::io::BufReader::new(file);
            let rel_path = path
                .strip_prefix(&canonical_root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| path.to_string_lossy().to_string());

            for (idx, line_res) in reader.lines().enumerate() {
                let line = match line_res {
                    Ok(l) => l,
                    Err(_) => break, // Invalid UTF-8 midway
                };

                let line_number = idx + 1;
                if is_case_sensitive {
                    let mut start_idx = 0;
                    while let Some(pos) = line[start_idx..].find(query) {
                        let match_start = start_idx + pos;
                        let match_end = match_start + query.len();
                        matches.push(WorkspaceSearchMatch {
                            file_path: rel_path.clone(),
                            line_number,
                            line_content: line.clone(),
                            match_start,
                            match_end,
                        });
                        start_idx = match_end;
                        if matches.len() >= limit {
                            return matches;
                        }
                    }
                } else {
                    let mut start_idx = 0;
                    while start_idx < line.len() {
                        let mut found = None;
                        for (start_byte, c_start) in line[start_idx..].char_indices() {
                            let abs_start = start_idx + start_byte;
                            if first_is_ascii && c_start.is_ascii() && c_start.to_ascii_lowercase() != first_q_char {
                                continue;
                            }

                            let mut q_idx = 0;
                            let mut end_byte = abs_start;
                            let mut matched = false;

                            for (char_offset, c) in line[abs_start..].char_indices() {
                                let mut c_matched = true;
                                if c.is_ascii() {
                                    let lc = c.to_ascii_lowercase();
                                    if q_idx < query_chars.len() && lc == query_chars[q_idx] {
                                        q_idx += 1;
                                    } else {
                                        c_matched = false;
                                    }
                                } else {
                                    for lc in c.to_lowercase() {
                                        if q_idx < query_chars.len() && lc == query_chars[q_idx] {
                                            q_idx += 1;
                                        } else {
                                            c_matched = false;
                                            break;
                                        }
                                    }
                                }

                                if !c_matched {
                                    break;
                                }

                                end_byte = abs_start + char_offset + c.len_utf8();
                                if q_idx == query_chars.len() {
                                    matched = true;
                                    break;
                                }
                            }

                            if matched {
                                found = Some((abs_start, end_byte));
                                break;
                            }
                        }

                        if let Some((m_start, m_end)) = found {
                            matches.push(WorkspaceSearchMatch {
                                file_path: rel_path.clone(),
                                line_number,
                                line_content: line.clone(),
                                match_start: m_start,
                                match_end: m_end,
                            });
                            if matches.len() >= limit {
                                return matches;
                            }
                            start_idx = if m_end > m_start { m_end } else { m_start + 1 };
                        } else {
                            break;
                        }
                    }
                }
            }
        }
    }

    matches
}

pub fn search_workspace_files_impl(
    root: &Path,
    query: &str,
    max_results: Option<usize>,
) -> Result<Vec<WorkspaceSearchMatch>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let limit = max_results.unwrap_or(100).max(1);

    // Try ripgrep first for ultra-fast native search
    match search_workspace_files_with_rg(root, query, limit) {
        Ok(matches) => Ok(matches),
        Err(_) => {
            // Fallback to recursive Rust search walker
            Ok(search_workspace_files_rust(root, query, limit))
        }
    }
}

#[tauri::command]
pub async fn cmd_search_workspace_files(
    workspace_id: Option<String>,
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<WorkspaceSearchMatch>, String> {
    let root = resolve_workspace_root_async(workspace_id.as_deref()).await;
    search_workspace_files_impl(&root, &query, max_results)
}


pub fn ensure_daemon_running() {
    let socket_path = resolve_socket_path();
    if std::os::unix::net::UnixStream::connect(&socket_path).is_err() {
        let mut candidates = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                candidates.push(parent.join("aetherd"));
                candidates.push(parent.join("../release/aetherd"));
                candidates.push(parent.join("../debug/aetherd"));
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(PathBuf::from(home).join(".local/bin/aetherd"));
        }
        candidates.push(PathBuf::from("/usr/local/bin/aetherd"));
        candidates.push(PathBuf::from("/usr/bin/aetherd"));

        for candidate in candidates {
            if candidate.is_file() {
                info!("Auto-spawning aetherd daemon from {}...", candidate.display());
                let _ = std::process::Command::new(&candidate)
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn();
                std::thread::sleep(std::time::Duration::from_millis(300));
                break;
            }
        }
    }
}

#[tauri::command]
pub async fn cmd_save_ai_provider_config(
    provider: String,
    api_key: String,
    model: String,
    base_url: Option<String>,
    display_name: Option<String>,
    protocol: Option<String>,
    state: State<'_, GuiBridgeState>,
) -> Result<ProviderConfig, String> {
    let payload = IpcRequestPayload::SaveAiProviderConfig {
        provider,
        api_key,
        model,
        base_url,
        display_name,
        protocol,
    };
    match state.send_request(payload).await? {
        IpcResponsePayload::AiProviderConfig(config) => Ok(config),
        other => Err(format!("Unexpected response payload: {:?}", other)),
    }
}

#[tauri::command]
pub async fn cmd_delete_ai_provider_config(
    provider: String,
    state: State<'_, GuiBridgeState>,
) -> Result<ProviderConfig, String> {
    let payload = IpcRequestPayload::DeleteAiProviderConfig { provider };
    match state.send_request(payload).await? {
        IpcResponsePayload::AiProviderConfig(config) => Ok(config),
        other => Err(format!("Unexpected response payload: {:?}", other)),
    }
}

#[tauri::command]
pub async fn cmd_get_ai_provider_config(
    state: State<'_, GuiBridgeState>,
) -> Result<ProviderConfig, String> {
    let payload = IpcRequestPayload::GetAiProviderConfig;
    match state.send_request(payload).await? {
        IpcResponsePayload::AiProviderConfig(config) => Ok(config),
        other => Err(format!("Unexpected response payload: {:?}", other)),
    }
}

#[tauri::command]
pub async fn cmd_run_ai_pilot_prompt(
    pane_id: String,
    instruction: String,
    state: State<'_, GuiBridgeState>,
) -> Result<String, String> {
    let payload = IpcRequestPayload::RunAiPilotPrompt {
        pane_id,
        instruction,
    };
    match state.send_request(payload).await? {
        IpcResponsePayload::AiPilotPromptResult { result } => Ok(result),
        other => Err(format!("Unexpected response payload: {:?}", other)),
    }
}

#[tauri::command]
pub async fn cmd_test_ai_provider(
    provider: String,
    api_key: String,
    model: String,
    base_url: Option<String>,
    state: State<'_, GuiBridgeState>,
) -> Result<String, String> {
    let payload = IpcRequestPayload::TestAiProviderConnection {
        provider,
        api_key,
        model,
        base_url,
    };
    match state.send_request(payload).await? {
        IpcResponsePayload::AiProviderTestResult { success, message } => {
            if success {
                Ok(message)
            } else {
                Err(message)
            }
        }
        other => Err(format!("Unexpected response payload: {:?}", other)),
    }
}

#[tauri::command]
pub async fn cmd_ai_chat(
    provider: String,
    model: Option<String>,
    prompt: String,
    system_prompt: Option<String>,
    history: Option<Vec<ChatHistoryEntry>>,
    state: State<'_, GuiBridgeState>,
) -> Result<String, String> {
    let payload = IpcRequestPayload::AiChat {
        provider,
        model,
        prompt,
        system_prompt,
        history,
    };
    match state.send_request(payload).await? {
        IpcResponsePayload::AiChatResult { content } => Ok(content),
        other => Err(format!("Unexpected response payload: {:?}", other)),
    }
}

pub fn resolve_socket_path() -> PathBuf {
    if let Ok(path) = std::env::var("AETHER_SOCK").or_else(|_| std::env::var(AETHER_SOCK_ENV)) {
        return PathBuf::from(path);
    }
    if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
        return PathBuf::from(runtime_dir).join(DEFAULT_SOCKET_NAME);
    }
    let uid = unsafe { libc::getuid() };
    PathBuf::from(format!("/run/user/{uid}")).join(DEFAULT_SOCKET_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::time::{sleep, Duration};

    #[tokio::test]
    async fn test_process_event_stream_batch_threshold() {
        let (tx, rx) = tokio::sync::mpsc::channel(100);
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_clone = emitted.clone();

        let handle = tokio::spawn(async move {
            process_event_stream(
                rx,
                move |_name, event| {
                    emitted_clone.lock().unwrap().push(event);
                },
                1024, // 1KB threshold for fast test
                100,  // 100ms interval
            )
            .await;
        });

        // Send 600 bytes (below 1KB threshold)
        tx.send(IpcMessage::Event(IpcEvent::PtyOutput {
            pane_id: "pane_1".to_string(),
            data: vec![b'A'; 600],
            offset: 0,
        }))
        .await
        .unwrap();

        // Give a tiny moment for processing message
        sleep(Duration::from_millis(10)).await;
        // Still below threshold and before 100ms interval
        assert_eq!(emitted.lock().unwrap().len(), 0);

        // Send another 600 bytes -> 1200 bytes total >= 1024 bytes threshold!
        tx.send(IpcMessage::Event(IpcEvent::PtyOutput {
            pane_id: "pane_1".to_string(),
            data: vec![b'B'; 600],
            offset: 600,
        }))
        .await
        .unwrap();

        sleep(Duration::from_millis(15)).await;
        let lock = emitted.lock().unwrap();
        assert_eq!(lock.len(), 1);
        if let IpcEvent::PtyOutput { pane_id, data, offset } = &lock[0] {
            assert_eq!(pane_id, "pane_1");
            assert_eq!(*offset, 0);
            assert_eq!(data.len(), 1200);
            assert_eq!(&data[..600], vec![b'A'; 600].as_slice());
            assert_eq!(&data[600..], vec![b'B'; 600].as_slice());
        } else {
            panic!("Expected PtyOutput event");
        }
        drop(lock);

        drop(tx);
        let _ = handle.await;
    }

    #[tokio::test]
    async fn test_process_event_stream_interval_flush() {
        let (tx, rx) = tokio::sync::mpsc::channel(100);
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_clone = emitted.clone();

        let handle = tokio::spawn(async move {
            process_event_stream(
                rx,
                move |_name, event| {
                    emitted_clone.lock().unwrap().push(event);
                },
                10 * 1024, // 10KB threshold
                20,        // 20ms interval
            )
            .await;
        });

        // Send small 50 bytes (far below threshold)
        tx.send(IpcMessage::Event(IpcEvent::PtyOutput {
            pane_id: "pane_2".to_string(),
            data: b"hello interval".to_vec(),
            offset: 0,
        }))
        .await
        .unwrap();

        // Before interval: empty
        sleep(Duration::from_millis(5)).await;
        assert_eq!(emitted.lock().unwrap().len(), 0);

        // After interval (>= 25ms): should be flushed
        sleep(Duration::from_millis(30)).await;
        let lock = emitted.lock().unwrap();
        assert_eq!(lock.len(), 1);
        if let IpcEvent::PtyOutput { pane_id, data, offset } = &lock[0] {
            assert_eq!(pane_id, "pane_2");
            assert_eq!(*offset, 0);
            assert_eq!(data.as_slice(), b"hello interval");
        } else {
            panic!("Expected PtyOutput event");
        }
        drop(lock);

        drop(tx);
        let _ = handle.await;
    }

    #[tokio::test]
    async fn test_process_event_stream_pane_exit_order() {
        let (tx, rx) = tokio::sync::mpsc::channel(100);
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let emitted_clone = emitted.clone();

        let handle = tokio::spawn(async move {
            process_event_stream(
                rx,
                move |_name, event| {
                    emitted_clone.lock().unwrap().push(event);
                },
                10 * 1024,
                200,
            )
            .await;
        });

        // Send small data
        tx.send(IpcMessage::Event(IpcEvent::PtyOutput {
            pane_id: "pane_3".to_string(),
            data: b"final output".to_vec(),
            offset: 0,
        }))
        .await
        .unwrap();

        // Immediately send PaneExited
        tx.send(IpcMessage::Event(IpcEvent::PaneExited {
            pane_id: "pane_3".to_string(),
            exit_code: Some(0),
        }))
        .await
        .unwrap();

        sleep(Duration::from_millis(15)).await;

        let lock = emitted.lock().unwrap();
        assert_eq!(lock.len(), 2);
        // First event must be the flushed PtyOutput
        match &lock[0] {
            IpcEvent::PtyOutput { pane_id, data, offset } => {
                assert_eq!(pane_id, "pane_3");
                assert_eq!(*offset, 0);
                assert_eq!(data.as_slice(), b"final output");
            }
            other => panic!("Expected PtyOutput, got {:?}", other),
        }
        // Second event must be PaneExited
        match &lock[1] {
            IpcEvent::PaneExited { pane_id, exit_code } => {
                assert_eq!(pane_id, "pane_3");
                assert_eq!(*exit_code, Some(0));
            }
            other => panic!("Expected PaneExited, got {:?}", other),
        }
        drop(lock);

        drop(tx);
        let _ = handle.await;
    }

    #[tokio::test]
    async fn test_read_workspace_directory_basic_and_sorting() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_read_dir_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        // Create directories: b_dir, a_dir, z_dir
        std::fs::create_dir_all(temp_dir.join("b_dir")).unwrap();
        std::fs::create_dir_all(temp_dir.join("a_dir")).unwrap();
        std::fs::create_dir_all(temp_dir.join("z_dir")).unwrap();

        // Create files: b_file.txt, a_file.rs, z_file.json
        std::fs::write(temp_dir.join("b_file.txt"), "hello").unwrap();
        std::fs::write(temp_dir.join("a_file.rs"), "fn main() {}").unwrap();
        std::fs::write(temp_dir.join("z_file.json"), "{}").unwrap();

        let entries = cmd_read_workspace_directory(
            Some(temp_dir.to_str().unwrap().to_string()),
            None,
        )
        .await
        .expect("Directory read should succeed");

        assert_eq!(entries.len(), 6);
        // Directories sorted first alphabetically
        assert_eq!(entries[0].name, "a_dir");
        assert!(entries[0].is_dir);
        assert_eq!(entries[0].extension, None);

        assert_eq!(entries[1].name, "b_dir");
        assert!(entries[1].is_dir);

        assert_eq!(entries[2].name, "z_dir");
        assert!(entries[2].is_dir);

        // Then files sorted alphabetically
        assert_eq!(entries[3].name, "a_file.rs");
        assert!(!entries[3].is_dir);
        assert_eq!(entries[3].extension, Some("rs".to_string()));

        assert_eq!(entries[4].name, "b_file.txt");
        assert!(!entries[4].is_dir);
        assert_eq!(entries[4].extension, Some("txt".to_string()));

        assert_eq!(entries[5].name, "z_file.json");
        assert!(!entries[5].is_dir);
        assert_eq!(entries[5].extension, Some("json".to_string()));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_directory_filters_build_and_git() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_filter_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        std::fs::create_dir_all(temp_dir.join(".git")).unwrap();
        std::fs::create_dir_all(temp_dir.join("target")).unwrap();
        std::fs::create_dir_all(temp_dir.join("node_modules")).unwrap();
        std::fs::create_dir_all(temp_dir.join("src")).unwrap();
        std::fs::write(temp_dir.join("Cargo.toml"), "[package]").unwrap();

        let entries = cmd_read_workspace_directory(
            Some(temp_dir.to_str().unwrap().to_string()),
            None,
        )
        .await
        .expect("Directory read should succeed");

        let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert!(!names.contains(&".git".to_string()));
        assert!(!names.contains(&"target".to_string()));
        assert!(!names.contains(&"node_modules".to_string()));
        assert!(names.contains(&"src".to_string()));
        assert!(names.contains(&"Cargo.toml".to_string()));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_directory_traversal_fails() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_trav_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let res = cmd_read_workspace_directory(
            Some(temp_dir.to_str().unwrap().to_string()),
            Some("../../".to_string()),
        )
        .await;

        assert!(res.is_err());
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_file_complete_and_truncated() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_file_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let text = "Hello AetherTerminal Workspace File";
        std::fs::write(temp_dir.join("doc.txt"), text).unwrap();

        // 1. Read complete file
        let full_res = cmd_read_workspace_file(
            Some(temp_dir.to_str().unwrap().to_string()),
            "doc.txt".to_string(),
            None,
        )
        .await
        .expect("Reading file should succeed");

        assert_eq!(full_res.content, text);
        assert!(!full_res.is_truncated);
        assert_eq!(full_res.total_bytes, text.len() as u64);
        assert_eq!(full_res.relative_path, "doc.txt");

        // 2. Read with small max_bytes
        let trunc_res = cmd_read_workspace_file(
            Some(temp_dir.to_str().unwrap().to_string()),
            "doc.txt".to_string(),
            Some(5),
        )
        .await
        .expect("Truncated read should succeed");

        assert_eq!(trunc_res.content, "Hello");
        assert!(trunc_res.is_truncated);
        assert_eq!(trunc_res.total_bytes, text.len() as u64);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_file_traversal_and_missing() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_miss_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let missing = cmd_read_workspace_file(
            Some(temp_dir.to_str().unwrap().to_string()),
            "nonexistent.txt".to_string(),
            None,
        )
        .await;
        assert!(missing.is_err());

        let traversal = cmd_read_workspace_file(
            Some(temp_dir.to_str().unwrap().to_string()),
            "../etc/passwd".to_string(),
            None,
        )
        .await;
        assert!(traversal.is_err());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_search_workspace_files_finds_matches() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_search_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(temp_dir.join("src")).unwrap();
        std::fs::create_dir_all(temp_dir.join(".git")).unwrap();

        let code = "// Line 1\npub fn find_alpha_token() -> i32 {\n    42\n}\n";
        std::fs::write(temp_dir.join("src/lib.rs"), code).unwrap();
        std::fs::write(temp_dir.join("readme.md"), "# Alpha Guide\nfind_alpha_token is helpful.\n").unwrap();
        std::fs::write(temp_dir.join(".git/hidden.txt"), "find_alpha_token should be ignored").unwrap();

        // Binary file with null bytes
        let mut bin = Vec::new();
        bin.extend_from_slice(b"find_alpha_token\0binary_data");
        std::fs::write(temp_dir.join("app.bin"), bin).unwrap();

        let matches = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "find_alpha_token".to_string(),
            Some(10),
        )
        .await
        .expect("Search should succeed");

        assert!(!matches.is_empty());
        for m in &matches {
            assert!(!m.file_path.contains(".git"));
            assert!(!m.file_path.ends_with(".bin"));
            assert!(m.line_content.contains("find_alpha_token"));
            let slice = &m.line_content[m.match_start..m.match_end];
            assert!(slice.eq_ignore_ascii_case("find_alpha_token"));
        }

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_search_workspace_files_empty_query() {
        let matches = cmd_search_workspace_files(None, "   ".to_string(), None)
            .await
            .expect("Empty search should return Ok");
        assert!(matches.is_empty());
    }

    #[test]
    fn test_search_workspace_files_rust_fallback_directly() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_rust_walk_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(temp_dir.join("sub")).unwrap();

        std::fs::write(
            temp_dir.join("sub/test.txt"),
            "first line\nneedle in a haystack\nthird line\n",
        )
        .unwrap();

        let matches = search_workspace_files_rust(&temp_dir, "needle", 10);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].file_path, "sub/test.txt");
        assert_eq!(matches[0].line_number, 2);
        assert_eq!(matches[0].line_content, "needle in a haystack");
        assert_eq!(matches[0].match_start, 0);
        assert_eq!(matches[0].match_end, 6);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_directory_symlink_escape_fails() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_sym_esc_{}", Uuid::new_v4().simple()));
        let outside_dir = std::env::temp_dir().join(format!("aether_gui_test_outside_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::create_dir_all(&outside_dir).unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside_dir, temp_dir.join("link_outside")).unwrap();

        let res = cmd_read_workspace_directory(
            Some(temp_dir.to_str().unwrap().to_string()),
            Some("link_outside".to_string()),
        )
        .await;

        assert!(res.is_err(), "Symlink pointing outside workspace root must fail");
        assert!(res.unwrap_err().contains("Security violation"));

        let _ = std::fs::remove_dir_all(&temp_dir);
        let _ = std::fs::remove_dir_all(&outside_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_directory_file_as_dir_fails() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_file_as_dir_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("regular_file.txt"), "hello").unwrap();

        let res = cmd_read_workspace_directory(
            Some(temp_dir.to_str().unwrap().to_string()),
            Some("regular_file.txt".to_string()),
        )
        .await;

        assert!(res.is_err());
        assert!(res.unwrap_err().contains("not a directory"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_directory_internal_symlink_succeeds() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_int_sym_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(temp_dir.join("real_dir")).unwrap();
        std::fs::write(temp_dir.join("real_dir/child.txt"), "content").unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(temp_dir.join("real_dir"), temp_dir.join("symlink_dir")).unwrap();

        let entries = cmd_read_workspace_directory(
            Some(temp_dir.to_str().unwrap().to_string()),
            Some("symlink_dir".to_string()),
        )
        .await
        .expect("Internal symlink directory read should succeed");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "child.txt");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_directory_dangling_symlink_handled() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_dang_sym_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(temp_dir.join("does_not_exist.txt"), temp_dir.join("broken_link.txt")).unwrap();

        let entries = cmd_read_workspace_directory(
            Some(temp_dir.to_str().unwrap().to_string()),
            None,
        )
        .await
        .expect("Directory with dangling symlink should be read safely without panic");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "broken_link.txt");
        assert!(entries[0].is_symlink);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_file_symlink_escape_fails() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_f_sym_esc_{}", Uuid::new_v4().simple()));
        let outside_dir = std::env::temp_dir().join(format!("aether_gui_test_f_out_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::create_dir_all(&outside_dir).unwrap();

        let outside_file = outside_dir.join("secret.txt");
        std::fs::write(&outside_file, "classified").unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside_file, temp_dir.join("leak_link.txt")).unwrap();

        let res = cmd_read_workspace_file(
            Some(temp_dir.to_str().unwrap().to_string()),
            "leak_link.txt".to_string(),
            None,
        )
        .await;

        assert!(res.is_err(), "Symlink pointing to outside file must fail");
        assert!(res.unwrap_err().contains("Security violation"));

        let _ = std::fs::remove_dir_all(&temp_dir);
        let _ = std::fs::remove_dir_all(&outside_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_file_dir_as_file_fails() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_f_dir_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(temp_dir.join("subdir")).unwrap();

        let res = cmd_read_workspace_file(
            Some(temp_dir.to_str().unwrap().to_string()),
            "subdir".to_string(),
            None,
        )
        .await;

        assert!(res.is_err());
        assert!(res.unwrap_err().contains("not a file"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_file_zero_max_bytes() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_zero_b_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("sample.txt"), "hello world sample content").unwrap();

        let res = cmd_read_workspace_file(
            Some(temp_dir.to_str().unwrap().to_string()),
            "sample.txt".to_string(),
            Some(0),
        )
        .await
        .expect("Zero max_bytes should succeed with empty content");

        assert_eq!(res.content, "");
        assert_eq!(res.total_bytes, 26);
        assert!(res.is_truncated);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_file_exact_boundaries() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_bound_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let data = "0123456789".repeat(10); // 100 bytes
        std::fs::write(temp_dir.join("bound.txt"), &data).unwrap();

        // Exact match
        let res_100 = cmd_read_workspace_file(
            Some(temp_dir.to_str().unwrap().to_string()),
            "bound.txt".to_string(),
            Some(100),
        )
        .await
        .unwrap();
        assert_eq!(res_100.content.len(), 100);
        assert!(!res_100.is_truncated);

        // 1 byte less: truncated
        let res_99 = cmd_read_workspace_file(
            Some(temp_dir.to_str().unwrap().to_string()),
            "bound.txt".to_string(),
            Some(99),
        )
        .await
        .unwrap();
        assert_eq!(res_99.content.len(), 99);
        assert!(res_99.is_truncated);

        // 1 byte more: not truncated
        let res_101 = cmd_read_workspace_file(
            Some(temp_dir.to_str().unwrap().to_string()),
            "bound.txt".to_string(),
            Some(101),
        )
        .await
        .unwrap();
        assert_eq!(res_101.content.len(), 100);
        assert!(!res_101.is_truncated);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_file_empty_file() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_empty_f_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("empty.txt"), "").unwrap();

        let res = cmd_read_workspace_file(
            Some(temp_dir.to_str().unwrap().to_string()),
            "empty.txt".to_string(),
            None,
        )
        .await
        .expect("Reading empty file should succeed");

        assert_eq!(res.content, "");
        assert_eq!(res.total_bytes, 0);
        assert!(!res.is_truncated);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_file_invalid_utf8_binary() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_bin_f_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let bytes = vec![0xFF, 0xFE, 0xFD, 0x80, b'A', b'B'];
        std::fs::write(temp_dir.join("raw.bin"), bytes).unwrap();

        let res = cmd_read_workspace_file(
            Some(temp_dir.to_str().unwrap().to_string()),
            "raw.bin".to_string(),
            None,
        )
        .await
        .expect("Lossy conversion of non-UTF8 bytes should succeed");

        assert_eq!(res.total_bytes, 6);
        assert!(res.content.contains("AB"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_read_workspace_file_large_2mb() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_2mb_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let chunk = "A".repeat(1024 * 1024); // 1MB
        let mut f = std::fs::File::create(temp_dir.join("large.txt")).unwrap();
        use std::io::Write;
        f.write_all(chunk.as_bytes()).unwrap();
        f.write_all(chunk.as_bytes()).unwrap(); // 2MB total
        drop(f);

        let res = cmd_read_workspace_file(
            Some(temp_dir.to_str().unwrap().to_string()),
            "large.txt".to_string(),
            None,
        )
        .await
        .expect("Reading large file should succeed within default 256KB limit");

        assert_eq!(res.total_bytes, 2 * 1024 * 1024);
        assert_eq!(res.content.len(), 256 * 1024);
        assert!(res.is_truncated);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_search_workspace_files_regex_special_characters() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_search_regex_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let code = "let re = \"[a-z]+.*(foo|bar)?$\";\nfn test() { (val + 1) * 2; }\n";
        std::fs::write(temp_dir.join("regex.rs"), code).unwrap();

        // Exact regex chars literal match
        let matches = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "[a-z]+.*(foo|bar)?$".to_string(),
            None,
        )
        .await
        .expect("Literal match on regex special characters should succeed without syntax error");

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].file_path, "regex.rs");
        assert_eq!(matches[0].line_number, 1);

        // Search for parentheses
        let p_matches = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "(val + 1)".to_string(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(p_matches.len(), 1);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_search_workspace_files_max_results_limit() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_limit_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let mut lines = String::new();
        for i in 0..250 {
            lines.push_str(&format!("target_token_index_{}\n", i));
        }
        std::fs::write(temp_dir.join("many_matches.txt"), lines).unwrap();

        // Limit 15
        let res_15 = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "target_token_index".to_string(),
            Some(15),
        )
        .await
        .unwrap();
        assert_eq!(res_15.len(), 15);

        // Default limit (100)
        let res_default = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "target_token_index".to_string(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(res_default.len(), 100);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_search_workspace_files_unicode() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_search_uni_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let content = "Line 1: Привет мир\nLine 2: 你好世界\nLine 3: \u{1f680} rocket launch\n";
        std::fs::write(temp_dir.join("unicode.txt"), content).unwrap();

        let cyrillic = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "Привет".to_string(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(cyrillic.len(), 1);
        assert_eq!(cyrillic[0].line_number, 1);
        let slice = &cyrillic[0].line_content[cyrillic[0].match_start..cyrillic[0].match_end];
        assert_eq!(slice, "Привет");

        let cjk = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "你好".to_string(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(cjk.len(), 1);
        assert_eq!(cjk[0].line_number, 2);

        let emoji = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "\u{1f680}".to_string(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(emoji.len(), 1);
        assert_eq!(emoji[0].line_number, 3);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_search_workspace_files_dash_queries() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_dash_q_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let content = "let flag = \"-v\";\nlet opt = \"-e\";\nlet help = \"--help\";\n";
        std::fs::write(temp_dir.join("flags.rs"), content).unwrap();

        let res_v = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "-v".to_string(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(res_v.len(), 1, "Searching for '-v' should find the line containing '-v'");

        let res_e = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "-e".to_string(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(res_e.len(), 1, "Searching for '-e' should find the line containing '-e'");

        let res_help = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "--help".to_string(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(res_help.len(), 1, "Searching for '--help' should find the line containing '--help'");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_search_workspace_files_rust_unicode_byte_offsets() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_test_rust_uni_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        // Kelvin sign U+212A (3 bytes in UTF-8: E2 84 AA).
        // In lowercase, U+212A becomes 'k' (1 byte: 6B).
        // This shifts byte offsets of all subsequent characters by 2 bytes!
        let line = "prefix \u{212a} suffix target_match";
        std::fs::write(temp_dir.join("sample.txt"), line).unwrap();

        let matches = search_workspace_files_rust(&temp_dir, "target_match", 10);
        assert_eq!(matches.len(), 1);
        let m = &matches[0];

        // If match_start and match_end were computed against line_lower without adjusting
        // for UTF-8 byte length changes, slicing `m.line_content[m.match_start..m.match_end]`
        // will slice the wrong characters or panic on char boundary!
        let slice = &m.line_content[m.match_start..m.match_end];
        assert_eq!(slice, "target_match", "Slice must match target_match exactly");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_adversarial_search_dash_and_flag_queries() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_adv_dash_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let content = "\
line 1: let opt = \"-v\";
line 2: let opt = \"-e\";
line 3: let opt = \"--help\";
line 4: let opt = \"-foo\";
line 5: let opt = \"--\";
line 6: let opt = \"-\";
line 7: let opt = \"--json\";
line 8: let opt = \"-n\";
line 9: let opt = \"-c\";
line 10: let opt = \"-l\";
line 11: let opt = \"-o\";
line 12: let opt = \"-g\";
line 13: let opt = \"--smart-case\";
line 14: let opt = \"-F\";
line 15: repeat -foo here and -foo there
";
        std::fs::write(temp_dir.join("flags_adv.txt"), content).unwrap();

        let dash_queries = vec![
            ("-v", 1),
            ("-e", 1),
            ("--help", 1),
            ("-foo", 3), // line 4 + line 15 twice
            ("--", 3),   // line 3 (--help), line 5 (--), line 7 (--json), line 13 (--smart-case) => at least 3
            ("-", 17),   // present in all lines with '-'
            ("--json", 1),
            ("-n", 1),
            ("-c", 1),
            ("-l", 1),
            ("-o", 1),
            ("-g", 1),
            ("--smart-case", 1),
            ("-F", 1),
        ];

        for (query, expected_min_matches) in dash_queries {
            // Test 1: Full command (ripgrep)
            let res = cmd_search_workspace_files(
                Some(temp_dir.to_str().unwrap().to_string()),
                query.to_string(),
                None,
            )
            .await
            .unwrap_or_else(|e| panic!("Search failed for query {:?}: {}", query, e));

            assert!(
                res.len() >= expected_min_matches,
                "Query {:?} expected at least {} matches, got {}",
                query,
                expected_min_matches,
                res.len()
            );

            for m in &res {
                assert!(m.line_content.is_char_boundary(m.match_start), "match_start not on char boundary");
                assert!(m.line_content.is_char_boundary(m.match_end), "match_end not on char boundary");
                let matched_text = &m.line_content[m.match_start..m.match_end];
                assert_eq!(
                    matched_text.to_lowercase(),
                    query.to_lowercase(),
                    "Matched slice must equal query"
                );
            }

            // Test 2: Pure Rust fallback directly
            let rust_res = search_workspace_files_rust(&temp_dir, query, 100);
            assert!(
                rust_res.len() >= expected_min_matches,
                "Rust fallback for {:?} expected at least {} matches, got {}",
                query,
                expected_min_matches,
                rust_res.len()
            );

            for m in &rust_res {
                assert!(m.line_content.is_char_boundary(m.match_start), "match_start not on char boundary");
                assert!(m.line_content.is_char_boundary(m.match_end), "match_end not on char boundary");
                let matched_text = &m.line_content[m.match_start..m.match_end];
                assert_eq!(
                    matched_text.to_lowercase(),
                    query.to_lowercase(),
                    "Rust fallback matched slice must equal query"
                );
            }
        }

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_adversarial_search_regex_and_empty_queries() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_adv_regex_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let content = "\
line 1: .*+?^${}()|[]\\
line 2: (a + b) * [c - d]
line 3: fn test() -> Result<(), Box<dyn Error>> { Ok(()) }
line 4: path/to/file?query=1&param=true
line 5: empty lines and spaces
";
        std::fs::write(temp_dir.join("regex_adv.txt"), content).unwrap();

        // Adversarial metacharacter queries
        let metachars = vec![
            ".*+?^${}()|[]\\",
            "(",
            ")",
            "[",
            "]",
            "{",
            "}",
            "^",
            "$",
            "\\",
            "|",
            "+",
            "?",
            "*",
        ];

        for meta in metachars {
            let res = cmd_search_workspace_files(
                Some(temp_dir.to_str().unwrap().to_string()),
                meta.to_string(),
                None,
            )
            .await
            .unwrap_or_else(|e| panic!("Metachar search failed for {:?}: {}", meta, e));

            assert!(
                !res.is_empty(),
                "Query {:?} should have found at least one match",
                meta
            );

            for m in &res {
                assert!(m.line_content.is_char_boundary(m.match_start));
                assert!(m.line_content.is_char_boundary(m.match_end));
                let slice = &m.line_content[m.match_start..m.match_end];
                assert_eq!(slice, meta, "Matched slice must match literal query");
            }
        }

        // Empty and whitespace queries must return Ok(empty)
        for empty_q in &["", "   ", "\t", "\n", " \t \r\n "] {
            let res = cmd_search_workspace_files(
                Some(temp_dir.to_str().unwrap().to_string()),
                empty_q.to_string(),
                None,
            )
            .await
            .expect("Empty query should succeed with empty result");
            assert!(res.is_empty(), "Empty query should return 0 results");
        }

        // Query with no matches
        let no_match = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "completely_absent_token_xyz987".to_string(),
            None,
        )
        .await
        .expect("No-match search should succeed with empty result");
        assert!(no_match.is_empty());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_adversarial_unicode_stress_and_char_boundaries() {
        let temp_dir = std::env::temp_dir().join(format!("aether_gui_adv_uni_{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        // 1. Line with multiple byte-shrinking and multi-byte characters before target
        // Kelvin sign \u{212a} (3 bytes), Angstrom \u{212b} (3 bytes), Sharp S \u{1e9e} (3 bytes), Rocket \u{1f680} (4 bytes)
        let line1 = "\u{1f680} prefix \u{212a} and \u{212b} and \u{1e9e} target_alpha suffix\n";
        // 2. Cyrillic and Greek
        let line2 = "Greek: ΣΙΣΥΦΟΣ and Cyrillic: ПРИВЕТ МИР and French: CAFÉ\n";
        // 3. Repeating targets with Unicode in between
        let line3 = "match_here 你好 match_here мир match_here\n";

        std::fs::write(temp_dir.join("unicode_stress.txt"), format!("{}{}{}", line1, line2, line3)).unwrap();

        // Search for target_alpha (Rust walker fallback & rg)
        let matches_alpha = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "target_alpha".to_string(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(matches_alpha.len(), 1);
        let m = &matches_alpha[0];
        assert!(m.line_content.is_char_boundary(m.match_start));
        assert!(m.line_content.is_char_boundary(m.match_end));
        assert_eq!(&m.line_content[m.match_start..m.match_end], "target_alpha");

        // Pure Rust fallback check for target_alpha
        let rust_alpha = search_workspace_files_rust(&temp_dir, "target_alpha", 10);
        assert_eq!(rust_alpha.len(), 1);
        let m_rust = &rust_alpha[0];
        assert!(m_rust.line_content.is_char_boundary(m_rust.match_start));
        assert!(m_rust.line_content.is_char_boundary(m_rust.match_end));
        assert_eq!(&m_rust.line_content[m_rust.match_start..m_rust.match_end], "target_alpha");

        // Case-insensitive Greek search:
        // rg supports full Unicode case-folding equating final sigma 'ς' to 'Σ'
        let matches_greek_rg = cmd_search_workspace_files(
            Some(temp_dir.to_str().unwrap().to_string()),
            "σισυφος".to_string(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(matches_greek_rg.len(), 1);
        let m_greek_rg = &matches_greek_rg[0];
        assert_eq!(&m_greek_rg.line_content[m_greek_rg.match_start..m_greek_rg.match_end], "ΣΙΣΥΦΟΣ");

        // Rust fallback matches standard lowercase sigma 'σ' against 'Σ'
        let matches_greek = search_workspace_files_rust(&temp_dir, "σισυφοσ", 10);
        assert_eq!(matches_greek.len(), 1);
        let m_greek = &matches_greek[0];
        assert!(m_greek.line_content.is_char_boundary(m_greek.match_start));
        assert!(m_greek.line_content.is_char_boundary(m_greek.match_end));
        assert_eq!(&m_greek.line_content[m_greek.match_start..m_greek.match_end], "ΣΙΣΥΦΟΣ");

        // Case-insensitive Cyrillic search
        let matches_cyr = search_workspace_files_rust(&temp_dir, "привет", 10);
        assert_eq!(matches_cyr.len(), 1);
        let m_cyr = &matches_cyr[0];
        assert!(m_cyr.line_content.is_char_boundary(m_cyr.match_start));
        assert!(m_cyr.line_content.is_char_boundary(m_cyr.match_end));
        assert_eq!(&m_cyr.line_content[m_cyr.match_start..m_cyr.match_end], "ПРИВЕТ");

        // Repeating target across line
        let matches_rep = search_workspace_files_rust(&temp_dir, "match_here", 10);
        assert_eq!(matches_rep.len(), 3);
        for mr in &matches_rep {
            assert!(mr.line_content.is_char_boundary(mr.match_start));
            assert!(mr.line_content.is_char_boundary(mr.match_end));
            assert_eq!(&mr.line_content[mr.match_start..mr.match_end], "match_here");
        }

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}



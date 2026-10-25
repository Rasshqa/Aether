use aether_protocol::agent::AgentStatus;
use aether_protocol::ipc::async_codec::{read_ipc_message, write_ipc_message};
use aether_protocol::ipc::{
    IpcEvent, IpcMessage, IpcRequest, IpcRequestPayload, IpcResponse,
    IpcResponsePayload, PaneSpawnedInfo, PaneSummary,
};
use aether_protocol::{AETHER_SOCK_ENV, DEFAULT_SOCKET_NAME};
use aetherd::brain_db::BrainDb;
use aetherd::obsidian_sync::ObsidianSyncEngine;
use aetherd::pty_manager::PtyManager;
use aetherd::snapshot_engine::SnapshotEngine;
use aetherd::worktree_engine::WorktreeEngine;
use aetherd::DaemonContext;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::broadcast;
use tracing::{debug, error, info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
use uuid::Uuid;

fn resolve_default_home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

fn resolve_default_vault_path() -> PathBuf {
    if let Some(proj_dirs) = directories::ProjectDirs::from("com", "aether", "aether") {
        proj_dirs.data_local_dir().join("vault")
    } else {
        resolve_default_home_dir().join(".local/share/aether/vault")
    }
}

/// Pick the working directory for a new pane.
///
/// Priority: explicit request → workspace repo root → `/`. Never `$HOME`: a fresh
/// pane used to land in the user's home directory because that was the fallback.
fn resolve_spawn_working_dir(
    requested: &Path,
    workspace_root: Option<PathBuf>,
    home_dir: &Path,
) -> PathBuf {
    let dir = if !requested.as_os_str().is_empty() && requested != Path::new(".") {
        requested.to_path_buf()
    } else {
        match workspace_root {
            Some(root) if root.exists() && root != home_dir => root,
            _ => PathBuf::from("/"),
        }
    };
    if dir.exists() {
        dir
    } else {
        PathBuf::from("/")
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Initialize Logging
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("aetherd=info,aether_protocol=info")),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting AetherTerminal Core Daemon (aetherd)...");

    // 1b. Seed default configuration (~/.config/aether/)
    if let Err(e) = aetherd::config::ensure_default_configs() {
        warn!("Could not ensure default configs: {}", e);
    }

    // 2. Resolve Socket and DB Paths
    let socket_path = resolve_socket_path();
    info!("Unix Domain Socket path: {}", socket_path.display());

    // 3. Initialize Shared Brain Database
    let db = match BrainDb::open_default() {
        Ok(database) => {
            info!("Shared Brain database initialized at: {}", database.path().display());
            database
        }
        Err(e) => {
            error!("Failed to open default brain database: {}. Falling back to in-memory store.", e);
            BrainDb::open_in_memory()?
        }
    };

    // Ensure default workspace and obsidian vault exist
    let home_dir = resolve_default_home_dir();
    let default_vault = resolve_default_vault_path();
    let _ = std::fs::create_dir_all(&default_vault);
    let _ = db.upsert_workspace(
        "default",
        "Default Workspace",
        &home_dir.to_string_lossy(),
        Some(&default_vault.to_string_lossy()),
    );
    // Clear stale agent instances from previous daemon lifecycles
    let _ = db.clear_all_agent_instances();

    // Event bus must exist before the Obsidian engine so note updates reach the GUI
    let (event_tx, _) = broadcast::channel::<IpcEvent>(2048);

    let obsidian_sync = Arc::new(
        ObsidianSyncEngine::new(db.clone(), "default", &default_vault)
            .with_event_tx(event_tx.clone()),
    );
    if let Err(e) = obsidian_sync.index_entire_vault() {
        warn!("Failed to index default obsidian vault: {}", e);
    }
    let _obsidian_watcher = match obsidian_sync.clone().start_watcher() {
        Ok(w) => {
            info!("Obsidian vault file watcher started on {}", default_vault.display());
            Some(w)
        }
        Err(e) => {
            warn!("Failed to start obsidian vault watcher: {}", e);
            None
        }
    };

    // 4. Initialize PTY Manager (event bus created above for Obsidian sync)
    let pty_manager = Arc::new(PtyManager::new(event_tx.clone()));

    let ctx = DaemonContext {
        db,
        pty_manager: pty_manager.clone(),
        event_tx: event_tx.clone(),
        obsidian_sync: obsidian_sync.clone(),
    };

    // 5. Clean up stale socket file if necessary
    cleanup_stale_socket(&socket_path);

    // Ensure parent directory exists
    if let Some(parent) = socket_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            error!("Failed to create directory for socket: {}", e);
        }
    }

    // 6. Bind Unix Domain Socket
    let listener = UnixListener::bind(&socket_path).map_err(|e| {
        error!("Failed to bind Unix socket at {}: {}", socket_path.display(), e);
        e
    })?;

    // Set socket permissions to 0600 (owner only)
    if let Ok(metadata) = std::fs::metadata(&socket_path) {
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o600);
        let _ = std::fs::set_permissions(&socket_path, permissions);
    }

    info!("aetherd is actively listening for GUI and MCP connections on {}", socket_path.display());

    // 7. Periodic Port Radar task (checks active panes every 3 seconds)
    let radar_pty_manager = pty_manager.clone();
    let radar_event_tx = event_tx.clone();
    let radar_db = ctx.db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3));
        loop {
            interval.tick().await;
            if let Ok(agents) = radar_db.list_agent_instances(None) {
                for agent in agents {
                    let ports = radar_pty_manager.scan_open_ports(&agent.id).await;
                    if !ports.is_empty() {
                        let _ = radar_event_tx.send(IpcEvent::PortRadarDetected {
                            pane_id: agent.id.clone(),
                            ports,
                        });
                    }
                }
            }
        }
    });

    // 8. Graceful shutdown handler
    let shutdown_socket_path = socket_path.clone();
    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        info!("Received shutdown signal (Ctrl+C). Cleaning up socket...");
        let _ = std::fs::remove_file(&shutdown_socket_path);
        std::process::exit(0);
    });

    // 9. Main Connection Loop
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let client_ctx = ctx.clone();
                tokio::spawn(async move {
                    handle_client(stream, client_ctx).await;
                });
            }
            Err(e) => {
                warn!("Error accepting incoming client connection: {}", e);
            }
        }
    }
}

/// Handle a single incoming client connection (aether-gui or aether-mcp)
async fn handle_client(stream: UnixStream, ctx: DaemonContext) {
    // Security check: verify connecting process UID matches current daemon user UID
    #[cfg(target_os = "linux")]
    {
        if let Ok(ucred) = stream.peer_cred() {
            let current_uid = unsafe { libc::getuid() };
            if ucred.uid() != current_uid {
                warn!(
                    "Security alert: rejected unauthorized socket connection from peer UID {} (expected {})",
                    ucred.uid(),
                    current_uid
                );
                return;
            }
        }
    }

    let (mut reader, mut writer) = stream.into_split();
    let (outgoing_tx, mut outgoing_rx) = tokio::sync::mpsc::channel::<IpcMessage>(256);

    // Task 1: Outgoing writer loop
    let writer_task = tokio::spawn(async move {
        while let Some(msg) = outgoing_rx.recv().await {
            if let Err(e) = write_ipc_message(&mut writer, &msg).await {
                debug!("Failed to write IPC message to client: {}", e);
                break;
            }
        }
    });

    // Task 2: Broadcast events subscriber (activated only when client subscribes)
    let mut subscriber_task: Option<tokio::task::JoinHandle<()>> = None;

    // Task 3: Ingoing reader loop
    loop {
        match read_ipc_message(&mut reader).await {
            Ok(IpcMessage::Request(req)) => {
                let is_subscribe = matches!(req.payload, IpcRequestPayload::SubscribeEvents { .. });
                let response = process_request(&ctx, req).await;
                if outgoing_tx.send(IpcMessage::Response(response)).await.is_err() {
                    break;
                }

                if is_subscribe && subscriber_task.is_none() {
                    let mut event_rx = ctx.event_tx.subscribe();
                    let event_tx_clone = outgoing_tx.clone();
                    subscriber_task = Some(tokio::spawn(async move {
                        loop {
                            match event_rx.recv().await {
                                Ok(event) => {
                                    if event_tx_clone.send(IpcMessage::Event(event)).await.is_err() {
                                        break;
                                    }
                                }
                                Err(broadcast::error::RecvError::Lagged(missed)) => {
                                    warn!("Client event subscriber lagged by {} messages", missed);
                                }
                                Err(broadcast::error::RecvError::Closed) => {
                                    break;
                                }
                            }
                        }
                    }));
                }
            }
            Ok(IpcMessage::Response(_)) => {
                // Daemon does not usually receive responses from clients
            }
            Ok(IpcMessage::Event(_)) => {
                // Clients do not inject raw events directly
            }
            Err(e) => {
                debug!("Client disconnected or read error: {}", e);
                break;
            }
        }
    }

    // Abort helper tasks on disconnect
    writer_task.abort();
    if let Some(task) = subscriber_task {
        task.abort();
    }
}

/// Process incoming IPC request and generate a corresponding IPC response
async fn process_request(ctx: &DaemonContext, req: IpcRequest) -> IpcResponse {
    let req_id = req.id;
    match req.payload {
        IpcRequestPayload::Ping => IpcResponse::ok(req_id, IpcResponsePayload::Pong),

        IpcRequestPayload::SpawnPane(spawn_req) => {
            let pane_id = spawn_req
                .pane_id
                .unwrap_or_else(|| format!("pane_{}", Uuid::new_v4().simple()));
            let ws_id = spawn_req.workspace_id;

            let home_dir = resolve_default_home_dir();

            // Task 1: Auto-upsert workspace if it does not exist yet to prevent SQLite FK constraint errors
            if ctx.db.get_workspace(&ws_id).ok().flatten().is_none() {
                let default_vault = resolve_default_vault_path();
                let _ = std::fs::create_dir_all(&default_vault);
                let _ = ctx.db.upsert_workspace(
                    &ws_id,
                    &ws_id,
                    &home_dir.to_string_lossy(),
                    Some(&default_vault.to_string_lossy()),
                );
            }

            // Determine target working directory (explicit request → repo root → `/`).
            let ws_root = ctx.db.get_workspace(&ws_id).ok().flatten().map(|ws| PathBuf::from(ws.root_repo_path));
            let target_dir = resolve_spawn_working_dir(&spawn_req.working_dir, ws_root, &home_dir);

            // Keep the workspace pointed at the real project repository so WorktreeDiff and
            // MergeWorktree never fall back to $HOME.
            if let Some(repo_root) = discover_repo_root(&target_dir) {
                let repo_root_str = repo_root.to_string_lossy().to_string();
                let needs_update = match ctx.db.get_workspace(&ws_id) {
                    Ok(Some(ws)) => ws.root_repo_path != repo_root_str,
                    _ => true,
                };
                if needs_update {
                    let existing = ctx.db.get_workspace(&ws_id).ok().flatten();
                    let name = existing
                        .as_ref()
                        .map(|w| w.name.clone())
                        .unwrap_or_else(|| ws_id.clone());
                    let vault = existing.and_then(|w| w.obsidian_vault_path);
                    let _ = ctx.db.upsert_workspace(
                        &ws_id,
                        &name,
                        &repo_root_str,
                        vault.as_deref(),
                    );
                    info!(
                        "Workspace '{}' root_repo_path updated to active repository: {}",
                        ws_id, repo_root_str
                    );
                }
            }

            let (working_dir, worktree_path_opt, git_branch_opt) = if spawn_req.isolated_worktree {
                match WorktreeEngine::create_worktree(&target_dir, &pane_id, None) {
                    Ok(wt) => (
                        wt.worktree_path.clone(),
                        Some(wt.worktree_path),
                        Some(wt.branch_name),
                    ),
                    Err(e) => {
                        debug!("Worktree not created for {}: {}. Spawning directly in {}", pane_id, e, target_dir.display());
                        (target_dir.clone(), None, None)
                    }
                }
            } else {
                (target_dir.clone(), None, None)
            };

            let mut env_vars = spawn_req.env_vars;
            let socket_str = resolve_socket_path().to_string_lossy().to_string();
            env_vars.insert("AETHER_AGENT_ID".to_string(), pane_id.clone());
            env_vars.insert("AETHER_WORKSPACE_ID".to_string(), ws_id.clone());
            env_vars.insert("AETHER_SOCKET".to_string(), socket_str.clone());
            env_vars.insert("AETHER_SOCK".to_string(), socket_str.clone());

            let mut command_args = spawn_req.args;

            // Task 2: Generate temporary MCP config file for this agent pane
            let mcp_bin = resolve_mcp_binary_path();
            let mcp_config_path = format!("/tmp/aether_mcp_{}.json", pane_id);
            let mcp_json = serde_json::json!({
                "mcpServers": {
                    "aether": {
                        "command": mcp_bin.to_string_lossy().to_string(),
                        "args": [],
                        "env": {
                            "AETHER_SOCKET": socket_str,
                            "AETHER_SOCK": socket_str,
                            "AETHER_WORKSPACE_ID": ws_id,
                            "AETHER_AGENT_ID": pane_id
                        }
                    }
                }
            });
            if let Ok(json_str) = serde_json::to_string_pretty(&mcp_json) {
                let _ = std::fs::write(&mcp_config_path, json_str);
            }

            let agent_profile = aetherd::config::load_agents_config()
                .ok()
                .and_then(|cfg| cfg.agents.get(spawn_req.cli_type.as_str()).cloned());

            let injection_strategy = agent_profile
                .as_ref()
                .and_then(|p| p.mcp_injection_strategy.clone());

            if spawn_req.cli_type == aether_protocol::agent::CliType::ClaudeCode
                || injection_strategy.as_deref() == Some("config-flag")
            {
                if !command_args.iter().any(|a| a == "--mcp-config") {
                    command_args.push("--mcp-config".to_string());
                    command_args.push(mcp_config_path);
                }
            } else {
                env_vars.insert("AETHER_MCP_CONFIG".to_string(), mcp_config_path);
            }

            if worktree_path_opt.is_some() {
                // Task 1: Rust/Cargo target cache isolation
                let cargo_target_dir = target_dir.join(".aether/cache/targets").join(&pane_id);
                let _ = std::fs::create_dir_all(&cargo_target_dir);
                env_vars.insert("CARGO_TARGET_DIR".to_string(), cargo_target_dir.to_string_lossy().to_string());

                // Optional sccache integration if binary is present
                if is_executable_in_path("sccache") {
                    env_vars.insert("RUSTC_WRAPPER".to_string(), "sccache".to_string());
                    let sccache_dir = target_dir.join(".aether/cache/sccache");
                    let _ = std::fs::create_dir_all(&sccache_dir);
                    env_vars.insert("SCCACHE_DIR".to_string(), sccache_dir.to_string_lossy().to_string());
                }
            }

            match ctx
                .pty_manager
                .spawn_pane(
                    pane_id.clone(),
                    spawn_req.command,
                    command_args,
                    working_dir,
                    spawn_req.cols,
                    spawn_req.rows,
                    env_vars,
                )
                .await
            {
                Ok(pid) => {
                    let cli_type_str = spawn_req.cli_type.to_string();
                    let wt_str = worktree_path_opt.as_ref().map(|p| p.to_string_lossy().to_string());
                    let _ = ctx.db.register_agent_instance(
                        &pane_id,
                        &ws_id,
                        &cli_type_str,
                        Some(pid),
                        wt_str.as_deref(),
                        git_branch_opt.as_deref(),
                        AgentStatus::Idle,
                    );

                    IpcResponse::ok(
                        req_id,
                        IpcResponsePayload::PaneSpawned(PaneSpawnedInfo {
                            pane_id,
                            pid: Some(pid),
                            worktree_path: worktree_path_opt,
                            git_branch: git_branch_opt,
                        }),
                    )
                }
                Err(e) => IpcResponse::err(req_id, "PTY_SPAWN_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::PtyInput(input_req) => {
            let pane_id = input_req.pane_id.clone();
            match ctx
                .pty_manager
                .write_input(&pane_id, &input_req.data)
                .await
            {
                Ok(maybe_line) => {
                    // Task 4: Check completed line buffer for package mutation commands
                    if let Some(cmd_line) = maybe_line {
                        if is_package_mutation_command(&cmd_line) {
                            if let Ok(Some(agent)) = ctx.db.get_agent_instance(&pane_id) {
                                if let Some(wt_str) = agent.worktree_path {
                                    info!(
                                        "Detected package mutation command '{}' for pane '{}'. Isolating node_modules...",
                                        cmd_line, pane_id
                                    );
                                    let _ = WorktreeEngine::isolate_node_modules(Path::new(&wt_str));
                                }
                            }
                        }
                    }
                    IpcResponse::ok(req_id, IpcResponsePayload::Success)
                }
                Err(e) => IpcResponse::err(req_id, "PTY_WRITE_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::ResizePane(resize_req) => {
            match ctx
                .pty_manager
                .resize_pane(&resize_req.pane_id, resize_req.cols, resize_req.rows)
                .await
            {
                Ok(_) => IpcResponse::ok(req_id, IpcResponsePayload::Success),
                Err(e) => IpcResponse::err(req_id, "PTY_RESIZE_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::KillPane(kill_req) => {
            let _ = ctx.db.delete_agent_instance(&kill_req.pane_id);
            match ctx
                .pty_manager
                .kill_pane(&kill_req.pane_id, kill_req.signal)
                .await
            {
                Ok(_) => IpcResponse::ok(
                    req_id,
                    IpcResponsePayload::PaneKilled {
                        pane_id: kill_req.pane_id,
                    },
                ),
                Err(e) => IpcResponse::err(req_id, "PTY_KILL_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::ListPanes { workspace_id } => {
            match ctx
                .db
                .list_agent_instances(workspace_id.as_deref())
            {
                Ok(agents) => {
                    let mut summaries = Vec::new();
                    for a in agents {
                        if ctx.pty_manager.is_pane_active(&a.id).await {
                            let ports = ctx.pty_manager.scan_open_ports(&a.id).await;
                            summaries.push(PaneSummary {
                                pane_id: a.id,
                                workspace_id: a.workspace_id,
                                cli_type: a.cli_type,
                                pid: a.pty_pid,
                                status: a.status,
                                worktree_path: a.worktree_path,
                                git_branch: a.git_branch,
                                open_ports: ports,
                            });
                        } else {
                            let _ = ctx.db.delete_agent_instance(&a.id);
                        }
                    }
                    IpcResponse::ok(req_id, IpcResponsePayload::PaneList(summaries))
                }
                Err(e) => IpcResponse::err(req_id, "DB_QUERY_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::GetPaneStatus { pane_id } => {
            match ctx.db.get_agent_instance(&pane_id) {
                Ok(Some(inst)) => IpcResponse::ok(req_id, IpcResponsePayload::PaneStatus(inst.status)),
                Ok(None) => IpcResponse::err(req_id, "PANE_NOT_FOUND", "Pane does not exist"),
                Err(e) => IpcResponse::err(req_id, "DB_QUERY_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::GetScrollback { pane_id } => {
            match ctx.pty_manager.get_scrollback(&pane_id).await {
                Ok((data, end_offset)) => IpcResponse::ok(
                    req_id,
                    IpcResponsePayload::ScrollbackData { pane_id, data, end_offset },
                ),
                Err(e) => IpcResponse::err(req_id, "PTY_SCROLLBACK_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::InitWorkspace(init_req) => {
            let root_str = init_req.root_repo_path.to_string_lossy();
            let vault_str = init_req.obsidian_vault_path.as_ref().map(|p| p.to_string_lossy());

            match ctx.db.upsert_workspace(
                &init_req.id,
                &init_req.name,
                &root_str,
                vault_str.as_deref(),
            ) {
                Ok(ws) => IpcResponse::ok(req_id, IpcResponsePayload::Workspace(ws)),
                Err(e) => IpcResponse::err(req_id, "DB_WORKSPACE_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::GetWorkspace { workspace_id } => {
            match ctx.db.get_workspace(&workspace_id) {
                Ok(Some(ws)) => IpcResponse::ok(req_id, IpcResponsePayload::Workspace(ws)),
                Ok(None) => IpcResponse::err(req_id, "WORKSPACE_NOT_FOUND", "Workspace not found"),
                Err(e) => IpcResponse::err(req_id, "DB_QUERY_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::GetSharedContext(ctx_req) => {
            match ctx
                .db
                .get_shared_context(&ctx_req.workspace_id, ctx_req.query.as_deref())
            {
                Ok(summary) => IpcResponse::ok(req_id, IpcResponsePayload::SharedContext(summary)),
                Err(e) => IpcResponse::err(req_id, "DB_QUERY_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::PublishBlackboard(bb_req) => {
            // Task 1: Auto-upsert workspace if missing to prevent FK error
            if ctx.db.get_workspace(&bb_req.workspace_id).ok().flatten().is_none() {
                let home_dir = resolve_default_home_dir();
                let default_vault = resolve_default_vault_path();
                let _ = std::fs::create_dir_all(&default_vault);
                let _ = ctx.db.upsert_workspace(
                    &bb_req.workspace_id,
                    &bb_req.workspace_id,
                    &home_dir.to_string_lossy(),
                    Some(&default_vault.to_string_lossy()),
                );
            }

            match ctx.db.publish_blackboard(
                &bb_req.workspace_id,
                &bb_req.author_agent_id,
                bb_req.entry_type,
                &bb_req.title,
                &bb_req.content_markdown,
                bb_req.target_agent_id.as_deref(),
            ) {
                Ok(entry) => {
                    // Broadcast blackboard event to all panes
                    let _ = ctx.event_tx.send(IpcEvent::BlackboardEntryCreated(entry.clone()));
                    IpcResponse::ok(
                        req_id,
                        IpcResponsePayload::BlackboardPublished {
                            entry_id: entry.id,
                        },
                    )
                }
                Err(e) => IpcResponse::err(req_id, "DB_PUBLISH_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::DelegateTask(del_req) => {
            // Task 1 & 7: Auto-upsert workspace if missing
            if ctx.db.get_workspace(&del_req.workspace_id).ok().flatten().is_none() {
                let home_dir = resolve_default_home_dir();
                let default_vault = resolve_default_vault_path();
                let _ = std::fs::create_dir_all(&default_vault);
                let _ = ctx.db.upsert_workspace(
                    &del_req.workspace_id,
                    &del_req.workspace_id,
                    &home_dir.to_string_lossy(),
                    Some(&default_vault.to_string_lossy()),
                );
            }

            // Publish HANDOFF entry to shared_blackboard
            let title = format!("Task Delegation to @{}", del_req.target_cli);
            let content = format!(
                "**Caller:** `{}`\n**Target CLI:** `{}`\n**Mode:** `{}`\n\n**Prompt:**\n{}",
                del_req.caller_agent_id, del_req.target_cli, del_req.mode, del_req.prompt
            );
            let entry = ctx.db.publish_blackboard(
                &del_req.workspace_id,
                &del_req.caller_agent_id,
                aether_protocol::agent::BlackboardEntryType::Handoff,
                &title,
                &content,
                Some(&del_req.target_cli),
            );

            if let Ok(ref bb_entry) = entry {
                let _ = ctx.event_tx.send(IpcEvent::BlackboardEntryCreated(bb_entry.clone()));
            }

            if del_req.mode == "headless" {
                let config = aetherd::config::load_agents_config().ok();
                let profile = config
                    .as_ref()
                    .and_then(|c| c.agents.get(&del_req.target_cli).cloned());

                let binary_name = profile
                    .as_ref()
                    .map(|p| p.binary.clone())
                    .unwrap_or_else(|| del_req.target_cli.clone());

                if !is_executable_in_path(&binary_name) {
                    let msg = format!(
                        "Delegated task recorded to blackboard (Handoff), but target CLI '{}' is not installed in PATH.",
                        binary_name
                    );
                    return IpcResponse::ok(req_id, IpcResponsePayload::TaskDelegated { result_output: msg });
                }

                let headless_args = profile
                    .as_ref()
                    .map(|p| p.headless_args.clone())
                    .unwrap_or_else(|| vec!["-p".to_string(), "{PROMPT}".to_string()]);

                let processed_args: Vec<String> = headless_args
                    .into_iter()
                    .map(|arg| arg.replace("{PROMPT}", &del_req.prompt))
                    .collect();

                let ws_dir = if let Ok(Some(ws)) = ctx.db.get_workspace(&del_req.workspace_id) {
                    let p = PathBuf::from(ws.root_repo_path);
                    if p.exists() { p } else { resolve_default_home_dir() }
                } else {
                    resolve_default_home_dir()
                };

                let mut cmd = tokio::process::Command::new(&binary_name);
                cmd.args(&processed_args)
                    .current_dir(ws_dir)
                    .env("AETHER_WORKSPACE_ID", &del_req.workspace_id)
                    .env("AETHER_AGENT_ID", &del_req.caller_agent_id)
                    .env("AETHER_SOCKET", resolve_socket_path())
                    .env("AETHER_SOCK", resolve_socket_path());

                match tokio::time::timeout(Duration::from_secs(120), cmd.output()).await {
                    Ok(Ok(output)) => {
                        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                        let combined = if output.status.success() {
                            if stdout.trim().is_empty() {
                                "Task completed successfully with empty stdout.".to_string()
                            } else {
                                stdout
                            }
                        } else {
                            format!("CLI execution returned error status ({:?}):\n{}\n{}", output.status.code(), stdout, stderr)
                        };
                        IpcResponse::ok(req_id, IpcResponsePayload::TaskDelegated { result_output: combined })
                    }
                    Ok(Err(e)) => {
                        let err_msg = format!("Failed to spawn headless CLI '{}': {}", binary_name, e);
                        IpcResponse::ok(req_id, IpcResponsePayload::TaskDelegated { result_output: err_msg })
                    }
                    Err(_) => {
                        let timeout_msg = format!("Headless execution of '{}' timed out after 120 seconds.", binary_name);
                        IpcResponse::ok(req_id, IpcResponsePayload::TaskDelegated { result_output: timeout_msg })
                    }
                }
            } else {
                // Interactive pane mode: ask the GUI to spawn a real pane and pipe the prompt in.
                let _ = ctx.event_tx.send(IpcEvent::DelegationPaneRequested {
                    workspace_id: del_req.workspace_id.clone(),
                    caller_agent_id: del_req.caller_agent_id.clone(),
                    target_cli: del_req.target_cli.clone(),
                    prompt: del_req.prompt.clone(),
                });

                let entry_id_str = entry.map(|e| format!("#{}", e.id)).unwrap_or_else(|_| "new".to_string());
                let result_output = format!(
                    "Task delegation to @{} registered on shared blackboard ({}) and an interactive pane was requested in the GUI.",
                    del_req.target_cli, entry_id_str
                );
                IpcResponse::ok(req_id, IpcResponsePayload::TaskDelegated { result_output })
            }
        }

        IpcRequestPayload::ClaimModule(claim_req) => {
            match ctx.db.claim_file_locks(
                &claim_req.workspace_id,
                &claim_req.agent_id,
                &claim_req.files,
                claim_req.intent.as_deref(),
            ) {
                Ok((granted, conflicts)) => {
                    if granted {
                        for f in &claim_req.files {
                            let _ = ctx.event_tx.send(IpcEvent::FileLockChanged {
                                workspace_id: claim_req.workspace_id.clone(),
                                file_path: f.clone(),
                                agent_id: claim_req.agent_id.clone(),
                                intent: claim_req.intent.clone(),
                                locked: true,
                            });
                        }
                    }
                    IpcResponse::ok(
                        req_id,
                        IpcResponsePayload::ModuleClaimed {
                            granted,
                            conflicts,
                        },
                    )
                }
                Err(e) => IpcResponse::err(req_id, "DB_CLAIM_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::ReleaseModule(release_req) => {
            match ctx.db.release_file_locks(
                &release_req.workspace_id,
                &release_req.agent_id,
                &release_req.files,
            ) {
                Ok(_) => {
                    for f in &release_req.files {
                        let _ = ctx.event_tx.send(IpcEvent::FileLockChanged {
                            workspace_id: release_req.workspace_id.clone(),
                            file_path: f.clone(),
                            agent_id: release_req.agent_id.clone(),
                            intent: None,
                            locked: false,
                        });
                    }
                    IpcResponse::ok(req_id, IpcResponsePayload::ModuleReleased)
                }
                Err(e) => IpcResponse::err(req_id, "DB_RELEASE_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::GetFileLocks { workspace_id } => {
            match ctx.db.get_file_locks(&workspace_id) {
                Ok(locks) => IpcResponse::ok(req_id, IpcResponsePayload::FileLocks(locks)),
                Err(e) => IpcResponse::err(req_id, "DB_QUERY_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::ObsidianReadNote(note_req) => {
            match ctx
                .db
                .get_obsidian_note_by_path(&note_req.workspace_id, &note_req.query_or_path)
            {
                Ok(Some(note)) => IpcResponse::ok(req_id, IpcResponsePayload::ObsidianNote(note)),
                Ok(None) => {
                    // Try full-text search as fallback
                    match ctx
                        .db
                        .search_obsidian_fts(&note_req.workspace_id, &note_req.query_or_path, 1)
                    {
                        Ok(results) if !results.is_empty() => {
                            if let Ok(Some(n)) = ctx
                                .db
                                .get_obsidian_note_by_path(&note_req.workspace_id, &results[0].relative_path)
                            {
                                IpcResponse::ok(req_id, IpcResponsePayload::ObsidianNote(n))
                            } else {
                                IpcResponse::err(req_id, "NOTE_NOT_FOUND", "Note not found")
                            }
                        }
                        _ => IpcResponse::err(req_id, "NOTE_NOT_FOUND", "Note not found"),
                    }
                }
                Err(e) => IpcResponse::err(req_id, "DB_QUERY_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::ObsidianSearch(search_req) => {
            match ctx
                .db
                .search_obsidian_fts(&search_req.workspace_id, &search_req.query, search_req.limit)
            {
                Ok(results) => IpcResponse::ok(
                    req_id,
                    IpcResponsePayload::ObsidianSearchResults(results),
                ),
                Err(e) => IpcResponse::err(req_id, "DB_SEARCH_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::ListWorkflows { .. } => {
            let workflows = ctx.obsidian_sync.load_workflows().unwrap_or_default();
            IpcResponse::ok(req_id, IpcResponsePayload::WorkflowList(workflows))
        }

        IpcRequestPayload::WorktreeDiff(diff_req) => {
            let agent = match ctx.db.get_agent_instance(&diff_req.pane_id) {
                Ok(Some(a)) => a,
                _ => return IpcResponse::err(req_id, "AGENT_NOT_FOUND", "Agent pane not found"),
            };
            let ws = match ctx.db.get_workspace(&agent.workspace_id) {
                Ok(Some(w)) => w,
                _ => return IpcResponse::err(req_id, "WORKSPACE_NOT_FOUND", "Workspace not found"),
            };

            // Prefer the worktree's own repository; fall back to the workspace record.
            let repo_root =
                resolve_repo_root_for_pane(agent.worktree_path.as_deref(), &ws.root_repo_path);

            match WorktreeEngine::compute_worktree_diff(
                &repo_root,
                &diff_req.pane_id,
                diff_req.target_branch.as_deref(),
            ) {
                Ok(diff) => IpcResponse::ok(req_id, IpcResponsePayload::WorktreeDiff(diff)),
                Err(e) => IpcResponse::err(req_id, "DIFF_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::MergeWorktree(merge_req) => {
            let agent = match ctx.db.get_agent_instance(&merge_req.pane_id) {
                Ok(Some(a)) => a,
                _ => return IpcResponse::err(req_id, "AGENT_NOT_FOUND", "Agent pane not found"),
            };
            let ws = match ctx.db.get_workspace(&agent.workspace_id) {
                Ok(Some(w)) => w,
                _ => return IpcResponse::err(req_id, "WORKSPACE_NOT_FOUND", "Workspace not found"),
            };

            let target = merge_req.target_branch.unwrap_or_else(|| "master".to_string());
            let repo_root =
                resolve_repo_root_for_pane(agent.worktree_path.as_deref(), &ws.root_repo_path);

            match WorktreeEngine::merge_worktree(
                &repo_root,
                &merge_req.pane_id,
                &target,
                merge_req.squash,
                merge_req.commit_message.as_deref(),
            ) {
                Ok(commit_oid) => {
                    IpcResponse::ok(req_id, IpcResponsePayload::WorktreeMerged { commit_oid })
                }
                Err(e) => IpcResponse::err(req_id, "MERGE_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::CreateSnapshot(snap_req) => {
            let worktree_dir = if let Ok(Some(agent)) = ctx.db.get_agent_instance(&snap_req.pane_id) {
                agent.worktree_path.map(PathBuf::from)
            } else {
                None
            };

            let path = worktree_dir.unwrap_or_else(|| PathBuf::from("."));
            match SnapshotEngine::capture_snapshot(&path, &snap_req.summary) {
                Ok((git_tree_oid, files_changed)) => {
                    let snap_id = format!("snap_{}", Uuid::new_v4().simple());
                    let _ = ctx.db.create_git_snapshot(
                        &snap_id,
                        &snap_req.pane_id,
                        &git_tree_oid,
                        &snap_req.summary,
                        files_changed,
                    );
                    let _ = ctx.event_tx.send(IpcEvent::GitSnapshotCreated {
                        pane_id: snap_req.pane_id.clone(),
                        snapshot_id: snap_id.clone(),
                        summary: snap_req.summary,
                    });
                    IpcResponse::ok(
                        req_id,
                        IpcResponsePayload::SnapshotCreated {
                            snapshot_id: snap_id,
                            git_tree_oid,
                        },
                    )
                }
                Err(e) => IpcResponse::err(req_id, "SNAPSHOT_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::ListSnapshots { pane_id } => {
            match ctx.db.list_git_snapshots(&pane_id) {
                Ok(snaps) => IpcResponse::ok(req_id, IpcResponsePayload::SnapshotList(snaps)),
                Err(e) => IpcResponse::err(req_id, "DB_QUERY_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::RollbackSnapshot(rollback_req) => {
            let worktree_dir = if let Ok(Some(agent)) = ctx.db.get_agent_instance(&rollback_req.pane_id) {
                agent.worktree_path.map(PathBuf::from)
            } else {
                None
            };
            let path = worktree_dir.unwrap_or_else(|| PathBuf::from("."));

            let snapshots = ctx.db.list_git_snapshots(&rollback_req.pane_id).unwrap_or_default();
            let target_snap = snapshots
                .iter()
                .find(|s| s.id == rollback_req.snapshot_id || s.git_tree_oid == rollback_req.snapshot_id);

            if let Some(snap) = target_snap {
                match SnapshotEngine::rollback_snapshot(&path, &snap.git_tree_oid) {
                    Ok(_) => IpcResponse::ok(req_id, IpcResponsePayload::SnapshotRolledBack),
                    Err(e) => IpcResponse::err(req_id, "ROLLBACK_FAILED", e.to_string()),
                }
            } else {
                IpcResponse::err(req_id, "SNAPSHOT_NOT_FOUND", "Snapshot not found")
            }
        }

        IpcRequestPayload::ObsidianUpdateTask(task_req) => {
            let vault_path = if let Ok(Some(ws)) = ctx.db.get_workspace(&task_req.workspace_id) {
                ws.obsidian_vault_path.map(PathBuf::from)
            } else {
                None
            };

            if let Some(vault) = vault_path {
                match ObsidianSyncEngine::update_task_checkbox(
                    &vault,
                    &task_req.note_path,
                    &task_req.task_text,
                    task_req.completed,
                ) {
                    Ok(_) => IpcResponse::ok(req_id, IpcResponsePayload::ObsidianTaskUpdated),
                    Err(e) => IpcResponse::err(req_id, "TASK_UPDATE_FAILED", e.to_string()),
                }
            } else {
                IpcResponse::err(req_id, "VAULT_NOT_CONFIGURED", "No Obsidian Vault linked")
            }
        }

        IpcRequestPayload::ObsidianAppendMemory(mem_req) => {
            let vault_path = if let Ok(Some(ws)) = ctx.db.get_workspace(&mem_req.workspace_id) {
                ws.obsidian_vault_path.map(PathBuf::from)
            } else {
                None
            };

            if let Some(vault) = vault_path {
                match ObsidianSyncEngine::append_memory(
                    &vault,
                    &mem_req.folder,
                    &mem_req.title,
                    &mem_req.markdown,
                ) {
                    Ok(_) => IpcResponse::ok(req_id, IpcResponsePayload::ObsidianMemoryAppended),
                    Err(e) => IpcResponse::err(req_id, "APPEND_MEMORY_FAILED", e.to_string()),
                }
            } else {
                IpcResponse::err(req_id, "VAULT_NOT_CONFIGURED", "No Obsidian Vault linked")
            }
        }

        IpcRequestPayload::SaveAiProviderConfig {
            provider,
            api_key,
            model,
            base_url,
            display_name,
            protocol,
        } => {
            match aetherd::ai_pilot::update_provider_setting(
                &provider,
                &api_key,
                &model,
                base_url,
                display_name,
                protocol,
            ) {
                Ok(config) => IpcResponse::ok(req_id, IpcResponsePayload::AiProviderConfig(config)),
                Err(e) => IpcResponse::err(req_id, "SAVE_AI_PROVIDER_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::DeleteAiProviderConfig { provider } => {
            match aetherd::ai_pilot::delete_provider_setting(&provider) {
                Ok(config) => IpcResponse::ok(req_id, IpcResponsePayload::AiProviderConfig(config)),
                Err(e) => IpcResponse::err(req_id, "DELETE_AI_PROVIDER_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::GetAiProviderConfig => {
            match aetherd::ai_pilot::load_provider_config() {
                Ok(config) => IpcResponse::ok(req_id, IpcResponsePayload::AiProviderConfig(config)),
                Err(e) => IpcResponse::err(req_id, "GET_AI_PROVIDER_FAILED", e.to_string()),
            }
        }

        IpcRequestPayload::RunAiPilotPrompt { pane_id, instruction } => {
            match aetherd::ai_pilot::run_ai_pilot_cycle(ctx, &pane_id, &instruction).await {
                Ok(result) => {
                    IpcResponse::ok(req_id, IpcResponsePayload::AiPilotPromptResult { result })
                }
                Err(e) => IpcResponse::err(req_id, "AI_PILOT_EXECUTION_FAILED", e),
            }
        }

        IpcRequestPayload::TestAiProviderConnection {
            provider,
            api_key,
            model,
            base_url,
        } => {
            let client = aetherd::ai_pilot::AiPilotClient::new();
            let settings = aether_protocol::ipc::ProviderSettings {
                api_key,
                model,
                base_url,
                display_name: None,
                protocol: None,
            };
            match client.test_connection(&provider, &settings).await {
                Ok(msg) => IpcResponse::ok(
                    req_id,
                    IpcResponsePayload::AiProviderTestResult {
                        success: true,
                        message: msg,
                    },
                ),
                Err(e) => IpcResponse::ok(
                    req_id,
                    IpcResponsePayload::AiProviderTestResult {
                        success: false,
                        message: e,
                    },
                ),
            }
        }

        IpcRequestPayload::AiChat {
            provider,
            model,
            prompt,
            system_prompt,
            history,
        } => {
            let config = aetherd::ai_pilot::load_provider_config().unwrap_or_default();
            let p_key = provider.to_lowercase();
            let mut settings = config.providers.get(&p_key).cloned().unwrap_or_else(|| {
                aether_protocol::ipc::ProviderSettings {
                    api_key: String::new(),
                    model: model.clone().unwrap_or_else(|| "gpt-4o".to_string()),
                    base_url: None,
                    display_name: None,
                    protocol: None,
                }
            });
            if let Some(m) = model {
                if !m.trim().is_empty() {
                    settings.model = m;
                }
            }
            let client = aetherd::ai_pilot::AiPilotClient::new();
            let mut messages = Vec::new();
            let default_sys = "You are AetherCortex AI Assistant. Be concise, direct, and actionable. Never overexplain, lecture, or add unnecessary preamble/postamble. Provide exact solutions, terminal commands, or answers directly without fluff.".to_string();
            let effective_sys = match system_prompt {
                Some(ref s) if !s.trim().is_empty() => s.clone(),
                _ => default_sys,
            };
            messages.push(aetherd::ai_pilot::ChatMessage::system(effective_sys));
            if let Some(hist) = history {
                for item in hist {
                    match item.role.as_str() {
                        "user" => messages.push(aetherd::ai_pilot::ChatMessage::user(item.content)),
                        "assistant" => messages.push(aetherd::ai_pilot::ChatMessage::assistant(Some(item.content), None)),
                        "system" => messages.push(aetherd::ai_pilot::ChatMessage::system(item.content)),
                        _ => messages.push(aetherd::ai_pilot::ChatMessage::user(item.content)),
                    }
                }
            }
            messages.push(aetherd::ai_pilot::ChatMessage::user(prompt));
            match client.chat_completion(&provider, &settings, &messages, &[]).await {
                Ok(resp) => {
                    let mut text = resp.content.unwrap_or_default();
                    if !resp.tool_calls.is_empty() {
                        for tc in resp.tool_calls {
                            if !text.is_empty() {
                                text.push_str("\n\n");
                            }
                            text.push_str(&format!("```tool_call\n{{\"name\": \"{}\", \"arguments\": {}}}\n```", tc.function.name, tc.function.arguments));
                        }
                    }
                    IpcResponse::ok(req_id, IpcResponsePayload::AiChatResult { content: text })
                }
                Err(err) => IpcResponse::err(req_id, "AI_CHAT_ERROR", err),
            }
        }

        IpcRequestPayload::FsListDirectory {
            root_path,
            recursive,
            max_depth,
        } => {
            let base = if root_path.trim().is_empty() || root_path == "." {
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
            } else {
                PathBuf::from(&root_path)
            };

            if !base.exists() {
                return IpcResponse::err(req_id, "PATH_NOT_FOUND", format!("Root path '{}' does not exist", root_path));
            }

            let depth_limit = if recursive { max_depth.clamp(1, 15) } else { 1 };
            let mut entries = Vec::new();
            scan_directory_recursive(&base, &base, recursive, depth_limit, 1, &mut entries);
            entries.sort_by(|a, b| {
                if a.is_dir == b.is_dir {
                    a.name.cmp(&b.name)
                } else if a.is_dir {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Greater
                }
            });

            IpcResponse::ok(req_id, IpcResponsePayload::FsDirectoryListing { entries })
        }

        IpcRequestPayload::FsReadFile {
            file_path,
            start_line,
            end_line,
        } => {
            let path = PathBuf::from(&file_path);
            if !path.exists() {
                return IpcResponse::err(req_id, "FILE_NOT_FOUND", format!("File '{}' not found", file_path));
            }
            if path.is_dir() {
                return IpcResponse::err(req_id, "IS_DIRECTORY", format!("Path '{}' is a directory", file_path));
            }

            match std::fs::read_to_string(&path) {
                Ok(raw) => {
                    let lines: Vec<&str> = raw.lines().collect();
                    let total_lines = lines.len();
                    let start = start_line.unwrap_or(1).clamp(1, total_lines.max(1));
                    let end = end_line.unwrap_or(total_lines).clamp(start, total_lines.max(start));

                    let mut formatted = Vec::new();
                    for idx in start..=end {
                        let line_idx = idx.saturating_sub(1);
                        let line_text = lines.get(line_idx).copied().unwrap_or("");
                        formatted.push(format!("{:4} | {}", idx, line_text));
                    }

                    IpcResponse::ok(
                        req_id,
                        IpcResponsePayload::FsFileContent {
                            file_path,
                            content: formatted.join("\n"),
                            start_line: start,
                            end_line: end,
                            total_lines,
                        },
                    )
                }
                Err(e) => IpcResponse::err(req_id, "READ_ERROR", e.to_string()),
            }
        }

        IpcRequestPayload::FsWriteOrEditFile {
            file_path,
            operation,
            content,
        } => {
            let path = PathBuf::from(&file_path);
            if let Some(parent) = path.parent() {
                if !parent.as_os_str().is_empty() {
                    let _ = std::fs::create_dir_all(parent);
                }
            }

            let tmp_path = if let Some(parent) = path.parent() {
                if !parent.as_os_str().is_empty() {
                    let _ = std::fs::create_dir_all(parent);
                    parent.join(format!(".tmp_{}", uuid::Uuid::new_v4().simple()))
                } else {
                    PathBuf::from(format!(".tmp_{}", uuid::Uuid::new_v4().simple()))
                }
            } else {
                PathBuf::from(format!(".tmp_{}", uuid::Uuid::new_v4().simple()))
            };

            let write_result = match std::fs::write(&tmp_path, &content) {
                Ok(_) => {
                    let res = std::fs::rename(&tmp_path, &path);
                    if res.is_err() {
                        let _ = std::fs::remove_file(&tmp_path);
                    }
                    res
                }
                Err(e) => {
                    let _ = std::fs::remove_file(&tmp_path);
                    Err(e)
                }
            };

            match write_result {
                Ok(_) => {
                    let bytes_written = content.len();
                    let _ = ctx.event_tx.send(IpcEvent::WorkspaceFileChanged {
                        file_path: file_path.clone(),
                        operation: operation.clone(),
                    });
                    IpcResponse::ok(
                        req_id,
                        IpcResponsePayload::FsFileModified {
                            file_path,
                            bytes_written,
                        },
                    )
                }
                Err(e) => IpcResponse::err(req_id, "WRITE_ERROR", e.to_string()),
            }
        }

        IpcRequestPayload::FsDeletePath { file_path } => {
            let path = PathBuf::from(&file_path);
            if !path.exists() {
                return IpcResponse::err(req_id, "PATH_NOT_FOUND", format!("Path '{}' not found", file_path));
            }

            let res = if path.is_dir() {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };

            match res {
                Ok(_) => {
                    let _ = ctx.event_tx.send(IpcEvent::WorkspaceFileChanged {
                        file_path: file_path.clone(),
                        operation: "delete".to_string(),
                    });
                    IpcResponse::ok(req_id, IpcResponsePayload::FsPathDeleted { file_path })
                }
                Err(e) => IpcResponse::err(req_id, "DELETE_ERROR", e.to_string()),
            }
        }

        IpcRequestPayload::SubscribeEvents { .. } => {
            IpcResponse::ok(req_id, IpcResponsePayload::Success)
        }
    }
}

fn scan_directory_recursive(
    dir: &Path,
    base: &Path,
    recursive: bool,
    max_depth: usize,
    current_depth: usize,
    entries: &mut Vec<aether_protocol::ipc::FsEntryInfo>,
) {
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    let ignored_names = [".git", "node_modules", "target", "dist", ".aether"];

    for entry in read_dir.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if ignored_names.contains(&file_name.as_str()) {
            continue;
        }

        let path = entry.path();
        let is_dir = path.is_dir();
        let size_bytes = if is_dir {
            0
        } else {
            entry.metadata().map(|m| m.len()).unwrap_or(0)
        };

        let rel_path = path
            .strip_prefix(base)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| file_name.clone());

        entries.push(aether_protocol::ipc::FsEntryInfo {
            name: file_name,
            path: rel_path,
            is_dir,
            size_bytes,
        });

        if is_dir && recursive && current_depth < max_depth {
            scan_directory_recursive(&path, base, recursive, max_depth, current_depth + 1, entries);
        }
    }
}

/// Discover the root working directory of the Git repository containing `start`.
fn discover_repo_root(start: &Path) -> Option<PathBuf> {
    let repo = git2::Repository::discover(start).ok()?;
    repo.workdir()
        .map(|p| p.to_path_buf())
        .or_else(|| Some(repo.path().to_path_buf()))
}

/// Resolve the repository root for a pane, preferring the worktree's parent repository.
fn resolve_repo_root_for_pane(worktree_path: Option<&str>, fallback: &str) -> PathBuf {
    if let Some(wt) = worktree_path {
        if let Some(root) = discover_repo_root(Path::new(wt)) {
            return root;
        }
    }
    PathBuf::from(fallback)
}

/// Determine location of Unix Domain Socket
fn resolve_socket_path() -> PathBuf {
    if let Ok(path) = std::env::var("AETHER_SOCK").or_else(|_| std::env::var(AETHER_SOCK_ENV)) {
        return PathBuf::from(path);
    }

    if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
        return PathBuf::from(runtime_dir).join(DEFAULT_SOCKET_NAME);
    }

    let uid = unsafe { libc::getuid() };
    let run_user = PathBuf::from(format!("/run/user/{uid}"));
    if run_user.is_dir() {
        return run_user.join(DEFAULT_SOCKET_NAME);
    }

    PathBuf::from(format!("/tmp/aether-{uid}.sock"))
}

/// Cleanup dead socket from previous daemon process
fn cleanup_stale_socket(path: &Path) {
    if path.exists() {
        // Try connecting to see if another aetherd is actively listening
        if std::os::unix::net::UnixStream::connect(path).is_err() {
            debug!("Removing stale socket file at {}", path.display());
            let _ = std::fs::remove_file(path);
        } else {
            warn!(
                "An active aetherd daemon appears to already be running on {}. Exiting.",
                path.display()
            );
            std::process::exit(1);
        }
    }
}

/// Check if a binary command exists in system PATH
fn is_executable_in_path(cmd: &str) -> bool {
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(':') {
            let candidate = PathBuf::from(dir).join(cmd);
            if candidate.is_file() {
                return true;
            }
        }
    }
    false
}

/// Detect commands that mutate package dependencies
fn is_package_mutation_command(input: &str) -> bool {
    let trimmed = input.trim();
    let mutation_prefixes = [
        "npm install", "npm i ", "npm add",
        "pnpm add", "pnpm i ", "pnpm install",
        "yarn add", "yarn install",
        "bun add", "bun install", "bun i "
    ];
    mutation_prefixes.iter().any(|prefix| trimmed.contains(prefix))
}

/// Resolve the path to the aether-mcp executable
fn resolve_mcp_binary_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("aether-mcp");
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(':') {
            let candidate = PathBuf::from(dir).join("aether-mcp");
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    for candidate in &[
        "target/release/aether-mcp",
        "target/debug/aether-mcp",
        "/usr/local/bin/aether-mcp",
    ] {
        let p = PathBuf::from(candidate);
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from("aether-mcp")
}

#[cfg(test)]
mod spawn_fallback_tests {
    use super::resolve_spawn_working_dir;
    use std::path::{Path, PathBuf};

    fn home() -> PathBuf { PathBuf::from("/home/tester") }

    #[test]
    fn fresh_pane_defaults_to_filesystem_root_not_home() {
        // Regression: a brand-new pane used to land in $HOME.
        let got = resolve_spawn_working_dir(Path::new(""), None, &home());
        assert_eq!(got, PathBuf::from("/"));
    }

    #[test]
    fn workspace_root_wins_when_it_exists() {
        let got = resolve_spawn_working_dir(Path::new(""), Some(PathBuf::from("/tmp")), &home());
        assert_eq!(got, PathBuf::from("/tmp"));
    }

    #[test]
    fn workspace_root_equal_to_home_falls_back_to_root() {
        let got = resolve_spawn_working_dir(Path::new(""), Some(home()), &home());
        assert_eq!(got, PathBuf::from("/"));
    }

    #[test]
    fn explicit_request_wins_over_everything() {
        let got = resolve_spawn_working_dir(Path::new("/usr"), Some(home()), &home());
        assert_eq!(got, PathBuf::from("/usr"));
    }

    #[test]
    fn missing_requested_path_falls_back_to_root() {
        let got = resolve_spawn_working_dir(Path::new("/nope/does/not/exist"), None, &home());
        assert_eq!(got, PathBuf::from("/"));
    }
}

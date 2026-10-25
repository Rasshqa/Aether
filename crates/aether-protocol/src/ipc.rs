use crate::agent::{
    AgentStatus, AgentTelemetry, BlackboardEntry, BlackboardEntryType, CliType, FileLockInfo,
    GitSnapshotInfo, WorkspaceInfo,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ProtocolError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error (serde_json): {0}")]
    Json(#[from] serde_json::Error),
    #[error("Serialization error (bincode): {0}")]
    Bincode(#[from] bincode::Error),
    #[error("Frame size exceeded maximum allowed: {0} bytes")]
    FrameTooLarge(usize),
    #[error("Invalid frame header or unknown codec identifier: {0}")]
    InvalidHeader(u8),
    #[error("Connection closed by peer")]
    ConnectionClosed,
}

pub const MAX_FRAME_SIZE: usize = 16 * 1024 * 1024; // 16 MB max frame
pub const CODEC_BINCODE: u8 = 0x01;
pub const CODEC_JSON: u8 = 0x02;

// ----------------------------------------------------------------------------
// Top-Level IPC Message & Containers
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum IpcMessage {
    Request(IpcRequest),
    Response(IpcResponse),
    Event(IpcEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IpcRequest {
    pub id: String,
    pub payload: IpcRequestPayload,
}

impl IpcRequest {
    pub fn new(id: impl Into<String>, payload: IpcRequestPayload) -> Self {
        Self {
            id: id.into(),
            payload,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IpcResponse {
    pub reply_to: String,
    pub payload: Result<IpcResponsePayload, IpcErrorPayload>,
}

impl IpcResponse {
    pub fn ok(reply_to: impl Into<String>, payload: IpcResponsePayload) -> Self {
        Self {
            reply_to: reply_to.into(),
            payload: Ok(payload),
        }
    }

    pub fn err(reply_to: impl Into<String>, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            reply_to: reply_to.into(),
            payload: Err(IpcErrorPayload {
                code: code.into(),
                message: message.into(),
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IpcErrorPayload {
    pub code: String,
    pub message: String,
}

// ----------------------------------------------------------------------------
// Request Payloads
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum IpcRequestPayload {
    // Session / Pane management
    SpawnPane(SpawnPaneRequest),
    PtyInput(PtyInputRequest),
    ResizePane(ResizePaneRequest),
    KillPane(KillPaneRequest),
    ListPanes { workspace_id: Option<String> },
    GetPaneStatus { pane_id: String },
    GetScrollback { pane_id: String },

    // Workspace
    InitWorkspace(InitWorkspaceRequest),
    GetWorkspace { workspace_id: String },

    // Shared Brain & Blackboard
    GetSharedContext(GetSharedContextRequest),
    PublishBlackboard(PublishBlackboardRequest),
    ClaimModule(ClaimModuleRequest),
    ReleaseModule(ReleaseModuleRequest),
    GetFileLocks { workspace_id: String },

    // Git Engine & Worktree
    WorktreeDiff(WorktreeDiffRequest),
    MergeWorktree(MergeWorktreeRequest),
    CreateSnapshot(CreateSnapshotRequest),
    ListSnapshots { pane_id: String },
    RollbackSnapshot(RollbackSnapshotRequest),

    // Multi-Agent Orchestration
    DelegateTask(DelegateTaskRequest),

    // Obsidian Sync & Search
    ObsidianReadNote(ObsidianReadNoteRequest),
    ObsidianUpdateTask(ObsidianUpdateTaskRequest),
    ObsidianAppendMemory(ObsidianAppendMemoryRequest),
    ObsidianSearch(ObsidianSearchRequest),
    ListWorkflows { workspace_id: String },

    // Real-Time Event Subscription
    SubscribeEvents { workspace_id: Option<String> },
    Ping,

    // AI Pilot and Provider Settings
    SaveAiProviderConfig {
        provider: String,
        api_key: String,
        model: String,
        base_url: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        display_name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        protocol: Option<String>,
    },
    DeleteAiProviderConfig {
        provider: String,
    },
    GetAiProviderConfig,
    RunAiPilotPrompt {
        pane_id: String,
        instruction: String,
    },
    TestAiProviderConnection {
        provider: String,
        api_key: String,
        model: String,
        base_url: Option<String>,
    },
    AiChat {
        provider: String,
        model: Option<String>,
        prompt: String,
        system_prompt: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        history: Option<Vec<ChatHistoryEntry>>,
    },

    // Workspace File System Access (AI Assistant & Tools)
    FsListDirectory {
        root_path: String,
        recursive: bool,
        max_depth: usize,
    },
    FsReadFile {
        file_path: String,
        start_line: Option<usize>,
        end_line: Option<usize>,
    },
    FsWriteOrEditFile {
        file_path: String,
        operation: String, // "write" | "replace_lines" | "apply_patch"
        content: String,
    },
    FsDeletePath {
        file_path: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SpawnPaneRequest {
    pub pane_id: Option<String>,
    pub workspace_id: String,
    pub cli_type: CliType,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub working_dir: PathBuf,
    pub cols: u16,
    pub rows: u16,
    pub isolated_worktree: bool,
    pub env_vars: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PtyInputRequest {
    pub pane_id: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResizePaneRequest {
    pub pane_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KillPaneRequest {
    pub pane_id: String,
    pub signal: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InitWorkspaceRequest {
    pub id: String,
    pub name: String,
    pub root_repo_path: PathBuf,
    pub obsidian_vault_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GetSharedContextRequest {
    pub workspace_id: String,
    pub query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PublishBlackboardRequest {
    pub workspace_id: String,
    pub author_agent_id: String,
    pub entry_type: BlackboardEntryType,
    pub title: String,
    pub content_markdown: String,
    pub target_agent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClaimModuleRequest {
    pub workspace_id: String,
    pub agent_id: String,
    pub files: Vec<String>,
    pub intent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReleaseModuleRequest {
    pub workspace_id: String,
    pub agent_id: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorktreeDiffRequest {
    pub pane_id: String,
    pub target_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MergeWorktreeRequest {
    pub pane_id: String,
    pub target_branch: Option<String>,
    pub squash: bool,
    pub commit_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CreateSnapshotRequest {
    pub pane_id: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RollbackSnapshotRequest {
    pub pane_id: String,
    pub snapshot_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DelegateTaskRequest {
    pub workspace_id: String,
    pub caller_agent_id: String,
    pub target_cli: String,
    pub prompt: String,
    pub mode: String, // "headless" | "pane"
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ObsidianReadNoteRequest {
    pub workspace_id: String,
    pub query_or_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ObsidianUpdateTaskRequest {
    pub workspace_id: String,
    pub note_path: String,
    pub task_text: String,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ObsidianAppendMemoryRequest {
    pub workspace_id: String,
    pub folder: String,
    pub title: String,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ObsidianSearchRequest {
    pub workspace_id: String,
    pub query: String,
    pub limit: usize,
}

/// Parameterized command template stored as markdown in the vault's Workflows folder.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub command_template: String,
    pub tags: Vec<String>,
    /// Vault-relative markdown path, so the GUI can open the source note.
    pub relative_path: String,
}

// ----------------------------------------------------------------------------
// Response Payloads
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum IpcResponsePayload {
    Pong,
    Success,
    PaneSpawned(PaneSpawnedInfo),
    PaneKilled { pane_id: String },
    PaneList(Vec<PaneSummary>),
    PaneStatus(AgentStatus),
    ScrollbackData {
        pane_id: String,
        data: Vec<u8>,
        #[serde(default)]
        end_offset: u64,
    },
    Workspace(WorkspaceInfo),
    SharedContext(SharedContextSummary),
    BlackboardPublished { entry_id: i64 },
    ModuleClaimed { granted: bool, conflicts: Vec<String> },
    ModuleReleased,
    FileLocks(Vec<FileLockInfo>),
    WorktreeDiff(WorktreeDiffSummary),
    WorktreeMerged { commit_oid: String },
    SnapshotCreated { snapshot_id: String, git_tree_oid: String },
    SnapshotList(Vec<GitSnapshotInfo>),
    SnapshotRolledBack,
    TaskDelegated { result_output: String },
    ObsidianNote(ObsidianNoteSummary),
    ObsidianTaskUpdated,
    ObsidianMemoryAppended,
    ObsidianSearchResults(Vec<ObsidianSearchResult>),
    WorkflowList(Vec<WorkflowDefinition>),
    AiProviderConfig(ProviderConfig),
    AiPilotPromptResult {
        result: String,
    },
    AiProviderTestResult {
        success: bool,
        message: String,
    },
    AiChatResult {
        content: String,
    },
    FsDirectoryListing {
        entries: Vec<FsEntryInfo>,
    },
    FsFileContent {
        file_path: String,
        content: String,
        start_line: usize,
        end_line: usize,
        total_lines: usize,
    },
    FsFileModified {
        file_path: String,
        bytes_written: usize,
    },
    FsPathDeleted {
        file_path: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FsEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatHistoryEntry {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProviderSettings {
    pub api_key: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProviderConfig {
    pub default_provider: String,
    pub providers: HashMap<String, ProviderSettings>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        let mut providers = HashMap::new();
        providers.insert(
            "openai".to_string(),
            ProviderSettings {
                api_key: String::new(),
                model: "gpt-4o".to_string(),
                base_url: Some("https://api.openai.com/v1".to_string()),
                display_name: Some("OpenAI".to_string()),
                protocol: Some("openai".to_string()),
            },
        );
        providers.insert(
            "anthropic".to_string(),
            ProviderSettings {
                api_key: String::new(),
                model: "claude-3-5-sonnet-20241022".to_string(),
                base_url: Some("https://api.anthropic.com/v1".to_string()),
                display_name: Some("Anthropic".to_string()),
                protocol: Some("anthropic".to_string()),
            },
        );
        providers.insert(
            "gemini".to_string(),
            ProviderSettings {
                api_key: String::new(),
                model: "gemini-1.5-pro".to_string(),
                base_url: Some("https://generativelanguage.googleapis.com/v1beta/openai".to_string()),
                display_name: Some("Google Gemini".to_string()),
                protocol: Some("openai".to_string()),
            },
        );
        providers.insert(
            "groq".to_string(),
            ProviderSettings {
                api_key: String::new(),
                model: "llama-3.3-70b-versatile".to_string(),
                base_url: Some("https://api.groq.com/openai/v1".to_string()),
                display_name: Some("Groq".to_string()),
                protocol: Some("openai".to_string()),
            },
        );
        providers.insert(
            "openrouter".to_string(),
            ProviderSettings {
                api_key: String::new(),
                model: "anthropic/claude-3.5-sonnet".to_string(),
                base_url: Some("https://openrouter.ai/api/v1".to_string()),
                display_name: Some("OpenRouter".to_string()),
                protocol: Some("openai".to_string()),
            },
        );
        providers.insert(
            "ollama".to_string(),
            ProviderSettings {
                api_key: String::new(),
                model: "llama3:latest".to_string(),
                base_url: Some("http://localhost:11434/v1".to_string()),
                display_name: Some("Ollama (Local)".to_string()),
                protocol: Some("openai".to_string()),
            },
        );
        Self {
            default_provider: "openrouter".to_string(),
            providers,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PaneSpawnedInfo {
    pub pane_id: String,
    pub pid: Option<u32>,
    pub worktree_path: Option<PathBuf>,
    pub git_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PaneSummary {
    pub pane_id: String,
    pub workspace_id: String,
    pub cli_type: String,
    pub pid: Option<u32>,
    pub status: AgentStatus,
    pub worktree_path: Option<String>,
    pub git_branch: Option<String>,
    pub open_ports: Vec<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SharedContextSummary {
    pub blackboard_entries: Vec<BlackboardEntry>,
    pub active_file_locks: Vec<FileLockInfo>,
    pub relevant_notes: Vec<ObsidianNoteSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorktreeDiffSummary {
    pub pane_id: String,
    pub diff_unified: String,
    pub files_changed: Vec<String>,
    pub insertions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ObsidianNoteSummary {
    pub note_id: String,
    pub relative_path: String,
    pub title: String,
    pub frontmatter_json: Option<String>,
    pub raw_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ObsidianSearchResult {
    pub note_id: String,
    pub relative_path: String,
    pub title: String,
    pub snippet: String,
}

// ----------------------------------------------------------------------------
// Real-Time Asynchronous Events
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum IpcEvent {
    /// Raw terminal stdout/stderr bytes for WebGL2 pane rendering
    PtyOutput {
        pane_id: String,
        data: Vec<u8>,
        #[serde(default)]
        offset: u64,
    },
    /// Child process exited
    PaneExited {
        pane_id: String,
        exit_code: Option<i32>,
    },
    /// Agent status changed (e.g. IDLE -> THINKING -> EXECUTING)
    PaneStatusChanged {
        pane_id: String,
        status: AgentStatus,
    },
    /// A new entry appeared on the shared blackboard
    BlackboardEntryCreated(BlackboardEntry),
    /// File advisory lock claimed or released
    FileLockChanged {
        workspace_id: String,
        file_path: String,
        agent_id: String,
        intent: Option<String>,
        locked: bool,
    },
    /// Local listening port detected for this pane
    PortRadarDetected {
        pane_id: String,
        ports: Vec<u16>,
    },
    /// Telemetry / resource metrics updated
    TelemetryUpdated {
        pane_id: String,
        telemetry: AgentTelemetry,
    },
    /// New git snapshot captured for this pane
    GitSnapshotCreated {
        pane_id: String,
        snapshot_id: String,
        summary: String,
    },
    /// Agent requested an interactive pane for a delegated task
    DelegationPaneRequested {
        workspace_id: String,
        caller_agent_id: String,
        target_cli: String,
        prompt: String,
    },
    /// Obsidian note was modified externally and re-indexed
    ObsidianNoteUpdated {
        workspace_id: String,
        relative_path: String,
    },
    /// Step-by-step progress event emitted by the autonomous AI pilot
    AiPilotEvent {
        pane_id: String,
        step: String,
        details: Option<String>,
    },
    /// Workspace file created, modified, or deleted by AI or tools
    WorkspaceFileChanged {
        file_path: String,
        operation: String,
    },
}

// ----------------------------------------------------------------------------
// High-Speed Framing & Serialization Codec
// ----------------------------------------------------------------------------

impl IpcMessage {
    /// Encode message into bytes with length prefix and format header byte
    pub fn encode_bincode(&self) -> Result<Vec<u8>, ProtocolError> {
        let payload = bincode::serialize(self)?;
        let total_payload_len = payload.len() + 1; // +1 for codec byte
        if total_payload_len > MAX_FRAME_SIZE {
            return Err(ProtocolError::FrameTooLarge(total_payload_len));
        }

        let mut bytes = Vec::with_capacity(4 + total_payload_len);
        bytes.extend_from_slice(&(total_payload_len as u32).to_be_bytes());
        bytes.push(CODEC_BINCODE);
        bytes.extend_from_slice(&payload);
        Ok(bytes)
    }

    /// Encode message into JSON frame with length prefix
    pub fn encode_json(&self) -> Result<Vec<u8>, ProtocolError> {
        let payload = serde_json::to_vec(self)?;
        let total_payload_len = payload.len() + 1;
        if total_payload_len > MAX_FRAME_SIZE {
            return Err(ProtocolError::FrameTooLarge(total_payload_len));
        }

        let mut bytes = Vec::with_capacity(4 + total_payload_len);
        bytes.extend_from_slice(&(total_payload_len as u32).to_be_bytes());
        bytes.push(CODEC_JSON);
        bytes.extend_from_slice(&payload);
        Ok(bytes)
    }

    /// Decode message from raw framed payload (starting with codec byte)
    pub fn decode_payload(bytes: &[u8]) -> Result<Self, ProtocolError> {
        if bytes.is_empty() {
            return Err(ProtocolError::ConnectionClosed);
        }
        let codec = bytes[0];
        let payload = &bytes[1..];
        match codec {
            CODEC_BINCODE => Ok(bincode::deserialize(payload)?),
            CODEC_JSON => Ok(serde_json::from_slice(payload)?),
            other => Err(ProtocolError::InvalidHeader(other)),
        }
    }
}

#[cfg(feature = "async-codec")]
pub mod async_codec {
    use super::*;
    use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

    /// Read a single framed IPC message from an async stream
    pub async fn read_ipc_message<R>(reader: &mut R) -> Result<IpcMessage, ProtocolError>
    where
        R: AsyncRead + Unpin,
    {
        let mut len_bytes = [0u8; 4];
        match reader.read_exact(&mut len_bytes).await {
            Ok(0) => return Err(ProtocolError::ConnectionClosed),
            Ok(4) => {}
            Ok(_) => return Err(ProtocolError::ConnectionClosed),
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Err(ProtocolError::ConnectionClosed)
            }
            Err(e) => return Err(ProtocolError::Io(e)),
        }

        let len = u32::from_be_bytes(len_bytes) as usize;
        if len > MAX_FRAME_SIZE {
            return Err(ProtocolError::FrameTooLarge(len));
        }
        if len == 0 {
            return Err(ProtocolError::InvalidHeader(0));
        }

        let mut buffer = vec![0u8; len];
        reader.read_exact(&mut buffer).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::UnexpectedEof {
                ProtocolError::ConnectionClosed
            } else {
                ProtocolError::Io(e)
            }
        })?;

        IpcMessage::decode_payload(&buffer)
    }

    /// Write a single framed IPC message into an async stream using binary codec
    pub async fn write_ipc_message<W>(writer: &mut W, msg: &IpcMessage) -> Result<(), ProtocolError>
    where
        W: AsyncWrite + Unpin,
    {
        let encoded = msg.encode_bincode()?;
        writer.write_all(&encoded).await?;
        writer.flush().await?;
        Ok(())
    }

    /// Write a single framed IPC message into an async stream using JSON codec
    pub async fn write_ipc_message_json<W>(writer: &mut W, msg: &IpcMessage) -> Result<(), ProtocolError>
    where
        W: AsyncWrite + Unpin,
    {
        let encoded = msg.encode_json()?;
        writer.write_all(&encoded).await?;
        writer.flush().await?;
        Ok(())
    }
}

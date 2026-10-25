// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod ipc_bridge;
pub mod tool_detector;

use ipc_bridge::{
    cmd_check_pane_process, cmd_claim_module, cmd_cleanup_all_panes, cmd_create_snapshot, cmd_detect_available_tools,
    cmd_get_shared_context, cmd_get_scrollback, cmd_get_worktree_diff, cmd_kill_pane, cmd_list_panes, cmd_list_snapshots,
    cmd_list_workflows,
    cmd_merge_worktree, cmd_publish_blackboard, cmd_read_obsidian_note, cmd_release_module,
    cmd_resize_pane, cmd_rollback_snapshot, cmd_send_pty_input, cmd_spawn_pane,
    cmd_update_obsidian_task, cmd_validate_tool,
    cmd_read_workspace_directory, cmd_search_workspace_files, cmd_read_workspace_file,
    cmd_fs_list_directory, cmd_fs_read_file, cmd_fs_write_or_edit_file, cmd_fs_delete_path,
    cmd_save_ai_provider_config, cmd_get_ai_provider_config, cmd_run_ai_pilot_prompt, cmd_test_ai_provider,
    cmd_delete_ai_provider_config, cmd_ai_chat,
    start_event_listener, GuiBridgeState,
};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Workaround for WebKitGTK blank white screen on NVIDIA / Wayland / Hyprland
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("aether_gui=info")),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting AetherTerminal Native Shell (Tauri v2)...");

    tauri::Builder::default()
        .manage(GuiBridgeState::new())
        .setup(|app| {
            info!("Initializing Aether IPC daemon event bridge...");
            start_event_listener(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_spawn_pane,
            cmd_send_pty_input,
            cmd_resize_pane,
            cmd_kill_pane,
            cmd_cleanup_all_panes,
            cmd_check_pane_process,
            cmd_list_panes,
            cmd_get_shared_context,
            cmd_get_scrollback,
            cmd_publish_blackboard,
            cmd_claim_module,
            cmd_release_module,
            cmd_get_worktree_diff,
            cmd_merge_worktree,
            cmd_create_snapshot,
            cmd_rollback_snapshot,
            cmd_list_snapshots,
            cmd_read_obsidian_note,
            cmd_list_workflows,
            cmd_update_obsidian_task,
            cmd_detect_available_tools,
            cmd_validate_tool,
            cmd_read_workspace_directory,
            cmd_search_workspace_files,
            cmd_read_workspace_file,
            cmd_fs_list_directory,
            cmd_fs_read_file,
            cmd_fs_write_or_edit_file,
            cmd_fs_delete_path,
            cmd_save_ai_provider_config,
            cmd_get_ai_provider_config,
            cmd_run_ai_pilot_prompt,
            cmd_test_ai_provider,
            cmd_delete_ai_provider_config,
            cmd_ai_chat
        ])
        .build(tauri::generate_context!())
        .expect("error while building AetherTerminal application")
        .run(|_app_handle, event| {
            // Fires every frame; trace level keeps the launcher log readable.
            tracing::trace!("Tauri RunEvent: {:?}", event);
        });
}

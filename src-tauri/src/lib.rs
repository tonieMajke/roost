mod config;
mod pty;

use std::sync::OnceLock;

use tauri::Manager;

/// WebKitGTK variables this process set itself (not inherited from the user).
static OWN_ENV: OnceLock<Vec<&'static str>> = OnceLock::new();

pub(crate) fn own_env() -> impl Iterator<Item = &'static str> {
    OWN_ENV.get().into_iter().flatten().copied()
}

/// WebKitGTK on NVIDIA + Wayland renders a black window without these (same fix as Pi Code).
/// User values win. Agents get them removed again, see `pty_spawn`.
pub fn set_webview_env() {
    let mut own = Vec::new();
    #[cfg(target_os = "linux")]
    for (key, value) in [
        ("GDK_BACKEND", "x11"),
        ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
        ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
        ("LIBGL_ALWAYS_SOFTWARE", "1"),
    ] {
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, value);
            own.push(key);
        }
    }
    let _ = OWN_ENV.set(own);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::Ptys::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            config::agents_load,
            config::claude_session_exists,
            config::dir_exists,
            config::home_dir,
            config::workspace_load,
            config::workspace_save,
            config::workspace_backup,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Window closed, app.exit(), Ctrl+C in the dev terminal: never leave agents behind.
            if let tauri::RunEvent::Exit = event {
                app.state::<pty::Ptys>().kill_all();
            }
        });
}

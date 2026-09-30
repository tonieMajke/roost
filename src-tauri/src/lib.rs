mod config;
mod context;
mod handoff;
mod limits;
mod notify;
mod pty;
mod summary;

use std::sync::OnceLock;

use tauri::Manager;

pub use limits::statusline_helper;

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
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(pty::Ptys::default())
        // A reloaded page (Ctrl+R, Vite reload in `pnpm desktop`) never ran its cleanup: without
        // this its agents live on unseen next to the new page's copies of the same conversations.
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                webview.state::<pty::Ptys>().kill_all_async();
            }
        })
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
            context::session_context,
            handoff::session_handoff,
            summary::claude_summary,
            limits::claude_settings_arg,
            limits::claude_limits,
            notify::notify,
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

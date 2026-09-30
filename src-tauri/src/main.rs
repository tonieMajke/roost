#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Status line helper for claude panes (limits.rs): answer and exit before any GUI setup.
    if let Some(code) = agents_lib::statusline_helper() {
        std::process::exit(code);
    }
    agents_lib::set_webview_env();
    agents_lib::run()
}

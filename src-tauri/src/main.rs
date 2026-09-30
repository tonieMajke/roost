#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    agents_lib::set_webview_env();
    agents_lib::run()
}

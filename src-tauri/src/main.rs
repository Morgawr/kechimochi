// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kechimochi_lib::cli_env::apply_cli_env_overrides();
    kechimochi_lib::run()
}

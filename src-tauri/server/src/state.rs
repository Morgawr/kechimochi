use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub conn: Mutex<Connection>,
    pub data_dir: PathBuf,
    pub covers_dir: PathBuf,
}

use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::str::FromStr;

use image::ImageFormat;
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

pub fn open_input_file(app_handle: &AppHandle, path: &str) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    let file_path = FilePath::from_str(path).unwrap();
    app_handle
        .fs()
        .open(file_path, options)
        .map_err(|e| e.to_string())
}

pub fn read_input_bytes(app_handle: &AppHandle, path: &str) -> Result<Vec<u8>, String> {
    read_input_bytes_with_limit(app_handle, path, 64 * 1024 * 1024)
}

pub fn read_input_bytes_with_limit(
    app_handle: &AppHandle,
    path: &str,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let mut file = open_input_file(app_handle, path)?;
    if file.metadata().map_err(|e| e.to_string())?.len() > limit as u64 {
        return Err(format!("Selected file exceeds the {limit} byte limit"));
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err(format!("Selected file exceeds the {limit} byte limit"));
    }
    Ok(bytes)
}

pub fn write_output_bytes_atomic(path: &str, bytes: &[u8]) -> Result<(), String> {
    let destination = Path::new(path);
    let parent = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    staged.write_all(bytes).map_err(|e| e.to_string())?;
    staged.as_file_mut().sync_all().map_err(|e| e.to_string())?;
    staged
        .persist(destination)
        .map_err(|error| error.error.to_string())?;
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

pub fn input_file_name(app_handle: &AppHandle, path: &str) -> Option<String> {
    app_handle.path().file_name(path)
}

pub fn infer_extension_from_name(file_name: Option<&str>) -> Option<String> {
    file_name
        .and_then(|name| Path::new(name).extension().and_then(|ext| ext.to_str()))
        .map(|ext| ext.to_ascii_lowercase())
}

pub fn infer_image_extension(app_handle: &AppHandle, path: &str, bytes: &[u8]) -> String {
    match image::guess_format(bytes) {
        Ok(ImageFormat::Png) => "png".to_string(),
        Ok(ImageFormat::Jpeg) => "jpg".to_string(),
        Ok(ImageFormat::Gif) => "gif".to_string(),
        Ok(ImageFormat::WebP) => "webp".to_string(),
        _ => infer_extension_from_name(input_file_name(app_handle, path).as_deref())
            .unwrap_or_else(|| "png".to_string()),
    }
}

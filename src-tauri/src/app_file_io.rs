use std::fs::File;
use std::io::Read;
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
    let mut file = open_input_file(app_handle, path)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes)
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

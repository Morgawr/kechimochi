use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::{
    codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, GenericImageView, ImageFormat,
};

use crate::models::ProfilePicture;

pub const MAX_PROFILE_PICTURE_BYTES: usize = 3 * 1024 * 1024;
pub const MAX_PROFILE_PICTURE_DIMENSION: u32 = 640;

pub fn process_profile_picture_file(path: &str) -> Result<ProfilePicture, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    process_profile_picture_bytes(&bytes)
}

pub fn process_profile_picture_bytes(bytes: &[u8]) -> Result<ProfilePicture, String> {
    if bytes.is_empty() {
        return Err("Profile picture file is empty".to_string());
    }

    let format = image::guess_format(bytes)
        .map_err(|_| "Unsupported profile picture format. Use PNG, JPEG, or WebP.".to_string())?;
    match format {
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP => {}
        _ => return Err("Unsupported profile picture format. Use PNG, JPEG, or WebP.".to_string()),
    }

    let mut image = image::load_from_memory_with_format(bytes, format)
        .map_err(|e| format!("Failed to decode profile picture: {e}"))?;

    if image.width() > MAX_PROFILE_PICTURE_DIMENSION
        || image.height() > MAX_PROFILE_PICTURE_DIMENSION
    {
        image = image.resize(
            MAX_PROFILE_PICTURE_DIMENSION,
            MAX_PROFILE_PICTURE_DIMENSION,
            FilterType::Lanczos3,
        );
    }

    let (encoded_bytes, mime_type) = encode_image(&image)?;
    if encoded_bytes.len() > MAX_PROFILE_PICTURE_BYTES {
        return Err(
            "Profile picture is too large after processing. Keep it under 3 MB.".to_string(),
        );
    }

    let (width, height) = image.dimensions();
    Ok(ProfilePicture {
        mime_type: mime_type.to_string(),
        base64_data: BASE64.encode(&encoded_bytes),
        byte_size: encoded_bytes.len() as i64,
        width: width as i64,
        height: height as i64,
        updated_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn encode_image(image: &DynamicImage) -> Result<(Vec<u8>, &'static str), String> {
    if image.color().has_alpha() {
        let mut cursor = Cursor::new(Vec::new());
        image
            .write_to(&mut cursor, ImageFormat::Png)
            .map_err(|e| format!("Failed to encode profile picture: {e}"))?;
        Ok((cursor.into_inner(), "image/png"))
    } else {
        let mut encoded = Vec::new();
        let mut encoder = JpegEncoder::new_with_quality(&mut encoded, 85);
        encoder
            .encode_image(image)
            .map_err(|e| format!("Failed to encode profile picture: {e}"))?;
        Ok((encoded, "image/jpeg"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgb, Rgba};

    fn encode_png(image: &DynamicImage) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        image.write_to(&mut cursor, ImageFormat::Png).unwrap();
        cursor.into_inner()
    }

    #[test]
    fn resizes_large_images_down_to_640_square() {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2000, 1000, Rgb([255, 0, 0])));
        let bytes = encode_png(&image);

        let processed = process_profile_picture_bytes(&bytes).unwrap();

        assert_eq!(processed.width, 640);
        assert_eq!(processed.height, 320);
        assert_eq!(processed.mime_type, "image/jpeg");
        assert!(processed.byte_size > 0);
    }

    #[test]
    fn preserves_alpha_images_as_png() {
        let image = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(32, 32, Rgba([0, 0, 0, 0])));
        let bytes = encode_png(&image);

        let processed = process_profile_picture_bytes(&bytes).unwrap();

        assert_eq!(processed.width, 32);
        assert_eq!(processed.height, 32);
        assert_eq!(processed.mime_type, "image/png");
    }

    #[test]
    fn rejects_invalid_bytes() {
        let err = process_profile_picture_bytes(b"not an image").unwrap_err();
        assert!(err.contains("Unsupported profile picture format"));
    }
}

mod routes;
mod state;

use clap::Parser;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use state::AppState;

#[derive(Parser)]
#[command(name = "kechimochi-server", about = "Kechimochi self-hosted web server")]
struct Args {
    /// Port to listen on
    #[arg(short, long, default_value_t = 8080)]
    port: u16,

    /// Data directory for databases and covers
    #[arg(short, long, default_value = "./data")]
    data_dir: PathBuf,

    /// Initial profile name
    #[arg(long, default_value = "default")]
    profile: String,

    /// Path to the built frontend (dist/) directory
    #[arg(long, default_value = "../dist")]
    frontend_dir: PathBuf,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();

    let data_dir = args.data_dir.canonicalize().unwrap_or_else(|_| {
        std::fs::create_dir_all(&args.data_dir).expect("Failed to create data directory");
        args.data_dir
            .canonicalize()
            .expect("Failed to resolve data directory")
    });

    let covers_dir = data_dir.join("covers");
    std::fs::create_dir_all(&covers_dir).expect("Failed to create covers directory");

    let profiles = kechimochi_core::db::list_profiles(&data_dir).unwrap_or_default();
    let initial_profile = if profiles.contains(&args.profile) {
        args.profile.clone()
    } else if profiles.is_empty() {
        args.profile.clone()
    } else {
        profiles[0].clone()
    };

    let conn = kechimochi_core::db::init_db(&data_dir, &initial_profile)
        .expect("Failed to initialize database");

    let state = Arc::new(AppState {
        conn: std::sync::Mutex::new(conn),
        data_dir,
        covers_dir,
    });

    let frontend_dir = args.frontend_dir.clone();
    let index_file = frontend_dir.join("index.html");

    let app = axum::Router::new()
        .nest("/api", routes::api_routes())
        .fallback_service(
            ServeDir::new(&frontend_dir).fallback(ServeFile::new(&index_file)),
        )
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", args.port);
    println!("Kechimochi server starting on http://localhost:{}", args.port);
    println!("Frontend served from: {}", frontend_dir.display());

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind address");
    axum::serve(listener, app)
        .await
        .expect("Server error");
}

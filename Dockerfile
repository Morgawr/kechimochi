# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src/ src/
COPY public/ public/
ARG VITE_GIT_HASH=docker
ARG VITE_APP_VERSION=0.0.0-dev.docker
ARG VITE_APP_CHANNEL=dev
ARG VITE_RELEASE_STAGE=beta
ENV VITE_GIT_HASH=$VITE_GIT_HASH
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_APP_CHANNEL=$VITE_APP_CHANNEL
ENV VITE_RELEASE_STAGE=$VITE_RELEASE_STAGE
RUN npm run web:build

# ── Stage 2: Build Rust web server binary ─────────────────────────────────────
FROM rust:1-bookworm AS backend
WORKDIR /app
# tauri-build (in build.rs) detects Tauri platform libs via pkg-config even when
# building only the web_server binary; these are build-time only deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
        pkg-config \
        libwebkit2gtk-4.1-dev \
        libgtk-3-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*
COPY src-tauri/ src-tauri/
RUN cargo build --manifest-path src-tauri/Cargo.toml --bin web_server --release

# ── Stage 3: Minimal runtime image ───────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /app/src-tauri/target/release/web_server ./web_server
COPY --from=frontend /app/dist ./dist

# Data is stored in /data; mount a volume there to persist across updates.
RUN groupadd --gid 10001 kechimochi \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin kechimochi \
    && mkdir -p /data \
    && chown -R kechimochi:kechimochi /app /data
VOLUME /data
ENV KECHIMOCHI_DATA_DIR=/data
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000
USER kechimochi
CMD ["./web_server"]

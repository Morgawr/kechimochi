# Development Guide

This document outlines the steps for setting up a development environment, building the application, and running the internal test suites for Kechimochi.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

*   **Node.js** (22.13+; CI uses Node 22). An `.nvmrc` is provided for `nvm use`.
*   **Rust** (latest stable via [rustup](https://rustup.rs/))
*   **System Dependencies** (Linux only):
    ```bash
    # Debian/Ubuntu
    sudo apt update
    sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

    # Fedora
    sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel

    # Arch
    sudo pacman -S webkit2gtk-4.1 gtk3 libappindicator-gtk3 librsvg
    ```

## Getting the Source

Clone the repository and install the dependencies:

```bash
git clone https://github.com/Morgawr/kechimochi.git
cd kechimochi
npm install
```

## Running the Application

Kechimochi supports two primary interfaces for development.

### Desktop (Tauri)
The desktop application uses Tauri to provide a native window and access to system APIs.

```bash
npm run tauri dev
```

This will start the Vite development server for the frontend and compile the Rust backend in debug mode.

If you need Google Drive cloud sync for a local desktop build, place the desktop OAuth client ID and secret in a gitignored `.env.local` at the repository root or in `src-tauri/.env.local`:

```bash
KECHIMOCHI_GOOGLE_CLIENT_ID=your-desktop-client-id.apps.googleusercontent.com
KECHIMOCHI_GOOGLE_CLIENT_SECRET=your-desktop-client-secret
```

The desktop build injects both values at build time, so they do not need to live in `src-tauri/tauri.conf.json`.

### Android (Tauri Mobile)
The Android project is generated under `src-tauri/gen/android` and is intended to be checked into the repository.

With the Android SDK/NDK installed and `ANDROID_HOME` / `ANDROID_SDK_ROOT` pointing at your SDK, you can use the standard Tauri mobile commands:

```bash
npm run tauri android dev
npm run tauri android build --debug --apk --ci
```

The debug build produces an APK through the generated Gradle project.

### Web Interface
You can also run Kechimochi as a web application. This requires starting both the frontend development server and a separate Rust backend API server.

```bash
npm run web
```

You can then access the app via `http://localhost:3000`.

## Testing and Quality Assurance

We use a variety of tools to ensure code quality and stability.

For database compatibility rules and migration workflow, see `docs/database-versioning.md`.
For the release workflow, changelog process, and versioning tracks, see `docs/release-process.md`.

### Frontend Quality
All frontend commands should be run from the project root.

*   **Linting**: Check the TypeScript code for style and potential errors.
    ```bash
    npm run lint
    ```
*   **Unit Tests**: Run frontend logic and component tests using Vitest.
    ```bash
    npm run test
    ```
*   **Coverage**: Generate a test coverage report.
    ```bash
    npm run test:coverage
    ```

### Backend Quality (Rust)
Navigate to the `src-tauri` directory or use the `--manifest-path` flag to run backend checks.

*   **Unit Tests**: Verify Rust logic and database operations.
    ```bash
    cd src-tauri
    cargo test
    ```
*   **Clippy**: Run the Rust linter to catch common mistakes and improve code quality.
    ```bash
    cargo clippy
    ```

### End-to-End (E2E) Tests

The E2E suite verifies the entire application stack using WebdriverIO.  It supports three platforms — Desktop (Tauri), Web (Chrome + web_server), and Android (Appium + emulator/cloud) — controlled by separate config files.  All tests run against isolated temporary databases.

#### Spec layout

```
e2e/specs/
  shared/     — platform-agnostic CUJs (run on Desktop + Web + Android)
  desktop/    — Desktop-only: file dialogs, disk export/import, native window
  web/        — Web-exclusive: browser refresh, direct URL load
  android/    — Android-only smoke: fresh-install + seeded-DB
  non-mobile/ — Desktop + Web only (e.g. window-resize / breakpoints)
```

#### Database Seeding

The E2E suite relies on deterministic fixture databases to ensure consistent test results.  We use a seed script to generate these databases, which include:
*   A **Shared Media Database** containing a curated set of Japanese media titles (Manga, Anime, Visual Novels, etc.).
*   A **User Profile Database** populated with historical activity logs and initial settings.
*   **Placeholder Assets** like cover images for the media library.

Seed the databases manually (also run automatically by `npm run e2e`, `npm run e2e:test`, and the full platform suite commands):
```bash
npm run e2e:seed
```

#### Desktop E2E

Pre-requisite: `tauri-driver` installed.
```bash
cargo install tauri-driver
```

Run the full Desktop suite (seed + build + shared/desktop specs):
```bash
npm run e2e           # shorthand — also aliases to desktop
npm run e2e:desktop   # explicit
```

Run a single spec:
```bash
npm run e2e:test -- --spec e2e/specs/shared/dashboard.spec.ts
npm run e2e:test -- --spec e2e/specs/desktop/bulk-management.spec.ts
```

#### Web E2E

Pre-requisite: `cargo` (already required for Tauri).  Uses WDIO's managed chromedriver — no separate install.

Run the full Web suite (seed + frontend build + web_server build + shared/web specs):
```bash
npm run e2e:web
```

Run a single spec:
```bash
npm run e2e:web -- --spec e2e/specs/shared/dashboard.spec.ts
npm run e2e:web -- --spec e2e/specs/web/web-load.spec.ts
```

**Cost note:** Web E2E runs in headless Chrome against a local `web_server` binary.  It is cheap (no VM or emulator needed) and runs per-PR in CI.

#### Android E2E

Pre-requisites:
1.  Android SDK installed, `ANDROID_HOME` set.
2.  An AVD created and booted: `emulator -avd Pixel_6_API_34`.
3.  Appium with the UiAutomator2 driver installed (`appium driver install uiautomator2`), running
    with chromedriver autodownload so it can drive the Tauri WebView (the app UI is an Android
    WebView, not native): `npx appium --port 4723 --allow-insecure=uiautomator2:chromedriver_autodownload`.
4.  Debug APK built: `npm run tauri -- android build --apk --debug`.

Run the Android suite (shared + Android-only specs):
```bash
npm run e2e:android
```

> **Running the emulator inside a VM/CI** needs nested virtualization (KVM); without it the emulator
> falls back to software rendering and is too slow to be usable. On GitHub's Ubuntu runners KVM is
> available but `/dev/kvm` must be opened up — `android-e2e.yml` does this in its "enable KVM" step.
> Developing in a VM with no nested virtualization (no `/dev/kvm`) means you can't run it locally at
> all — trigger the `Android E2E` workflow manually (`workflow_dispatch`) to run it in CI instead.

Target a remote Appium grid (BrowserStack, Sauce Labs, LambdaTest, AWS Device Farm):
```bash
ANDROID_E2E_TARGET=remote \
  APPIUM_HOST=hub.browserstack.com \
  APPIUM_USER=<user> \
  APPIUM_KEY=<key> \
  npm run e2e:android
```

**Cost note:** Emulator boot is the heaviest CI step (~10–20 min).  Android E2E runs on a weekly schedule (Monday 06:00 UTC) plus manual `workflow_dispatch`, in `.github/workflows/android-e2e.yml`.

**Firebase Test Lab is not compatible with this suite.**  FTL runs Espresso / UIAutomator2 *instrumentation* tests (JVM, APK-packaged), not a live Appium WebDriver grid.  Adapting these specs for FTL would require rewriting them as instrumentation tests — a separate effort.

#### Parallel Execution

By default, Desktop and Web E2E run with **2 parallel workers**.  Override with:
```bash
E2E_MAX_INSTANCES=4 npm run e2e
```

> [!WARNING]
> More than 4–5 parallel instances can cause CPU overhead and flaky timeouts.  Android E2E always uses `maxInstances: 1` to avoid AVD conflicts.

## Building for Production

To create a standalone production binary:

```bash
npx tauri build
```

The compiled packages (AppImage, deb, etc.) will be located in `src-tauri/target/release/bundle/`.

For release builds with Google Drive sync enabled, provide both `KECHIMOCHI_GOOGLE_CLIENT_ID` and `KECHIMOCHI_GOOGLE_CLIENT_SECRET` in the build environment or a private `.env.local` before running the build.

### Web Release (Self Hosted)

To build the web release artifacts (frontend + standalone Rust web server):

```bash
npm run web:release
```

This produces:

*   Frontend build output in `dist/`
*   Backend binary in `src-tauri/target/release/` (`web_server` on Linux/macOS, `web_server.exe` on Windows)

Run the server from the project root:

```bash
# Linux/macOS
./src-tauri/target/release/web_server

# Windows (PowerShell)
.\src-tauri\target\release\web_server.exe
```

By default, the server expects `dist/` to be available and serves both the SPA and `/api/*` endpoints from a single process.

Optional environment variables:

*   `PORT`: listen port (default `3000`)
*   `HOST`: bind host (default `0.0.0.0`)
*   `KECHIMOCHI_DATA_DIR`: override application data directory
*   `KECHIMOCHI_WEB_DIST_DIR`: override frontend build directory (defaults to `dist`)

## Contributing

We welcome contributions to Kechimochi! To ensure the project maintains its standard of quality, please follow these guidelines when submitting a Pull Request (PR) on GitHub.

### Code Quality and Standards
We use [SonarCloud](https://sonarcloud.io/) to monitor our codebase and maintain a high standard of "vibe" coded software. You can view the current state of the project's code quality at:
[sonarcloud.io/project/overview?id=Morgawr_kechimochi](https://sonarcloud.io/project/overview?id=Morgawr_kechimochi)

*   **Linter Checks**: Every PR is expected to have all linter tests passing.
*   **PR Analysis**: SonarCloud will automatically crawl your PR to ensure code quality does not drop significantly.
*   **Review Process**: Project owners will review your changes and may ask you to address specific code quality issues or other concerns before the PR is merged.

### Guidelines for LLM Assisted Contributions
We support contributions that utilize Large Language Models. However, authors are responsible for the code they submit.

*   **Understanding**: You should thoroughly understand what your code does and how it is implemented.
*   **Human Readable Descriptions**: The PR description should be as humanly readable as possible. Avoid including large walls of text often generated by LLMs.
*   **Brief and Focused**: Keep your changes short and focused. Smaller PRs are much easier to review and less likely to waste the maintainer's time.

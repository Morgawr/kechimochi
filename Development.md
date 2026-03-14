# Development Guide

This document outlines the steps for setting up a development environment, building the application, and running the internal test suites for Kechimochi.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

*   **Node.js** (version 18 or higher)
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

### Web Interface
You can also run Kechimochi as a web application. This requires starting both the frontend development server and a separate Rust backend API server.

```bash
npm run web
```

You can then access the app via `http://localhost:3000`.

## Testing and Quality Assurance

We use a variety of tools to ensure code quality and stability.

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
The E2E suite verifies the entire application stack using WebdriverIO. These tests run on isolated temporary databases.

Ensure you have `tauri-driver` installed:
```bash
cargo install tauri-driver
```

#### Database Seeding
The E2E suite relies on deterministic fixture databases to ensure consistent test results. We use a seed script to generate these databases, which include:
*   A **Shared Media Database** containing a curated set of Japanese media titles (Manga, Anime, Visual Novels, etc.).
*   A **User Profile Database** populated with historical activity logs and initial settings.
*   **Placeholder Assets** like cover images for the media library.

You can run the seeding process manually using:
```bash
npm run e2e:seed
```

This command is automatically executed as part of the main `npm run e2e` command, but it is useful to run independently if you are debugging specific test cases or want to inspect the fixture data.

#### Running Tests
Run the full E2E suite (including database seeding and application build):
```bash
npm run e2e
```

#### Parallel Execution
By default, the test suite runs with **2 parallel jobs**. You can override this using the `E2E_MAX_INSTANCES` environment variable.

```bash
E2E_MAX_INSTANCES=4 npm run e2e
```

> [!WARNING]
> Running more than **4 or 5 parallel instances** can lead to significant CPU overhead and application slowdowns. This often results in flaky tests, unexpected timeouts, and failures. It is recommended to stay within the default limits unless you are on high performance hardware.

To run only specific test specs:
```bash
npm run e2e:test -- --spec specs/profile.spec.ts
```

## Building for Production

To create a standalone production binary:

```bash
npx tauri build
```

The compiled packages (AppImage, deb, etc.) will be located in `src-tauri/target/release/bundle/`.

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

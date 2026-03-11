# Kechimochi

[![Test status](https://github.com/Morgawr/kechimochi/actions/workflows/test.yml/badge.svg)](https://github.com/Morgawr/kechimochi/actions/workflows/test.yml)

<p align="center">
  <img src="public/logo.png" width="120" alt="Kechimochi Logo" />
</p>

<p align="center">
  <em>A personal language immersion tracker</em>
</p>

---

> [!CAUTION]
> **WARNING: VIBE-CODED SOFTWARE: USE AT YOUR OWN RISK**
>
> This application was **entirely vibe-coded**. That means it was built rapidly with AI assistance,
> without formal testing, code review, or quality assurance processes. There are certainly bugs
> lurking in the codebase, edge cases that haven't been considered, and potentially data-loss
> scenarios that haven't been accounted for.
>
> **The author takes absolutely no responsibility for:**
> - Data loss, corruption, or inaccuracy
> - Application crashes or unexpected behavior
> - Any consequences resulting from reliance on this software
> - Security vulnerabilities
> - Anything else that might go wrong
>
> **You have been warned.** Back up your data frequently. Use the CSV export feature.
> Do not rely on this application as your sole source of truth for anything important.

---

## What is Kechimochi?

Kechimochi is a **desktop activity tracker** designed for people studying languages through immersion. It helps you log, visualize, and analyze time spent consuming media in your target language, whether you're reading manga, watching anime, playing games, or listening to podcasts.

## Features

### Dashboard
* **Tracking Heatmap**: A GitHub style yearly contribution heatmap showing your daily activity. Navigate between years to view your historical immersion journey.
* **Study Stats**: A statistics panel providing insights into your habits:
    * Total lifetime logs and media entries.
    * Longest consecutive study streak and current active streak.
    * Daily averages: total and per activity type.
    * Date of first recorded entry.
* **Activity Breakdown**: A doughnut chart visualizing time distribution across activity types such as Reading, Watching, or Playing.
* **Activity Visualization**: Bar or line charts showing immersion over time with configurable ranges:
    * **Weekly**: Day by day breakdown.
    * **Monthly**: Week by week breakdown.
    * **Yearly**: Month by month breakdown.
* **Recent Activity**: A timeline feed of your latest logged sessions with the ability to delete individual entries.

### Library and Media Management
* **Media Grid**: A grid view to track your media titles.
* **Power Search**: Real time fuzzy search 
* **Advanced Filtering**: Filter your library by activity type or status
* **Media Details**: A comprehensive view for each title including:
    * **Metadata Management**: Edit titles, descriptions, and custom fields.
    * **Contextual Tagging**: Smart content types tailored to the activity type.
    * **Progress Tracking**: Update statuses like Ongoing, Complete, Dropped, etc.

### Metadata Importers
Automatically fetch covers, descriptions, and metadata from various sources:
* **Visual Novels**: VNDB
* **Manga and Books**: Bookmeter, BookWalker, Cmoa, Shonen Jump Plus
* **Anime and Movies**: AniList, IMDb
* **Video Games**: Backloggd
With Jiten.moe metadata integration

### Reading Analysis
* **Reading Report Card**: Analyzes your reading speed across media types.
* **Progress Projections**: Estimates remaining time and completion rates for active content based on your historical trends.

### Multi-Profile and Personalization
* **Isolated Profiles**: Create and switch between multiple user profiles, each with its own independent SQLite database.
* **Theme System**: Choose from 12 curated themes including Light, Dark, Pastel Pink, Molokai, Noctua Brown, and multiple greyscale options.

### Data Management
* **Activity Portability**: Import or export activity logs in CSV format.
* **Library Portability**: Export your entire media library to CSV or import new libraries from other users or backups.

## Prerequisites

- **Node.js** >= 18
- **Rust** (latest stable, via [rustup](https://rustup.rs/))
- **System dependencies** for Tauri on Linux:

```bash
# Debian/Ubuntu
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel

# Arch
sudo pacman -S webkit2gtk-4.1 gtk3 libappindicator-gtk3 librsvg
```

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/Morgawr/kechimochi.git
cd kechimochi
npm install
```

### 2. Run in development mode

```bash
npm run tauri dev
```

This will:
- Start the Vite dev server for hot-reloading the frontend
- Compile and launch the Rust backend
- Open the application window

### 3. Build a standalone binary

```bash
# On Arch Linux (or if AppImage build fails with strip errors)
NO_STRIP=true npx tauri build

# On Debian/Ubuntu/Fedora
npx tauri build
```

The compiled binary and packages will be at:

```
src-tauri/target/release/kechimochi              # raw binary
src-tauri/target/release/bundle/appimage/         # .AppImage (portable)
src-tauri/target/release/bundle/deb/              # .deb (Debian/Ubuntu)
```

You can run the AppImage directly:

```bash
chmod +x src-tauri/target/release/bundle/appimage/kechimochi_*.AppImage
./src-tauri/target/release/bundle/appimage/kechimochi_*.AppImage
```

Or just run the raw binary:

```bash
./src-tauri/target/release/kechimochi
```

> [!NOTE]
> On Arch Linux, `linuxdeploy`'s bundled `strip` tool is incompatible with Arch's newer ELF
> format. Setting `NO_STRIP=true` skips the stripping step and resolves the issue. The resulting
> AppImage will be slightly larger but functionally identical.

### 4. Running Tests

#### Backend Tests
Run the Rust test suite to verify database operations and logic:

```bash
cd src-tauri
cargo test
cd ..
```

#### Frontend Type Checking
Run TypeScript type checking:

```bash
npx tsc --noEmit
```

#### End-to-End (E2E) Tests
Kechimochi uses WebdriverIO and Tauri Driver for automated E2E testing. These tests run on isolated temporary databases and do not affect your personal data.

**Setup E2E Prerequisites:**
Ensure `tauri-driver` is installed:
```bash
cargo install tauri-driver
```

**Run E2E Tests:**
The `npm run e2e` command builds the app in debug mode, seeds the test databases, and executes the full suite:

```bash
npm run e2e
```

**Parallel Execution:**
Tests run in parallel by default (2 instances). You can configure the number of parallel workers using the `E2E_MAX_INSTANCES` environment variable:

```bash
E2E_MAX_INSTANCES=4 npm run e2e:test
```

**Run Specific Specs:**
To run only specific test files:

```bash
npm run e2e:test -- --spec specs/profile.spec.ts
```

## CSV Format

For importing data, use the following CSV format:

```csv
Date,Log Name,Media Type,Duration,Language
2024-01-15,ある魔女が死ぬまで,Reading,45,Japanese
2024-01-15,Final Fantasy 7,Playing,120,Japanese
2024-01-16,呪術廻戦,Watching,25,Japanese
```

| Column       | Description                                          |
|-------------|------------------------------------------------------|
| `Date`      | `YYYY-MM-DD` format                                 |
| `Log Name`  | Title of the media                                   |
| `Media Type`| One of: `Reading`, `Watching`, `Playing`, `Listening`, `None` |
| `Duration`  | Duration in minutes (integer)                        |
| `Language`  | Language tag (e.g., `Japanese`, `Korean`)             |

## Data Storage

All data is stored locally in SQLite databases in your system's application data directory:

- **Linux**: `~/.local/share/com.morg.kechimochi/`
- **macOS**: `~/Library/Application Support/com.morg.kechimochi/`
- **Windows**: `C:\Users\<user>\AppData\Roaming\com.morg.kechimochi\`

Each profile has its own database file named `kechimochi_<profilename>.db`.

## License

This project is provided as-is with no warranty. See the warning at the top of this document.

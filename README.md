# Kechimochi

[![Test status](https://github.com/Morgawr/kechimochi/actions/workflows/test.yml/badge.svg)](https://github.com/Morgawr/kechimochi/actions/workflows/test.yml)
![Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/morgawr/ec5ee3f88d6da60d5de0504267e07de7/raw/kechimochi-coverage.json)
[![Quality Gate
Status](https://sonarcloud.io/api/project_badges/measure?project=Morgawr_kechimochi&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=Morgawr_kechimochi)

[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=Morgawr_kechimochi&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=Morgawr_kechimochi)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=Morgawr_kechimochi&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=Morgawr_kechimochi)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=Morgawr_kechimochi&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=Morgawr_kechimochi)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=Morgawr_kechimochi&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=Morgawr_kechimochi)

[![SonarQube Cloud](https://sonarcloud.io/images/project_badges/sonarcloud-highlight.svg)](https://sonarcloud.io/summary/new_code?id=Morgawr_kechimochi)

---

<p align="center">
  <img src="public/logo.png" width="120" alt="Kechimochi Logo" />
</p>

<p align="center">
  <em>A personal Japanese immersion tracker</em>
</p>

---

Status: Beta.

## Log and Visualize Your Japanese Immersion

Kechimochi is a personal activity tracker built for those who learn Japanese through immersion. It provides a simple way to log time spent with native content, whether you are reading manga, watching anime, playing video games, or listening to podcasts.

Designed with a local first philosophy, Kechimochi ensures that your data remains yours. It provides a focused interface to manage your media library, track your study habits, and keep ownership of your history without relying on external websites or cloud services.

## Core Features

### Dashboard & Analytics

![Dashboard](demos/dashboard_demo.gif)

A vibrant and colorful dashboard where you can see your historical activities and immersion time, including statistics of how many hours have been spent every day, week, year, and on what content. The dashboard also includes yearly heatmaps and per-media breakdowns so you can see where your study time is really going. You can log new activity directly from the **New Activity** button.

### Media Management & Automated Metadata

![Library](demos/library_demo.gif)

A fast and responsive library which tracks all the media you have added. You can browse the media you are currently watching, playing, or reading, track progress over time, manage cover images, and add milestones to record specific breakthroughs such as routes, chapters, endings, or in-game goals.

The metadata of each entry is provided by various websites which the user can add and download from automatically:
*   **Visual Novels**: VNDB
*   **Anime and Movies**: AniList and IMDb
*   **Manga and Books**: Bookmeter, BookWalker, Cmoa, and Shonen Jump Plus
*   **Video Games**: Backloggd
*   **Dictionary Integration**: Jiten.moe metadata support

Are we missing some sites? Let us know by opening an [issue](https://github.com/Morgawr/kechimochi/issues/new) on our issue tracker.

### Customization

![Themes](demos/themes_demo.gif)

Customizable themes and a profile picture let you personalize the app while keeping the local-first workflow simple.

### Reading Analysis

The application includes dedicated reading reports to help you understand your pace across different media. It estimates your reading speed from completed content and provides progress projections to calculate when you might finish your current book, manga, or visual novel based on your past activity.

### Data Ownership and Portability

Your logs are stored in local SQLite databases, giving you full control over your information.
*   **CSV Import**: Migrate your existing logs from other spreadsheets or tools (see [CSV Formats](docs/csv-formats.md)).
*   **CSV Export**: Export your activity history, milestones, or library when you need a plain-text dataset.
*   **Full Backup / Restore**: Save and restore the entire application state, including databases, settings, and covers.
*   **Local First Storage**: Keep your data on your machine or your own server.

We take data preservation seriously. Kechimochi is designed to keep your data local, ships with explicit backup and restore support, and uses cautious database versioning and migration rules to reduce the risk of accidental data loss during updates. Even so, you should still keep regular backups of anything you care about.

### Apps and Self-Hosted Web

Kechimochi supports desktop and Android apps plus a self-hosted web mode powered by the same Rust backend. If you want a local native app, use the desktop or Android build. If you want to host it for yourself, you can run the bundled web server or the published Docker image.

The desktop app is the primary and most thoroughly tested way to use Kechimochi. The web mode is available as a best-effort option for self-hosting, but it has not been exercised as extensively as the desktop app.

## Getting Started

Kechimochi is built with Tauri for the app experience (desktop and Android) and also supports a self-hosted web deployment.

For details on how to run the software on developer builds (and contribute!) see the [Development.md](Development.md) document.

Kechimochi is currently in beta. Core tracking, media management, analytics, import/export, and backup flows are implemented and working, but you should still expect active iteration and occasional rough edges as the app continues to evolve.

If you want a beta release build, download it from the [GitHub Releases](https://github.com/Morgawr/kechimochi/releases) page.

If you want to test the latest in-progress development build without building it yourself, grab one of the workflow artifacts from [Publish Dev Artifacts](https://github.com/Morgawr/kechimochi/actions/workflows/publish.yml). Those builds are for testers and contributors, and they display a `DEV BUILD x.y.z-dev.<git-hash>` label in the UI.

### Docker (Self Hosted)

Kechimochi web mode is available as a container image on GitHub Container Registry:

*   `ghcr.io/morgawr/kechimochi:latest`

Run with Docker:

```bash
docker run -d \
  --name kechimochi \
  -p 3000:3000 \
  -v /path/to/kechimochi-data:/data \
  -e TZ=UTC \
  ghcr.io/morgawr/kechimochi:latest
```

Then open `http://<your-server-ip>:3000`.

The `/data` volume contains your SQLite databases and covers, so keep it on persistent storage.

The web deployment is still a best-effort option. If you want the most tested and supported experience today, prefer the desktop app.

### Docker Compose Example

```yaml
services:
  kechimochi:
    image: ghcr.io/morgawr/kechimochi:latest
    container_name: kechimochi
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      TZ: UTC
      KECHIMOCHI_DATA_DIR: /data
      PORT: 3000
      HOST: 0.0.0.0
    volumes:
      - /path/to/kechimochi-data:/data
```

> **Volume permissions:** The container runs as uid/gid `10001` by default. If your host path is owned by a different user (e.g. TrueNAS/Unraid systems where the `apps` user is uid `568`), add a `user:` override so the container can write to the volume:
> ```yaml
>     user: "568:568"
> ```
> Replace `568:568` with the uid:gid that owns your host data directory.

Start it with:

```bash
docker compose up -d
```

Update to the newest image:

```bash
docker compose pull
docker compose up -d
```

---

### LLM Assisted Coding and Quality Assurance

This application has been developed with assistance from Large Language Model, use at your own risk.

A lot of the code has not been manually verified by humans, however we do strive for a high level of quality by employing strict tests, development guard rails, and automated checks before merging the code.

Kechimochi is built on a foundation of test suites and automated checks. We maintain unit tests for frontend and backend logic, along with an end to end (e2e) testing infrastructure. These automated systems run on every change to help prevent regressions and ensure that features remain stable as the project evolves.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

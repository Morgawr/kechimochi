# Kechimochi

[![Test status](https://github.com/Morgawr/kechimochi/actions/workflows/test.yml/badge.svg)](https://github.com/Morgawr/kechimochi/actions/workflows/test.yml)
![Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/morgawr/ec5ee3f88d6da60d5de0504267e07de7/raw/kechimochi-coverage.json)

<p align="center">
  <img src="public/logo.png" width="120" alt="Kechimochi Logo" />
</p>

<p align="center">
  <em>A personal Japanese immersion tracker</em>
</p>

---

Status of the project: Pre-release.

## Log and Visualize Your Japanese Immersion

Kechimochi is a personal activity tracker built for those who learn Japanese through immersion. It provides a simple way to log time spent with native content, whether you are reading manga, watching anime, playing video games, or listening to podcasts.

Designed with a local first philosophy, Kechimochi ensures that your data remains yours. It provides a focused interface to manage your media library and track your study habits without relying on external websites or cloud services.

## Core Features

### Dashboard & Analytics

![Dashboard](demos/dashboard_demo.gif)

A vibrant and colorful dashboard where you can see your historical activities and immersion time, including statistics of how many hours have been spent every day, week, year, and on what content. You can also track your activities by clicking on the **New Activity** button.

### Media Management & Automated Metadata

![Library](demos/library_demo.gif)

A fast and responsive library which tracks all the media you have added. You can browse the media you are currently watching, playing, or reading, and add milestones to track your breakthroughs (finished a route in a VN, reached a certain chapter in a book, finished a specific challenge in a game, etc). 

The metadata of each entry is provided by various websites which the user can add and download from automatically:
*   **Visual Novels**: VNDB
*   **Anime and Movies**: AniList and IMDb
*   **Manga and Books**: Bookmeter, BookWalker, Cmoa, and Shonen Jump Plus
*   **Video Games**: Backloggd
*   **Dictionary Integration**: Jiten.moe metadata support

Are we missing some sites? Let us know by opening an [issue](https://github.com/Morgawr/kechimochi/issues/new) on our issue tracker.

### Customization

![Themes](demos/themes_demo.gif)

Multiple profiles to choose from to get your preferred color theme.

### Reading Analysis

The application includes dedicated reading reports to help you understand your pace across different media. It estimates your reading speed and provides progress projections to calculate when you might finish your current book or manga based on your past activity.

### Data Ownership and Portability

Your logs are stored in local SQLite databases, giving you full control over your information.
*   **CSV Import**: Migrate your existing logs from other spreadsheets or tools.
*   **CSV Export**: Backup your activity or library at any time.

## Getting Started

Kechimochi is a desktop application built with Tauri. It supports a standalone app interface, as well as a self hosted web application.

For details on how to run the software on developer builds (and contribute!) see the [Development.md](Development.md) document.

The software is still in heavy early development. Most core features are already implemented and work and is in a more than usable state, but some core features are still missing or might change significantly before official release. Be aware that you are choosing to trust this software at your own risk.

If you want to run it on dev builds without needing to build it yourself, grab one of the latest  pre-release artifacts from one of the [published artifacts](https://github.com/Morgawr/kechimochi/actions/workflows/publish.yml) for either Linux or Windows.

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

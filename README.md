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

### Dashboard
A dashboard designed to turn your logs into visible insights. Use the contribution heatmap to track your daily consistency and show off your progress with charts that break down your activity by week, month, and year.

### Automated Metadata

Kechimochi integrates with various media databases to help you organize your library.
*   **Visual Novels**: VNDB
*   **Anime and Movies**: AniList and IMDb
*   **Manga and Books**: Bookmeter, BookWalker, Cmoa, and Shonen Jump Plus
*   **Video Games**: Backloggd
*   **Dictionary Integration**: Jiten.moe metadata support

Are we missing some sites? Let us know by opening an [issue](https://github.com/Morgawr/kechimochi/issues/new) on our issue tracker.

### Reading Analysis

The application includes dedicated reading reports to help you understand your pace across different media. It estimates your reading speed and provides progress projections to calculate when you might finish your current book or manga based on your past activity.

### Data Ownership and Portability

Your logs are stored in local SQLite databases, giving you full control over your information.
*   **CSV Import**: Migrate your existing logs from other spreadsheets or tools.
*   **CSV Export**: Backup your activity or library at any time.

## Getting Started

Kechimochi is a desktop application built with Tauri. It supports a standalone app interface, as well as a local web page (this requires developer tools to build).

For details on how to run the software on developer builds (and contribute!) see the [Development.md](Development.md) document.

The software is still in heavy early development. Most core features are already implemented and work and is in a more than usable state, but some core features are still missing or might change significantly before official release. Be aware that you are choosing to trust this software at your own risk.

If you want to run it on dev builds without needing to build it yourself, grab one of the latest  pre-release artifacts from one of the [published artifacts](https://github.com/Morgawr/kechimochi/actions/workflows/publish.yml) for either Linux or Windows.

---

### LLM Assisted Coding and Quality Assurance

This application has been developed with assistance from Large Language Model, use at your own risk. 

A lot of the code has not been manually verified by humans, however we do strive for a high level of quality by employing strict tests, development guard rails, and automated checks before merging the code. 

Kechimochi is built on a foundation of test suites and automated checks. We maintain unit tests for frontend and backend logic, along with an end to end (e2e) testing infrastructure. These automated systems run on every change to help prevent regressions and ensure that features remain stable as the project evolves.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

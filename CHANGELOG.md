# Changelog

All notable changes to Kechimochi will be documented in this file.

The format is based on Keep a Changelog, with one section per released version.

## [Unreleased]

## [0.1.2] - 2026-03-25

- No real updates, I am just writing a changelog to test the update check workflow

## [0.1.1] - 2026-03-25

### Added
- Cumulative library filters for tracking status and media type.
- Desktop update notifications and changelog prompts for new releases.

### Changed
- Extra field labels in the media view continue to display in uppercase, while inline editing now shows the real stored capitalization.
- The library filter panel is now a compact animated dropdown, with `Hide Archived` kept as a separate toggle.

### Fixed
- Extra field names are now treated as case-insensitively unique when adding, renaming, or importing metadata, which avoids confusing duplicate tags that differ only by capitalization.
- Character-count-based calculations now work across capitalization variants of the `Character count` extra field.

## [0.1.0] - 2026-03-24

### Added
- A personal immersion-tracking app for logging Japanese study activity across books, manga, anime, visual novels, and other media.
- A media library with per-title progress tracking, milestone support, cover art handling, and profile-specific data.
- Dashboards and reports for daily activity, heatmaps, totals, and personal reading-speed calculations.
- CSV import and export flows, full backup and restore support, and both desktop and self-hosted web distribution targets.
- Explicit database schema versioning, backup metadata validation, and a tagged GitHub release workflow for future updates.

### Changed
- Stable tagged builds now display `BETA VERSION 0.1.0` in the UI while the app remains in beta.
- Development artifacts built from `main` now display `DEV BUILD 0.1.0-dev.<git-hash>`.
- Release and development builds now share one version source, so both tracks stay aligned between releases.

### Notes
- `0.1.0` is the first formal Kechimochi beta release.

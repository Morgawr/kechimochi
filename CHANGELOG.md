# Changelog

All notable changes to Kechimochi will be documented in this file.

The format is based on Keep a Changelog, with one section per released version.

## [Unreleased]

### Added
 - Milestones can now be edited

### Changed
 - Milestones now pre-fill the textboxes with time and/or char already recorded
 - Updated backloggd importer which had stopped working
 - Timeline now shows direction and month/year badge for easier recognition

### Fixed
 - Quick log now shows more clearly in tablet mode
 - Circle and bar activity graphs now use a consistent color mapping
 - Activity csv import now forces YYYY/MM/DD or YYYY-MM-DD date formats

## [0.2.5] - 2026-04-08

### Added
 - Dashboard has a quick log view of most recently logged non-complete media

### Changed
 - Jiten importer now shows the media cover from the parent if the child has no specific cover
 - Removed desktop-specific references that showed up in the Android app
 - In minified mode, the "back to library" button has been removed
 - The "delete media" button has been moved to a context three-dots menu
 - New media added via "Log Activity" will now default to "Ongoing" status automatically

### Fixed
 - Graph UI elements no longer break through their containers

## [0.2.4] - 2026-04-04

Re-Re-release of 0.2.2 because the sign APK key was incorrect.

### Fixed

- Android clients using official release .apk should be able to sync again

## [0.2.3] - 2026-04-04

Re-release 0.2.2 but with valid Android APK signing

## [0.2.2] - 2026-04-04

### Added
 - Android apk is now built for published releases

### Changed
 - Android login workflow now uses proper Android-native auth protocols

## [0.2.1] - 2026-04-04

### Added
- Added Android builds
- Android development builds are now published as GitHub workflow artifacts.
- Ability to view how much storage is used by sync backups
- Users can now clear the local sync backup files automatically with a button click
- Provide the option to sync directly to cloud on first startup instead of creating a new profile

### Changed
- Android now uses the app logo for launcher icons.

### Fixed
- Cloud sync no longer times out while it is still making progress, and remote library downloads are faster.

## [0.2.0] - 2026-04-03

### Added
- Google Drive cloud sync for desktop builds, with sign-in, first upload, attach, manual sync, conflict review, and recovery actions.
- Snapshot-based sync with per-device state, remote cover-art transfer, and sync progress UI.
- Per-entry conflict resolution for media `extra_data`.
- End-to-end desktop coverage for the cloud sync flow with mocked OAuth and Drive endpoints.

### Changed
- Media sync identity now uses stable UIDs instead of title-only matching.
- During app startup now there is a spinning loader to offset the loading time and reduce startup jank

### Fixed
- macOS DMG builds are now packaged as universal binaries to support both Intel and Apple Silicon architectures natively.
- 'Back to Grid' button text changed to 'Back to Library' on the media detail view to be layout-agnostic.
- List view now resizes properly on smaller resolutions without cutting borders
- App now shows an error on startup when the database version is newer than what is supported

## [0.1.3] - 2026-03-26

### Added
- A timeline view for reverse-chronological media events, including started, completed, paused, dropped, and dated milestone entries.
- A library list layout with persistent `grid`/`list` selection and per-entry activity summary fields.
- macOS release builds for the desktop app and self-hosted web package.

### Changed
- Library search, filters, hide-archived handling, refresh, and detail navigation now use shared behavior in both library layouts.
- Viewports below the grid breakpoint now force `list` layout without overwriting the saved layout preference.
- Clicking a heatmap day on the dashboard now jumps the activity charts to that week.

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

# Changelog

All notable changes to Kechimochi will be documented in this file.

The format is based on Keep a Changelog, with one section per released version.

## [Unreleased]

### Added
 - Added an optional media variant tag, editable from the library detail view and shown when choosing or logging media.
 - Media, activity, and milestone CSV exports now include optional variant tag.
 - You can now zoom in/out in the library grid view.
 - Media entries can now share the same title as long as they have different variant tags (including empty variant)
 - You can now add "boolean" tags to media items. They work like any other tag but only have a key with an empty value and they look different in the UI.
 - Spider chart showing weekly average and median distribution of activities

### Changed
 - When browsing media entries, left and right buttons now cycle through entries according to any previously-applied media filters
 - Reworked the "Monthly" view to show daily amounts instead of weeks, because weeks were inconsistent and not accurate.
 - Renamed "Weekly", "Monthly", and "Yearly" options to "Week", "Month", and "Year"
 - Renamed the media-level "Media Type" field to "Default Activity Type" across the database, API, and CSV exports, while retaining compatibility with legacy imports and API clients.
 - Cloud sync now asks whether to combine entries or rename one and keep both when local and remote media have the same title and variant but different internal identities.
 - CSV imports now identify media using the exact title and variant pair. Legacy CSVs without a variant column remain supported when the title identifies only one media entry.
 - Introduced a global lock that prevents multiple kechimochi instances from running on the same device.
 - Improved performance and background data loading for the dashboard, library, timeline, and media covers.
 - CSV activity import will now match duplicate activities already present in the database and prompt the user to confirm if it's a valid import or a mistake

### Fixed
 - Activity types are now stored on every activity log, so changing a media default no longer reclassifies historical activity; This also retroactively applies to historical blank activities.
 - Activity CSV now exports Default Activity Type for the media default while Activity Type preserves each individual log override.
 - Renaming a media entry can no longer create a duplicate title and variant pair. Rejected changes leave the original entry unchanged.
 - CSV imports now fail without applying any rows when media identity is ambiguous or rows disagree about the default activity type of a new media entry.
 - Cloud sync no longer automatically merges separate media entries that happen to have the same title and variant.
 - Interrupted sync recovery no longer overwrites newer local changes by replaying an already-applied snapshot.
 - Factory reset, backup restore, and Google Drive disconnect can no longer race with an active sync or retain sync state belonging to the previous database.
 - Newer unsupported database versions are rejected before the app creates companion database files or applies persistent database settings.

### Special Notes:

For apps and tools developers, or for people who make use of csv import/export scripts, some of the csv fields have changed to match a more robust media/activity tagging system. The documentation has been updated at https://github.com/Morgawr/kechimochi/blob/main/docs/csv-formats.md to reflect these changes.

Legacy formats should still be supported but it is strongly recommended you migrate to the new format as soon as possible.

It is STRONGLY recommended to perform a full backup export before updating, as this new version makes a lot of changes to the internal database that could cause data mismatch. In case of failure to update, you should delete your local files, rollback the app version, restore from a backup, and file a bug report at https://github.com/Morgawr/kechimochi/issues

## [0.2.11] - 2026-07-20

### Added
 - Added a Notes field to activity log entries (editable in the log modal, shown on the media detail page, included in sync and CSV export).
 - The desktop app now remembers its window size, position, and maximized state between launches.
 - Shareable profile "report cards" - save a PNG of your stats from the Profile page, as either time spent per activity type or per content type, each with a matching donut chart.

### Changed
 - UI aggregate metrics now report hours with proper breakdown of minutes rather than confusing decimals

### Fixed
 - The tracking heatmap now colors days that have characters logged but no time tracked, in addition to days with time tracked. Cell intensity reflects whichever of the two is higher, so days tracked with both time and characters are not artificially brighter.
 - Milestones on the same media and same date now appear in creation order (oldest at the bottom, newest at the top) instead of alphabetically by name.
 - Default window no longer opens larger than the screen / under the taskbar, which could hide the update dialog's close button.
 - Fixed the "OK" button not closing the app during a startup error notice (database mismatch, etc)

## [0.2.10] - 2026-06-10

### Added
 - Ability to use go back gesture or button on android to quit a popup or a media.
 - Shortcut button to medias from quick log
 - DMM games metadata importer (works on Fanza games too)
 - AniList manga metadata importer
 - Total hours count in study stats
 - Totals panel that shows a total of time spend / characters read for weeks, months, years and allows comparison with direct previous total.
 - Categories panel that shows a total for each media type.
 - Highlights panel that shows specific values : media with most time, sessions, chars, biggest streak, and day with the most time. All three panels use the timeframe selected in Activity Visualisation.
 - Can change which day is the begining of the week in settings for "weekly" view of activity visualisation and Totals.
 - Added "all time" selector in activity visualisation.

### Changed
 - Pop ups no longer appear behind the keyboard and center themselves in the visible space.
 - Reworked elements on the media page for compactness and aesthetics including : Estimation values, buttons above description and copy title button.
 - Adjusted a few colors in themes : Purple, Yellow lime, Deep blue, to have more readable buttons.
 - Made quick log display 6 elements on desktop and large mobiles.
 - Made loading of Medias faster when clicking from library and quick log shortcuts.
 - Monthly activity visualisation now labels bars with their date range (e.g. "Jun 1–7") instead of generic "Week 1 / Week 2".
 - Weekly activity visualisation now labels days with month names (e.g. "Jun 08") instead of numeric month-day labels.

### Fixed
 - Some elements are now readable in light themes including : Desktop window title, activity breakdown legend, android top bar.
 - Patch notes should now show long bullet lists with the right indentation
 - Changing media using the pagination now properly loads the logs.
 - The activity visualisation "next period" navigation button is now clearly greyed out when already viewing the current period, instead of appearing active but doing nothing.
 - Monthly activity visualisation no longer drops activity from the final partial week in some months.

## [0.2.9] - 2026-05-09

### Added
 - Desktop version now allows enabling an HTTP server backend for automation

### Fixed
 - Activities logged in weeks between month boundaries will now show the correct
   amount in the pie chart slice

### Special notes:

With the inclusion of an HTTP server option in the desktop build, users are now
able to automate certain activities (like logging entries, adding media, etc)
according to the backend API. This API is described in the http-api.md doc in
the github repository, refer to that if you want to know more.

Be aware that the HTTP server is unprotected and you are responsible for your
own local security as the app itself will not care about rejecting unauthorized
accesses.

## [0.2.8] - 2026-05-06

### Fixed
 - Activity logs from the main activity modal now set the right activity type
 - Updated IMDB importer to new layout changes
 - IMDB importer now strips special characters from movie descriptions
 - Quick Log now properly shows the 5 latest relevant ongoing entries
 - Speed estimates now better handled for locales using 10 000 format.

## [0.2.7] - 2026-05-04

### Added
 - Sync button shortcut in the navigation bar
 - Ability to select a local theme which overrides the remote sync theme on current device only

### Changed
 - Improved consistency of titles and navigation buttons
 - Navigation bar moved to the bottom for mobiles for easier accessibility
 - Improved compactness of study stats in tablet layout
 - Library tab header is cleaner on mobile and media grid elements have properly sized covers
 - Made the Log popup more compact in mobiles

### Fixed
 - Text in recent activity uses the whole width to be more readable in mobiles
 - pagination of recent activity is no longer cropped / sticked to the title in mobile
 - hover animation of media grid elements no longer cropped
 - navigation header in media details is better centered on desktop.

## [0.2.6] - 2026-04-26

### Added
 - Milestones can now be edited

### Changed
 - Milestones now pre-fill the textboxes with time and/or char already recorded
 - Timeline now shows direction and month/year badge for easier recognition

### Fixed
 - Updated backloggd importer which had stopped working
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

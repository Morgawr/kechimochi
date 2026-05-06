# Release Process

This document defines how Kechimochi ships application releases and development artifacts.

## Versioning Model

Kechimochi now uses three independent version concepts:

- App version: semantic versioning (`X.Y.Z`) for user-facing releases.
- Database schema version: an integer stored in SQLite and managed separately from app releases.
- Backup format version: an integer for full-backup packaging and manifest compatibility.

These three versions move for different reasons:

- app version changes when the product ships a new release,
- database schema version changes when persisted data shape or meaning changes,
- backup format version changes when the zip layout or manifest contract changes.

For the database and backup compatibility policy, see `docs/database-versioning.md`.

## Release Tracks

### Release Track

Release builds are created only from Git tags that match `vX.Y.Z`.

- The checked-in version files must already be set to the release version.
- Private desktop OAuth values such as `KECHIMOCHI_GOOGLE_CLIENT_ID` and `KECHIMOCHI_GOOGLE_CLIENT_SECRET` must come from the release environment, not tracked config files.
- GitHub Actions desktop builds currently source those values from repository secrets with the same names.
- The release workflow publishes assets to the GitHub Releases tab.
- Tagged releases currently publish desktop bundles for Linux, Windows, and macOS, self-hosted web packages for Linux, Windows, and macOS, and an Android APK.
- While the app is in beta, release builds display `BETA VERSION X.Y.Z` in the UI.
- GitHub Releases are marked as prereleases until beta is over.

### Development Track

Development builds continue to come from regular pushes to `main`.

- They are published as workflow artifacts, not GitHub Releases.
- Development artifacts are produced for Linux, Windows, and macOS on both the desktop and self-hosted web tracks.
- The displayed version is derived from the checked-in base version plus the current commit hash.
- Example: if `package.json` is `0.1.0`, a development build from `main` shows `DEV BUILD 0.1.0-dev.abc1234`.

## Source of Truth

The app version is stored in these files and must always match:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

Use the helper script to update them together:

```bash
npm run version:set -- 0.1.0
```

## Changelog Workflow

`CHANGELOG.md` at the repository root is the canonical release notes file.

Rules:

- Add ongoing release notes to `## [Unreleased]` while work is in progress.
- When preparing a release, move the finalized notes into `## [X.Y.Z] - YYYY-MM-DD`.
- The release workflow extracts that exact section and uses it as the GitHub Release body.

You can preview what the workflow will publish with:

```bash
npm run changelog:extract -- 0.1.0
```

## Android Gradle Dependency Verification

The Android project uses Gradle dependency verification through `src-tauri/gen/android/gradle/verification-metadata.xml`.

That file is a lock file for Maven artifacts used by the Android Gradle Plugin, the generated Tauri Android project, and Android app dependencies. When any of those versions change, Gradle may need extra artifact checksums before it will build in CI.

This can show up only during tagged release builds because the release APK exercises release-only Gradle tasks such as `:tauri-android:extractReleaseAnnotations`. A debug Android artifact from `main` can pass while the release APK later fails with `Dependency verification failed`.

Release branches named `release/...` automatically run an unsigned Android release APK build in CI. Before merging a release PR, confirm that check passed. If you need to reproduce it locally, run:

```bash
KECHIMOCHI_GOOGLE_ANDROID_CLIENT_ID=release-smoke-test \
VITE_APP_VERSION=0.1.0 \
VITE_APP_CHANNEL=release \
VITE_RELEASE_STAGE=beta \
npm run tauri -- android build --apk --ci --target aarch64
```

If the build fails with missing Gradle verification entries, refresh the metadata for the failing Gradle task, review the added artifacts, commit the metadata diff, and rerun the Android release build:

```bash
cd src-tauri/gen/android
./gradlew --write-verification-metadata sha256 :tauri-android:extractReleaseAnnotations
git diff -- gradle/verification-metadata.xml
```

Update and commit `src-tauri/gen/android/gradle/verification-metadata.xml` whenever the release build adds trusted Gradle artifacts. This is especially likely after Tauri, Android Gradle Plugin, Kotlin Gradle Plugin, AndroidX, Google Play Services, or Gradle wrapper updates.

## Releasing `0.1.0`

The release flow should happen through a release PR.

1. Create a release branch from `main` named `release/v0.1.0`.
2. Update the version files and finalize the `CHANGELOG.md` section for `0.1.0`.
3. Open a PR.
4. Confirm the Android release build check passed, committing any required `gradle/verification-metadata.xml` updates.
5. Review the PR and merge it into `main`.
6. After the PR is merged, tag the merge commit that now lives on `main`:

```bash
git checkout main
git pull origin main
git tag -a v0.1.0 -m "Kechimochi v0.1.0"
git push origin v0.1.0
```

7. The `release.yml` workflow publishes the tagged artifacts to GitHub Releases.

## Continuing Development After a Release

Development builds always derive from the checked-in base version on `main`.

That means:

- If `main` stays on `0.1.0`, development artifacts continue to show `0.1.0-dev.<sha>`.
- When you intentionally start the next cycle, bump `main` to the next target version first.
- If you use a PR-only workflow, do that bump in a normal follow-up PR after the release tag is published.
- Example: after releasing `0.1.0`, merge a PR that runs `npm run version:set -- 0.2.0` so future artifacts show `0.2.0-dev.<sha>`.

## Beta Stage

The release workflow currently builds with the release stage set to `beta`.

Implications:

- Release builds display `BETA VERSION X.Y.Z`.
- GitHub Releases are published as prereleases.

When Kechimochi exits beta, update the release workflow to use `stable` instead of `beta`. That will switch the UI label to `VERSION X.Y.Z` and publish normal releases.

## GitHub Workflows

- `.github/workflows/publish.yml`: development artifacts from `main`
- `.github/workflows/release.yml`: tagged GitHub Releases from `vX.Y.Z`
- `.github/workflows/docker.yml`: container publishing for both dev (`main`) and release (`vX.Y.Z`) builds

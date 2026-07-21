# CSV Data Formats

Kechimochi supports importing and exporting data via CSV files. This document details the expected structure for each type of CSV supported by the application.

## Overview

All CSV files should use UTF-8 encoding. Headers are required for all formats.

CSV identity is always human-readable. Numeric IDs, UIDs, UUIDs, and other opaque
identity fields are never exported and are not accepted on import. Only the
columns documented below are supported; an unknown column makes the import fail.

Media is identified at the CSV boundary by the exact `(title, variant)` pair.
Titles are compared exactly. Surrounding whitespace in variants is ignored, and
an empty variant is a real value. Internal database and cloud-sync identities
remain private to Kechimochi.

Free-form, user-authored metadata remains data rather than CSV identity.
Kechimochi never uses `Extra Data`, descriptions, notes, or source URLs to link
CSV rows, and it never injects internal database or cloud IDs into those fields.
Existing user metadata, including external references, round-trips unchanged.

Imports are preflighted in full before any database rows are written. A malformed
row, ambiguous legacy lookup, missing milestone parent, or inconsistent default
for a media entry that would be created aborts the entire import. No earlier rows
from that file are retained.

---

## 1. Activity Logs

Used for importing and exporting your daily activity history.

### Header Fields

| Column Name | Description | Required | Example |
| :--- | :--- | :--- | :--- |
| **Date** | The date of the activity. Supports `YYYY-MM-DD` or `YYYY/MM/DD`. | Yes | 2024-01-15 |
| **Log Name** | The title of the media being logged. | Yes | Frieren: Beyond Journey's End |
| **Default Activity Type** | The media entry's default for future activities. Used when an import creates a missing media entry. Standard values are `Reading`, `Watching`, `Playing`, `Listening`, and `None`. | Yes | Watching |
| **Duration** | The time spent in minutes. | Yes | 24 |
| **Language** | The language of the content. | Yes | Japanese |
| **Characters** | The number of characters read or written (useful for books/writing). | No | 0 |
| **Activity Type** | The type recorded for this individual activity. May override the media entry's default and falls back to `Default Activity Type` if empty. | No | Reading |
| **Notes** | Optional notes attached to the activity. | No | Episode 1 |
| **Media Variant** | The variant portion of the media identity. If this header exists, every row targets the exact `(Log Name, Media Variant)` pair; a blank cell explicitly targets the blank variant. | No | Anime |

### Example
```csv
Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Notes,Media Variant
2024-01-15,ある魔女が死ぬまで,Reading,45,Japanese,1000,Reading,,Light Novel
2024-01-16,呪術廻戦,Watching,25,Japanese,0,Reading,Read an interview,Anime
```

`Default Activity Type` describes the media-level default, while `Activity Type` preserves what was recorded for that particular log. In the second example, the media normally defaults to `Watching`, but that individual activity was logged as `Reading`.

`Activity Type` is never used to identify or split media. For example, two rows
for `Horimiya` may record `Reading` and `Watching` while both still belong to the
same media entry. If those rows would create one new media entry, their `Default
Activity Type` values must agree. Different per-log `Activity Type` values remain
valid. When rows target an existing media entry, import does not change that
entry's default activity type.

---

## 2. Media Library

Used for bulk importing media metadata or exporting your entire library.

### Header Fields

| Column Name | Description | Required | Example |
| :--- | :--- | :--- | :--- |
| **Title** | The media title. It is unique only together with `Variant`. | Yes | FF7 Rebirth |
| **Default Activity Type** | Default activity type for future logs. Standard values are `Reading`, `Watching`, `Playing`, `Listening`, and `None`. | Yes | Playing |
| **Status** | The stored library-status value. Current UI-created entries use `Active` or `Archived`; import preserves other existing values for compatibility. Tracking Status is not a separate CSV field. | Yes | Active |
| **Language** | Primary language. | Yes | Japanese |
| **Description** | A brief summary or notes. | No | Remake part 2. |
| **Content Type** | Specific format. Use one of the labels recognized by the current UI, such as `Anime`, `Movie`, `Novel`, `WebNovel`, `NonFiction`, `Videogame`, `Visual Novel`, `Manga`, `Audio`, `Drama`, `Livestream`, `Youtube Video`, or `Unknown`. Import preserves the supplied text. | Yes | Videogame |
| **Extra Data** | A JSON string containing user-authored metadata. It is never used as media identity. | Yes | `{"Developer": "Square Enix"}` |
| **Cover Image (Base64)** | The cover image encoded as a Base64 string. | Yes | (long base64 string) |
| **Variant** | The optional variant portion of the media identity. If this header exists, a blank cell explicitly targets the blank variant. | No | Manga |

> [!NOTE]
> Content Types are case-sensitive and should match the labels used in the application (e.g., `Videogame`, `Visual Novel`, `Novel`, `Anime`, `Manga`, `Movie`, `WebNovel`).

`Content Type` describes what the media is, while `Default Activity Type` is the action initially selected when logging it. For example, a `Visual Novel` can default to either `Reading` or `Playing`.

An exact `(Title, Variant)` match is offered as an update to that media entry.
The same title with a different variant is a different media entry. A media CSV
must contain each exact pair at most once; duplicate target pairs abort analysis
before the apply step.

### Example
```csv
Title,Default Activity Type,Status,Language,Description,Content Type,Extra Data,Cover Image (Base64),Variant
Existing,Reading,Active,Japanese,,Novel,{},,Light Novel
New Media,Watching,Active,English,,Anime,{},,Anime
```

### Activity-type header compatibility

Imports continue to accept the legacy `Media Type` header in place of `Default Activity Type`. New exports always use `Default Activity Type`. If both headers contain non-blank values on a row, those values must match; conflicting values are rejected before any rows are written.

---

## 3. Milestones

Used for importing and exporting specific progress markers/milestones for your media.

### Header Fields

| Column Name | Description | Required | Example |
| :--- | :--- | :--- | :--- |
| **Media Title** | The title of the parent media. | Yes | One Piece |
| **Name** | The name of the milestone. | Yes | Volume 100 |
| **Duration** | Total duration spent to reach this milestone (accumulated). | Yes | 5000 |
| **Characters** | Total characters read to reach this milestone (accumulated). | Yes | 150000 |
| **Date** | The date text for the milestone. Kechimochi-generated CSV uses `YYYY-MM-DD`; import preserves the supplied text. | No | 2024-03-01 |
| **Media Variant** | The variant portion of the parent media identity. If this header exists, a blank cell explicitly targets the blank variant. | No | Manga |

### Example
```csv
Media Title,Name,Duration,Characters,Date,Media Variant
One Piece,Volume 1,120,5000,2024-01-01,Manga
One Piece,Volume 2,240,10000,2024-01-02,Manga
```

Milestone import never creates a media entry or an orphan milestone. The parent
media must already exist and resolve unambiguously. After resolving the
human-readable pair, Kechimochi links the milestone to that media using an
internal identity that is never written to the CSV. Milestone export likewise
derives the title and variant from the linked media entry.

## Variant import compatibility

The variant columns are optional so CSV files exported by older Kechimochi
versions remain importable. Header presence—not whether an individual cell is
blank—selects the lookup rule:

- When `Media Variant` (activities and milestones) or `Variant` (media library)
  is present, each row uses the exact `(title, variant)` pair. A blank cell means
  the blank variant. Mixed variants for one title create or target distinct media
  entries; they are never collapsed to a consensus variant.
- When the relevant variant header is absent, the row uses legacy title-only
  resolution. One existing title match is used even if it has a non-blank
  variant. Multiple same-title entries are ambiguous, so the whole import fails
  and reports the row, title, and available variants.
- With no existing title match, an activity import or media-library import creates
  the blank-variant pair. A milestone import fails because it does not have enough
  metadata to create a parent media entry.

Imports accept the legacy `Media Type` header as an alias for `Default Activity
Type`. If both are populated on a row, they must agree. Rows that would create
the same media pair must also agree on the new entry's default activity type;
Kechimochi rejects conflicting defaults instead of choosing one based on row
order.

# CSV Data Formats

Kechimochi supports importing and exporting data via CSV files. This document details the expected structure for each type of CSV supported by the application.

## Overview

All CSV files should use UTF-8 encoding. Headers are required for all formats.

---

## 1. Activity Logs

Used for importing and exporting your daily activity history.

### Header Fields

| Column Name | Description | Required | Example |
| :--- | :--- | :--- | :--- |
| **Date** | The date of the activity. Supports `YYYY-MM-DD` or `YYYY/MM/DD`. | Yes | 2024-01-15 |
| **Log Name** | The title of the media being logged. | Yes | Frieren: Beyond Journey's End |
| **Media Type** | The media entry's default activity type. Used when an import creates a missing media entry. Must be one of: `Reading`, `Watching`, `Playing`, `Listening`, `None`. | Yes | Watching |
| **Duration** | The time spent in minutes. | Yes | 24 |
| **Language** | The language of the content. | Yes | Japanese |
| **Characters** | The number of characters read or written (useful for books/writing). | No | 0 |
| **Activity Type** | The type of this individual activity. May override the media entry's default and falls back to `Media Type` if empty. | No | Reading |
| **Notes** | Optional notes attached to the activity. | No | Episode 1 |
| **Media Variant** | A descriptive subtitle for the media, used only when the import creates a new library entry. | No | Anime |

### Example
```csv
Date,Log Name,Media Type,Duration,Language,Characters,Activity Type,Notes,Media Variant
2024-01-15,ある魔女が死ぬまで,Reading,45,Japanese,1000,Reading,,Light Novel
2024-01-16,呪術廻戦,Watching,25,Japanese,0,Reading,Read an interview,Anime
```

`Media Type` and `Activity Type` both use activity labels such as `Reading` or `Watching`. In the second example, the media normally defaults to `Watching`, but that individual activity was logged as `Reading`.

---

## 2. Media Library

Used for bulk importing media metadata or exporting your entire library.

### Header Fields

| Column Name | Description | Required | Example |
| :--- | :--- | :--- | :--- |
| **Title** | The unique title of the media. | Yes | FF7 Rebirth |
| **Media Type** | Default activity type for new logs. Must be one of: `Reading`, `Watching`, `Playing`, `Listening`, `None`. | Yes | Playing |
| **Status** | The library state. Must be one of: `Active`, `Archived`. Note: 'Tracking Status' (e.g. Ongoing, Complete) is not currently imported from CSV. | Yes | Active |
| **Language** | Primary language. | Yes | Japanese |
| **Description** | A brief summary or notes. | No | Remake part 2. |
| **Content Type** | Specific format. Must be one of: `Anime`, `Movie`, `Novel`, `WebNovel`, `NonFiction`, `Videogame`, `Visual Novel`, `Manga`, `Audio`, `Drama`, `Livestream`, `Youtube Video`, `Unknown`. | Yes | Videogame |
| **Extra Data** | A JSON string containing additional metadata. | Yes | `{"vNDB_ID": "v123"}` |
| **Cover Image (Base64)** | The cover image encoded as a Base64 string. | Yes | (long base64 string) |
| **Variant** | An optional, non-unique subtitle that distinguishes editions or formats sharing a title. | No | Manga |

> [!NOTE]
> Content Types are case-sensitive and should match the labels used in the application (e.g., `Videogame`, `Visual Novel`, `Novel`, `Anime`, `Manga`, `Movie`, `WebNovel`).

`Content Type` describes what the media is, while `Media Type` is the default action selected when logging it. For example, a `Visual Novel` can default to either `Reading` or `Playing`.

### Example
```csv
Title,Media Type,Status,Language,Description,Content Type,Extra Data,Cover Image (Base64),Variant
Existing,Reading,Active,Japanese,,Novel,{},,Light Novel
New Media,Watching,Active,English,,Anime,{},,Anime
```

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
| **Date** | The date the milestone was reached (`YYYY-MM-DD`). | No | 2024-03-01 |
| **Media Variant** | Descriptive context exported with the milestone. Currently ignored when importing because milestones are matched by title. | No | Manga |

### Example
```csv
Media Title,Name,Duration,Characters,Date,Media Variant
One Piece,Volume 1,120,5000,2024-01-01,Manga
One Piece,Volume 2,240,10000,2024-01-02,Manga
```

## Variant import compatibility

The variant columns are optional, so CSV files exported by older Kechimochi versions remain importable. Media matching is deliberately title-only in this release:

- If the title already exists, imported activities are appended to it and a media-library replacement preserves its current variant. A missing, blank, or different CSV variant never changes the existing variant.
- If a media-library import creates a title, its `Variant` value is stored.
- If an activity import creates a title, its variant is stored only when every non-empty `Media Variant` value for that title agrees. Mixed variants create the media with an empty variant so the import does not guess.
- Milestone imports continue to resolve by title and do not update variants.

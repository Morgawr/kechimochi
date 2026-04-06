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
| **Media Type** | The category of the media (e.g., Reading, Watching, Playing). | Yes | Watching |
| **Duration** | The time spent in minutes. | Yes | 24 |
| **Language** | The language of the content. | Yes | Japanese |
| **Characters** | The number of characters read or written (useful for books/writing). | No | 0 |
| **Activity Type** | Sub-category of activity. Defaults to `Media Type` if empty. | No | Anime |

### Example
```csv
Date,Log Name,Media Type,Duration,Language,Characters,Activity Type
2024-01-15,ある魔女が死ぬまで,Reading,45,Japanese,1000,Web Novel
2024-01-16,呪術廻戦,Watching,25,Japanese,0,Anime
```

---

## 2. Media Library

Used for bulk importing media metadata or exporting your entire library.

### Header Fields

| Column Name | Description | Required | Example |
| :--- | :--- | :--- | :--- |
| **Title** | The unique title of the media. | Yes | FF7 Rebirth |
| **Media Type** | Category (e.g., Playing, Reading). | Yes | Playing |
| **Status** | Your current status (e.g., Ongoing, Complete, Dropped, Plan to Watch). | Yes | Ongoing |
| **Language** | Primary language. | Yes | Japanese |
| **Description** | A brief summary or notes. | Yes | Remake part 2. |
| **Content Type** | Specific format (e.g., Novel, Anime, Game, Manga). | Yes | Game |
| **Extra Data** | A JSON string containing additional metadata. | Yes | `{"vNDB_ID": "v123"}` |
| **Cover Image (Base64)** | The cover image encoded as a Base64 string. | Yes | (long base64 string) |

### Example
```csv
Title,Media Type,Status,Language,Description,Content Type,Extra Data,Cover Image (Base64)
Existing,Reading,Ongoing,Japanese,,Novel,{},
New Media,Watching,Plan to Watch,English,,Anime,{},
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

### Example
```csv
Media Title,Name,Duration,Characters,Date
One Piece,Volume 1,120,5000,2024-01-01
One Piece,Volume 2,240,10000,2024-01-02
```

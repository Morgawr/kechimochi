# Generalized Study Tracker

This is a fork/branch of Kechimochi that generalizes the Japanese immersion tracker to support any type of study subject or category.

## Key Differences from Kechimochi

### 1. **Study Categories Instead of Language-Only**
- Support tracking multiple study subjects: languages, music, programming, art, mathematics, etc.
- Each StudyItem belongs to a specific study category
- Dashboard and analytics grouped by category instead of just language

### 2. **Generalized Content Models**
- `Media` → `StudyItem`: Represents any type of study content (not just media)
- New field: `study_category` (e.g., "Japanese", "Spanish", "Piano", "Python", "Drawing")
- `language` field repurposed to represent the primary language/context of the study category

### 3. **Expanded Activity Types**
Beyond immersion-focused activities:
- **Immersion Activities**: Watching, Reading, Listening, Playing
- **Study Activities**: Studying, Practicing, Reviewing, Lesson, Flashcard, Writing
- **Custom Activities**: Users can add their own activity types

### 4. **Enhanced Dashboard Analytics**
- Filter and compare progress across multiple study categories
- Category-specific statistics and trends
- Multi-category heatmaps showing study consistency
- Compare time invested across different subjects

### 5. **Flexible Media/Content Library**
Instead of just Japanese media:
- Music albums/songs for language or instrument learning
- Programming projects and exercise platforms
- Course materials and textbooks
- Art reference materials
- Mathematics problem sets

## Database Schema Changes

### New/Modified Tables

#### `study_categories` (New)
```sql
CREATE TABLE study_categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,  -- "Japanese", "Spanish", "Piano", etc.
    icon TEXT,                   -- emoji or icon path
    color TEXT,                  -- hex color for UI
    description TEXT,
    created_at TEXT
);
```

#### `study_items` (Formerly `media`)
```sql
CREATE TABLE study_items (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    variant TEXT,
    default_activity_type TEXT,
    status TEXT,  -- "Active", "Paused", "Complete", "Dropped", "Planned"
    description TEXT,
    cover_image TEXT,
    extra_data TEXT,
    content_type TEXT,  -- e.g., "Novel", "Anime", "Song", "Book", "Exercise"
    tracking_status TEXT,
    created_at TEXT,
    FOREIGN KEY(category_id) REFERENCES study_categories(id)
);
```

#### `activity_logs` (Enhanced)
New field:
```sql
alter_table activity_logs add column activity_category TEXT;  -- Maps to study category
```

## Migration Path

Existing Kechimochi databases can be migrated by:
1. Creating a default "Japanese" study category
2. Mapping all existing `media` entries to the Japanese category
3. Preserving all activity logs and statistics
4. Users can then create additional categories for other subjects

## API Changes

### Endpoints Updated
- `GET /api/study-categories` - List all categories
- `POST /api/study-categories` - Create new category
- `GET /api/study-items` - List items (now filterable by category)
- `POST /api/study-items` - Create new item
- `GET /api/dashboard` - Enhanced to support category filtering
- `GET /api/analytics/{category}` - Category-specific analytics

## Frontend Changes

### New Components
- Category selector in sidebar
- Category management panel
- Multi-category dashboard view
- Category-specific library
- Category comparison charts

### Modified Components
- Dashboard: Add category filter dropdown
- Library: Add category tab/filter
- Activity log: Show category alongside media
- Settings: Category management interface

## Example Use Cases

1. **Polyglot Learner**: Track Japanese, Spanish, and French simultaneously
2. **Musician**: Monitor practice time for piano, guitar, and music theory
3. **Developer**: Track coding practice time across Python, Rust, and TypeScript
4. **Artist**: Log drawing, painting, and digital art separately
5. **Polymath**: Track all learning activities (languages, music, tech, art) in one app

## Configuration

Users can define custom study categories with:
- Name and description
- Icon/emoji for visual identification
- Color theme for UI
- Custom activity types per category
- Category-specific metadata fields

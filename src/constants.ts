/**
 * Constants for localStorage keys and setting keys
 */

export const VIEW_NAMES = {
    DASHBOARD: 'dashboard',
    MEDIA: 'media',
    PROFILE: 'profile',
} as const;

export const EVENTS = {
    APP_NAVIGATE: 'app-navigate',
    PROFILE_UPDATED: 'profile-updated',
} as const;

export const STORAGE_KEYS = {
    CURRENT_PROFILE: 'kechimochi_profile',
    THEME_CACHE: 'kechimochi_theme',
    MOCK_DATE: 'kechimochi_mock_date',
} as const;

export const SETTING_KEYS = {
    THEME: 'theme',
    STATS_NOVEL_SPEED: 'stats_novel_speed',
    STATS_NOVEL_COUNT: 'stats_novel_count',
    STATS_MANGA_SPEED: 'stats_manga_speed',
    STATS_MANGA_COUNT: 'stats_manga_count',
    STATS_VN_SPEED: 'stats_vn_speed',
    STATS_VN_COUNT: 'stats_vn_count',
    STATS_REPORT_TIMESTAMP: 'stats_report_timestamp',
    GRID_HIDE_ARCHIVED: 'grid_hide_archived',
    DASHBOARD_CHART_TYPE: 'dashboard_chart_type',
    DASHBOARD_GROUP_BY: 'dashboard_group_by',
} as const;

export const DEFAULTS = {
    THEME: 'pastel-pink',
    PROFILE: 'default',
} as const;

export const TRACKING_STATUSES = [
    'Ongoing', 'Complete', 'Paused', 'Dropped', 'Not Started', 'Untracked'
] as const;

export const ACTIVITY_TYPES = [
    'Reading', 'Watching', 'Playing', 'Listening', 'None'
] as const;

export const CONTENT_TYPES = [
    'Anime', 'Movie', 'Novel', 'WebNovel', 'NonFiction', 
    'Videogame', 'Visual Novel', 'Manga', 'Audio', 'Drama', 
    'Livestream', 'Youtube Video', 'Unknown'
] as const;

export const MEDIA_STATUS = {
    ACTIVE: 'Active',
    ARCHIVED: 'Archived',
} as const;

export const FILTERS = {
    ALL: 'All',
} as const;

export const EXTRA_FIELD_LABELS = {
    CHARACTER_COUNT: 'Character count',
} as const;

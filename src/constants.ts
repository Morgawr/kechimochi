/**
 * Constants for localStorage keys and setting keys
 */

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
} as const;

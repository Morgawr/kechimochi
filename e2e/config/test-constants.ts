/**
 * Cross-cutting test data shared across e2e specs and helpers — values that
 * appear in more than one e2e file and must stay in sync if changed.
 *
 * Domain selectors live with their domain helper (e.g. MEDIA_ITEM_SELECTOR in
 * library.ts, view roots in navigation.ts), NOT here.
 */

/** Profile name baked into the seeded fixture (settings.profile_name). */
export const TEST_PROFILE_NAME = 'TESTUSER';

/** Seeded user-DB fixture filename — the contract between seed.ts and setup.ts. */
export const SEED_USER_DB_FILENAME = `kechimochi_${TEST_PROFILE_NAME}.db`;

/** System date the suite mocks to ("today"), for deterministic stats and charts. */
export const MOCK_DATE = '2024-03-31';
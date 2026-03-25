/**
 * Seed script: generates deterministic fixture databases for e2e testing.
 * Run with: npx tsx e2e/fixtures/seed.ts
 * 
 * Creates:
 *   e2e/fixtures/kechimochi_TESTUSER.db    (activity logs + settings)
 *   e2e/fixtures/kechimochi_shared_media.db (media entries)
 *   e2e/fixtures/covers/                   (placeholder cover images)
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '../../src/core/logger';

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHARED_DB_PATH = path.join(FIXTURES_DIR, 'kechimochi_shared_media.db');
const USER_DB_PATH = path.join(FIXTURES_DIR, 'kechimochi_TESTUSER.db');
const COVERS_DIR = path.join(FIXTURES_DIR, 'covers');

// ---------- Media entries (all Japanese) ----------
const MEDIA_ENTRIES = [
  {
    title: 'ある魔女が死ぬまで',
    media_type: 'Reading',
    status: 'Complete',
    language: 'Japanese',
    description: '魔女と少女の物語。感動的なファンタジー小説。',
    content_type: 'Novel',
    tracking_status: 'Complete',
    extra_data: JSON.stringify({ source_url: 'https://example.com/novel1' }),
  },
  {
    title: '薬屋のひとりごと',
    media_type: 'Reading',
    status: 'Active',
    language: 'Japanese',
    description: '後宮で働く薬師の少女が様々な事件を解決していく物語。',
    content_type: 'Novel',
    tracking_status: 'Ongoing',
    extra_data: '{}',
  },
  {
    title: '呪術廻戦',
    media_type: 'Reading',
    status: 'Active',
    language: 'Japanese',
    description: '呪いをめぐる少年たちの戦いを描いたダークファンタジー。',
    content_type: 'Manga',
    tracking_status: 'Ongoing',
    extra_data: '{}',
  },
  {
    title: 'ハイキュー!!',
    media_type: 'Watching',
    status: 'Complete',
    language: 'Japanese',
    description: 'バレーボールに青春をかける高校生たちの物語。',
    content_type: 'Anime',
    tracking_status: 'Complete',
    extra_data: '{}',
  },
  {
    title: 'STEINS;GATE',
    media_type: 'Playing',
    status: 'Complete',
    language: 'Japanese',
    description: 'タイムリープをテーマにしたサイエンスフィクション。',
    content_type: 'Visual Novel',
    tracking_status: 'Complete',
    extra_data: '{}',
  },
  {
    title: 'ペルソナ5',
    media_type: 'Playing',
    status: 'Active',
    language: 'Japanese',
    description: '心の怪盗団として活躍するRPG。',
    content_type: 'Video Game',
    tracking_status: 'Ongoing',
    extra_data: '{}',
  },
  {
    title: '本好きの下剋上',
    media_type: 'Reading',
    status: 'Active',
    language: 'Japanese',
    description: '本を愛する少女が異世界で本を作るために奮闘する物語。',
    content_type: 'Novel',
    tracking_status: 'Ongoing',
    extra_data: '{}',
  },
  {
    title: '葬送のフリーレン',
    media_type: 'Watching',
    status: 'Active',
    language: 'Japanese',
    description: '魔王を倒した後のエルフの魔法使いの旅を描いた作品。',
    content_type: 'Anime',
    tracking_status: 'Ongoing',
    extra_data: '{}',
  },
  {
    title: 'WHITE ALBUM 2',
    media_type: 'Playing',
    status: 'Paused',
    language: 'Japanese',
    description: '音楽と恋愛をテーマにしたビジュアルノベル。',
    content_type: 'Visual Novel',
    tracking_status: 'Paused',
    extra_data: '{}',
  },
  {
    title: 'ダンジョン飯',
    media_type: 'Reading',
    status: 'Archived',
    language: 'Japanese',
    description: 'ダンジョンの中でモンスターを料理して食べる冒険者たちの物語。',
    content_type: 'Manga',
    tracking_status: 'Complete',
    extra_data: '{}',
  },
];

function generateActivityLogs(mediaIds: Map<string, number>) {
  const logs: { media_id: number; duration_minutes: number; date: string; characters: number; activity_type: string }[] = [];
  const year = 2024;
  const entries: [string, number, string][] = [
    // [title, minutes, date]
    ['ある魔女が死ぬまで', 45, `${year}-01-05`],
    ['ある魔女が死ぬまで', 60, `${year}-01-08`],
    ['ある魔女が死ぬまで', 30, `${year}-01-12`],
    ['ある魔女が死ぬまで', 55, `${year}-01-15`],
    ['薬屋のひとりごと', 40, `${year}-01-06`],
    ['薬屋のひとりごと', 55, `${year}-01-10`],
    ['薬屋のひとりごと', 35, `${year}-01-15`],
    ['呪術廻戦', 25, `${year}-01-07`],
    ['呪術廻戦', 20, `${year}-01-14`],
    ['ハイキュー!!', 24, `${year}-01-09`],
    ['ハイキュー!!', 24, `${year}-01-16`],
    ['STEINS;GATE', 90, `${year}-01-11`],
    ['STEINS;GATE', 120, `${year}-01-18`],
    ['ペルソナ5', 60, `${year}-01-13`],
    ['ペルソナ5', 45, `${year}-01-20`],
    ['本好きの下剋上', 50, `${year}-02-01`],
    ['本好きの下剋上', 65, `${year}-02-05`],
    ['本好きの下剋上', 40, `${year}-02-10`],
    ['葬送のフリーレン', 24, `${year}-02-03`],
    ['葬送のフリーレン', 24, `${year}-02-08`],
    ['葬送のフリーレン', 24, `${year}-02-15`],
    ['WHITE ALBUM 2', 75, `${year}-02-04`],
    ['ダンジョン飯', 30, `${year}-02-06`],
    ['ある魔女が死ぬまで', 55, `${year}-02-12`],
    ['薬屋のひとりごと', 45, `${year}-02-18`],
    ['ペルソナ5', 90, `${year}-02-20`],
    ['本好きの下剋上', 70, `${year}-03-01`],
    ['ある魔女が死ぬまで', 40, `${year}-03-03`],
    ['葬送のフリーレン', 24, `${year}-03-05`],
    ['薬屋のひとりごと', 50, `${year}-03-07`],
    ['ペルソナ5', 60, `${year}-03-08`],
  ];

  for (const [title, minutes, date] of entries) {
    const mediaId = mediaIds.get(title);
    const mediaEntry = MEDIA_ENTRIES.find(m => m.title === title);
    if (mediaId !== undefined && mediaEntry) {
      logs.push({
        media_id: mediaId,
        duration_minutes: minutes,
        date,
        characters: 0,
        activity_type: mediaEntry.media_type
      });
    }
  }

  return logs;
}

function getSeedMilestones() {
  return [
    {
      media_title: 'ペルソナ5',
      name: 'カモシダ・パレス攻略',
      duration: 90,
      characters: 0,
      date: '2024-03-08',
    },
    {
      media_title: '薬屋のひとりごと',
      name: '後宮の謎',
      duration: 0,
      characters: 2500,
      date: '2024-03-07',
    },
    {
      media_title: 'ある魔女が死ぬまで',
      name: '最終章',
      duration: 40,
      characters: 0,
      date: '2024-03-03',
    },
  ];
}

// ---------- Create placeholder cover images (1x1 PNG) ----------
function createPlaceholderImage(filepath: string) {
  // Minimal valid PNG (1x1 red pixel)
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND chunk
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  fs.writeFileSync(filepath, png);
}

// ---------- Main ----------
function main() {
  Logger.info('Seeding e2e fixture databases...');

  // Clean up existing fixtures
  for (const f of [SHARED_DB_PATH, USER_DB_PATH]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  // Only remove the auto-generated placeholder; preserve manually committed
  // fixtures (e.g. profile_placeholder.png) so they survive across seed runs.
  const generatedCoverPath = path.join(COVERS_DIR, 'placeholder.png');
  if (fs.existsSync(generatedCoverPath)) {
    fs.unlinkSync(generatedCoverPath);
  }
  fs.mkdirSync(COVERS_DIR, { recursive: true });

  // --- Shared media DB ---
  const sharedDb = new Database(SHARED_DB_PATH);
  sharedDb.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL UNIQUE,
      media_type TEXT NOT NULL,
      status TEXT NOT NULL,
      language TEXT NOT NULL,
      description TEXT DEFAULT '',
      cover_image TEXT DEFAULT '',
      extra_data TEXT DEFAULT '{}',
      content_type TEXT DEFAULT 'Unknown',
      tracking_status TEXT DEFAULT 'Untracked'
    )
  `);

  const insertMedia = sharedDb.prepare(`
    INSERT INTO media (title, media_type, status, language, description, cover_image, extra_data, content_type, tracking_status)
    VALUES (@title, @media_type, @status, @language, @description, @cover_image, @extra_data, @content_type, @tracking_status)
  `);

  const mediaIds = new Map<string, number>();

  for (const entry of MEDIA_ENTRIES) {
    // Create a placeholder cover image for each entry
    const coverPath = path.join(COVERS_DIR, `placeholder.png`);
    if (!fs.existsSync(coverPath)) {
      createPlaceholderImage(coverPath);
    }

    const result = insertMedia.run({
      ...entry,
      // Cover image paths will be relative -- the test setup will fix them
      // to point at the actual $TEST_DIR/covers/ path at runtime
      cover_image: '',
    });
    mediaIds.set(entry.title, Number(result.lastInsertRowid));
  }

  Logger.info(`  Created ${MEDIA_ENTRIES.length} media entries in shared DB`);
  sharedDb.close();

  // --- User DB ---
  const userDb = new Database(USER_DB_PATH);
  userDb.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      characters INTEGER NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      activity_type TEXT NOT NULL DEFAULT ''
    )
  `);
  userDb.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  userDb.exec(`
    CREATE TABLE IF NOT EXISTS milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_title TEXT NOT NULL,
      name TEXT NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      characters INTEGER NOT NULL DEFAULT 0,
      date TEXT
    )
  `);

  const insertLog = userDb.prepare(`
    INSERT INTO activity_logs (media_id, duration_minutes, characters, date, activity_type)
    VALUES (@media_id, @duration_minutes, @characters, @date, @activity_type)
  `);
  const insertMilestone = userDb.prepare(`
    INSERT INTO milestones (media_title, name, duration, characters, date)
    VALUES (@media_title, @name, @duration, @characters, @date)
  `);

  const logs = generateActivityLogs(mediaIds);
  for (const log of logs) {
    insertLog.run(log);
  }
  Logger.info(`  Created ${logs.length} activity log entries in user DB`);

  const milestones = getSeedMilestones();
  for (const milestone of milestones) {
    insertMilestone.run(milestone);
  }
  Logger.info(`  Created ${milestones.length} milestone entries in user DB`);

  // Insert default settings
  const insertSetting = userDb.prepare(`
    INSERT INTO settings (key, value) VALUES (@key, @value)
  `);
  insertSetting.run({ key: 'theme', value: 'pastel-pink' });
  Logger.info(`  Inserted default settings`);

  userDb.close();

  Logger.info('Done! Fixture databases created:');
  Logger.info(`  ${SHARED_DB_PATH}`);
  Logger.info(`  ${USER_DB_PATH}`);
  Logger.info(`  ${COVERS_DIR}/`);
}

main();

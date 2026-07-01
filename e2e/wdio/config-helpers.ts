import path from 'node:path';
import { Logger } from '../../src/logger';

export async function moveArtifactsToFinalDirectory(
  stageDirectory: string,
  specName: string,
  finalDirectory: string,
): Promise<void> {
  const { mkdirSync, existsSync, cpSync, rmSync, readdirSync } = await import('node:fs');
  if (!existsSync(stageDirectory)) return;
  try {
    const stagedFiles = readdirSync(stageDirectory, { recursive: true });
    Logger.info(`[e2e] [${specName}] Staging area contains: ${stagedFiles.join(', ')}`);
    mkdirSync(finalDirectory, { recursive: true });
    cpSync(stageDirectory, finalDirectory, { recursive: true });
    rmSync(stageDirectory, { recursive: true, force: true });
  } catch (error) {
    Logger.error(`[e2e] [${specName}] Failed to move artifacts:`, error);
  }
}

export async function seedSyncBackupFixture(testDirectory: string): Promise<void> {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const syncDirectory = path.join(testDirectory, 'sync');
  const syncConfigPath = path.join(syncDirectory, 'sync_config.json');

  mkdirSync(syncDirectory, { recursive: true });
  writeFileSync(syncConfigPath, JSON.stringify({
    sync_profile_id: 'prof_e2e_test',
    profile_name: 'E2E Test Profile',
    google_account_email: 'test@example.com',
    remote_manifest_name: 'kechimochi-manifest-prof_e2e_test.json',
    last_sync_status: 'clean',
    device_name: 'E2E Device',
  }));

  writeFileSync(path.join(syncDirectory, 'pre_sync_backup_1.zip'), Buffer.alloc(1024 * 1024));
  writeFileSync(path.join(syncDirectory, 'pre_sync_backup_2.zip'), Buffer.alloc(1024 * 1024));
  writeFileSync(path.join(syncDirectory, 'important_data.txt'), 'do not touch');
}
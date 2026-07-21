import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { addMedia, clickMediaItem, isMediaNotVisible, isMediaVisible } from '../../helpers/library.js';
import { addMilestone, logActivityFromDetail } from '../../helpers/media-detail.js';
import { confirmAction, dismissAlert, safeClick } from '../../helpers/common.js';

async function getBackendCounts(title: string): Promise<{ logs: number; milestones: number }> {
  return browser.execute(async (mediaTitle) => {
    const invoke = (globalThis as unknown as {
      __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> };
    }).__TAURI_INTERNALS__.invoke;
    const media = await invoke<Array<{ id: number; uid: string; title: string }>>('get_all_media');
    const target = media.find(entry => entry.title === mediaTitle);
    const logs = target
      ? await invoke<unknown[]>('get_logs_for_media', { mediaId: target.id })
      : [];
    const milestones = target
      ? await invoke<unknown[]>('get_milestones', { mediaUid: target.uid })
      : [];
    return { logs: logs.length, milestones: milestones.length };
  }, title);
}

describe('Desktop CUJ: Destructive Data Boundaries', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('cancels media deletion, then deletes the media with its logs and milestones', async () => {
    const title = 'Delete Cascade Journey';
    await navigateTo('media');
    await addMedia(title, 'Reading', 'Novel');
    await logActivityFromDetail(title, '27', '500', 'Reading', 'Must be cascaded');
    await addMilestone('Delete me too', '0', '27', '500', true);

    expect(await getBackendCounts(title)).toEqual({ logs: 1, milestones: 1 });

    await safeClick('#btn-media-overflow');
    await safeClick('#btn-delete-media-detail');
    await confirmAction(false);
    expect(await $('#media-title').getText()).toBe(title);

    await safeClick('#btn-media-overflow');
    await safeClick('#btn-delete-media-detail');
    await confirmAction(true);
    await navigateTo('media');
    expect(await isMediaNotVisible(title)).toBe(true);
    expect(await getBackendCounts(title)).toEqual({ logs: 0, milestones: 0 });

    await navigateTo('dashboard');
    expect(await $(`.dashboard-activity-item[data-activity-title="${title}"]`).isExisting()).toBe(false);
    await navigateTo('timeline');
    expect(await $('body').getText()).not.toContain(title);
  });

  it('clears activities while preserving media and milestones', async () => {
    const title = 'Clear Activities Boundary';
    await navigateTo('media');
    await addMedia(title, 'Playing', 'Videogame');
    await logActivityFromDetail(title, '44', '0', 'Playing', 'Only this log is disposable');
    await addMilestone('Keep this milestone', '0', '44', '0', true);

    await navigateTo('profile');
    await safeClick('#profile-btn-clear-activities');
    await confirmAction(false);
    expect((await getBackendCounts(title)).logs).toBe(1);

    await safeClick('#profile-btn-clear-activities');
    await confirmAction(true);
    await dismissAlert('All activity logs removed.');

    await navigateTo('dashboard');
    await $('p=No activity logged yet.').waitForDisplayed({ timeout: 5000 });
    expect(await $$('.dashboard-activity-item').length).toBe(0);

    await navigateTo('media');
    expect(await isMediaVisible(title)).toBe(true);
    await clickMediaItem(title);
    expect(await $('#media-logs-container').getText()).toContain('No activity logs found');
    expect(await $('#milestone-list-container').getText()).toContain('Keep this milestone');
    expect(await getBackendCounts(title)).toEqual({ logs: 0, milestones: 1 });

    await browser.refresh();
    await waitForAppReady();
    await navigateTo('media');
    expect(await isMediaVisible(title)).toBe(true);
  });
});

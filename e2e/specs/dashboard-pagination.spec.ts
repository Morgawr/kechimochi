import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { waitForAppReady } from '../helpers/setup.js';
import { submitPrompt } from '../helpers/common.js';

async function seedLogsViaCsv(count: number) {
    const dataDir = process.env.KECHIMOCHI_DATA_DIR || os.tmpdir();
    // eslint-disable-next-line sonarjs/pseudo-random
    const csvPath = path.join(dataDir, `seed_${Math.random().toString(36).substring(7)}.csv`);
    const logs = [
        'Date,Log Name,Media Type,Duration,Language',
        ...Array.from({ length: count }, () => '2024-03-31,Test Media,Reading,10,Japanese')
    ].join('\n');

    fs.writeFileSync(csvPath, logs);

    await browser.execute(async (path) => {
        // @ts-expect-error - reaching into Tauri internals for E2E
        await globalThis.__TAURI_INTERNALS__.invoke('import_csv', { filePath: path });
    }, csvPath);

    await browser.refresh();
    await waitForAppReady();

    try { 
        fs.unlinkSync(csvPath); 
    } catch (err: unknown) { 
        if ((err as Error).message.includes('EBUSY')) {
            // ignore
        }
    }
}

describe('Dashboard Pagination E2E', () => {
    const testProfile = 'PAGETEST';

    before(async () => {
        await waitForAppReady();

        // Add a new profile
        const addProfileBtn = await $('#btn-add-profile');
        await addProfileBtn.click();

        await submitPrompt(testProfile);

        // Wait for switch and re-render
        const profileSelect = await $('#select-profile');
        await browser.waitUntil(async () => {
            return (await profileSelect.getValue()) === testProfile;
        }, { timeout: 5000, timeoutMsg: `Failed to switch to ${testProfile} profile` });

        await waitForAppReady();
    });

    it('should NOT show pagination with 15 or fewer activities', async () => {
        // Seeding 15 items in bulk
        await seedLogsViaCsv(15);

        const pagination = await $('#current-page-display');
        expect(await pagination.isExisting()).toBe(false);
    });

    it('should show pagination when 16th activity is added (Page 1)', async () => {
        // Add 1 more log
        await seedLogsViaCsv(1);

        const pagination = await $('#current-page-display');
        await pagination.waitForDisplayed({ timeout: 2000 });
        expect(await pagination.getText()).toBe('1');

        // Page 1: << is hidden
        const prevBtn = await $('#prev-page');
        expect(await prevBtn.isExisting()).toBe(false);

        const nextBtn = await $('#next-page');
        expect(await nextBtn.isDisplayed()).toBe(true);
    });

    it('should navigate to Page 2 and show both arrows', async () => {
        // We have 16. Add 15 more -> total 31 (3 pages)
        await seedLogsViaCsv(15);

        const pagination = await $('#current-page-display');
        await pagination.scrollIntoView();

        // Wait for logs to settle
        await browser.pause(500);

        const nextBtn = await $('#next-page');
        await nextBtn.click();

        await browser.waitUntil(async () => {
            const el = await $('#current-page-display');
            return (await el.getText()) === '2';
        }, { timeout: 2000, timeoutMsg: 'Failed to navigate to page 2' });

        const prevBtn = await $('#prev-page');
        expect(await prevBtn.isDisplayed()).toBe(true);
        expect(await nextBtn.isDisplayed()).toBe(true);
    });

    it('should navigate to Page 3 and hide >> arrow', async () => {
        const nextBtn = await $('#next-page');
        await nextBtn.scrollIntoView();
        await nextBtn.click();

        await browser.waitUntil(async () => {
            const el = await $('#current-page-display');
            return (await el.getText()) === '3';
        }, { timeout: 2000, timeoutMsg: 'Failed to navigate to page 3' });

        expect(await nextBtn.isExisting()).toBe(false);
        const prevBtn = await $('#prev-page');
        expect(await prevBtn.isDisplayed()).toBe(true);
    });

    it('should jump to Page 1 via double-click and manual entry', async () => {
        const pagination = await $('#current-page-display');
        await pagination.scrollIntoView();

        // Click and wait for re-render to make sure it's stable
        await browser.pause(500);

        await browser.execute((sel) => {
            const el = document.querySelector(sel);
            if (el) {
                const ev = new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: globalThis as unknown as Window, detail: 2 });
                el.dispatchEvent(ev);
            }
        }, '#current-page-display');

        const input = await $('#current-page-input');
        await input.waitForDisplayed({ timeout: 2000 });

        // Use browser.execute to set value and trigger Enter directly to avoid blur/flakiness
        await browser.execute((val) => {
            const el = document.getElementById('current-page-input') as HTMLInputElement;
            if (el) {
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                });
                el.dispatchEvent(enterEvent);
            }
        }, '1');

        // Wait for re-render and check result
        await browser.waitUntil(async () => {
            const el = await $('#current-page-display');
            return (await el.isExisting()) && (await el.getText()) === '1';
        }, { timeout: 2000, timeoutMsg: 'Failed to return to page 1' });

        const prevBtn = await $('#prev-page');
        expect(await prevBtn.isExisting()).toBe(false);
    });
});

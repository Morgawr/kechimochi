import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo } from '../helpers/navigation.js';
import { clickMediaItem } from '../helpers/library.js';
import { addExtraField, getProjectionValue, backToGrid } from '../helpers/media-detail.js';
import { calculateReport } from '../helpers/profile.js';
import { logActivityGlobal } from '../helpers/dashboard.js';

describe('CUJ: Progress Analysis (Projections)', () => {
    beforeAll(async () => {
        await waitForAppReady();
    });

    it('should calculate reading speeds and show correct projections per media type', async () => {
        await navigateTo('media');
        await clickMediaItem('ダンジョン飯');
        await addExtraField('Character count', '3000');
        await backToGrid();

        await clickMediaItem('ある魔女が死ぬまで');
        await addExtraField('Character count', '14250');
        await backToGrid();

        await clickMediaItem('STEINS;GATE');
        await addExtraField('Character count', '31500');

        await navigateTo('profile');
        await calculateReport();

        await navigateTo('media');
        await clickMediaItem('呪術廻戦');
        await addExtraField('Character count', '6000');
        
        await browser.waitUntil(async () => (await getProjectionValue('est-remaining-time')) === '15min', {
            timeout: 5000, timeoutMsg: 'est-remaining-time for Jututsu did not reach 15min'
        });
        await browser.waitUntil(async () => (await getProjectionValue('est-completion-rate')) === '75%', {
            timeout: 5000, timeoutMsg: 'est-completion-rate for Jututsu did not reach 75%'
        });
        await backToGrid();

        await clickMediaItem('薬屋のひとりごと');
        await addExtraField('Character count', '15000');
        
        await browser.waitUntil(async () => (await getProjectionValue('est-remaining-time')) === '1h15min', {
            timeout: 5000, timeoutMsg: 'est-remaining-time for Kusuriya did not reach 1h15min'
        });
        await browser.waitUntil(async () => (await getProjectionValue('est-completion-rate')) === '75%', {
            timeout: 5000, timeoutMsg: 'est-completion-rate for Kusuriya did not reach 75%'
        });
        await backToGrid();

        await logActivityGlobal('呪術廻戦', 30);
        await $('#add-activity-form').waitForExist({ reverse: true, timeout: 5000 });
        
        await navigateTo('media');
        await clickMediaItem('呪術廻戦');
        
        await browser.waitUntil(async () => (await getProjectionValue('est-remaining-time')) === '0min', {
            timeout: 5000, timeoutMsg: 'est-remaining-time for Jujutsu (post-log) did not reach 0min'
        });
        await browser.waitUntil(async () => (await getProjectionValue('est-completion-rate')) === '100%', {
            timeout: 5000, timeoutMsg: 'est-completion-rate for Jujutsu (post-log) did not reach 100%'
        });
    });
});

import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { getSelectValue, setSelect, setCheckbox } from '../../helpers/form-controls.js';

async function expectBodyTheme(theme: string): Promise<void> {
    await browser.waitUntil(
        async () => (await $('body').getAttribute('data-theme')) === theme,
        { timeout: 10000, timeoutMsg: `body[data-theme] never became "${theme}"` }
    );
}

describe('CUJ: Local Theme Override', () => {
    before(async () => {
        await waitForAppReady();
    });

    it('overrides the synced theme locally without changing the synced value', async () => {
        await navigateTo('profile');
        expect(await verifyActiveView('profile')).toBe(true);

        await setSelect('#profile-select-theme', { value: 'molokai' });
        await expectBodyTheme('molokai');

        expect(await $('#profile-select-theme-local').isExisting()).toBe(false);

        await setCheckbox('#profile-checkbox-theme-override', true);

        await setSelect('#profile-select-theme-local', { value: 'dark' });
        await expectBodyTheme('dark');

        expect(await getSelectValue('#profile-select-theme')).toBe('molokai');

        await setCheckbox('#profile-checkbox-theme-override', false);
        await expectBodyTheme('molokai');

        await browser.waitUntil(
            async () => !(await $('#profile-select-theme-local').isExisting()),
            { timeout: 5000, timeoutMsg: 'Local theme dropdown remained visible after override was disabled' }
        );
    });

    it('persists the override choice across navigations', async () => {
        await navigateTo('profile');
        await setCheckbox('#profile-checkbox-theme-override', true);
        await setSelect('#profile-select-theme-local', { value: 'purple' });
        await expectBodyTheme('purple');

        await navigateTo('dashboard');
        expect(await verifyActiveView('dashboard')).toBe(true);
        await expectBodyTheme('purple');

        await navigateTo('profile');
        expect(await $('#profile-checkbox-theme-override').isSelected()).toBe(true);
        expect(await getSelectValue('#profile-select-theme-local')).toBe('purple');

        await setCheckbox('#profile-checkbox-theme-override', false);
    });
});

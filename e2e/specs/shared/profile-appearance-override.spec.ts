import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { getSelectValue, setSelect, setCheckbox } from '../../helpers/form-controls.js';

async function expectBodyTheme(theme: string): Promise<void> {
    await browser.waitUntil(
        async () => (await $('body').getAttribute('data-theme')) === theme,
        { timeout: 10000, timeoutMsg: `body[data-theme] never became "${theme}"` }
    );
}

async function expectBodyFont(font: string): Promise<void> {
    await browser.waitUntil(
        async () => (await $('body').getAttribute('data-font')) === font,
        { timeout: 10000, timeoutMsg: `body[data-font] never became "${font}"` }
    );
}

describe('CUJ: Local Appearance Override', () => {
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

    it('overrides the synced font locally without changing the synced value', async () => {
        await navigateTo('profile');

        await setSelect('#profile-select-font', { value: 'montserrat' });
        await expectBodyFont('montserrat');

        expect(await $('#profile-select-font-local').isExisting()).toBe(false);

        await setCheckbox('#profile-checkbox-theme-override', true);

        await setSelect('#profile-select-font-local', { value: 'nunito' });
        await expectBodyFont('nunito');

        expect(await getSelectValue('#profile-select-font')).toBe('montserrat');

        await setCheckbox('#profile-checkbox-theme-override', false);
        await expectBodyFont('montserrat');

        await browser.waitUntil(
            async () => !(await $('#profile-select-font-local').isExisting()),
            { timeout: 5000, timeoutMsg: 'Local font dropdown remained visible after override was disabled' }
        );
    });

    it('persists the local theme and font across navigations', async () => {
        await navigateTo('profile');
        await setCheckbox('#profile-checkbox-theme-override', true);
        await setSelect('#profile-select-theme-local', { value: 'purple' });
        await setSelect('#profile-select-font-local', { value: 'source-sans-3' });
        await expectBodyTheme('purple');
        await expectBodyFont('source-sans-3');

        await navigateTo('dashboard');
        expect(await verifyActiveView('dashboard')).toBe(true);
        await expectBodyTheme('purple');
        await expectBodyFont('source-sans-3');

        await navigateTo('profile');
        expect(await $('#profile-checkbox-theme-override').isSelected()).toBe(true);
        expect(await getSelectValue('#profile-select-theme-local')).toBe('purple');
        expect(await getSelectValue('#profile-select-font-local')).toBe('source-sans-3');

        await setCheckbox('#profile-checkbox-theme-override', false);
    });
});
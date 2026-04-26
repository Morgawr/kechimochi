import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';

async function setSelectValue(selector: string, value: string): Promise<void> {
    await browser.execute((selector, value) => {
        const select = document.querySelector(selector) as HTMLSelectElement | null;
        if (!select) throw new Error(`Select not found: ${selector}`);
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }, selector, value);
}

async function setCheckbox(selector: string, checked: boolean): Promise<void> {
    await browser.execute((selector, checked) => {
        const checkbox = document.querySelector(selector) as HTMLInputElement | null;
        if (!checkbox) throw new Error(`Checkbox not found: ${selector}`);
        if (checkbox.checked !== checked) {
            checkbox.checked = checked;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, selector, checked);
}

async function expectBodyTheme(theme: string): Promise<void> {
    await browser.waitUntil(
        async () => (await $('body').getAttribute('data-theme')) === theme,
        { timeout: 5000, timeoutMsg: `body[data-theme] never became "${theme}"` }
    );
}

describe('CUJ: Local Theme Override', () => {
    before(async () => {
        await waitForAppReady();
    });

    it('overrides the synced theme locally without changing the synced value', async () => {
        await navigateTo('profile');
        expect(await verifyActiveView('profile')).toBe(true);

        const syncedThemeSelect = await $('#profile-select-theme');
        await syncedThemeSelect.waitForDisplayed({ timeout: 5000 });
        await setSelectValue('#profile-select-theme', 'molokai');
        await expectBodyTheme('molokai');

        expect(await $('#profile-select-theme-local').isExisting()).toBe(false);

        const overrideCheckbox = await $('#profile-checkbox-theme-override');
        await overrideCheckbox.waitForDisplayed({ timeout: 5000 });
        await setCheckbox('#profile-checkbox-theme-override', true);

        const localThemeSelect = await $('#profile-select-theme-local');
        await localThemeSelect.waitForDisplayed({ timeout: 5000 });

        await setSelectValue('#profile-select-theme-local', 'dark');
        await expectBodyTheme('dark');

        expect(await $('#profile-select-theme').getValue()).toBe('molokai');

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
        await setSelectValue('#profile-select-theme-local', 'purple');
        await expectBodyTheme('purple');

        await navigateTo('dashboard');
        expect(await verifyActiveView('dashboard')).toBe(true);
        await expectBodyTheme('purple');

        await navigateTo('profile');
        expect(await $('#profile-checkbox-theme-override').isSelected()).toBe(true);
        expect(await $('#profile-select-theme-local').getValue()).toBe('purple');

        await setCheckbox('#profile-checkbox-theme-override', false);
    });
});
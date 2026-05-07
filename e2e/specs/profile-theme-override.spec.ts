import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { safeClick } from '../helpers/common.js';

async function setSelectValue(selector: string, value: string): Promise<void> {
    const select = $(selector);
    await select.waitForDisplayed({ timeout: 5000 });
    await select.selectByAttribute('value', value).catch(() => undefined);
    await browser.execute((targetSelector, nextValue) => {
        const element = document.querySelector(targetSelector as string);
        if (!(element instanceof HTMLSelectElement)) {
            throw new Error(`${targetSelector} did not resolve to a select`);
        }

        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(element, nextValue);
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }, selector, value);

    await browser.waitUntil(async () => (await $(selector).getValue().catch(() => '')) === value, {
        timeout: 5000,
        timeoutMsg: `${selector} did not settle to ${value}`,
    });
}

async function setCheckbox(selector: string, checked: boolean): Promise<void> {
    const checkbox = $(selector);
    await checkbox.waitForDisplayed({ timeout: 5000 });

    if ((await checkbox.isSelected()) !== checked) {
        await safeClick(checkbox);
    }
    await browser.execute((targetSelector, nextChecked) => {
        const element = document.querySelector(targetSelector as string);
        if (!(element instanceof HTMLInputElement)) {
            throw new Error(`${targetSelector} did not resolve to an input`);
        }

        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
        setter?.call(element, nextChecked);
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }, selector, checked);

    await browser.waitUntil(async () => (await $(selector).isSelected().catch(() => !checked)) === checked, {
        timeout: 5000,
        timeoutMsg: `${selector} did not settle to ${checked ? 'checked' : 'unchecked'}`,
    });
}

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

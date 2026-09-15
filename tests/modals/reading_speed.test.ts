import { describe, it, expect, beforeEach } from 'vitest';
import { showReadingSpeedOverrideModal } from '../../src/media/reading_speed_modal';

function getInput(): HTMLInputElement {
    return document.querySelector('#reading-speed-input') as HTMLInputElement;
}

describe('modals/reading_speed.ts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('should keep only digits, capped at seven of them', async () => {
        const promise = showReadingSpeedOverrideModal('Some Novel', null);

        const input = getInput();
        input.value = '12a34,567890';
        input.dispatchEvent(new Event('input'));
        expect(input.value).toBe('1234567');

        (document.querySelector('#reading-speed-confirm') as HTMLButtonElement).click();
        expect(await promise).toEqual({ charactersPerHour: 1234567 });
    });

    it('should report an empty field as no override', async () => {
        const promise = showReadingSpeedOverrideModal('Some Novel', 5000);

        const input = getInput();
        expect(input.value).toBe('5000');
        input.value = '';
        input.dispatchEvent(new Event('input'));
        (document.querySelector('#reading-speed-confirm') as HTMLButtonElement).click();

        expect(await promise).toEqual({ charactersPerHour: null });
    });

    it('should resolve null when cancelled', async () => {
        const promise = showReadingSpeedOverrideModal('Some Novel', null);

        (document.querySelector('#reading-speed-cancel') as HTMLButtonElement).click();

        expect(await promise).toBeNull();
    });
});

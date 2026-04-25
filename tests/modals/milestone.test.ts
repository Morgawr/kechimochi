import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showAddMilestoneModal } from '../../src/modals/milestone';
import { buildCalendar } from '../../src/modals/calendar';

vi.mock('../../src/modals/calendar', () => ({
    buildCalendar: vi.fn(),
}));

describe('modals/milestone.ts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
    });

    it('should resolve milestone data on confirm', async () => {
        const promise = showAddMilestoneModal('Test Media');
        await vi.waitFor(() => document.querySelector('#milestone-confirm'));

        const nameInput = document.querySelector('#milestone-name') as HTMLInputElement;
        const hoursInput = document.querySelector('#milestone-hours') as HTMLInputElement;
        const minutesInput = document.querySelector('#milestone-minutes') as HTMLInputElement;

        nameInput.value = 'Finish Chapter 1';
        hoursInput.value = '2';
        minutesInput.value = '30';

        (document.querySelector('#milestone-confirm') as HTMLElement).click();

        const result = await promise;
        expect(result).toEqual({
            media_title: 'Test Media',
            name: 'Finish Chapter 1',
            duration: 150,
            characters: 0,
            date: undefined
        });
    });

    it('should handle date recording', async () => {
        const promise = showAddMilestoneModal('Test Media');
        await vi.waitFor(() => document.querySelector('#milestone-record-date'));

        const checkbox = document.querySelector('#milestone-record-date') as HTMLInputElement;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        const nameInput = document.querySelector('#milestone-name') as HTMLInputElement;
        nameInput.value = 'Milestone with Date';
        (document.querySelector('#milestone-minutes') as HTMLInputElement).value = '10';

        (document.querySelector('#milestone-confirm') as HTMLElement).click();

        const result = await promise;
        expect(result?.date).toBeDefined();
    });

    it('should resolve null on cancel', async () => {
        const promise = showAddMilestoneModal('Test Media');
        await vi.waitFor(() => document.querySelector('#milestone-cancel'));

        (document.querySelector('#milestone-cancel') as HTMLElement).click();

        const result = await promise;
        expect(result).toBeNull();
    });

    it('should prefill duration and characters from defaults', async () => {
        showAddMilestoneModal('Test Media', { duration: 125, characters: 3210 });
        await vi.waitFor(() => document.querySelector('#milestone-hours'));

        const hoursInput = document.querySelector('#milestone-hours') as HTMLInputElement;
        const minutesInput = document.querySelector('#milestone-minutes') as HTMLInputElement;
        const charactersInput = document.querySelector('#milestone-characters') as HTMLInputElement;

        expect(hoursInput.value).toBe('2');
        expect(minutesInput.value).toBe('5');
        expect(charactersInput.value).toBe('3210');
    });
<<<<<<< ours
=======

    it('should prefill and update existing milestone in edit mode', async () => {
        const existing = {
            id: 7,
            media_uid: 'abc-123',
            media_title: 'Test Media',
            name: 'Initial milestone',
            duration: 125,
            characters: 900,
            date: '2025-05-14'
        };
        const promise = showAddMilestoneModal('Test Media', existing);
        await vi.waitFor(() => document.querySelector('#milestone-confirm'));

        expect((document.querySelector('h3') as HTMLElement).textContent).toContain('Edit Milestone');
        expect((document.querySelector('#milestone-hours') as HTMLInputElement).value).toBe('2');
        expect((document.querySelector('#milestone-minutes') as HTMLInputElement).value).toBe('5');
        expect((document.querySelector('#milestone-characters') as HTMLInputElement).value).toBe('900');
        expect((document.querySelector('#milestone-record-date') as HTMLInputElement).checked).toBe(true);
        expect(buildCalendar).toHaveBeenCalledWith('milestone-calendar', '2025-05-14', expect.any(Function));

        (document.querySelector('#milestone-name') as HTMLInputElement).value = 'Updated milestone';
        (document.querySelector('#milestone-confirm') as HTMLElement).click();

        const result = await promise;
        expect(result).toEqual({
            id: 7,
            media_uid: 'abc-123',
            media_title: 'Test Media',
            name: 'Updated milestone',
            duration: 125,
            characters: 900,
            date: '2025-05-14'
        });
    });
>>>>>>> theirs
});

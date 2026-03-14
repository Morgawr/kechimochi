import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showAddMilestoneModal } from '../../src/modals/milestone';

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
});

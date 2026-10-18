import { describe, it, expect } from 'vitest';
import {
    getImmersePromptIntensity,
    getImmersePromptText,
    renderNoPeriodDataEmptyState,
} from '../../../src/dashboard/card_shell';

function renderEmptyState(elapsedPeriodDays: number | null): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = renderNoPeriodDataEmptyState(elapsedPeriodDays);
    return container;
}

describe('getImmersePromptIntensity', () => {
    it.each([
        [1, 0],
        [2, 1],
        [3, 1],
        [4, 2],
        [7, 2],
        [8, 3],
        [15, 3],
        [16, 4],
    ])('should map %i elapsed days to intensity %i', (elapsedPeriodDays, expectedIntensity) => {
        expect(getImmersePromptIntensity(elapsedPeriodDays)).toBe(expectedIntensity);
    });

    it('should stay at the maximum intensity for a full year', () => {
        expect(getImmersePromptIntensity(366)).toBe(4);
    });
});

describe('getImmersePromptText', () => {
    it('should add one exclamation mark per intensity level', () => {
        expect(getImmersePromptText(0)).toBe('Go immerse!');
        expect(getImmersePromptText(4)).toBe('Go immerse!!!!!');
    });
});

describe('renderNoPeriodDataEmptyState', () => {
    it('should render only the plain message when today is outside the period', () => {
        const container = renderEmptyState(null);

        expect(container.textContent).toBe('No data in this period.');
        expect(container.querySelector('[data-immerse-intensity]')).toBeNull();
    });

    it('should render the prompt with its intensity when today is inside the period', () => {
        const container = renderEmptyState(10);

        expect(container.textContent).toBe('No data in this period. Go immerse!!!!');
        expect(container.querySelector<HTMLElement>('[data-immerse-intensity]')?.dataset.immerseIntensity).toBe('3');
    });
});

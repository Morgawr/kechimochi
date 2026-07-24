import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wireDurationInput } from '../../src/time/duration_input';

const ERROR_DELAY_MS = 600;

describe('duration_input.ts', () => {
    let inputElement: HTMLInputElement;
    let hintElement: HTMLDivElement;
    let confirmButton: HTMLButtonElement;

    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        inputElement = document.createElement('input');
        hintElement = document.createElement('div');
        confirmButton = document.createElement('button');
        document.body.append(inputElement, hintElement, confirmButton);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const setInputValue = (value: string) => {
        inputElement.value = value;
        inputElement.dispatchEvent(new Event('input'));
    };

    const isShowingError = () => hintElement.classList.contains('is-invalid');

    describe('wireDurationInput', () => {
        it('should enable the confirm button and clear the hint for empty input', () => {
            const { getDurationMinutes } = wireDurationInput(inputElement, hintElement, confirmButton);

            setInputValue('');

            expect(confirmButton.disabled).toBe(false);
            expect(hintElement.textContent).toBe('');
            expect(getDurationMinutes()).toBe(0);
        });

        it('should show the parsed duration hint and keep the confirm button enabled for valid input', () => {
            const { getDurationMinutes } = wireDurationInput(inputElement, hintElement, confirmButton);

            setInputValue('2h15m');

            expect(confirmButton.disabled).toBe(false);
            expect(hintElement.textContent).toBe('135 minutes (2h 15m)');
            expect(getDurationMinutes()).toBe(135);
        });

        it('should show a day-aware compact hint for long durations', () => {
            wireDurationInput(inputElement, hintElement, confirmButton);

            setInputValue('3d4h5m');

            expect(hintElement.textContent).toBe('4565 minutes (3d 4h 5m)');
        });

        it('should omit the compact form when it adds nothing', () => {
            wireDurationInput(inputElement, hintElement, confirmButton);

            setInputValue('45m');

            expect(hintElement.textContent).toBe('45 minutes');
        });

        it('should disable the confirm button immediately but delay the error message', () => {
            const { getDurationMinutes } = wireDurationInput(inputElement, hintElement, confirmButton);

            setInputValue('2h15m3');

            expect(confirmButton.disabled).toBe(true);
            expect(getDurationMinutes()).toBeNull();
            expect(isShowingError()).toBe(false);

            vi.advanceTimersByTime(ERROR_DELAY_MS);

            expect(isShowingError()).toBe(true);
            expect(hintElement.textContent).toContain('Unrecognized');
        });

        it('should not report an error for input that becomes valid before typing pauses', () => {
            wireDurationInput(inputElement, hintElement, confirmButton);

            setInputValue('2h15m3');
            vi.advanceTimersByTime(ERROR_DELAY_MS - 100);
            expect(isShowingError()).toBe(false);

            setInputValue('2h15m30s');
            vi.advanceTimersByTime(ERROR_DELAY_MS * 2);

            expect(isShowingError()).toBe(false);
            expect(confirmButton.disabled).toBe(false);
            expect(hintElement.textContent).toBe('136 minutes (2h 16m)');
        });

        it('should report the error immediately when focus leaves the field', () => {
            wireDurationInput(inputElement, hintElement, confirmButton);

            setInputValue('abc');
            inputElement.dispatchEvent(new Event('blur'));

            expect(isShowingError()).toBe(true);
            expect(hintElement.textContent).toContain('Unrecognized');
        });

        it('should distinguish a too-large duration from unrecognized notation', () => {
            wireDurationInput(inputElement, hintElement, confirmButton);

            setInputValue('abc');
            vi.advanceTimersByTime(ERROR_DELAY_MS);
            const unrecognizedHint = hintElement.textContent;

            setInputValue('99999999999999999999');
            vi.advanceTimersByTime(ERROR_DELAY_MS);

            expect(confirmButton.disabled).toBe(true);
            expect(hintElement.textContent).not.toBe(unrecognizedHint);
            expect(hintElement.textContent).toContain('too large');
        });

        it('should keep the confirm button enabled for a parseable zero', () => {
            const { getDurationMinutes } = wireDurationInput(inputElement, hintElement, confirmButton);

            setInputValue('0');

            expect(confirmButton.disabled).toBe(false);
            expect(getDurationMinutes()).toBe(0);
        });

        it('should re-enable the confirm button and drop the error after fixing invalid input', () => {
            wireDurationInput(inputElement, hintElement, confirmButton);

            setInputValue('12:20');
            vi.advanceTimersByTime(ERROR_DELAY_MS);
            expect(confirmButton.disabled).toBe(true);
            expect(isShowingError()).toBe(true);

            setInputValue('2h15m');

            expect(confirmButton.disabled).toBe(false);
            expect(isShowingError()).toBe(false);
        });

        it('should run once immediately with the input element current value', () => {
            inputElement.value = '90';

            const { getDurationMinutes } = wireDurationInput(inputElement, hintElement, confirmButton);

            expect(confirmButton.disabled).toBe(false);
            expect(getDurationMinutes()).toBe(90);
        });
    });
});
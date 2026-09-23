import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wireDurationInput } from '../../src/time/duration_input';

const ERROR_DELAY_MS = 600;

describe('duration_input.ts', () => {
    let inputElement: HTMLInputElement;
    let hintElement: HTMLDivElement;

    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        inputElement = document.createElement('input');
        hintElement = document.createElement('div');
        document.body.append(inputElement, hintElement);
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
        it('should clear the hint and report zero minutes for empty input', () => {
            const { getDurationMinutes } = wireDurationInput(inputElement, hintElement, () => {});

            setInputValue('');

            expect(hintElement.textContent).toBe('');
            expect(getDurationMinutes()).toBe(0);
        });

        it('should show the parsed duration hint for valid input', () => {
            const { getDurationMinutes } = wireDurationInput(inputElement, hintElement, () => {});

            setInputValue('2h15m');

            expect(hintElement.textContent).toBe('135 minutes (2h 15m)');
            expect(getDurationMinutes()).toBe(135);
        });

        it('should show a day-aware compact hint for long durations', () => {
            wireDurationInput(inputElement, hintElement, () => {});

            setInputValue('3d4h5m');

            expect(hintElement.textContent).toBe('4565 minutes (3d 4h 5m)');
        });

        it('should omit the compact form when it adds nothing', () => {
            wireDurationInput(inputElement, hintElement, () => {});

            setInputValue('45m');

            expect(hintElement.textContent).toBe('45 minutes');
        });

        it('should reject unparseable input immediately but delay the error message', () => {
            const { getDurationMinutes } = wireDurationInput(inputElement, hintElement, () => {});

            setInputValue('2h15m3');

            expect(getDurationMinutes()).toBeNull();
            expect(isShowingError()).toBe(false);

            vi.advanceTimersByTime(ERROR_DELAY_MS);

            expect(isShowingError()).toBe(true);
            expect(hintElement.textContent).toContain('Unrecognized');
        });

        it('should not report an error for input that becomes valid before typing pauses', () => {
            wireDurationInput(inputElement, hintElement, () => {});

            setInputValue('2h15m3');
            vi.advanceTimersByTime(ERROR_DELAY_MS - 100);
            expect(isShowingError()).toBe(false);

            setInputValue('2h15m30s');
            vi.advanceTimersByTime(ERROR_DELAY_MS * 2);

            expect(isShowingError()).toBe(false);
            expect(hintElement.textContent).toBe('136 minutes (2h 16m)');
        });

        it('should report the error immediately when focus leaves the field', () => {
            wireDurationInput(inputElement, hintElement, () => {});

            setInputValue('abc');
            inputElement.dispatchEvent(new Event('blur'));

            expect(isShowingError()).toBe(true);
            expect(hintElement.textContent).toContain('Unrecognized');
        });

        it('should distinguish a too-large duration from unrecognized notation', () => {
            const { getDurationMinutes } = wireDurationInput(inputElement, hintElement, () => {});

            setInputValue('abc');
            vi.advanceTimersByTime(ERROR_DELAY_MS);
            const unrecognizedHint = hintElement.textContent;

            setInputValue('99999999999999999999');
            vi.advanceTimersByTime(ERROR_DELAY_MS);

            expect(getDurationMinutes()).toBeNull();
            expect(hintElement.textContent).not.toBe(unrecognizedHint);
            expect(hintElement.textContent).toContain('too large');
        });

        it('should report a parseable zero as zero minutes', () => {
            const { getDurationMinutes } = wireDurationInput(inputElement, hintElement, () => {});

            setInputValue('0');

            expect(getDurationMinutes()).toBe(0);
        });

        it('should drop the error after fixing invalid input', () => {
            const { getDurationMinutes } = wireDurationInput(inputElement, hintElement, () => {});

            setInputValue('12:20');
            vi.advanceTimersByTime(ERROR_DELAY_MS);
            expect(isShowingError()).toBe(true);

            setInputValue('2h15m');

            expect(isShowingError()).toBe(false);
            expect(getDurationMinutes()).toBe(135);
        });

        it('should run once immediately with the input element current value', () => {
            inputElement.value = '90';

            const { getDurationMinutes } = wireDurationInput(inputElement, hintElement, () => {});

            expect(hintElement.textContent).toBe('90 minutes (1h 30m)');
            expect(getDurationMinutes()).toBe(90);
        });

        it('should call onChange after each edit but not while wiring or on blur', () => {
            const onChange = vi.fn();
            const { getDurationMinutes } = wireDurationInput(inputElement, hintElement, onChange);
            expect(onChange).not.toHaveBeenCalled();

            const minutesSeenByOnChange: Array<number | null> = [];
            onChange.mockImplementation(() => minutesSeenByOnChange.push(getDurationMinutes()));

            setInputValue('30');
            setInputValue('abc');
            inputElement.dispatchEvent(new Event('blur'));

            expect(onChange).toHaveBeenCalledTimes(2);
            expect(minutesSeenByOnChange).toEqual([30, null]);
        });
    });
});

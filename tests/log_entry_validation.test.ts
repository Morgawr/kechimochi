import { describe, it, expect, beforeEach } from 'vitest';
import {
    describeMissingAmount,
    formatMissingInputsMessage,
    syncConfirmButton,
} from '../src/log_entry_validation';

describe('log_entry_validation.ts', () => {
    describe('describeMissingAmount', () => {
        it.each([
            { durationMinutes: null, characters: 0, expected: 'a valid duration' },
            { durationMinutes: null, characters: 500, expected: 'a valid duration' },
            { durationMinutes: 0, characters: 0, expected: 'a duration, a character count, or both' },
            { durationMinutes: 30, characters: 0, expected: null },
            { durationMinutes: 0, characters: 500, expected: null },
            { durationMinutes: 30, characters: 500, expected: null },
        ])('should describe duration $durationMinutes with $characters characters as $expected', ({ durationMinutes, characters, expected }) => {
            expect(describeMissingAmount(durationMinutes, characters)).toBe(expected);
        });
    });

    describe('formatMissingInputsMessage', () => {
        it('should phrase a single missing input as one request', () => {
            expect(formatMissingInputsMessage(['a valid duration'])).toBe('Please enter a valid duration.');
        });

        it('should keep the name separate from the duration-or-characters choice', () => {
            expect(formatMissingInputsMessage(['a milestone name', 'a duration, a character count, or both']))
                .toBe('Please enter a milestone name, and also a duration, a character count, or both.');
        });
    });

    describe('syncConfirmButton', () => {
        let confirmButton: HTMLButtonElement;

        beforeEach(() => {
            confirmButton = document.createElement('button');
        });

        it('should disable the button and explain why while inputs are missing', () => {
            syncConfirmButton(confirmButton, ['a valid duration']);

            expect(confirmButton.disabled).toBe(true);
            expect(confirmButton.title).toBe('Please enter a valid duration.');
        });

        it('should enable the button and drop the explanation once nothing is missing', () => {
            syncConfirmButton(confirmButton, ['a valid duration']);
            syncConfirmButton(confirmButton, []);

            expect(confirmButton.disabled).toBe(false);
            expect(confirmButton.hasAttribute('title')).toBe(false);
        });
    });
});

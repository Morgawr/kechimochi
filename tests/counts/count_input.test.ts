import { describe, it, expect, beforeEach } from 'vitest';
import { readCount, wireDigitsOnlyInput } from '../../src/counts/count_input';

describe('count_input.ts', () => {
    describe('wireDigitsOnlyInput', () => {
        let inputElement: HTMLInputElement;

        beforeEach(() => {
            inputElement = document.createElement('input');
            wireDigitsOnlyInput(inputElement);
        });

        const typeInto = (value: string) => {
            inputElement.value = value;
            inputElement.dispatchEvent(new Event('input'));
        };

        it.each([
            { typed: 'a1b2', expected: '12' },
            { typed: '1,000', expected: '1000' },
            { typed: '-5', expected: '5' },
            { typed: '1e3', expected: '13' },
            { typed: 'abc', expected: '' },
            { typed: '2500', expected: '2500' },
        ])('should turn $typed into $expected', ({ typed, expected }) => {
            typeInto(typed);

            expect(inputElement.value).toBe(expected);
        });
    });

    describe('readCount', () => {
        it('should read an empty input as zero', () => {
            const inputElement = document.createElement('input');

            expect(readCount(inputElement)).toBe(0);
        });

        it('should read the digits of the input as a number', () => {
            const inputElement = document.createElement('input');
            inputElement.value = '1500';

            expect(readCount(inputElement)).toBe(1500);
        });
    });
});

const NON_DIGIT_PATTERN = /\D/g;

export const COUNT_INPUT_PLACEHOLDER = 'e.g. 1500';

export function wireDigitsOnlyInput(inputElement: HTMLInputElement): void {
    inputElement.addEventListener('input', () => {
        const digitsOnlyValue = inputElement.value.replace(NON_DIGIT_PATTERN, '');
        if (digitsOnlyValue !== inputElement.value) {
            inputElement.value = digitsOnlyValue;
        }
    });
}

export function readCount(inputElement: HTMLInputElement): number {
    return Number(inputElement.value.replace(NON_DIGIT_PATTERN, ''));
}

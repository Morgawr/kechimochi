export const MISSING_INPUTS_ALERT_TITLE = 'Input Required';

/**
 * Names what keeps a duration/characters pair from being loggable, or `null` when it is
 * loggable. `durationMinutes` is `null` for an unparseable duration.
 */
export function describeMissingAmount(durationMinutes: number | null, characters: number): string | null {
    if (durationMinutes === null) return 'a valid duration';
    if (durationMinutes === 0 && characters === 0) return 'a duration, a character count, or both';
    return null;
}

export function formatMissingInputsMessage(missingInputs: readonly string[]): string {
    return `Please enter ${missingInputs.join(', and also ')}.`;
}

export function syncConfirmButton(confirmButton: HTMLButtonElement, missingInputs: readonly string[]): void {
    confirmButton.disabled = missingInputs.length > 0;
    if (confirmButton.disabled) {
        confirmButton.title = formatMissingInputsMessage(missingInputs);
    } else {
        confirmButton.removeAttribute('title');
    }
}

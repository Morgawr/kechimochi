import { DurationParseResult, parseDuration } from './duration_parsing';
import { formatCompactDuration } from './formatting';

const DURATION_HINT_INVALID_CLASS = 'is-invalid';
const DURATION_HINT_UNRECOGNIZED_TEXT = 'Unrecognized duration. Try 90, 1h30m, or 2h 15.';
const DURATION_HINT_TOO_LARGE_TEXT = 'That duration is too large.';
const DURATION_ERROR_DELAY_MS = 600;

function describeParsedDuration(minutes: number): string {
    const compactDuration = formatCompactDuration(minutes);
    const minutesLabel = `${minutes} minutes`;
    return compactDuration === `${minutes}m` ? minutesLabel : `${minutesLabel} (${compactDuration})`;
}

type DurationParseFailure = Exclude<DurationParseResult, { status: 'parsed' }>;

function errorMessageFor(failure: DurationParseFailure): string {
    return failure.status === 'tooLarge' ? DURATION_HINT_TOO_LARGE_TEXT : DURATION_HINT_UNRECOGNIZED_TEXT;
}

/**
 * Wires a free-form duration input to a hint element: parses on every keystroke, shows a
 * live "parsed to" hint, and calls `onChange` after each edit so the caller can decide
 * whether its confirm button is usable. `onChange` is not called while wiring, because the
 * caller does not have `getDurationMinutes` yet. `getDurationMinutes` returns `null` for
 * input that cannot be parsed, so callers reached by other means than the confirm button
 * (the Enter key, say) cannot mistake a rejected duration for zero.
 *
 * Rejection is reported only once typing pauses or focus leaves. Validating on every
 * keystroke but reporting immediately would flash an error while "5h12m" is still being
 * typed, since "5h1" is not yet valid.
 */
export function wireDurationInput(
    inputElement: HTMLInputElement,
    hintElement: HTMLElement,
    onChange: () => void
): { getDurationMinutes: () => number | null } {
    let pendingErrorTimer: ReturnType<typeof setTimeout> | undefined;

    const cancelPendingError = () => {
        if (pendingErrorTimer !== undefined) {
            clearTimeout(pendingErrorTimer);
            pendingErrorTimer = undefined;
        }
    };

    const showError = (message: string) => {
        cancelPendingError();
        hintElement.hidden = false;
        hintElement.textContent = message;
        hintElement.classList.add(DURATION_HINT_INVALID_CLASS);
    };

    const update = () => {
        cancelPendingError();

        if (inputElement.value.trim().length === 0) {
            hintElement.textContent = '';
            hintElement.hidden = true;
            hintElement.classList.remove(DURATION_HINT_INVALID_CLASS);
            return;
        }

        const result = parseDuration(inputElement.value);

        if (result.status === 'parsed') {
            hintElement.hidden = false;
            hintElement.textContent = describeParsedDuration(result.minutes);
            hintElement.classList.remove(DURATION_HINT_INVALID_CLASS);
            return;
        }

        const errorMessage = errorMessageFor(result);
        pendingErrorTimer = setTimeout(() => showError(errorMessage), DURATION_ERROR_DELAY_MS);
    };

    const flushError = () => {
        if (inputElement.value.trim().length === 0) return;

        const result = parseDuration(inputElement.value);
        if (result.status === 'parsed') return;

        showError(errorMessageFor(result));
    };

    inputElement.addEventListener('input', () => {
        update();
        onChange();
    });
    inputElement.addEventListener('blur', flushError);
    update();

    return {
        getDurationMinutes: () => {
            const result = parseDuration(inputElement.value);
            return result.status === 'parsed' ? result.minutes : null;
        },
    };
}
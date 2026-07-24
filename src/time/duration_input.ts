import { DurationParseResult, parseDuration } from './duration_parsing';
import { formatCompactDuration } from './formatting';

const DURATION_HINT_INVALID_CLASS = 'is-invalid';
const DURATION_HINT_UNRECOGNIZED_TEXT = 'Unrecognized duration. Use a number for minutes, or combine units d/h/m/s, e.g. 1h30m.';
const DURATION_HINT_TOO_LARGE_TEXT = 'That duration is too large to record.';
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
 * Wires a free-form duration input to a hint element and a confirm button: parses on
 * every keystroke, disables the confirm button while the input is unparseable, and
 * shows a live "parsed to" hint otherwise. `getDurationMinutes` returns `null` for input
 * that cannot be parsed, so callers reached by other means than the confirm button (the
 * Enter key, say) cannot mistake a rejected duration for zero.
 *
 * Rejection is reported only once typing pauses or focus leaves. Validating on every
 * keystroke but reporting immediately would flash an error while "5h12m" is still being
 * typed, since "5h1" is not yet valid.
 */
export function wireDurationInput(
    inputElement: HTMLInputElement,
    hintElement: HTMLElement,
    confirmButton: HTMLButtonElement
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
            confirmButton.disabled = false;
            return;
        }

        const result = parseDuration(inputElement.value);
        confirmButton.disabled = result.status !== 'parsed';

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

    inputElement.addEventListener('input', update);
    inputElement.addEventListener('blur', flushError);
    update();

    return {
        getDurationMinutes: () => {
            const result = parseDuration(inputElement.value);
            return result.status === 'parsed' ? result.minutes : null;
        },
    };
}
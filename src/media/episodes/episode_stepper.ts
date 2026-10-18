import { formatCompactDuration, parseDuration, withEpisodeCount } from '../../time';

const PRECISE_POINTER_MEDIA_QUERY = '(hover: hover) and (pointer: fine)';
const STEPPING_FIELD_CLASS = 'has-inline-actions';

function hasPrecisePointer(): boolean {
    return globalThis.matchMedia?.(PRECISE_POINTER_MEDIA_QUERY).matches ?? false;
}

export interface EpisodeStepperElements {
    durationField: HTMLElement;
    decrementButton: HTMLButtonElement;
    incrementButton: HTMLButtonElement;
    episodeDurationHint: HTMLElement;
    episodeDurationLabel: HTMLElement;
}

export function wireEpisodeStepper(
    elements: EpisodeStepperElements,
    durationInput: HTMLInputElement,
    getEpisodeDurationMinutes: () => number | null,
): { refresh: () => void } {
    const { durationField, decrementButton, incrementButton, episodeDurationHint, episodeDurationLabel } = elements;

    const readEpisodeCount = (): number | null => {
        const episodeDurationMinutes = getEpisodeDurationMinutes();
        if (episodeDurationMinutes === null) return null;
        const result = parseDuration(durationInput.value, episodeDurationMinutes);
        return result.status === 'parsed' ? result.episodeCount : null;
    };

    const refresh = () => {
        const episodeDurationMinutes = getEpisodeDurationMinutes();
        const isEpisodic = episodeDurationMinutes !== null;
        durationField.classList.toggle(STEPPING_FIELD_CLASS, isEpisodic);
        decrementButton.hidden = !isEpisodic;
        incrementButton.hidden = !isEpisodic;

        const episodeCount = readEpisodeCount();
        episodeDurationHint.hidden = !isEpisodic;
        if (episodeDurationMinutes !== null) {
            episodeDurationLabel.textContent = formatCompactDuration(episodeDurationMinutes);
        }
        decrementButton.disabled = episodeCount === null || episodeCount === 0;
        incrementButton.disabled = episodeCount === null;
    };

    const stepEpisodeCount = (delta: number) => {
        const episodeCount = readEpisodeCount();
        if (episodeCount === null) return;
        durationInput.value = withEpisodeCount(durationInput.value, Math.max(0, episodeCount + delta));
        durationInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (hasPrecisePointer()) durationInput.focus();
    };

    decrementButton.addEventListener('click', () => stepEpisodeCount(-1));
    incrementButton.addEventListener('click', () => stepEpisodeCount(1));
    durationInput.addEventListener('input', refresh);
    refresh();

    return { refresh };
}

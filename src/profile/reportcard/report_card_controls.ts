import { html } from '../../html';
import { Logger } from '../../logger';
import { customAlert } from '../../modal_base';
import { getServices } from '../../services';
import type { ActivitySummary, Media, ProfilePicture } from '../../types';
import { getProfileInitials, profilePictureToDataUrl } from '../profile_picture';
import { aggregateCategorySlices } from './report_card_data';
import type { ReportCardDimension, ReportCardMetric } from './report_card_data';
import {
    buildReportCardFileName,
    renderReportCardImage,
    resolveReportCardThemeColors,
} from './report_card_image';

/** The slice of profile state the report-card cards need to render. */
export interface ReportCardData {
    profileName: string;
    profilePicture: ProfilePicture | null;
    logs: ActivitySummary[];
    mediaList: Media[];
}

const METRIC_TIME_SELECTOR = '#report-card-metric-time';
const METRIC_CHARACTERS_SELECTOR = '#report-card-metric-characters';

const DIMENSION_TITLES: Record<ReportCardDimension, string> = {
    activity: 'Activity breakdown',
    content: 'Content breakdown',
};

/** Card subtitle naming the grouping dimension; the active metric lives in the footer. */
export function reportCardSubtitle(dimension: ReportCardDimension): string {
    return DIMENSION_TITLES[dimension];
}

/** Markup for the "Business Card" panel: the two save buttons plus the Time/Chars metric toggle. */
export function renderReportCardButtons(hasLoggedTime: boolean): HTMLElement {
    const disabledAttribute = hasLoggedTime ? '' : 'disabled';
    return html`
        <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
            <h3 style="margin: 0;">Business Card</h3>
            <div style="display: flex; gap: 1rem;">
                <button class="btn btn-primary" id="profile-btn-save-card-activity" style="flex: 1;" ${disabledAttribute}>Save Card: Activity</button>
                <button class="btn btn-primary" id="profile-btn-save-card-content" style="flex: 1;" ${disabledAttribute}>Save Card: Content</button>
            </div>
            <div class="toggle" role="group" aria-label="Percentage basis" style="align-self: center;">
                <button type="button" class="toggle-option is-active" id="report-card-metric-time" aria-pressed="true">Time</button>
                <button type="button" class="toggle-option" id="report-card-metric-characters" aria-pressed="false">Char</button>
            </div>
        </div>
    `;
}

/** Aggregates, renders and saves one report-card PNG for the requested dimension and metric. */
export async function saveReportCard(variant: ReportCardDimension, data: ReportCardData, metric: ReportCardMetric): Promise<void> {
    const slices = aggregateCategorySlices(data.logs, data.mediaList, variant, metric);
    if (slices.length === 0) {
        await customAlert('Nothing to show', 'There is no logged time to build this card yet.');
        return;
    }

    const imageBlob = await renderReportCardImage({
        profileName: data.profileName,
        profilePictureDataUrl: profilePictureToDataUrl(data.profilePicture),
        initials: getProfileInitials(data.profileName),
        subtitle: reportCardSubtitle(variant),
        slices,
        generatedAtIso: new Date().toISOString(),
        themeColors: resolveReportCardThemeColors(),
        metric,
    });
    const fileName = buildReportCardFileName(data.profileName, variant);
    const saved = await getServices().saveReportCardImage(imageBlob, fileName);
    if (saved) {
        await customAlert('Success', 'Report card image saved.');
    }
}

/**
 * Wires the two save buttons inside `root`, applying the busy-button idiom
 * (disable + "Saving..." while the PNG is built). `getData` is called per click
 * so the latest profile state is used. The active metric is read from the
 * Time/Characters segmented toggle at click time.
 */
export function wireReportCardButtons(root: HTMLElement, getData: () => ReportCardData): void {
    const isCharactersActive = (): boolean =>
        root.querySelector(METRIC_CHARACTERS_SELECTOR)?.classList.contains('is-active') ?? false;

    const wireButton = (selector: string, variant: ReportCardDimension) => {
        root.querySelector(selector)?.addEventListener('click', async () => {
            const button = root.querySelector(selector) as HTMLButtonElement;
            const originalText = button.innerText;
            button.disabled = true;
            button.innerText = 'Saving...';
            try {
                const metric: ReportCardMetric = isCharactersActive() ? 'characters' : 'time';
                await saveReportCard(variant, getData(), metric);
            } catch (error) {
                Logger.error('[report-card] save failed:', error);
                await customAlert('Error', 'Failed to save report card image.');
            } finally {
                button.disabled = false;
                button.innerText = originalText;
            }
        });
    };
    wireButton('#profile-btn-save-card-activity', 'activity');
    wireButton('#profile-btn-save-card-content', 'content');

    const timeOption = root.querySelector(METRIC_TIME_SELECTOR);
    const charactersOption = root.querySelector(METRIC_CHARACTERS_SELECTOR);
    const selectMetric = (metric: ReportCardMetric) => {
        timeOption?.classList.toggle('is-active', metric === 'time');
        timeOption?.setAttribute('aria-pressed', String(metric === 'time'));
        charactersOption?.classList.toggle('is-active', metric === 'characters');
        charactersOption?.setAttribute('aria-pressed', String(metric === 'characters'));
    };
    timeOption?.addEventListener('click', () => selectMetric('time'));
    charactersOption?.addEventListener('click', () => selectMetric('characters'));
}
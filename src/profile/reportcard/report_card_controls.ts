import { html } from '../../html';
import { Logger } from '../../logger';
import { customAlert } from '../../modal_base';
import { getServices } from '../../services';
import type { ActivitySummary, Media, ProfilePicture } from '../../types';
import { getProfileInitials, profilePictureToDataUrl } from '../profile_picture';
import { aggregateTimeByCategory } from './report_card_data';
import type { ReportCardDimension } from './report_card_data';
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

const CARD_SUBTITLES: Record<ReportCardDimension, string> = {
    activity: 'Time by activity',
    content: 'Time by content',
};

/** Markup for the two side-by-side "Save Card" buttons shown above the report widget. */
export function renderReportCardButtons(hasLoggedTime: boolean): HTMLElement {
    const disabledAttribute = hasLoggedTime ? '' : 'disabled';
    return html`
        <div style="display: flex; gap: 1rem;">
            <button class="btn btn-primary" id="profile-btn-save-card-activity" style="flex: 1;" ${disabledAttribute}>Save Card — Activity</button>
            <button class="btn btn-primary" id="profile-btn-save-card-content" style="flex: 1;" ${disabledAttribute}>Save Card — Content</button>
        </div>
    `;
}

/** Aggregates, renders and saves one report-card PNG for the requested dimension. */
export async function saveReportCard(variant: ReportCardDimension, data: ReportCardData): Promise<void> {
    const slices = aggregateTimeByCategory(data.logs, data.mediaList, variant);
    if (slices.length === 0) {
        await customAlert('Nothing to show', 'There is no logged time to build this card yet.');
        return;
    }

    const imageBlob = await renderReportCardImage({
        profileName: data.profileName,
        profilePictureDataUrl: profilePictureToDataUrl(data.profilePicture),
        initials: getProfileInitials(data.profileName),
        subtitle: CARD_SUBTITLES[variant],
        slices,
        generatedAtIso: new Date().toISOString(),
        themeColors: resolveReportCardThemeColors(),
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
 * so the latest profile state is used.
 */
export function wireReportCardButtons(root: HTMLElement, getData: () => ReportCardData): void {
    const wireButton = (selector: string, variant: ReportCardDimension) => {
        root.querySelector(selector)?.addEventListener('click', async () => {
            const button = root.querySelector(selector) as HTMLButtonElement;
            const originalText = button.innerText;
            button.disabled = true;
            button.innerText = 'Saving...';
            try {
                await saveReportCard(variant, getData());
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
}
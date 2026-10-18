import { html, rawHtml } from '../../html';
import { Logger } from '../../logger';
import { customAlert } from '../../modal_base';
import { getServices } from '../../services';
import { openPopupMenu, type PopupMenuItem } from '../../popups';
import { CLOCK, DOWNLOAD, HIRAGANA_KE, renderIcon } from '../../icons';
import type { ActivitySummary, Media, ProfilePicture } from '../../types';
import { getProfileInitials, profilePictureToDataUrl } from '../../profile/profile_picture';
import { aggregateCategorySlices } from './report_card_data';
import type { ReportCardDimension, ReportCardMetric } from './report_card_data';
import {
    buildReportCardFileName,
    renderReportCardImage,
    resolveReportCardThemeColors,
} from './report_card_image';

export interface ReportCardData {
    profileName: string;
    profilePicture: ProfilePicture | null;
    logs: ActivitySummary[];
    mediaList: Media[];
}

const DIMENSION_TITLES: Record<ReportCardDimension, string> = {
    activity: 'Activity breakdown',
    content: 'Content breakdown',
};

export function reportCardSubtitle(dimension: ReportCardDimension): string {
    return DIMENSION_TITLES[dimension];
}

const BUSINESS_CARD_BUTTON_ID = 'dashboard-business-card-button';
const BUSINESS_CARD_BUTTON_LABEL_SELECTOR = '.dashboard-business-card-button-label';
const BUSINESS_CARD_BUTTON_ICON_SIZE_PX = 14;

export type BusinessCardActionId = `${ReportCardDimension}-${ReportCardMetric}`;

interface BusinessCardMenuEntry {
    actionId: BusinessCardActionId;
    label: string;
    dimension: ReportCardDimension;
    metric: ReportCardMetric;
    separatorBefore?: boolean;
}

const BUSINESS_CARD_METRIC_ICONS: Record<ReportCardMetric, string> = {
    time: CLOCK,
    characters: HIRAGANA_KE,
};

const BUSINESS_CARD_MENU_ENTRIES: readonly BusinessCardMenuEntry[] = [
    { actionId: 'activity-time', label: 'Activity · Time', dimension: 'activity', metric: 'time' },
    { actionId: 'activity-characters', label: 'Activity · Chars', dimension: 'activity', metric: 'characters' },
    { actionId: 'content-time', label: 'Content · Time', dimension: 'content', metric: 'time', separatorBefore: true },
    { actionId: 'content-characters', label: 'Content · Chars', dimension: 'content', metric: 'characters' },
];

export function renderBusinessCardButton(hasLoggedTime: boolean): HTMLElement {
    const disabledAttribute = hasLoggedTime ? '' : 'disabled';
    return html`
        <button type="button" class="btn btn-primary dashboard-business-card-button" id="${BUSINESS_CARD_BUTTON_ID}" ${disabledAttribute}>${rawHtml(renderIcon(DOWNLOAD, BUSINESS_CARD_BUTTON_ICON_SIZE_PX))}<span class="dashboard-business-card-button-label">Save business card</span></button>
    `;
}

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

async function runBusinessCardSave(
    button: HTMLButtonElement,
    entry: BusinessCardMenuEntry,
    getData: () => Promise<ReportCardData>,
): Promise<void> {
    const label = button.querySelector<HTMLElement>(BUSINESS_CARD_BUTTON_LABEL_SELECTOR) ?? button;
    const originalText = label.textContent;
    button.disabled = true;
    label.textContent = 'Saving...';
    try {
        const data = await getData();
        await saveReportCard(entry.dimension, data, entry.metric);
    } catch (error) {
        Logger.error('[report-card] save failed:', error);
        await customAlert('Error', 'Failed to save report card image.');
    } finally {
        button.disabled = false;
        label.textContent = originalText;
    }
}

export function wireBusinessCardButton(root: HTMLElement, getData: () => Promise<ReportCardData>): void {
    const button = root.querySelector<HTMLButtonElement>(`#${BUSINESS_CARD_BUTTON_ID}`);
    if (!button) return;

    button.addEventListener('click', event => {
        const items: PopupMenuItem[] = BUSINESS_CARD_MENU_ENTRIES.map(entry => ({
            actionId: entry.actionId,
            label: entry.label,
            iconMarkup: BUSINESS_CARD_METRIC_ICONS[entry.metric],
            separatorBefore: entry.separatorBefore,
            onSelect: () => { void runBusinessCardSave(button, entry, getData); },
        }));
        openPopupMenu({
            label: 'Save business card',
            anchor: event.detail === 0
                ? { kind: 'element', element: button, align: 'end' }
                : { kind: 'point', clientX: event.clientX, clientY: event.clientY },
            items,
        });
    });
}
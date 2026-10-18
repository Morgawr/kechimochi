import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportCardData } from '../../../src/dashboard/reportcard/report_card_controls';
import {
    renderBusinessCardButton,
    reportCardSubtitle,
    saveReportCard,
    wireBusinessCardButton,
} from '../../../src/dashboard/reportcard/report_card_controls';
import type { PopupMenuItem } from '../../../src/popups';
import { CLOCK, HIRAGANA_KE } from '../../../src/icons';

const mocks = vi.hoisted(() => ({
    aggregateCategorySlices: vi.fn(),
    buildReportCardFileName: vi.fn(),
    customAlert: vi.fn(),
    loggerError: vi.fn(),
    renderReportCardImage: vi.fn(),
    resolveReportCardThemeColors: vi.fn(),
    saveReportCardImage: vi.fn(),
    openPopupMenu: vi.fn(),
}));

vi.mock('../../../src/dashboard/reportcard/report_card_data', () => ({
    aggregateCategorySlices: mocks.aggregateCategorySlices,
}));

vi.mock('../../../src/dashboard/reportcard/report_card_image', () => ({
    buildReportCardFileName: mocks.buildReportCardFileName,
    renderReportCardImage: mocks.renderReportCardImage,
    resolveReportCardThemeColors: mocks.resolveReportCardThemeColors,
}));

vi.mock('../../../src/services', () => ({
    getServices: () => ({ saveReportCardImage: mocks.saveReportCardImage }),
}));

vi.mock('../../../src/modal_base', () => ({
    customAlert: mocks.customAlert,
}));

vi.mock('../../../src/logger', () => ({
    Logger: { error: mocks.loggerError },
}));

vi.mock('../../../src/popups', () => ({
    openPopupMenu: mocks.openPopupMenu,
}));

describe('report card controls', () => {
    const slices = [{ label: 'Reading', minutes: 90, characters: 5000, percent: 100 }];
    const themeColors = {
        backgroundColor: '#111111',
        cardBackgroundColor: '#222222',
        primaryTextColor: '#ffffff',
        secondaryTextColor: '#aaaaaa',
        borderColor: '#333333',
        chartColors: ['#ff0000'],
    };
    const imageBlob = new Blob(['report-card'], { type: 'image/png' });

    function buildData(overrides: Partial<ReportCardData> = {}): ReportCardData {
        return {
            profileName: 'Alice Example',
            profilePicture: {
                mime_type: 'image/png',
                base64_data: 'avatar-data',
                byte_size: 11,
                width: 1,
                height: 1,
                updated_at: '2026-07-21T00:00:00Z',
            },
            logs: [],
            mediaList: [],
            ...overrides,
        };
    }

    function openedMenuItems(): PopupMenuItem[] {
        return mocks.openPopupMenu.mock.calls.at(-1)![0].items as PopupMenuItem[];
    }

    function selectMenuItem(actionId: string): void {
        openedMenuItems().find(item => item.actionId === actionId)!.onSelect();
    }

    function containerOf(button: HTMLElement): HTMLElement {
        const container = document.createElement('div');
        container.appendChild(button);
        return container;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.aggregateCategorySlices.mockReturnValue(slices);
        mocks.resolveReportCardThemeColors.mockReturnValue(themeColors);
        mocks.renderReportCardImage.mockResolvedValue(imageBlob);
        mocks.buildReportCardFileName.mockReturnValue('kechimochi_card_activity_Alice_Example.png');
        mocks.saveReportCardImage.mockResolvedValue(true);
        mocks.customAlert.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('reportCardSubtitle', () => {
        it('names the grouping dimension', () => {
            expect(reportCardSubtitle('activity')).toBe('Activity breakdown');
            expect(reportCardSubtitle('content')).toBe('Content breakdown');
        });
    });

    it('renders an enabled business card button when logged time is available', () => {
        const button = renderBusinessCardButton(true);

        expect(button.id).toBe('dashboard-business-card-button');
        expect(button.textContent).toContain('Save business card');
        expect((button as HTMLButtonElement).disabled).toBe(false);
    });

    it('disables the button when no time has been logged', () => {
        const button = renderBusinessCardButton(false);

        expect((button as HTMLButtonElement).disabled).toBe(true);
    });

    it('alerts without rendering when aggregation produces no slices', async () => {
        mocks.aggregateCategorySlices.mockReturnValue([]);
        const data = buildData();

        await saveReportCard('activity', data, 'time');

        expect(mocks.aggregateCategorySlices).toHaveBeenCalledWith(data.logs, data.mediaList, 'activity', 'time');
        expect(mocks.customAlert).toHaveBeenCalledWith(
            'Nothing to show',
            'There is no logged time to build this card yet.',
        );
        expect(mocks.renderReportCardImage).not.toHaveBeenCalled();
        expect(mocks.saveReportCardImage).not.toHaveBeenCalled();
    });

    it('builds, saves, and confirms an activity report card', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-21T12:34:56.000Z'));
        const data = buildData();

        await saveReportCard('activity', data, 'time');

        expect(mocks.renderReportCardImage).toHaveBeenCalledWith({
            profileName: 'Alice Example',
            profilePictureDataUrl: 'data:image/png;base64,avatar-data',
            initials: 'AE',
            subtitle: 'Activity breakdown',
            slices,
            generatedAtIso: '2026-07-21T12:34:56.000Z',
            themeColors,
            metric: 'time',
        });
        expect(mocks.buildReportCardFileName).toHaveBeenCalledWith('Alice Example', 'activity');
        expect(mocks.saveReportCardImage).toHaveBeenCalledWith(
            imageBlob,
            'kechimochi_card_activity_Alice_Example.png',
        );
        expect(mocks.customAlert).toHaveBeenCalledWith('Success', 'Report card image saved.');
    });

    it('threads the characters metric through aggregation and rendering', async () => {
        const data = buildData();

        await saveReportCard('content', data, 'characters');

        expect(mocks.aggregateCategorySlices).toHaveBeenCalledWith(data.logs, data.mediaList, 'content', 'characters');
        expect(mocks.renderReportCardImage).toHaveBeenCalledWith(expect.objectContaining({
            subtitle: 'Content breakdown',
            metric: 'characters',
        }));
    });

    it('uses the content subtitle and does not claim success when saving is cancelled', async () => {
        mocks.saveReportCardImage.mockResolvedValue(false);

        await saveReportCard('content', buildData({ profilePicture: null }), 'time');

        expect(mocks.aggregateCategorySlices).toHaveBeenCalledWith([], [], 'content', 'time');
        expect(mocks.renderReportCardImage).toHaveBeenCalledWith(expect.objectContaining({
            profilePictureDataUrl: null,
            subtitle: 'Content breakdown',
        }));
        expect(mocks.customAlert).not.toHaveBeenCalled();
    });

    it('opens a menu with the four dimension/metric outputs on click', () => {
        const button = renderBusinessCardButton(true);
        wireBusinessCardButton(containerOf(button),async () => buildData());

        button.click();

        expect(mocks.openPopupMenu).toHaveBeenCalledOnce();
        const items = openedMenuItems();
        expect(items.map(item => item.actionId)).toEqual([
            'activity-time',
            'activity-characters',
            'content-time',
            'content-characters',
        ]);
        expect(items.find(item => item.actionId === 'content-time')?.separatorBefore).toBe(true);
    });

    it('fetches fresh data and restores the busy button state after saving a selection', async () => {
        let resolveRender!: (blob: Blob) => void;
        mocks.renderReportCardImage.mockReturnValue(new Promise(resolve => {
            resolveRender = resolve;
        }));
        const button = renderBusinessCardButton(true) as HTMLButtonElement;
        const getData = vi.fn(async () => buildData());
        wireBusinessCardButton(containerOf(button),getData);
        const originalText = button.innerText;

        button.click();
        selectMenuItem('activity-time');
        await vi.waitFor(() => expect(getData).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(button.disabled).toBe(true));
        expect(button.innerText).toBe('Saving...');

        resolveRender(imageBlob);
        await vi.waitFor(() => expect(mocks.saveReportCardImage).toHaveBeenCalledOnce());
        expect(button.disabled).toBe(false);
        expect(button.innerText).toBe(originalText);
    });

    it('threads the selected menu entry dimension and metric into the save', async () => {
        const button = renderBusinessCardButton(true);
        wireBusinessCardButton(containerOf(button),async () => buildData());

        button.click();
        selectMenuItem('content-characters');

        await vi.waitFor(() => expect(mocks.aggregateCategorySlices).toHaveBeenCalledWith([], [], 'content', 'characters'));
    });

    it('reports save failures and still restores the button', async () => {
        const failure = new Error('canvas failed');
        mocks.renderReportCardImage.mockRejectedValue(failure);
        const button = renderBusinessCardButton(true) as HTMLButtonElement;
        wireBusinessCardButton(containerOf(button),async () => buildData());
        const originalText = button.innerText;

        button.click();
        selectMenuItem('activity-time');

        await vi.waitFor(() => expect(mocks.customAlert).toHaveBeenCalledWith(
            'Error',
            'Failed to save report card image.',
        ));
        expect(mocks.loggerError).toHaveBeenCalledWith('[report-card] save failed:', failure);
        expect(button.disabled).toBe(false);
        expect(button.innerText).toBe(originalText);
    });

    it('does nothing when the business card button is absent', () => {
        expect(() => wireBusinessCardButton(document.createElement('div'), async () => buildData())).not.toThrow();
    });

    it('carries the clock icon on the time entries and the hiragana-ke icon on the characters entries', () => {
        const button = renderBusinessCardButton(true);
        wireBusinessCardButton(containerOf(button),async () => buildData());

        button.click();

        const items = openedMenuItems();
        expect(items.find(item => item.actionId === 'activity-time')?.iconMarkup).toBe(CLOCK);
        expect(items.find(item => item.actionId === 'content-time')?.iconMarkup).toBe(CLOCK);
        expect(items.find(item => item.actionId === 'activity-characters')?.iconMarkup).toBe(HIRAGANA_KE);
        expect(items.find(item => item.actionId === 'content-characters')?.iconMarkup).toBe(HIRAGANA_KE);
    });

    it('opens the menu at the click point for a mouse click', () => {
        const button = renderBusinessCardButton(true);
        wireBusinessCardButton(containerOf(button),async () => buildData());

        button.dispatchEvent(new MouseEvent('click', { detail: 1, clientX: 123, clientY: 456 }));

        expect(mocks.openPopupMenu).toHaveBeenCalledWith(expect.objectContaining({
            anchor: { kind: 'point', clientX: 123, clientY: 456 },
        }));
    });

    it('anchors the menu to the button for a keyboard-activated click', () => {
        const button = renderBusinessCardButton(true);
        wireBusinessCardButton(containerOf(button),async () => buildData());

        button.dispatchEvent(new MouseEvent('click', { detail: 0, clientX: 0, clientY: 0 }));

        expect(mocks.openPopupMenu).toHaveBeenCalledWith(expect.objectContaining({
            anchor: { kind: 'element', element: button, align: 'end' },
        }));
    });

    it('swaps only the label span into "Saving..." while busy, leaving the icon svg untouched', async () => {
        let resolveRender!: (blob: Blob) => void;
        mocks.renderReportCardImage.mockReturnValue(new Promise(resolve => {
            resolveRender = resolve;
        }));
        const button = renderBusinessCardButton(true) as HTMLButtonElement;
        wireBusinessCardButton(containerOf(button),async () => buildData());
        const iconBefore = button.querySelector('svg');
        expect(iconBefore).not.toBeNull();

        button.click();
        selectMenuItem('activity-time');
        await vi.waitFor(() => expect(button.disabled).toBe(true));

        expect(button.querySelector('.dashboard-business-card-button-label')?.textContent).toBe('Saving...');
        expect(button.querySelector('svg')).toBe(iconBefore);

        resolveRender(imageBlob);
        await vi.waitFor(() => expect(button.disabled).toBe(false));
        expect(button.querySelector('.dashboard-business-card-button-label')?.textContent).toBe('Save business card');
        expect(button.querySelector('svg')).toBe(iconBefore);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportCardData } from '../../../src/profile/reportcard/report_card_controls';
import {
    renderReportCardButtons,
    reportCardSubtitle,
    saveReportCard,
    wireReportCardButtons,
} from '../../../src/profile/reportcard/report_card_controls';

const mocks = vi.hoisted(() => ({
    aggregateCategorySlices: vi.fn(),
    buildReportCardFileName: vi.fn(),
    customAlert: vi.fn(),
    loggerError: vi.fn(),
    renderReportCardImage: vi.fn(),
    resolveReportCardThemeColors: vi.fn(),
    saveReportCardImage: vi.fn(),
}));

vi.mock('../../../src/profile/reportcard/report_card_data', () => ({
    aggregateCategorySlices: mocks.aggregateCategorySlices,
}));

vi.mock('../../../src/profile/reportcard/report_card_image', () => ({
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

    it('renders a Business Card panel with enabled save buttons when logged time is available', () => {
        const root = renderReportCardButtons(true);

        expect(root.classList.contains('card')).toBe(true);
        expect(root.textContent).toContain('Business Card');
        expect(root.querySelectorAll('button.btn-primary')).toHaveLength(2);
        expect((root.querySelector('#profile-btn-save-card-activity') as HTMLButtonElement).disabled).toBe(false);
        expect((root.querySelector('#profile-btn-save-card-content') as HTMLButtonElement).disabled).toBe(false);
        expect(root.textContent).toContain('Save Card: Activity');
        expect(root.textContent).toContain('Save Card: Content');
    });

    it('disables both save buttons when no time has been logged', () => {
        const root = renderReportCardButtons(false);

        const saveButtons = root.querySelectorAll<HTMLButtonElement>('button.btn-primary');
        expect(saveButtons).toHaveLength(2);
        expect(Array.from(saveButtons).every(button => button.disabled)).toBe(true);
    });

    it('renders the Time/Characters metric toggle defaulting to time', () => {
        const root = renderReportCardButtons(true);

        const timeOption = root.querySelector('#report-card-metric-time') as HTMLButtonElement;
        const charactersOption = root.querySelector('#report-card-metric-characters') as HTMLButtonElement;
        expect(timeOption).not.toBeNull();
        expect(charactersOption).not.toBeNull();
        expect(timeOption.classList.contains('is-active')).toBe(true);
        expect(charactersOption.classList.contains('is-active')).toBe(false);
        expect(root.textContent).toContain('Time');
        expect(root.textContent).toContain('Char');
    });

    it('activates the clicked metric option', () => {
        const root = renderReportCardButtons(true);
        wireReportCardButtons(root, () => buildData());
        const timeOption = root.querySelector('#report-card-metric-time') as HTMLButtonElement;
        const charactersOption = root.querySelector('#report-card-metric-characters') as HTMLButtonElement;

        expect(timeOption.classList.contains('is-active')).toBe(true);
        expect(charactersOption.classList.contains('is-active')).toBe(false);

        charactersOption.click();

        expect(timeOption.classList.contains('is-active')).toBe(false);
        expect(charactersOption.classList.contains('is-active')).toBe(true);

        timeOption.click();

        expect(timeOption.classList.contains('is-active')).toBe(true);
        expect(charactersOption.classList.contains('is-active')).toBe(false);
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

    it('uses fresh data for each click and restores the busy button state after saving', async () => {
        let resolveRender!: (blob: Blob) => void;
        mocks.renderReportCardImage.mockReturnValue(new Promise(resolve => {
            resolveRender = resolve;
        }));
        const root = renderReportCardButtons(true);
        const getData = vi.fn(() => buildData());
        wireReportCardButtons(root, getData);
        const button = root.querySelector('#profile-btn-save-card-activity') as HTMLButtonElement;
        const originalText = button.innerText;

        button.click();

        expect(getData).toHaveBeenCalledOnce();
        expect(button.disabled).toBe(true);
        expect(button.innerText).toBe('Saving...');

        resolveRender(imageBlob);
        await vi.waitFor(() => expect(mocks.saveReportCardImage).toHaveBeenCalledOnce());
        expect(button.disabled).toBe(false);
        expect(button.innerText).toBe(originalText);
    });

    it('wires the content button to the content variant', async () => {
        const root = renderReportCardButtons(true);
        wireReportCardButtons(root, () => buildData());

        (root.querySelector('#profile-btn-save-card-content') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(mocks.aggregateCategorySlices).toHaveBeenCalledWith([], [], 'content', 'time'));
    });

    it('reads the active metric option at click time and passes it to saveReportCard', async () => {
        const root = renderReportCardButtons(true);
        wireReportCardButtons(root, () => buildData());
        (root.querySelector('#report-card-metric-characters') as HTMLButtonElement).click();

        (root.querySelector('#profile-btn-save-card-activity') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(mocks.aggregateCategorySlices).toHaveBeenCalledWith([], [], 'activity', 'characters'));
    });

    it('reports save failures and still restores the button', async () => {
        const failure = new Error('canvas failed');
        mocks.renderReportCardImage.mockRejectedValue(failure);
        const root = renderReportCardButtons(true);
        wireReportCardButtons(root, () => buildData());
        const button = root.querySelector('#profile-btn-save-card-activity') as HTMLButtonElement;
        const originalText = button.innerText;

        button.click();

        await vi.waitFor(() => expect(mocks.customAlert).toHaveBeenCalledWith(
            'Error',
            'Failed to save report card image.',
        ));
        expect(mocks.loggerError).toHaveBeenCalledWith('[report-card] save failed:', failure);
        expect(button.disabled).toBe(false);
        expect(button.innerText).toBe(originalText);
    });

    it('does nothing when a report-card button is absent', () => {
        expect(() => wireReportCardButtons(document.createElement('div'), () => buildData())).not.toThrow();
    });
});
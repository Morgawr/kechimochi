import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportCardData } from '../../../src/profile/reportcard/report_card_controls';
import {
    renderReportCardButtons,
    saveReportCard,
    wireReportCardButtons,
} from '../../../src/profile/reportcard/report_card_controls';

const mocks = vi.hoisted(() => ({
    aggregateTimeByCategory: vi.fn(),
    buildReportCardFileName: vi.fn(),
    customAlert: vi.fn(),
    loggerError: vi.fn(),
    renderReportCardImage: vi.fn(),
    resolveReportCardThemeColors: vi.fn(),
    saveReportCardImage: vi.fn(),
}));

vi.mock('../../../src/profile/reportcard/report_card_data', () => ({
    aggregateTimeByCategory: mocks.aggregateTimeByCategory,
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
    const slices = [{ label: 'Reading', minutes: 90, percent: 100 }];
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
            },
            logs: [],
            mediaList: [],
            ...overrides,
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.aggregateTimeByCategory.mockReturnValue(slices);
        mocks.resolveReportCardThemeColors.mockReturnValue(themeColors);
        mocks.renderReportCardImage.mockResolvedValue(imageBlob);
        mocks.buildReportCardFileName.mockReturnValue('kechimochi_card_activity_Alice_Example.png');
        mocks.saveReportCardImage.mockResolvedValue(true);
        mocks.customAlert.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders enabled save buttons when logged time is available', () => {
        const root = renderReportCardButtons(true);

        expect(root.querySelectorAll('button')).toHaveLength(2);
        expect((root.querySelector('#profile-btn-save-card-activity') as HTMLButtonElement).disabled).toBe(false);
        expect((root.querySelector('#profile-btn-save-card-content') as HTMLButtonElement).disabled).toBe(false);
        expect(root.textContent).toContain('Save Card — Activity');
        expect(root.textContent).toContain('Save Card — Content');
    });

    it('disables both save buttons when no time has been logged', () => {
        const root = renderReportCardButtons(false);

        expect(Array.from(root.querySelectorAll('button')).every(button => button.disabled)).toBe(true);
    });

    it('alerts without rendering when aggregation produces no slices', async () => {
        mocks.aggregateTimeByCategory.mockReturnValue([]);
        const data = buildData();

        await saveReportCard('activity', data);

        expect(mocks.aggregateTimeByCategory).toHaveBeenCalledWith(data.logs, data.mediaList, 'activity');
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

        await saveReportCard('activity', data);

        expect(mocks.renderReportCardImage).toHaveBeenCalledWith({
            profileName: 'Alice Example',
            profilePictureDataUrl: 'data:image/png;base64,avatar-data',
            initials: 'AE',
            subtitle: 'Time by activity',
            slices,
            generatedAtIso: '2026-07-21T12:34:56.000Z',
            themeColors,
        });
        expect(mocks.buildReportCardFileName).toHaveBeenCalledWith('Alice Example', 'activity');
        expect(mocks.saveReportCardImage).toHaveBeenCalledWith(
            imageBlob,
            'kechimochi_card_activity_Alice_Example.png',
        );
        expect(mocks.customAlert).toHaveBeenCalledWith('Success', 'Report card image saved.');
    });

    it('uses the content subtitle and does not claim success when saving is cancelled', async () => {
        mocks.saveReportCardImage.mockResolvedValue(false);

        await saveReportCard('content', buildData({ profilePicture: null }));

        expect(mocks.aggregateTimeByCategory).toHaveBeenCalledWith([], [], 'content');
        expect(mocks.renderReportCardImage).toHaveBeenCalledWith(expect.objectContaining({
            profilePictureDataUrl: null,
            subtitle: 'Time by content',
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

        await vi.waitFor(() => expect(mocks.aggregateTimeByCategory).toHaveBeenCalledWith([], [], 'content'));
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

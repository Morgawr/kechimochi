import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showLogActivityModal } from '../../src/activity_modal';
import * as api from '../../src/api';
import { ActivitySummary, Media } from '../../src/api';
import { createCancelableOverlay } from '../../src/modal_base';

vi.mock('../../src/api', () => ({
    getAllMedia: vi.fn(),
    getSetting: vi.fn(),
    addLog: vi.fn(),
    updateLog: vi.fn(),
    addMedia: vi.fn(),
    updateMedia: vi.fn(),
}));

vi.mock('../../src/modal_base', () => ({
    customPrompt: vi.fn(),
    customAlert: vi.fn(),
    createCancelableOverlay: vi.fn((onDismiss: () => void) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        document.body.appendChild(overlay);
        let isClosed = false;
        const cleanup = vi.fn(() => {
            if (isClosed) return;
            isClosed = true;
            overlay.remove();
        });
        const dismiss = vi.fn(() => {
            if (isClosed) return;
            cleanup();
            onDismiss();
        });
        return { overlay, cleanup, dismiss };
    }),
}));

const DEFAULT_MEDIA = [
    { id: 1, title: 'Test Media', status: 'Active', tracking_status: 'Ongoing' },
] as unknown as Media[];

async function openModal(editLog?: ActivitySummary): Promise<void> {
    vi.mocked(api.getAllMedia).mockResolvedValue(DEFAULT_MEDIA);
    vi.mocked(api.getSetting).mockResolvedValue(null);
    void showLogActivityModal(editLog ? undefined : 1, editLog);
    await vi.waitFor(() => {
        const form = document.querySelector('#add-activity-form');
        if (!form) throw new Error('activity form not rendered');
        return form;
    });
}

function setScope(scope: 'day' | 'month' | 'year'): void {
    document.querySelector<HTMLButtonElement>(`[data-date-scope="${scope}"]`)!.click();
}

function navigatePeriods(steps: number): void {
    const selector = steps < 0 ? '[data-calendar-nav="previous"]' : '[data-calendar-nav="next"]';
    for (let step = 0; step < Math.abs(steps); step++) {
        document.querySelector<HTMLButtonElement>(`#activity-cal-container ${selector}`)!.click();
    }
}

function dateTriggerText(): string {
    return document.querySelector('#activity-date-trigger-value')!.textContent!;
}

function pickCell(attribute: 'date' | 'month' | 'year', value: string): void {
    const cell = document.querySelector<HTMLButtonElement>(
        `#activity-cal-container [data-${attribute}="${value}"]`,
    );
    if (!cell) throw new Error(`No cell for data-${attribute}="${value}"`);
    cell.click();
}

async function submitAndGetSavedLog(): Promise<{ date: string; date_precision: string }> {
    (document.querySelector('#activity-duration') as HTMLInputElement).value = '30';
    document.querySelector('#add-activity-form')!.dispatchEvent(new Event('submit'));
    await vi.waitFor(() => expect(api.addLog).toHaveBeenCalled());
    return vi.mocked(api.addLog).mock.calls[0][0] as unknown as { date: string; date_precision: string };
}

function expectFullAnchor(saved: { date: string; date_precision: string }, date: string, date_precision: string): void {
    expect(saved.date).toHaveLength(10);
    expect(saved).toEqual(expect.objectContaining({ date, date_precision }));
}

function expectScopeMarkedSelected(scope: 'day' | 'month' | 'year'): void {
    const pressedScopes = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-date-scope]'))
        .filter(button => button.getAttribute('aria-selected') === 'true')
        .map(button => button.dataset.dateScope);
    expect(pressedScopes).toEqual([scope]);
}

describe('activity_modal date scope picker', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
        HTMLInputElement.prototype.setCustomValidity = vi.fn();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('should render the day grid after Year -> pick a non-current year -> Day', async () => {
        await openModal();

        setScope('year');
        pickCell('year', '2019');
        setScope('day');

        const dayCells = document.querySelectorAll('#activity-cal-container .cal-day');
        expect(dayCells.length).toBeGreaterThan(0);

        const saved = await submitAndGetSavedLog();
        expectFullAnchor(saved, '2019-01-01', 'day');
    });

    describe('scope transitions', () => {
        it('should carry a full anchor across Year -> Day when the picked year does not contain today', async () => {
            await openModal();
            setScope('year');
            pickCell('year', '2019');
            setScope('day');

            const saved = await submitAndGetSavedLog();
            expectFullAnchor(saved, '2019-01-01', 'day');
        });

        it('should carry a full anchor across Month -> Day when the current month contains today', async () => {
            await openModal();
            setScope('month');
            setScope('day');

            const saved = await submitAndGetSavedLog();
            expectFullAnchor(saved, '2026-06-15', 'day');
        });

        it('should carry a full anchor across Day -> Month -> Year (truncating)', async () => {
            await openModal();
            setScope('month');
            setScope('year');

            const saved = await submitAndGetSavedLog();
            expectFullAnchor(saved, '2026-01-01', 'year');
        });

        it('should let a later day pick replace an earlier month pick', async () => {
            await openModal();
            setScope('month');
            navigatePeriods(-6);
            pickCell('month', '2020-03');
            setScope('day');
            navigatePeriods(16);
            pickCell('date', '2021-07-05');
            setScope('month');

            expect(dateTriggerText()).toBe('July 2021');
            const saved = await submitAndGetSavedLog();
            expectFullAnchor(saved, '2021-07-01', 'month');
        });
    });

    describe('view and selection anchoring', () => {
        it('should adopt the viewed period when nothing has been picked', async () => {
            await openModal();

            navigatePeriods(8);
            setScope('month');

            expect(dateTriggerText()).toBe('February 2027');
            const saved = await submitAndGetSavedLog();
            expectFullAnchor(saved, '2027-02-01', 'month');
        });

        it('should keep a picked value after the view moves away from it', async () => {
            await openModal();

            navigatePeriods(-3);
            pickCell('date', '2026-03-11');
            navigatePeriods(12);
            setScope('month');

            expect(dateTriggerText()).toBe('March 2026');
            expect(document.querySelector('#activity-cal-container')!.textContent).toContain('2027');
            expect(document.querySelector('[data-month="2026-03"]')).toBeNull();

            const saved = await submitAndGetSavedLog();
            expectFullAnchor(saved, '2026-03-01', 'month');
        });

        it('should follow the selection when the view has not moved', async () => {
            await openModal();

            pickCell('date', '2026-06-20');
            setScope('month');

            expect(dateTriggerText()).toBe('This month');
            expect(document.querySelector('[data-month="2026-06"]')!.getAttribute('aria-pressed')).toBe('true');
        });
    });

    describe('edit opens', () => {
        const baseEditLog = {
            id: 1,
            media_id: 1,
            title: 'Test Media',
            activity_type: 'Reading',
            duration_minutes: 30,
            characters: 0,
            language: 'Japanese',
            notes: '',
        };

        it('should preselect the day scope and cell for a day-precision log', async () => {
            const editLog: ActivitySummary = { ...baseEditLog, date: '2026-03-05', date_precision: 'day' };
            await openModal(editLog);

            expectScopeMarkedSelected('day');
            const cell = document.querySelector('[data-date="2026-03-05"]');
            expect(cell?.getAttribute('aria-pressed')).toBe('true');
        });

        it('should preselect the month scope and cell for a month-precision log', async () => {
            const editLog: ActivitySummary = { ...baseEditLog, date: '2026-03-01', date_precision: 'month' };
            await openModal(editLog);

            expectScopeMarkedSelected('month');
            const cell = document.querySelector('[data-month="2026-03"]');
            expect(cell?.getAttribute('aria-pressed')).toBe('true');
        });

        it('should preselect the year scope and cell for a year-precision log', async () => {
            const editLog: ActivitySummary = { ...baseEditLog, date: '2026-01-01', date_precision: 'year' };
            await openModal(editLog);

            expectScopeMarkedSelected('year');
            const cell = document.querySelector('[data-year="2026"]');
            expect(cell?.getAttribute('aria-pressed')).toBe('true');
        });
    });

    it('should render the month grid for the month scope', async () => {
        await openModal();
        setScope('month');

        expect(document.querySelectorAll('#activity-cal-container .cal-month').length).toBeGreaterThan(0);
    });

    describe('date trigger', () => {
        const dateTrigger = () => document.querySelector<HTMLButtonElement>('#activity-date-trigger')!;
        const datePanel = () => document.querySelector<HTMLElement>('#activity-date-panel')!;

        it('should name the current period relatively', async () => {
            await openModal();
            expect(dateTriggerText()).toBe('Today');

            setScope('month');
            expect(dateTriggerText()).toBe('This month');

            setScope('year');
            expect(dateTriggerText()).toBe('This year');
        });

        it('should show any other date in full', async () => {
            await openModal();

            pickCell('date', '2026-06-14');

            expect(dateTriggerText()).toBe('June 14, 2026');
        });

        it('should keep the date panel hidden until the trigger is clicked', async () => {
            await openModal();
            expect(datePanel().hidden).toBe(true);
            expect(dateTrigger().getAttribute('aria-expanded')).toBe('false');

            dateTrigger().click();
            expect(datePanel().hidden).toBe(false);
            expect(dateTrigger().getAttribute('aria-expanded')).toBe('true');

            dateTrigger().click();
            expect(datePanel().hidden).toBe(true);
        });

        it('should close the whole modal on Escape at the open date trigger', async () => {
            await openModal();
            dateTrigger().click();
            const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

            dateTrigger().dispatchEvent(escape);

            expect(escape.defaultPrevented).toBe(true);
            expect(vi.mocked(createCancelableOverlay).mock.results[0].value.dismiss).toHaveBeenCalled();
        });

        it('should keep the focus on the newly active scope tab after switching', async () => {
            await openModal();
            dateTrigger().click();

            setScope('month');

            expect(document.activeElement).toBe(document.querySelector('[data-date-scope="month"]'));
            expectScopeMarkedSelected('month');
        });

        it('should close the date modal when the screen leaves the narrow layout', async () => {
            let notifyLayoutChange: () => void = () => {};
            const layoutQuery = {
                matches: true,
                addEventListener: vi.fn((_type: string, listener: () => void) => { notifyLayoutChange = listener; }),
                removeEventListener: vi.fn(),
            };
            vi.stubGlobal('matchMedia', vi.fn(() => layoutQuery));
            await openModal();
            dateTrigger().click();

            notifyLayoutChange();

            expect(document.querySelector('#activity-date-slot')!.contains(datePanel())).toBe(true);
            expect(datePanel().hidden).toBe(true);
            expect(layoutQuery.removeEventListener).toHaveBeenCalledWith('change', notifyLayoutChange);
            vi.unstubAllGlobals();
        });

        it('should keep the date panel open after picking a date', async () => {
            await openModal();
            dateTrigger().click();

            pickCell('date', '2026-06-10');
            setScope('month');

            expect(datePanel().hidden).toBe(false);
        });

        it('should open the date panel in a modal on narrow screens and put it back on close', async () => {
            vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
            await openModal();

            dateTrigger().click();

            const dateModal = document.querySelector('[role="dialog"][aria-label="Date"]')!;
            expect(dateModal.contains(datePanel())).toBe(true);
            expect(datePanel().hidden).toBe(false);
            pickCell('date', '2026-06-10');
            expect(dateModal.contains(datePanel())).toBe(true);

            vi.mocked(createCancelableOverlay).mock.results.at(-1)!.value.dismiss();

            expect(document.querySelector('#activity-date-slot')!.contains(datePanel())).toBe(true);
            expect(datePanel().hidden).toBe(true);
            expect(dateTrigger().getAttribute('aria-expanded')).toBe('false');
            expect(document.activeElement).toBe(dateTrigger());
            expect(dateTriggerText()).toBe('June 10, 2026');
            vi.unstubAllGlobals();
        });
    });
});

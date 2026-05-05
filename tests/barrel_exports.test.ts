import { describe, expect, it, vi } from 'vitest';

vi.mock('chart.js/auto', () => ({
    default: vi.fn(),
}));

describe('public module entrypoints', () => {
    it('re-exports core helpers', async () => {
        const core = await import('../src/core');

        expect(core.Component).toBeTypeOf('function');
        expect(core.Logger).toBeTypeOf('object');
        expect(core.html).toBeTypeOf('function');
        expect(core.escapeHTML).toBeTypeOf('function');
    });

    it('re-exports component classes', async () => {
        const dashboard = await import('../src/components/dashboard/index');
        const media = await import('../src/components/media/index');
        const components = await import('../src/components');

        expect(dashboard.ActivityCharts).toBeTypeOf('function');
        expect(dashboard.HeatmapView).toBeTypeOf('function');
        expect(media.MediaDetail).toBeTypeOf('function');
        expect(media.MediaGrid).toBeTypeOf('function');
        expect(components.Dashboard).toBeTypeOf('function');
        expect(components.MediaView).toBeTypeOf('function');
        expect(components.ProfileView).toBeTypeOf('function');
        expect(components.TimelineView).toBeTypeOf('function');
    });

    it('re-exports modal, update, importer, and utility APIs', async () => {
        const modals = await import('../src/modals');
        const updates = await import('../src/updates');
        const importers = await import('../src/importers');
        const utils = await import('../src/utils');

        expect(modals.customAlert).toBeTypeOf('function');
        expect(modals.showAvailableUpdateModal).toBeTypeOf('function');
        expect(updates.UpdateManager).toBeTypeOf('function');
        expect(updates.renderReleaseNotesHtml).toBeTypeOf('function');
        expect(importers.fetchMetadataForUrl).toBeTypeOf('function');
        expect(importers.importers.length).toBeGreaterThan(0);
        expect(utils.formatHhMm).toBeTypeOf('function');
        expect(utils.setupCopyButton).toBeTypeOf('function');
    });
});

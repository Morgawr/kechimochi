import { Logger } from '../../src/core/logger';
import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { 
    getStatValue,
    deleteMostRecentLog,
    getHeatmapCellColor,
    logActivityGlobal
} from '../helpers/dashboard.js';

describe('CUJ: Activity Feedback Loop (Dashboard Management)', () => {
    before(async () => {
        await waitForAppReady();
    });

    it('should reflect deletions and new logs on the dashboard immediately', async () => {
        await navigateTo('dashboard');
        expect(await verifyActiveView('dashboard')).toBe(true);

        const initialLogsCount = await getStatValue('stat-total-logs');
        Logger.info(`Initial logs count: ${initialLogsCount}`);

        const targetDate = '2024-03-08';
        const initialCellColor = await getHeatmapCellColor(targetDate);
        
        await deleteMostRecentLog();

        const afterDeleteCount = await getStatValue('stat-total-logs');
        expect(afterDeleteCount).toBe(initialLogsCount - 1);

        const afterDeleteCellColor = await getHeatmapCellColor(targetDate);
        expect(afterDeleteCellColor).not.toBe(initialCellColor);

        const todayDate = '2024-03-31';
        await logActivityGlobal('呪術廻戦', 1000);

        const finalLogsCount = await getStatValue('stat-total-logs');
        expect(finalLogsCount).toBe(afterDeleteCount + 1);

        const todayCellColor = await getHeatmapCellColor(todayDate);
        expect(todayCellColor).not.toContain('rgba(0, 0, 0, 0)');
        expect(todayCellColor).not.toBe('');

        const currentStreak = await getStatValue('stat-current-streak');
        expect(currentStreak).toBeGreaterThanOrEqual(1);

        const dailyAvg = await getStatValue('stat-total-avg');
        expect(dailyAvg).toBeGreaterThan(0);
    });
});

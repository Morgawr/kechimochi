import { Component } from '../../core/component';
import { html } from '../../core/html';
import { ActivitySummary, Media } from '../../api';
import { formatStatsDuration } from '../../utils/time';

interface StatsCardState {
    logs: ActivitySummary[];
    mediaList: Media[];
}

export class StatsCard extends Component<StatsCardState> {
    constructor(container: HTMLElement, initialState: StatsCardState) {
        super(container, initialState);
    }

    render() {
        this.clear();
        const { logs, mediaList } = this.state;
        
        const totalLogs = logs.length;
        const totalMedia = mediaList.length;

        const uniqueDates = Array.from(new Set(logs.map(l => l.date))).sort();
        const sinceDate = uniqueDates.length > 0 ? uniqueDates[0] : 'N/A';
        const loggedDaysCount = uniqueDates.length || 1;

        const { maxStreak, currentStreak } = this.calculateStreaks(uniqueDates);
        const { mediaBreakdown, totalAvgFormat } = this.calculateBreakdown(logs, loggedDaysCount);
        const breakdownHtml = this.renderBreakdown(mediaBreakdown, loggedDaysCount);

        const content = html`
            <div style="display: flex; flex-direction: column; height: 100%;">
                <div style="text-align: center; margin-bottom: 1rem;">
                    <h3 style="color: var(--text-secondary); font-size: 1.1rem; margin: 0;">Study Stats</h3>
                    <div style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.7; margin-top: 0.2rem;">Since: ${sinceDate}</div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.75rem; flex: 1;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; width: 100%; text-align: center;">
                        <div style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                            <div id="stat-total-logs" style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${totalLogs}</div>
                            <div style="font-size: 0.65rem; color: var(--text-secondary);">logs</div>
                        </div>
                        <div style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                            <div id="stat-total-media" style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${totalMedia}</div>
                            <div style="font-size: 0.65rem; color: var(--text-secondary);">media items</div>
                        </div>
                        <div style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                            <div id="stat-max-streak" style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${maxStreak}</div>
                            <div style="font-size: 0.65rem; color: var(--text-secondary);">max streak</div>
                        </div>
                        <div style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                            <div id="stat-current-streak" style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${currentStreak}</div>
                            <div style="font-size: 0.65rem; color: var(--text-secondary);">day streak</div>
                        </div>
                    </div>
                    <div id="stat-total-avg" style="background: var(--accent-purple); padding: 0.5rem; border-radius: var(--radius-sm); text-align: center; color: var(--accent-text); font-weight: 600; font-size: 0.85rem;">
                        Total Avg: ${totalAvgFormat} / day
                    </div>
                    <div style="width: 100%; height: 1px; background: var(--border-color); margin: 0.2rem 0;"></div>
                    <div style="width: 100%; display: flex; flex-direction: column; gap: 0.4rem;">
                        ${breakdownHtml}
                    </div>
                </div>
            </div>
        `;
        this.container.appendChild(content);
    }

    private calculateStreaks(uniqueDates: string[]) {
        if (uniqueDates.length === 0) return { maxStreak: 0, currentStreak: 0 };

        let maxStreak = 1;
        let streakCount = 1;
        for (let i = 1; i < uniqueDates.length; i++) {
            const d1 = new Date(uniqueDates[i - 1]);
            const d2 = new Date(uniqueDates[i]);
            const diffInDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24));
            if (diffInDays === 1) {
                streakCount++;
                if (streakCount > maxStreak) maxStreak = streakCount;
            } else {
                streakCount = 1;
            }
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const lastLogD = new Date(uniqueDates[uniqueDates.length - 1]);
        const todayD = new Date(todayStr);
        const diffToday = Math.round((todayD.getTime() - lastLogD.getTime()) / (1000 * 3600 * 24));

        let currentStreak = 0;
        if (diffToday <= 1) {
            currentStreak = 1;
            for (let i = uniqueDates.length - 1; i >= 1; i--) {
                const currD = new Date(uniqueDates[i]);
                const prevD = new Date(uniqueDates[i - 1]);
                const diffInDays = Math.round((currD.getTime() - prevD.getTime()) / (1000 * 3600 * 24));
                if (diffInDays === 1) currentStreak++;
                else break;
            }
        }

        return { maxStreak, currentStreak };
    }

    private calculateBreakdown(logs: ActivitySummary[], loggedDaysCount: number) {
        const mediaBreakdown = new Map<string, number>();
        for (const log of logs) {
            mediaBreakdown.set(log.media_type, (mediaBreakdown.get(log.media_type) || 0) + log.duration_minutes);
        }
        
        let totalMins = 0;
        mediaBreakdown.forEach(v => { totalMins += v; });
        const totalAvgMins = totalMins / loggedDaysCount;
        
        return { 
            mediaBreakdown, 
            totalAvgFormat: formatStatsDuration(totalAvgMins) 
        };
    }

    private renderBreakdown(mediaBreakdown: Map<string, number>, loggedDaysCount: number): string {
        const sortedBreakdown = Array.from(mediaBreakdown.entries()).sort((a, b) => b[1] - a[1]);
        return sortedBreakdown.map(([mtype, mins]) => {
            const totalFormat = formatStatsDuration(mins, true);
            const avgFormat = formatStatsDuration(mins / loggedDaysCount);

            return `
                <div style="display: flex; flex-direction: column; gap: 0.2rem; background: rgba(255,255,255,0.03); padding: 0.4rem; border-radius: var(--radius-sm);">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                        <span style="color: var(--text-secondary);">${mtype}</span>
                        <span style="font-weight: bold; color: var(--text-primary);">${totalFormat}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--text-secondary); opacity: 0.8;">
                        <span>Daily Avg:</span>
                        <span>${avgFormat}</span>
                    </div>
                </div>
            `;
        }).join('');
    }
}

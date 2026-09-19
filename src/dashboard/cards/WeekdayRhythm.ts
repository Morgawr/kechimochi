import { Component } from '../../component';
import { DashboardWeekdayDistribution, DashboardWeekdayStats } from '../../api';
import { escapeHTML } from '../../html';
import { formatStatsDuration } from '../../time';
import type { DashboardCardDescriptor } from '../dashboard_layout';
import { renderDashboardCardShell } from '../card_shell';

export const WEEKDAY_RHYTHM_CARD = {
    id: 'weekday_rhythm',
    label: 'Weekday Rhythm',
    spans: { wide: 4, medium: 6 },
    dataSources: ['weekdayDistribution'],
} as const satisfies DashboardCardDescriptor;

interface WeekdayRhythmState {
    weekdayDistribution?: DashboardWeekdayDistribution;
    metric?: 'minutes' | 'characters';
    weekStartDay: number;
}

export class WeekdayRhythm extends Component<WeekdayRhythmState> {
    public setState(newState: Partial<WeekdayRhythmState>): void {
        this.state = { ...this.state, ...newState };
        this.render();
    }

    render(): void {
        this.clear();
        this.container.insertAdjacentHTML('beforeend', this.renderWeekdayDistributionPanel());
    }

    private renderWeekdayDistributionPanel(): string {
        const distribution = this.state.weekdayDistribution;
        const metric = this.state.metric ?? 'minutes';
        const emptyMetricLabel = metric === 'minutes' ? 'timed' : 'character';
        const emptyBody = `
            <div class="dashboard-weekday-empty">
                <span aria-hidden="true">◇</span>
                <p>No ${emptyMetricLabel} activity in the last 6 months.</p>
            </div>
        `;

        if (!distribution) {
            return renderDashboardCardShell({
                title: WEEKDAY_RHYTHM_CARD.label,
                body: emptyBody,
                cardClasses: ['dashboard-weekday-card'],
                attributes: { 'data-metric': metric },
            });
        }

        const daysByWeekday = new Map(distribution.days.map(day => [day.weekday, day]));
        const orderedDays = Array.from({ length: 7 }, (_, index) => {
            const weekday = (this.state.weekStartDay + index) % 7;
            return daysByWeekday.get(weekday) ?? {
                weekday,
                average_minutes: 0,
                median_minutes: 0,
                average_characters: 0,
                median_characters: 0,
                sample_days: 0,
            };
        });
        const hasActivity = orderedDays.some(day => this.getRadarAverage(day, metric) > 0);
        const body = hasActivity ? this.renderWeekdayRadar(orderedDays, metric) : emptyBody;

        return renderDashboardCardShell({
            title: WEEKDAY_RHYTHM_CARD.label,
            body,
            cardClasses: ['dashboard-weekday-card'],
            attributes: {
                'data-range-start': distribution.start_date,
                'data-range-end': distribution.end_date,
                'data-metric': metric,
            },
        });
    }

    private renderWeekdayRadar(days: DashboardWeekdayStats[], metric: 'minutes' | 'characters'): string {
        const centerX = 160;
        const centerY = 148;
        const radius = 126;
        const averages = days.map(day => this.getRadarAverage(day, metric));
        const medians = days.map(day => this.getRadarMedian(day, metric));
        const scaleStep = metric === 'minutes' ? 60 : 10_000;
        const roundedLimit = Math.max(Math.ceil(Math.max(...averages) / scaleStep) * scaleStep, scaleStep);
        const chartLimit = metric === 'minutes' ? Math.min(roundedLimit, 24 * 60) : roundedLimit;
        const labelRadius = radius + 20;
        const pointAt = (index: number, distance: number) => {
            const angle = -Math.PI / 2 + index * Math.PI * 2 / days.length;
            return {
                x: centerX + Math.cos(angle) * distance,
                y: centerY + Math.sin(angle) * distance,
            };
        };
        const polygon = (values: number[]) => values
            .map((value, index) => {
                const normalized = Math.min(Math.max(value, 0), chartLimit) / chartLimit;
                const point = pointAt(index, radius * normalized);
                return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
            })
            .join(' ');
        const ringPoints = (scale: number) => Array.from({ length: days.length }, (_, index) => {
            const point = pointAt(index, radius * scale);
            return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
        }).join(' ');
        const averagePoints = polygon(averages);
        const medianPoints = polygon(medians);
        const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const accessibleSummary = days.map(day => {
            const label = weekdayLabels[day.weekday] ?? '';
            return `${label}: average ${this.formatRadarValue(this.getRadarAverage(day, metric), metric)}, median ${this.formatRadarValue(this.getRadarMedian(day, metric), metric)}`;
        }).join('; ');

        return `
            <figure class="dashboard-weekday-figure">
                <svg class="dashboard-weekday-radar" viewBox="0 0 320 306" role="img" data-metric="${metric}"
                    aria-label="Weekday activity distribution. ${escapeHTML(accessibleSummary)}">
                    <g class="dashboard-weekday-grid" aria-hidden="true">
                        ${[0.25, 0.5, 0.75, 1].map(scale => `<polygon points="${ringPoints(scale)}"></polygon>`).join('')}
                        ${days.map((_, index) => {
                            const point = pointAt(index, radius);
                            return `<line x1="${centerX}" y1="${centerY}" x2="${point.x.toFixed(2)}" y2="${point.y.toFixed(2)}"></line>`;
                        }).join('')}
                    </g>
                    <g class="dashboard-weekday-scale" aria-hidden="true">
                        ${[0.25, 0.5, 0.75, 1].map(scale => `<text x="${centerX + 4}" y="${(centerY - radius * scale + 3).toFixed(2)}">${this.formatRadarScaleValue(chartLimit * scale, metric)}</text>`).join('')}
                    </g>
                    <polygon class="dashboard-weekday-average" points="${averagePoints}"></polygon>
                    <polygon class="dashboard-weekday-median" points="${medianPoints}"></polygon>
                    ${days.map((day, index) => {
                        const average = this.getRadarAverage(day, metric);
                        const median = this.getRadarMedian(day, metric);
                        const point = pointAt(index, radius * Math.min(average, chartLimit) / chartLimit);
                        const label = weekdayLabels[day.weekday] ?? '';
                        const title = `${label}: avg ${this.formatRadarValue(average, metric)}, median ${this.formatRadarValue(median, metric)}`;
                        return `<circle class="dashboard-weekday-point" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3.5"
                            data-weekday="${day.weekday}" data-average="${average}" data-median="${median}"><title>${escapeHTML(title)}</title></circle>`;
                    }).join('')}
                    ${days.map((day, index) => {
                        const point = pointAt(index, labelRadius);
                        let anchor = 'middle';
                        if (point.x < centerX - 8) anchor = 'end';
                        if (point.x > centerX + 8) anchor = 'start';
                        return `<text class="dashboard-weekday-label" x="${point.x.toFixed(2)}" y="${(point.y + 4).toFixed(2)}" text-anchor="${anchor}">${weekdayLabels[day.weekday] ?? ''}</text>`;
                    }).join('')}
                </svg>
                <figcaption class="dashboard-weekday-legend">
                    <span><i class="is-average"></i>Average</span>
                    <span><i class="is-median"></i>Median</span>
                </figcaption>
            </figure>
        `;
    }

    private getRadarAverage(day: DashboardWeekdayStats, metric: 'minutes' | 'characters'): number {
        return metric === 'minutes' ? day.average_minutes : day.average_characters;
    }

    private getRadarMedian(day: DashboardWeekdayStats, metric: 'minutes' | 'characters'): number {
        return metric === 'minutes' ? day.median_minutes : day.median_characters;
    }

    private formatRadarScaleValue(value: number, metric: 'minutes' | 'characters'): string {
        if (metric === 'characters') return Math.round(value).toLocaleString();
        return this.formatRadarValue(value, metric);
    }

    private formatRadarValue(value: number, metric: 'minutes' | 'characters'): string {
        if (metric === 'characters') return `${Math.round(value).toLocaleString()} characters`;
        if (value <= 0) return '0m';
        return formatStatsDuration(Math.round(value));
    }
}

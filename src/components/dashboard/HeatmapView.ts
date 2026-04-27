import { Component } from '../../core/component';
import { html } from '../../core/html';
import { DailyHeatmap } from '../../api';

interface HeatmapViewState {
    heatmapData: DailyHeatmap[];
    year: number;
}

export class HeatmapView extends Component<HeatmapViewState> {
    private readonly onYearChange: (direction: number) => void;
    private readonly onDateSelect?: (dateStr: string) => void;

    constructor(
        container: HTMLElement,
        initialState: HeatmapViewState,
        onYearChange: (direction: number) => void,
        onDateSelect?: (dateStr: string) => void
    ) {
        super(container, initialState);
        this.onYearChange = onYearChange;
        this.onDateSelect = onDateSelect;
    }

    render() {
        this.clear();
        
        if (Number.isNaN(this.state.year)) {
            this.container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 2rem;">No data recorded yet.</div>';
            return;
        }

        const card = html`
            <div class="card" style="display: flex; flex-direction: column; min-width: 0; height: 100%;">
                <div class="heatmap-header">
                    <div class="heatmap-title-controls">
                        <button class="btn btn-ghost chart-nav-button" id="btn-heatmap-prev">
                            <svg class="nav-svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M10 4l-4 4 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <h3 class="heatmap-title dashboard-module-title">Tracking Heatmap (<span id="heatmap-year-label">${this.state.year}</span>)</h3>
                        <button class="btn btn-ghost chart-nav-button" id="btn-heatmap-next">
                            <svg class="nav-svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div style="flex: 1; display: flex; align-items: center; justify-content: center; width: 100%;">
                    <div id="heatmap-inner-container" style="width: 100%; display: flex; justify-content: center;">
                        <!-- Heatmap cells will be injected here -->
                    </div>
                </div>
            </div>
        `;

        this.container.appendChild(card);
        this.renderHeatmap(card.querySelector<HTMLElement>('#heatmap-inner-container')!);
        
        card.querySelector('#btn-heatmap-prev')?.addEventListener('click', () => this.onYearChange(-1));
        card.querySelector('#btn-heatmap-next')?.addEventListener('click', () => this.onYearChange(1));
    }

    private renderHeatmap(container: HTMLElement) {
        const { heatmapData, year } = this.state;
        let htmlContent = '<div class="heatmap">';
        
        const dateMap = new Map<string, { mins: number, chars: number }>();
        for (const cur of heatmapData) {
            dateMap.set(cur.date, { mins: cur.total_minutes, chars: cur.total_characters });
        }

        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31);
        
        const cells: string[] = [];
        const firstDayOfYear = new Date(year, 0, 1);
        const dayOfWeek = firstDayOfYear.getDay(); // 0=Sun
        const offset = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
        
        for (let i = 0; i < offset; i++) {
            cells.push(`<div class="heatmap-cell" style="opacity: 0; pointer-events: none;"></div>`);
        }

        const style = getComputedStyle(document.body);
        const getThemeNum = (v: string, def: number) => {
            const s = style.getPropertyValue(v).trim();
            return s === "" ? def : Number.parseFloat(s);
        };

        const heatmapHue = style.getPropertyValue('--heatmap-hue').trim() || '353';
        const satBase = getThemeNum('--heatmap-sat-base', 30);
        const satRange = getThemeNum('--heatmap-sat-range', 70);
        const lightBase = getThemeNum('--heatmap-light-base', 45);
        const lightRange = getThemeNum('--heatmap-light-range', 41);

        const todayStr = this.getLocalISODate(new Date());

        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateStr = this.getLocalISODate(d);
            const data = dateMap.get(dateStr) || { mins: 0, chars: 0 };
            cells.push(this.buildHeatmapCell(dateStr, data.mins, data.chars, {
                heatmapHue,
                satBase,
                satRange,
                lightBase,
                lightRange,
                todayStr
            }));
        }

        for (let i = 0; i < cells.length; i += 7) {
            htmlContent += '<div class="heatmap-col">';
            for(let j=0; j<7 && i+j<cells.length; j++) {
                htmlContent += cells[i+j];
            }
            htmlContent += '</div>';
        }
        
        htmlContent += '</div>';
        container.innerHTML = htmlContent;
        this.attachDateSelection(container);
    }

    private getLocalISODate(date: Date): string {
        const pad = (value: number) => value.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    private buildHeatmapCell(
        dateStr: string,
        minutes: number,
        characters: number,
        theme: {
            heatmapHue: string;
            satBase: number;
            satRange: number;
            lightBase: number;
            lightRange: number;
            todayStr: string;
        }
    ): string {
        const cellStyles: string[] = [];
        if (minutes > 0) {
            const ratio = Math.min(1, (minutes - 1) / 359);
            const saturation = theme.satBase + (ratio * theme.satRange);
            const lightness = theme.lightBase + (ratio * theme.lightRange);
            cellStyles.push(`background-color: hsl(${theme.heatmapHue}, ${saturation}%, ${lightness}%);`);
        }

        const isSelectable = dateStr <= theme.todayStr;
        const cellStyle = cellStyles.length > 0 ? `style="${cellStyles.join(' ')}"` : "";
        const interactiveAttrs = isSelectable
            ? `data-date="${dateStr}" role="button" tabindex="0" aria-label="Show activity week for ${dateStr}"`
            : "";
        const charTooltip = characters > 0 ? `, ${characters.toLocaleString()} chars` : '';
        const interactiveClass = isSelectable ? ' heatmap-cell-interactive' : '';

        return `<div class="heatmap-cell${interactiveClass}" ${cellStyle} ${interactiveAttrs} title="${dateStr}: ${minutes} mins${charTooltip}"></div>`;
    }

    private attachDateSelection(container: HTMLElement) {
        const heatmap = container.querySelector<HTMLElement>('.heatmap');
        if (!heatmap || !this.onDateSelect) return;

        const activateCell = (target: EventTarget | null) => {
            if (!(target instanceof HTMLElement)) return;
            const cell = target.closest<HTMLElement>('.heatmap-cell[data-date]');
            const dateStr = cell?.dataset.date;
            if (dateStr) this.onDateSelect?.(dateStr);
        };

        heatmap.addEventListener('click', (event) => activateCell(event.target));
        heatmap.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            activateCell(event.target);
            event.preventDefault();
        });
    }
}

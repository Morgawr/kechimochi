import Chart from 'chart.js/auto';
import { getLogs, getHeatmap, getAllMedia, ActivitySummary, DailyHeatmap, deleteLog } from '../api';
import { customConfirm } from '../modals';

export class Dashboard {
  private container: HTMLElement;
  private currentHeatmapYear: number = new Date().getFullYear();
  private groupByMode: 'media_type' | 'log_name' = 'media_type';
  private timeRangeDays: number = 7;
  private timeRangeOffset: number = 0;
  private chartType: 'bar' | 'line' = 'bar';
  private pieChartInstance: Chart | null = null;
  private barChartInstance: Chart | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async render() {
    this.container.innerHTML = `
      <div class="animate-fade-in" style="display: flex; flex-direction: column; gap: 2rem;">
        
        <!-- Heatmap Section -->
        <div class="dashboard-top-grid">
          <!-- Stats Box -->
          <div class="card" id="stats-box-container" style="display: flex; flex-direction: column;">
             <div style="display: flex; justify-content: center; align-items: center; height: 100%;">
                 <span style="color: var(--text-secondary);">Loading stats...</span>
             </div>
          </div>

          <div class="card" style="display: flex; flex-direction: column; min-width: 0;">
            <div style="display: flex; justify-content: center; align-items: center; margin-bottom: 2rem; gap: 1rem;">
              <button class="btn btn-ghost" style="padding: 0.2rem 0.5rem;" id="btn-heatmap-prev">&lt;</button>
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--text-secondary);">Tracking Heatmap (<span id="heatmap-year-label">${this.currentHeatmapYear}</span>)</h3>
              <button class="btn btn-ghost" style="padding: 0.2rem 0.5rem;" id="btn-heatmap-next">&gt;</button>
            </div>
            <div style="flex: 1; display: flex; align-items: center; justify-content: center; width: 100%;">
              <div id="heatmap-container" style="width: 100%; display: flex; justify-content: center;">
                <!-- Generated heatmap cells -->
              </div>
            </div>
          </div>
        </div>

        <!-- Charts Section -->
        <div class="charts-grid">
          <div class="card" style="display: flex; flex-direction: column; min-width: 0;">
            <h3 style="text-align: center; margin-bottom: 1rem;">Activity Breakdown</h3>
            <div class="chart-container-wrapper" style="flex: 1; min-height: 0;">
              <canvas id="pieChart"></canvas>
            </div>
          </div>
          <div class="card" style="display: flex; flex-direction: column; min-width: 0;">
            <div class="chart-controls-row">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                 <button class="btn btn-ghost" style="padding: 0.1rem 0.4rem;" id="btn-chart-prev">&lt;</button>
                 <h3 style="margin: 0;">Activity visualization</h3>
                 <button class="btn btn-ghost" style="padding: 0.1rem 0.4rem;" id="btn-chart-next">&gt;</button>
              </div>
              <div class="chart-selects">
                <select id="select-chart-type" style="font-size: 0.8rem; padding: 0.4rem 0.6rem;">
                  <option value="bar" ${this.chartType === 'bar' ? 'selected' : ''}>Bar</option>
                  <option value="line" ${this.chartType === 'line' ? 'selected' : ''}>Line</option>
                </select>
                <select id="select-time-range" style="font-size: 0.8rem; padding: 0.4rem 0.6rem;">
                  <option value="7" ${this.timeRangeDays === 7 ? 'selected' : ''}>Weekly</option>
                  <option value="30" ${this.timeRangeDays === 30 ? 'selected' : ''}>Monthly</option>
                  <option value="365" ${this.timeRangeDays === 365 ? 'selected' : ''}>Yearly</option>
                </select>
                <select id="select-group-by" style="font-size: 0.8rem; padding: 0.4rem 0.6rem;">
                  <option value="media_type" ${this.groupByMode === 'media_type' ? 'selected' : ''}>By Media Type</option>
                  <option value="log_name" ${this.groupByMode === 'log_name' ? 'selected' : ''}>By Log Name</option>
                </select>
              </div>
            </div>
            <div class="chart-container-wrapper" style="flex: 1; min-height: 0;">
              <canvas id="barChart"></canvas>
            </div>
          </div>
        </div>

        <!-- Recent Logs -->
        <div class="card">
          <h3 style="margin-bottom: 1rem;">Recent Activity</h3>
          <div id="recent-logs-list" style="display: flex; flex-direction: column; gap: 0.5rem;">
            <p style="color: var(--text-secondary);">Loading logs...</p>
          </div>
        </div>
      </div>
    `;

    await this.loadData();

    document.getElementById('btn-heatmap-prev')?.addEventListener('click', () => {
        this.currentHeatmapYear--;
        this.loadData();
    });
    document.getElementById('btn-heatmap-next')?.addEventListener('click', () => {
        this.currentHeatmapYear++;
        this.loadData();
    });
    const groupBySelect = document.getElementById('select-group-by') as HTMLSelectElement;
    if (groupBySelect) {
        groupBySelect.addEventListener('change', () => {
            this.groupByMode = groupBySelect.value as 'media_type' | 'log_name';
            this.loadData();
        });
    }

    const timeRangeSelect = document.getElementById('select-time-range') as HTMLSelectElement;
    if (timeRangeSelect) {
        timeRangeSelect.addEventListener('change', () => {
            this.timeRangeDays = parseInt(timeRangeSelect.value);
            this.timeRangeOffset = 0; // reset offset
            this.loadData();
        });
    }

    const chartTypeSelect = document.getElementById('select-chart-type') as HTMLSelectElement;
    if (chartTypeSelect) {
        chartTypeSelect.addEventListener('change', () => {
            this.chartType = chartTypeSelect.value as 'bar' | 'line';
            this.loadData();
        });
    }

    document.getElementById('btn-chart-prev')?.addEventListener('click', () => {
        this.timeRangeOffset++;
        this.loadData();
    });
    
    document.getElementById('btn-chart-next')?.addEventListener('click', () => {
        if (this.timeRangeOffset > 0) {
            this.timeRangeOffset--;
            this.loadData();
        }
    });
  }

  async loadData() {
    try {
      const dbLogs = await getLogs();
      const dbHeatmap = await getHeatmap();
      const mediaList = await getAllMedia();
      
      const lbl = document.getElementById('heatmap-year-label');
      if (lbl) lbl.textContent = this.currentHeatmapYear.toString();

      this.renderStats(dbLogs, mediaList);
      this.renderHeatmap(dbHeatmap);
      this.renderCharts(dbLogs);
      this.renderLogs(dbLogs);
    } catch (e) {
      console.error("Dashboard failed to load data", e);
    }
  }

  private renderStats(logs: ActivitySummary[], mediaList: any[]) {
    const container = document.getElementById('stats-box-container');
    if (!container) return;
    
    const totalLogs = logs.length;
    const totalMedia = mediaList.length;
    const mediaBreakdown = new Map<string, number>();

    const uniqueDates = Array.from(new Set(logs.map(l => l.date))).sort();
    let maxStreak = 0;
    let currentStreak = 0;
    let sinceDate = 'N/A';
    if (uniqueDates.length > 0) sinceDate = uniqueDates[0];

    for (const log of logs) {
        mediaBreakdown.set(log.media_type, (mediaBreakdown.get(log.media_type) || 0) + log.duration_minutes);
    }
    
    // Total immersion average
    let totalMins = 0;
    mediaBreakdown.forEach(v => totalMins += v);
    const loggedDaysCount = uniqueDates.length || 1;
    const totalAvgMins = totalMins / loggedDaysCount;
    const totalAvgH = Math.floor(totalAvgMins / 60);
    const totalAvgM = Math.round(totalAvgMins % 60);
    const totalAvgFormat = totalAvgH > 0 ? `${totalAvgH}h ${totalAvgM}m` : `${totalAvgM}m`;

    if (uniqueDates.length > 0) {
        let streakCount = 1;
        let maxS = 1;
        for (let i = 1; i < uniqueDates.length; i++) {
            const d1 = new Date(uniqueDates[i-1]);
            const d2 = new Date(uniqueDates[i]);
            const diffInDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24));
            if (diffInDays === 1) {
                streakCount++;
                if (streakCount > maxS) maxS = streakCount;
            } else {
                streakCount = 1;
            }
        }
        maxStreak = maxS;
        
        const getLocalISODate = (d: Date) => {
            const pad = (n: number) => n.toString().padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        };
        const todayStr = getLocalISODate(new Date());
        
        const lastLogD = new Date(uniqueDates[uniqueDates.length - 1]);
        const todayD = new Date(todayStr);
        const diffToday = Math.round((todayD.getTime() - lastLogD.getTime()) / (1000 * 3600 * 24));
        
        if (diffToday <= 1) {
            let curr = 1;
            for (let i = uniqueDates.length - 1; i >= 1; i--) {
                const currD = new Date(uniqueDates[i]);
                const prevD = new Date(uniqueDates[i-1]);
                const diffInDays = Math.round((currD.getTime() - prevD.getTime()) / (1000 * 3600 * 24));
                if (diffInDays === 1) {
                    curr++;
                } else {
                    break;
                }
            }
            currentStreak = curr;
        } else {
            currentStreak = 0;
        }
    }

    let actTypeHtml = '';
    const sortedBreakdown = Array.from(mediaBreakdown.entries()).sort((a,b) => b[1] - a[1]);
    for (const [mtype, mins] of sortedBreakdown) {
       let h = Math.floor(mins / 60);
       let m = Math.round(mins % 60);
       let totalFormat = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
       
       const avgMins = mins / loggedDaysCount;
       const avgH = Math.floor(avgMins / 60);
       const avgM = Math.round(avgMins % 60);
       const avgFormat = avgH > 0 ? `${avgH}h ${avgM}m` : `${avgM}m`;

       actTypeHtml += `
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
    }

    container.innerHTML = `
      <div style="text-align: center; margin-bottom: 1rem;">
          <h3 style="color: var(--text-secondary); font-size: 1.1rem; margin: 0;">Study Stats</h3>
          <div style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.7; margin-top: 0.2rem;">Since: ${sinceDate}</div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.75rem; flex: 1;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; width: 100%; text-align: center;">
          <div style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
            <div style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${totalLogs}</div>
            <div style="font-size: 0.65rem; color: var(--text-secondary);">logs</div>
          </div>
          <div style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
            <div style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${totalMedia}</div>
            <div style="font-size: 0.65rem; color: var(--text-secondary);">media items</div>
          </div>
          <div style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
            <div style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${maxStreak}</div>
            <div style="font-size: 0.65rem; color: var(--text-secondary);">max streak</div>
          </div>
          <div style="background: var(--bg-dark); padding: 0.4rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
            <div style="font-size: 1.1rem; font-weight: bold; color: var(--text-primary);">${currentStreak}</div>
            <div style="font-size: 0.65rem; color: var(--text-secondary);">day streak</div>
          </div>
        </div>
        
        <div style="background: var(--accent-purple); padding: 0.5rem; border-radius: var(--radius-sm); text-align: center; color: var(--bg-dark); font-weight: 600; font-size: 0.85rem;">
            Total Avg: ${totalAvgFormat} / day
        </div>
        
        <div style="width: 100%; height: 1px; background: var(--border-color); margin: 0.2rem 0;"></div>
        
        <div style="width: 100%; display: flex; flex-direction: column; gap: 0.4rem;">
           ${actTypeHtml}
        </div>
      </div>
    `;
  }

  private renderHeatmap(heatmapData: DailyHeatmap[]) {
    const container = document.getElementById('heatmap-container');
    if (!container) return;

    let html = '<div class="heatmap">';
    
    // Convert to a map of date string -> total minutes
    const dateMap = new Map<string, number>();
    for (const cur of heatmapData) {
        dateMap.set(cur.date, cur.total_minutes);
    }

    // Generate for the entire chosen year
    const startDate = new Date(this.currentHeatmapYear, 0, 1);
    const endDate = new Date(this.currentHeatmapYear, 11, 31);
    
    // adjust so we start on a certain weekday (e.g. Sunday) 
    // Wait, just loop day by day
    const getLocalISODate = (d: Date) => {
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    const cells = [];
    const firstDayOfYear = new Date(this.currentHeatmapYear, 0, 1);
    const dayOfWeek = firstDayOfYear.getDay(); // 0=Sun
    const offset = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
    
    // Add empty cells for padding to Monday
    for (let i = 0; i < offset; i++) {
        cells.push(`<div class="heatmap-cell" style="opacity: 0; pointer-events: none;"></div>`);
    }

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = getLocalISODate(d);
        
        const minutes = dateMap.get(dateStr) || 0;
        let cellStyle = "";
        if (minutes > 0) {
            const ratio = Math.min(1, (minutes - 1) / 359);
            // Saturation 30% -> 100%
            const saturation = 30 + (ratio * 70);
            // Lightness 45% (Darker) -> 86% (Brighter/Pastel)
            const lightness = 45 + (ratio * 41);
            cellStyle = `style="background-color: hsl(353, ${saturation}%, ${lightness}%);"`;
        }

        cells.push(`<div class="heatmap-cell" ${cellStyle} title="${dateStr}: ${minutes} mins"></div>`);
    }

    for (let i = 0; i < cells.length; i += 7) {
        html += '<div class="heatmap-col">';
        for(let j=0; j<7 && i+j<cells.length; j++) {
            html += cells[i+j];
        }
        html += '</div>';
    }
    
    html += '</div>';
    container.innerHTML = html;
  }

  private renderCharts(logs: ActivitySummary[]) {
    const pieCanvas = document.getElementById('pieChart') as HTMLCanvasElement;
    const barCanvas = document.getElementById('barChart') as HTMLCanvasElement;
    if (!pieCanvas || !barCanvas) return;

    if (this.pieChartInstance) this.pieChartInstance.destroy();
    if (this.barChartInstance) this.barChartInstance.destroy();

    const colors = ['#f4a6b8', '#b8cdda', '#e0bbe4', '#957DAD', '#D291BC', '#FEC8D8', '#FFDFD3'];

    // Construct Buckets
    // A bucket is: name (label), and we need a way to map a date to it.
    let labels: string[] = [];
    let getBucketIndex: (dateStr: string) => number = () => -1;
    let validStart = '';
    let validEnd = '';
    const numBuckets = () => labels.length;

    const getLocalISODate = (d: Date) => {
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    const today = new Date();
    if (this.timeRangeDays === 7) {
        const endDay = new Date(today);
        endDay.setDate(today.getDate() - (7 * this.timeRangeOffset));
        const startDay = new Date(endDay);
        // getDay() returns 0 for Sunday, 1 for Monday, etc.
        // We want Monday (1) to be the first day.
        const dayOfWeek = endDay.getDay(); 
        const diffToMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
        startDay.setDate(endDay.getDate() - diffToMonday);
        // Now endDay should be the Sunday of that week
        endDay.setDate(startDay.getDate() + 6);
        
        validStart = getLocalISODate(startDay);
        validEnd = getLocalISODate(endDay);
        
        // Buckets = 7 days
        for(let i = 0; i < 7; i++) {
            const d = new Date(startDay);
            d.setDate(startDay.getDate() + i);
            labels.push(getLocalISODate(d));
        }
        
        getBucketIndex = (dateStr: string) => labels.indexOf(dateStr);
    } else if (this.timeRangeDays === 30) {
        const targetMonth = new Date(today.getFullYear(), today.getMonth() - this.timeRangeOffset, 1);
        const y = targetMonth.getFullYear();
        const m = targetMonth.getMonth();
        const startDay = new Date(y, m, 1);
        const endDay = new Date(y, m + 1, 0); // last day
        
        validStart = getLocalISODate(startDay);
        validEnd = getLocalISODate(endDay);
        
        const totalDays = endDay.getDate();
        const weeksCount = Math.ceil(totalDays / 7);
        for(let i=0; i<weeksCount; i++) labels.push(`Week ${i+1}`);
        
        getBucketIndex = (dateStr: string) => {
            if (dateStr >= validStart && dateStr <= validEnd) {
                const date = new Date(dateStr + "T00:00:00");
                const firstOfMonth = new Date(y, m, 1);
                const firstDayWeekday = firstOfMonth.getDay(); // 0=Sun, 1=Mon
                const offset = (firstDayWeekday === 0 ? 6 : firstDayWeekday - 1);
                
                const day = date.getDate();
                return Math.floor((day + offset - 1) / 7);
            }
            return -1;
        };
    } else if (this.timeRangeDays === 365) {
        const targetYear = today.getFullYear() - this.timeRangeOffset;
        validStart = `${targetYear}-01-01`;
        validEnd = `${targetYear}-12-31`;
        
        labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        getBucketIndex = (dateStr: string) => {
            if (dateStr >= validStart && dateStr <= validEnd) {
                return parseInt(dateStr.split('-')[1]) - 1;
            }
            return -1;
        };
    }

    const pieTypeMap = new Map<string, number>();
    for (const log of logs) {
        if (log.date >= validStart && log.date <= validEnd) {
            const key = this.groupByMode === 'media_type' ? log.media_type : log.title;
            pieTypeMap.set(key, (pieTypeMap.get(key) || 0) + log.duration_minutes);
        }
    }

    this.pieChartInstance = new Chart(pieCanvas, {
      type: 'doughnut',
      data: {
        labels: Array.from(pieTypeMap.keys()),
        datasets: [{
          data: Array.from(pieTypeMap.values()),
          backgroundColor: colors,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: pieTypeMap.size <= 6, position: 'bottom', labels: { color: '#f0f0f5' } },
          tooltip: {
            callbacks: {
              label: function(context: any) {
                const val = context.parsed;
                const h = Math.floor(val / 60);
                const m = Math.round(val % 60);
                return `${context.label}: ${h > 0 ? h + 'h' : ''}${m}m`;
              }
            }
          }
        }
      }
    });

    const datasetsMap = new Map<string, number[]>();
    
    const activeKeysInPeriod = new Set<string>();
    for (const log of logs) {
        if (getBucketIndex(log.date) !== -1) {
            const key = this.groupByMode === 'media_type' ? log.media_type : log.title;
            activeKeysInPeriod.add(key);
        }
    }

    for (const key of activeKeysInPeriod) {
        datasetsMap.set(key, Array(numBuckets()).fill(0));
    }

    for (const log of logs) {
        const index = getBucketIndex(log.date);
        if (index !== -1) {
            const key = this.groupByMode === 'media_type' ? log.media_type : log.title;
            if (datasetsMap.has(key)) {
                datasetsMap.get(key)![index] += log.duration_minutes;
            }
        }
    }

    const datasets = Array.from(datasetsMap.entries()).map(([key, data], i) => ({
      label: key,
      data: data,
      backgroundColor: colors[i % colors.length],
      borderColor: colors[i % colors.length],
      fill: this.chartType === 'line' ? false : undefined,
      tension: 0.3
    }));

    this.barChartInstance = new Chart(barCanvas, {
      type: this.chartType,
      data: {
        labels: this.timeRangeDays === 7 ? labels.map(l => l.slice(5)) : labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: this.chartType === 'bar', grid: { color: '#3f3f4e' }, ticks: { color: '#a0a0b0' } },
          y: { 
            stacked: this.chartType === 'bar', 
            grid: { color: '#3f3f4e' }, 
            ticks: { 
              color: '#a0a0b0',
              callback: function(value: any) { 
                const h = Math.floor(value / 60);
                const m = Math.round(value % 60);
                if (h > 0 && m === 0) return `${h}h`;
                if (h > 0) return `${h}h ${m}m`;
                return `${m}m`;
              }
            } 
          }
        },
        plugins: {
          legend: { display: datasets.length <= 6, position: 'top', labels: { color: '#a0a0b0'} },
          tooltip: {
            callbacks: {
              label: function(context: any) {
                const val = context.parsed.y;
                const h = Math.floor(val / 60);
                const m = Math.round(val % 60);
                return `${context.dataset.label}: ${h > 0 ? h + 'h' : ''}${m}m`;
              }
            }
          }
        }
      }
    });
  }

  private renderLogs(logs: ActivitySummary[]) {
    const list = document.getElementById('recent-logs-list');
    if (!list) return;

    const currentProfile = localStorage.getItem('kechimochi_profile') || 'default';

    list.innerHTML = logs.slice(0, 20).map(log => `
      <div class="log-entry">
        <div>
          <span style="color: var(--accent-green); font-weight: 500;">${currentProfile}</span> 
          <span style="color: var(--text-secondary);">logged</span> 
          <span>${log.duration_minutes} minutes</span> 
          <span style="color: var(--text-secondary);">of ${log.media_type}</span> 
          <a class="dashboard-media-link" data-media-id="${log.media_id}" style="color: var(--text-primary); font-weight: 600; cursor: pointer; text-decoration: underline; text-decoration-color: var(--accent-blue);">${log.title}</a>
        </div>
        <div class="log-entry-meta">
          <div style="color: var(--text-secondary);">${log.date}</div>
           <button class="btn btn-danger btn-sm delete-log-btn" data-id="${log.id}" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; background-color: #ff4757 !important; color: #ffffff !important; border: none; cursor: pointer;">Delete</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.delete-log-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = parseInt((e.target as HTMLElement).getAttribute('data-id')!);
            const confirm = await customConfirm("Delete Log", "Are you sure you want to permanently delete this log entry?");
            if (confirm) {
                await deleteLog(id);
                this.loadData();
            }
        });
    });

    list.querySelectorAll('.dashboard-media-link').forEach(link => {
        link.addEventListener('click', (e) => {
            const mediaId = parseInt((e.target as HTMLElement).getAttribute('data-media-id')!);
            window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: 'media', focusMediaId: mediaId } }));
        });
    });
  }
}

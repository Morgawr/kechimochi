import { escapeHTML } from '../html';

export interface DashboardCardShellOptions {
    readonly title: string;
    readonly body: string;
    readonly cardClasses?: readonly string[];
    readonly bodyClasses?: readonly string[];
    readonly attributes?: Readonly<Record<string, string>>;
    readonly headerExtras?: string;
}

export function renderDashboardCardShell(options: DashboardCardShellOptions): string {
    const { title, body, cardClasses = [], bodyClasses = [], attributes = {}, headerExtras = '' } = options;
    const sectionClasses = ['card', 'dashboard-card', ...cardClasses].join(' ');
    const bodyClassList = ['dashboard-card-body', ...bodyClasses].join(' ');
    const headerClasses = ['dashboard-card-header', headerExtras ? 'dashboard-card-header-has-extras' : '']
        .filter(Boolean)
        .join(' ');
    const attributeString = Object.entries(attributes)
        .map(([name, value]) => ` ${name}="${escapeHTML(value)}"`)
        .join('');

    return `
        <section class="${sectionClasses}"${attributeString}>
            <header class="${headerClasses}">
                <h3 class="dashboard-card-title">${escapeHTML(title)}</h3>
                ${headerExtras}
            </header>
            <div class="${bodyClassList}">${body}</div>
        </section>
    `;
}

export function renderDashboardCardEmptyState(message: string): string {
    return `<p class="dashboard-card-empty">${escapeHTML(message)}</p>`;
}

const NO_PERIOD_DATA_MESSAGE = 'No data in this period.';
const IMMERSE_PROMPT = 'Go immerse!';

export function renderNoPeriodDataMessage(isTodayInRange: boolean): string {
    if (!isTodayInRange) return NO_PERIOD_DATA_MESSAGE;
    return `${NO_PERIOD_DATA_MESSAGE} <span class="dashboard-card-empty-prompt">${IMMERSE_PROMPT}</span>`;
}

export function renderNoPeriodDataEmptyState(isTodayInRange: boolean): string {
    return `<p class="dashboard-card-empty">${renderNoPeriodDataMessage(isTodayInRange)}</p>`;
}

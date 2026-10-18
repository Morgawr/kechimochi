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
const IMMERSE_PROMPT = 'Go immerse';
const MAXIMUM_IMMERSE_PROMPT_INTENSITY = 4;

export function getImmersePromptIntensity(elapsedPeriodDays: number): number {
    return Math.min(MAXIMUM_IMMERSE_PROMPT_INTENSITY, Math.floor(Math.log2(Math.max(1, elapsedPeriodDays))));
}

export function getImmersePromptText(intensity: number): string {
    return `${IMMERSE_PROMPT}${'!'.repeat(intensity + 1)}`;
}

export function renderNoPeriodDataMessage(elapsedPeriodDays: number | null): string {
    if (elapsedPeriodDays === null) return NO_PERIOD_DATA_MESSAGE;
    const intensity = getImmersePromptIntensity(elapsedPeriodDays);
    return `${NO_PERIOD_DATA_MESSAGE} <span class="dashboard-card-empty-prompt" data-immerse-intensity="${intensity}">${getImmersePromptText(intensity)}</span>`;
}

export function renderNoPeriodDataEmptyState(elapsedPeriodDays: number | null): string {
    return `<p class="dashboard-card-empty">${renderNoPeriodDataMessage(elapsedPeriodDays)}</p>`;
}

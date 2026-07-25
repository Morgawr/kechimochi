import { Component } from '../component';
import { html, escapeHTML, escapeAttribute, rawHtml } from '../html';
import { Media, addMedia } from '../api';
import { showAddMediaModal } from './modal';
import { CONTENT_TYPES, EVENTS, FILTERS, TRACKING_STATUSES, MEDIA_STATUS } from '../constants';
import { MediaGrid } from './MediaGrid';
import { MediaList } from './MediaList';
import {
    LIBRARY_GRID_ZOOM,
    normalizeLibraryGridZoom,
    type LibraryActivityMetrics,
    type LibraryLayoutMode,
} from './library_types';
import { measureSynchronous } from '../performance';
import { resolveDisplayContentType } from './content_type';
import {
    filterMediaByExtraData,
    getDefaultLibraryExtraFilterOperator,
    getLibraryExtraDataFacets,
    getLibraryExtraFieldValueKind,
    isLibraryFilterRuleReady,
    LIBRARY_NUMERIC_FILTER_OPERATORS,
    LIBRARY_TEXT_FILTER_OPERATORS,
    revalidateLibraryFilterRules,
    type LibraryExtraDataFacets,
    type LibraryExtraFilterOperator,
    type LibraryExtraFilterRule,
    type LibraryFilterRule,
} from './filtering';
import {
    applyLibrarySort,
    buildExtraDataIndex,
    buildLibraryRows,
    fromSortFieldOptionValue,
    getUniqueExtraFieldNames,
    toSortFieldOptionValue,
    LIBRARY_BUILTIN_SORT_KEYS,
    type LibraryBuiltinSortKey,
    type LibraryRow,
    type LibrarySortDirection,
    type LibrarySortField,
    type LibrarySortStage,
} from './sorting';

interface MediaLibraryBrowserState {
    mediaList: Media[];
    searchQuery: string;
    typeFilters: string[];
    statusFilters: string[];
    hideArchived: boolean;
    filterRules: LibraryFilterRule[];
    preferredLayout: LibraryLayoutMode;
    gridZoom: number;
    isGridSupported: boolean;
    listMetricsByMediaId: Record<number, LibraryActivityMetrics>;
    isListMetricsLoading: boolean;
    filtersExpanded: boolean;
    sortStages: LibrarySortStage[];
    groupByType: boolean;
    keepOngoingFirst: boolean;
    keepArchivedLast: boolean;
    sortExpanded: boolean;
    contentTypeOrder: string[];
    trackingStatusOrder: string[];
}

type MediaLibraryBrowserInitialState = Omit<
    MediaLibraryBrowserState,
    'filtersExpanded' | 'filterRules' | 'sortStages' | 'groupByType' | 'keepOngoingFirst' | 'keepArchivedLast' | 'sortExpanded' | 'contentTypeOrder' | 'trackingStatusOrder'
> & {
    filterRules?: LibraryFilterRule[];
    sortStages?: LibrarySortStage[];
    groupByType?: boolean;
    keepOngoingFirst?: boolean;
    keepArchivedLast?: boolean;
    contentTypeOrder?: string[];
    trackingStatusOrder?: string[];
};

export interface MediaLibraryFilters {
    searchQuery?: string;
    typeFilters?: string[];
    statusFilters?: string[];
    hideArchived?: boolean;
    filterRules?: LibraryFilterRule[];
    sortStages?: LibrarySortStage[];
    groupByType?: boolean;
    keepOngoingFirst?: boolean;
    keepArchivedLast?: boolean;
}

const LIBRARY_SORT_GROUP_LIBRARY_KEYS: readonly LibraryBuiltinSortKey[] = [
    'default', 'title', 'contentType', 'trackingStatus', 'dateAdded',
];
const LIBRARY_SORT_GROUP_ACTIVITY_KEYS: readonly LibraryBuiltinSortKey[] = [
    'lastActivity', 'firstActivity', 'timeLogged', 'totalCharacters',
];

const LIBRARY_BUILTIN_SORT_LABELS: Record<LibraryBuiltinSortKey, string> = {
    default: 'Default',
    title: 'Title',
    contentType: 'Content Type',
    trackingStatus: 'Tracking Status',
    dateAdded: 'Date Added',
    lastActivity: 'Last Activity',
    firstActivity: 'First Activity',
    timeLogged: 'Time Logged',
    totalCharacters: 'Total Characters',
};

const LIBRARY_SORT_TIEBREAKER_NOTE = 'Ties broken by last activity (newest first)';
const LIBRARY_FILTER_EXPRESSION_NOTE = 'AND is evaluated before OR. NOT inverts the rule it precedes.';

const LIBRARY_EXTRA_FILTER_OPERATOR_LABELS: Record<LibraryExtraFilterOperator, string> = {
    contains: 'Contains',
    notContains: 'Does not contain',
    equals: 'Equals',
    notEquals: 'Does not equal',
    startsWith: 'Starts with',
    endsWith: 'Ends with',
    greaterThan: 'Greater than (>)',
    greaterThanOrEqual: 'At least (≥)',
    lessThan: 'Less than (<)',
    lessThanOrEqual: 'At most (≤)',
};

interface SortSwitchConfig {
    id: string;
    label: string;
    stateKey: 'groupByType' | 'keepOngoingFirst' | 'keepArchivedLast';
    disabledWhenArchivedHidden: boolean;
}

const SORT_SWITCH_CONFIGS: readonly SortSwitchConfig[] = [
    { id: 'sort-group-by-type', label: 'Group by type', stateKey: 'groupByType', disabledWhenArchivedHidden: false },
    { id: 'sort-keep-ongoing-first', label: 'Keep ongoing first', stateKey: 'keepOngoingFirst', disabledWhenArchivedHidden: false },
    { id: 'sort-keep-archived-last', label: 'Keep archived last', stateKey: 'keepArchivedLast', disabledWhenArchivedHidden: true },
];

function renderPaneToggleButton({ id, label, panelId, isExpanded, count, countLabel }: {
    id: string;
    label: string;
    panelId: string;
    isExpanded: boolean;
    count: number;
    countLabel: string;
}): string {
    const countBadge = count > 0
        ? `<span class="media-grid-filter-count" aria-label="${count} ${countLabel}">${count}</span>`
        : '';

    return `
        <button class="media-grid-filters-toggle" id="${id}" aria-expanded="${isExpanded}" aria-controls="${panelId}">
            <span>${label}</span>
            ${countBadge}
            <svg class="media-grid-filters-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2.5 4.5L6 7.5L9.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
        </button>
    `;
}

function renderCollapsiblePanel({ id, isExpanded, body }: {
    id: string;
    isExpanded: boolean;
    body: string;
}): string {
    const panelStyle = isExpanded
        ? 'style="height: auto; opacity: 1; transform: translateY(0); pointer-events: auto;"'
        : 'style="height: 0; opacity: 0; transform: translateY(-8px); pointer-events: none;"';

    return `
        <div id="${id}" class="media-grid-filter-panel ${isExpanded ? 'is-expanded' : 'is-collapsed'}" aria-hidden="${isExpanded ? 'false' : 'true'}" ${panelStyle}>
            <div class="media-grid-filter-panel-body">
                ${body}
            </div>
        </div>
    `;
}

export interface LibraryMediaSelection {
    mediaId: number;
    navigationIds: readonly number[];
}

export class MediaLibraryBrowser extends Component<MediaLibraryBrowserState> {
    private readonly onMediaClick: (selection: LibraryMediaSelection) => void;
    private readonly onDataChange: (jumpToId?: number) => Promise<void>;
    private readonly onFilterChange?: (filters: MediaLibraryFilters) => void;
    private readonly onLayoutChange?: (layout: LibraryLayoutMode) => void;
    private readonly onGridZoomChange?: (gridZoom: number) => void;
    private activeLayoutComponent: MediaGrid | MediaList | null = null;
    private shellRendered = false;
    private memoizedExtraDataMediaList: Media[] | null = null;
    private memoizedExtraDataIndex: Map<number, Record<string, string>> = new Map();
    private memoizedExtraFieldNames: string[] = [];
    private memoizedExtraDataFacets: LibraryExtraDataFacets = {
        valuedFieldNames: [],
        booleanTagNames: [],
    };
    private searchRenderTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        container: HTMLElement,
        initialState: MediaLibraryBrowserInitialState,
        onMediaClick: (selection: LibraryMediaSelection) => void,
        onDataChange: (jumpToId?: number) => Promise<void>,
        onFilterChange?: (filters: MediaLibraryFilters) => void,
        onLayoutChange?: (layout: LibraryLayoutMode) => void,
        onGridZoomChange?: (gridZoom: number) => void,
    ) {
        const initialExtraDataIndex = buildExtraDataIndex(initialState.mediaList);
        const revalidatedFilterRules = revalidateLibraryFilterRules(
            initialState.filterRules ?? [],
            initialExtraDataIndex,
        );
        super(container, {
            ...initialState,
            typeFilters: [...new Set(initialState.typeFilters)],
            statusFilters: [...new Set(initialState.statusFilters)],
            filterRules: revalidatedFilterRules,
            gridZoom: normalizeLibraryGridZoom(initialState.gridZoom),
            filtersExpanded: false,
            sortStages: initialState.sortStages ?? [],
            groupByType: initialState.groupByType ?? false,
            keepOngoingFirst: initialState.keepOngoingFirst ?? true,
            keepArchivedLast: initialState.keepArchivedLast ?? true,
            sortExpanded: false,
            contentTypeOrder: initialState.contentTypeOrder ?? [...CONTENT_TYPES],
            trackingStatusOrder: initialState.trackingStatusOrder ?? [...TRACKING_STATUSES],
        });
        this.onMediaClick = onMediaClick;
        this.onDataChange = onDataChange;
        this.onFilterChange = onFilterChange;
        this.onLayoutChange = onLayoutChange;
        this.onGridZoomChange = onGridZoomChange;
    }

    public override destroy() {
        if (this.searchRenderTimer !== null) {
            globalThis.clearTimeout(this.searchRenderTimer);
            this.searchRenderTimer = null;
        }
        this.activeLayoutComponent?.destroy?.();
        super.destroy();
    }

    public async reconcileCoverUrls(): Promise<void> {
        await this.activeLayoutComponent?.reconcileCoverUrls();
    }

    render() {
        if (!this.shellRendered) {
            this.clear();

            const headerContainer = document.createElement('div');
            headerContainer.id = 'media-library-header';
            this.container.appendChild(headerContainer);

            const contentContainer = document.createElement('div');
            contentContainer.id = 'media-library-content';
            contentContainer.setAttribute('aria-busy', 'false');
            // Allow the library content to shrink in flex layouts; otherwise long children can
            // force horizontal overflow which then gets clipped by the app shell.
            contentContainer.style.cssText = 'display: flex; flex: 1; min-height: 0; min-width: 0;';
            this.container.appendChild(contentContainer);

            this.shellRendered = true;
        }

        const headerContainer = this.container.querySelector<HTMLElement>('#media-library-header');
        const contentContainer = this.container.querySelector<HTMLElement>('#media-library-content');
        if (!headerContainer || !contentContainer) return;

        this.renderHeader(headerContainer);
        this.renderContent(contentContainer);
    }

    private getActiveLayout(): LibraryLayoutMode {
        return this.state.isGridSupported ? this.state.preferredLayout : 'list';
    }

    private getUniqueTypes(): string[] {
        return Array.from(
            new Set(this.state.mediaList.map((media) => resolveDisplayContentType(media)))
        ).sort((a, b) => a.localeCompare(b));
    }

    private getVisibleMediaList(): Media[] {
        const {
            mediaList,
            searchQuery,
            typeFilters,
            statusFilters,
            hideArchived,
            filterRules,
        } = this.state;
        const normalizedQuery = searchQuery.toLowerCase();
        const standardFilteredList = mediaList.filter((media) => {
            const matchesQuery = media.title.toLowerCase().includes(normalizedQuery)
                || (media.variant || '').toLowerCase().includes(normalizedQuery);
            const mediaType = resolveDisplayContentType(media);
            const typeMatch = typeFilters.length === 0 || typeFilters.includes(mediaType);
            const statusMatch = statusFilters.length === 0 || statusFilters.includes(media.tracking_status);
            const isArchived = media.status === MEDIA_STATUS.ARCHIVED;
            const archiveMatch = !hideArchived || !isArchived;
            return matchesQuery && typeMatch && statusMatch && archiveMatch;
        });
        const extraDataIndex = this.getExtraDataIndex();
        const filteredList = filterMediaByExtraData(
            standardFilteredList,
            filterRules,
            extraDataIndex,
        );

        return applyLibrarySort(filteredList, {
            stages: this.state.sortStages,
            keepOngoingFirst: this.state.keepOngoingFirst,
            keepArchivedLast: this.state.keepArchivedLast,
            metricsByMediaId: this.state.listMetricsByMediaId,
            extraDataIndex,
            contentTypeOrder: this.state.contentTypeOrder,
            trackingStatusOrder: this.state.trackingStatusOrder,
        });
    }

    private getExtraDataIndex(): Map<number, Record<string, string>> {
        this.refreshExtraDataMemo();
        return this.memoizedExtraDataIndex;
    }

    private getExtraFieldNames(): string[] {
        this.refreshExtraDataMemo();
        return this.memoizedExtraFieldNames;
    }

    private getExtraDataFacets(): LibraryExtraDataFacets {
        this.refreshExtraDataMemo();
        return this.memoizedExtraDataFacets;
    }

    private refreshExtraDataMemo() {
        if (this.memoizedExtraDataMediaList === this.state.mediaList) return;

        this.memoizedExtraDataIndex = buildExtraDataIndex(this.state.mediaList);
        this.memoizedExtraFieldNames = getUniqueExtraFieldNames(this.memoizedExtraDataIndex);
        this.memoizedExtraDataFacets = getLibraryExtraDataFacets(this.memoizedExtraDataIndex);
        this.memoizedExtraDataMediaList = this.state.mediaList;
    }

    private getActiveFilterCount(): number {
        const extraDataIndex = this.getExtraDataIndex();
        const readyRuleCount = this.state.filterRules.filter(rule => (
            isLibraryFilterRuleReady(
                rule,
                extraDataIndex,
                this.memoizedExtraDataFacets,
            )
        )).length;
        return this.state.statusFilters.length
            + this.state.typeFilters.length
            + readyRuleCount;
    }

    private getSortLevelCount(): number {
        return this.state.sortStages.length;
    }

    private renderFilterChipGroup(
        label: string,
        group: 'status' | 'type',
        values: readonly string[],
        selectedValues: string[],
    ): string {
        const chips = [
            `<button type="button" class="media-filter-chip ${selectedValues.length === 0 ? 'is-active' : ''}" data-filter-group="${group}" data-filter-value="${FILTERS.ALL}" aria-pressed="${selectedValues.length === 0}">${FILTERS.ALL}</button>`,
            ...values.map((value) => {
                const isActive = selectedValues.includes(value);
                const escapedValue = escapeHTML(value);
                return `<button type="button" class="media-filter-chip ${isActive ? 'is-active' : ''}" data-filter-group="${group}" data-filter-value="${escapeAttribute(value)}" aria-pressed="${isActive}">${escapedValue}</button>`;
            }),
        ].join('');

        return `
            <div class="media-grid-filter-row">
                <div class="media-grid-filter-label">${label}</div>
                <div class="media-grid-chip-list" role="group" aria-label="${label} filters">
                    ${chips}
                </div>
            </div>
        `;
    }

    private renderExtraFilterFieldOptions(rule: LibraryExtraFilterRule, valuedFieldNames: string[]): string {
        return valuedFieldNames.map((fieldName) => {
            const isSelected = fieldName.toLowerCase() === rule.fieldName.toLowerCase();
            return `<option value="${escapeAttribute(fieldName)}" ${isSelected ? 'selected' : ''}>${escapeHTML(fieldName)}</option>`;
        }).join('');
    }

    private renderExtraFilterOperatorOptions(rule: LibraryExtraFilterRule): string {
        const valueKind = getLibraryExtraFieldValueKind(this.getExtraDataIndex(), rule.fieldName);
        const operators = valueKind === 'numeric'
            ? LIBRARY_NUMERIC_FILTER_OPERATORS
            : LIBRARY_TEXT_FILTER_OPERATORS;

        return operators.map((operator) => (
            `<option value="${operator}" ${operator === rule.operator ? 'selected' : ''}>${LIBRARY_EXTRA_FILTER_OPERATOR_LABELS[operator]}</option>`
        )).join('');
    }

    private renderFilterLogicOptions(rule: LibraryFilterRule, ruleIndex: number): string {
        let selectedValue: string;
        if (ruleIndex === 0) {
            selectedValue = rule.negated ? 'not' : 'match';
        } else {
            selectedValue = rule.join;
            if (rule.negated) selectedValue += 'Not';
        }
        const options = ruleIndex === 0
            ? [
                { value: 'match', label: 'Match' },
                { value: 'not', label: 'NOT' },
            ]
            : [
                { value: 'and', label: 'AND' },
                { value: 'or', label: 'OR' },
                { value: 'andNot', label: 'AND NOT' },
                { value: 'orNot', label: 'OR NOT' },
            ];

        return options.map(({ value, label }) => (
            `<option value="${value}" ${value === selectedValue ? 'selected' : ''}>${label}</option>`
        )).join('');
    }

    private renderExtraFilterRule(
        rule: LibraryExtraFilterRule,
        ruleIndex: number,
        valuedFieldNames: string[],
    ): string {
        const valueKind = getLibraryExtraFieldValueKind(this.getExtraDataIndex(), rule.fieldName);
        const inputMode = valueKind === 'numeric' ? 'inputmode="decimal"' : '';

        return `
            <div class="media-extra-filter-rule" data-rule-kind="extra" data-rule-index="${ruleIndex}">
                <select class="media-filter-logic" data-rule-index="${ruleIndex}" aria-label="Rule ${ruleIndex + 1} logic">
                    ${this.renderFilterLogicOptions(rule, ruleIndex)}
                </select>
                <select class="media-extra-filter-field" data-rule-index="${ruleIndex}" aria-label="Field rule ${ruleIndex + 1} field">
                    ${this.renderExtraFilterFieldOptions(rule, valuedFieldNames)}
                </select>
                <select class="media-extra-filter-operator" data-rule-index="${ruleIndex}" aria-label="Field rule ${ruleIndex + 1} operator">
                    ${this.renderExtraFilterOperatorOptions(rule)}
                </select>
                <input
                    type="text"
                    class="media-extra-filter-value"
                    data-rule-index="${ruleIndex}"
                    aria-label="Field rule ${ruleIndex + 1} value"
                    placeholder="Value"
                    value="${escapeAttribute(rule.value)}"
                    ${inputMode}
                    autocomplete="off"
                />
                <button type="button" class="media-filter-rule-remove" data-rule-index="${ruleIndex}" aria-label="Remove field rule ${ruleIndex + 1}">×</button>
            </div>
        `;
    }

    private renderBooleanTagFilterRule(rule: LibraryFilterRule, ruleIndex: number): string {
        if (rule.kind !== 'booleanTag') return '';

        return `
            <div class="media-extra-filter-rule" data-rule-kind="booleanTag" data-rule-index="${ruleIndex}">
                <select class="media-filter-logic" data-rule-index="${ruleIndex}" aria-label="Rule ${ruleIndex + 1} logic">
                    ${this.renderFilterLogicOptions(rule, ruleIndex)}
                </select>
                <div class="media-boolean-tag-condition" aria-label="Boolean tag ${escapeAttribute(rule.tagName)}">
                    <span>Tag</span>
                    <strong>${escapeHTML(rule.tagName)}</strong>
                </div>
                <button type="button" class="media-filter-rule-remove" data-rule-index="${ruleIndex}" aria-label="Remove boolean tag rule ${ruleIndex + 1}">×</button>
            </div>
        `;
    }

    private renderFilterRules(valuedFieldNames: string[], booleanTagNames: string[]): string {
        if (valuedFieldNames.length === 0 && booleanTagNames.length === 0) return '';

        const rulesMarkup = this.state.filterRules.map((rule, ruleIndex) => (
            rule.kind === 'extra'
                ? this.renderExtraFilterRule(rule, ruleIndex, valuedFieldNames)
                : this.renderBooleanTagFilterRule(rule, ruleIndex)
        )).join('');
        const selectedBooleanTags = new Set(
            this.state.filterRules
                .filter(rule => rule.kind === 'booleanTag')
                .map(rule => rule.tagName.toLowerCase()),
        );
        const availableBooleanTagNames = booleanTagNames
            .filter(tagName => !selectedBooleanTags.has(tagName.toLowerCase()));
        const availableBooleanTagOptions = availableBooleanTagNames
            .map(tagName => `<option value="${escapeAttribute(tagName)}">${escapeHTML(tagName)}</option>`)
            .join('');
        const booleanTagSelector = availableBooleanTagNames.length > 0
            ? `
                <select id="media-boolean-tag-add" class="media-boolean-tag-add" aria-label="Add tag filter">
                    <option value="">+ Add tag…</option>
                    ${availableBooleanTagOptions}
                </select>
            `
            : '';
        const fieldRuleButton = valuedFieldNames.length > 0
            ? '<button type="button" class="media-sort-add-level" id="btn-add-extra-filter-rule">+ Add filter rule</button>'
            : '';

        return `
            <div class="media-grid-filter-row">
                <div class="media-grid-filter-label">Rules</div>
                <div class="media-extra-filter-builder">
                    <div class="media-extra-filter-rules" id="media-filter-rules">${rulesMarkup}</div>
                    <div class="media-filter-add-controls">
                        ${booleanTagSelector}
                        ${fieldRuleButton}
                    </div>
                    <p class="media-extra-filter-note">${LIBRARY_FILTER_EXPRESSION_NOTE}</p>
                </div>
            </div>
        `;
    }

    private renderSortSwitches(): string {
        const archivedDisabled = this.state.hideArchived;

        const switchesMarkup = SORT_SWITCH_CONFIGS.map(({ id, label, stateKey, disabledWhenArchivedHidden }) => {
            const isDisabled = disabledWhenArchivedHidden && archivedDisabled;
            const isChecked = this.state[stateKey];

            return `
                <label class="media-sort-switch ${isDisabled ? 'is-disabled' : ''}" id="${id}-switch">
                    <span>${label}</span>
                    <span class="switch">
                        <input type="checkbox" id="${id}" ${isChecked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}>
                        <span class="slider round"></span>
                    </span>
                </label>
            `;
        }).join('');

        return `
            <div class="media-sort-switch-group" role="group" aria-label="Library grouping and ordering switches">
                ${switchesMarkup}
            </div>
        `;
    }

    private renderSortFieldOptions(stageIndex: number, extraFieldNames: string[]): string {
        const usedFieldKeys = new Set(
            this.state.sortStages
                .filter((_, index) => index !== stageIndex)
                .map((stage) => toSortFieldOptionValue(stage.field)),
        );
        const currentFieldKey = toSortFieldOptionValue(this.state.sortStages[stageIndex].field);

        const renderBuiltinOption = (key: LibraryBuiltinSortKey): string => {
            const fieldKey = toSortFieldOptionValue({ kind: 'builtin', key });
            if (usedFieldKeys.has(fieldKey)) return '';
            const isSelected = fieldKey === currentFieldKey;
            return `<option value="${fieldKey}" ${isSelected ? 'selected' : ''}>${LIBRARY_BUILTIN_SORT_LABELS[key]}</option>`;
        };

        const libraryOptions = LIBRARY_SORT_GROUP_LIBRARY_KEYS.map(renderBuiltinOption).join('');
        const activityOptions = LIBRARY_SORT_GROUP_ACTIVITY_KEYS.map(renderBuiltinOption).join('');

        const fieldOptions = extraFieldNames.map((fieldName) => {
            const fieldKey = toSortFieldOptionValue({ kind: 'extra', fieldName });
            if (usedFieldKeys.has(fieldKey)) return '';
            const isSelected = fieldKey === currentFieldKey;
            const escapedFieldName = escapeHTML(fieldName);
            return `<option value="${escapeAttribute(fieldKey)}" ${isSelected ? 'selected' : ''}>${escapedFieldName}</option>`;
        }).join('');

        return `
            <optgroup label="Library">${libraryOptions}</optgroup>
            <optgroup label="Activity">${activityOptions}</optgroup>
            ${fieldOptions ? `<optgroup label="Fields">${fieldOptions}</optgroup>` : ''}
        `;
    }

    private renderSortLevelRow(stage: LibrarySortStage, stageIndex: number, extraFieldNames: string[]): string {
        const levelLabel = stageIndex === 0 ? 'Sort by' : 'Then by';
        const isDefaultField = stage.field.kind === 'builtin' && stage.field.key === 'default';

        return `
            <div class="media-sort-level-row">
                <div class="media-sort-level-label">${levelLabel}</div>
                <select class="media-sort-level-select" data-level-index="${stageIndex}" aria-label="${levelLabel} field">
                    ${this.renderSortFieldOptions(stageIndex, extraFieldNames)}
                </select>
                <div class="media-sort-direction-toggle" role="group" aria-label="${levelLabel} direction">
                    <button type="button" class="media-sort-direction-option ${stage.direction === 'ascending' ? 'is-active' : ''}" data-level-index="${stageIndex}" data-direction="ascending" ${isDefaultField ? 'disabled' : ''}>Ascending</button>
                    <button type="button" class="media-sort-direction-option ${stage.direction === 'descending' ? 'is-active' : ''}" data-level-index="${stageIndex}" data-direction="descending" ${isDefaultField ? 'disabled' : ''}>Descending</button>
                </div>
                <button type="button" class="media-sort-level-remove" data-level-index="${stageIndex}" aria-label="Remove ${levelLabel.toLowerCase()} level">×</button>
            </div>
        `;
    }

    private renderSortPanelBody(): string {
        const extraFieldNames = this.getExtraFieldNames();
        const levelsMarkup = this.state.sortStages
            .map((stage, stageIndex) => this.renderSortLevelRow(stage, stageIndex, extraFieldNames))
            .join('');

        return `
            <div class="media-sort-tray">
                ${this.renderSortSwitches()}
                <div class="media-sort-levels" id="media-sort-levels" aria-describedby="media-sort-tiebreaker-note">
                    ${levelsMarkup}
                </div>
                <button type="button" class="media-sort-add-level" id="btn-add-sort-level">+ Add sort</button>
                <div class="media-sort-tiebreaker-divider"></div>
                <p class="media-sort-tiebreaker-note" id="media-sort-tiebreaker-note">${LIBRARY_SORT_TIEBREAKER_NOTE}</p>
            </div>
        `;
    }

    private renderGridZoomControl(): string {
        const gridZoomDisabled = this.getActiveLayout() !== 'grid';
        const disabledAttribute = (isDisabled: boolean) => (isDisabled ? 'disabled' : '');

        return `
            <div class="media-grid-zoom" role="group" aria-label="Library cover size">
                <button
                    type="button"
                    class="media-grid-zoom-button"
                    id="btn-grid-zoom-out"
                    aria-label="Show more, smaller library covers"
                    title="Show more covers"
                    ${disabledAttribute(gridZoomDisabled || this.state.gridZoom <= LIBRARY_GRID_ZOOM.MIN)}
                >−</button>
                <button
                    type="button"
                    class="media-grid-zoom-value"
                    id="btn-grid-zoom-reset"
                    aria-label="Reset library cover size to 100%"
                    title="Reset cover size"
                    ${disabledAttribute(gridZoomDisabled)}
                >${this.state.gridZoom}%</button>
                <button
                    type="button"
                    class="media-grid-zoom-button"
                    id="btn-grid-zoom-in"
                    aria-label="Show fewer, larger library covers"
                    title="Show larger covers"
                    ${disabledAttribute(gridZoomDisabled || this.state.gridZoom >= LIBRARY_GRID_ZOOM.MAX)}
                >+</button>
            </div>
        `;
    }

    private renderHeader(container: HTMLElement) {
        container.innerHTML = '';

        const uniqueTypes = this.getUniqueTypes();
        const activeLayout = this.getActiveLayout();
        const activeFilterCount = this.getActiveFilterCount();
        const { valuedFieldNames, booleanTagNames } = this.getExtraDataFacets();
        const compactHint = this.state.isGridSupported
            ? ''
            : '<span class="media-layout-hint">Grid re-enables when the window is wider.</span>';
        const sortLevelCount = this.getSortLevelCount();

        const filterTrayBody = `
            <div id="media-grid-filter-tray" class="media-grid-filter-tray">
                ${this.renderFilterChipGroup('Status', 'status', TRACKING_STATUSES, this.state.statusFilters)}
                ${this.renderFilterChipGroup('Type', 'type', uniqueTypes, this.state.typeFilters)}
                ${this.renderFilterRules(valuedFieldNames, booleanTagNames)}
                <div class="media-grid-filter-row">
                    <div class="media-grid-filter-label">Other</div>
                    <div class="media-grid-archive-toggle" style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 0.85rem; color: var(--text-secondary);">Hide Archived</span>
                        <label class="switch" style="font-size: 0.7rem;">
                            <input type="checkbox" id="grid-hide-archived" ${this.state.hideArchived ? 'checked' : ''}>
                            <span class="slider round"></span>
                        </label>
                    </div>
                </div>
            </div>
        `;

        const header = html`
            <div class="media-grid-toolbar-shell">
                <div class="media-grid-toolbar">
                    <div class="media-grid-toolbar-primary">
                        <h2 style="margin: 0.5rem auto 0.5em 0; color: var(--text-primary); white-space: nowrap;">Library</h2>
                        <button class="btn btn-ghost" id="btn-add-media-grid" style="font-size: 0.9rem; padding: 0.4rem 0.6rem;">+ New Media</button>
                        <button class="btn btn-ghost" id="btn-refresh-grid" title="Refresh Library" style="padding: 0.4rem; display: flex; align-items: center; justify-content: center;">
                            <svg id="refresh-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                                <g transform="rotate(0 0 30)">><path d="M17.91 14c-.478 2.833-2.943 5-5.91 5-3.308 0-6-2.692-6-6s2.692-6 6-6h2.172l-2.086 2.086L13.5 10.5 18 6l-4.5-4.5-1.414 1.414L14.172 5H12c-4.418 0-8 3.582-8 8s3.582 8 8 8c4.08 0 7.438-3.055 7.93-7h-2.02z"/></g>
                            </svg>
                        </button>
                    </div>

                    <div class="media-grid-toolbar-search">
                        <input type="text" id="grid-search-filter" placeholder="Search title..." style="width: 100%; min-width: 0; padding: 0.4rem 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); outline: none;" value="${this.state.searchQuery}" autocomplete="off" />
                    </div>

                    <div class="media-grid-toolbar-controls">
                        <div class="toggle-shell">
                            <div class="toggle" role="group" aria-label="Library layout toggle">
                                <button
                                    type="button"
                                    class="toggle-option ${activeLayout === 'grid' ? 'is-active' : ''}"
                                    id="btn-layout-grid"
                                    aria-pressed="${activeLayout === 'grid'}"
                                    ${this.state.isGridSupported ? '' : 'disabled'}
                                >
                                    Grid
                                </button>
                                <button
                                    type="button"
                                    class="toggle-option ${activeLayout === 'list' ? 'is-active' : ''}"
                                    id="btn-layout-list"
                                    aria-pressed="${activeLayout === 'list'}"
                                >
                                    List
                                </button>
                            </div>
                            ${rawHtml(compactHint)}
                        </div>

                        ${rawHtml(this.renderGridZoomControl())}

                        ${rawHtml(renderPaneToggleButton({
                            id: 'btn-toggle-filters',
                            label: 'Filters',
                            panelId: 'media-grid-filter-panel',
                            isExpanded: this.state.filtersExpanded,
                            count: activeFilterCount,
                            countLabel: 'active library filters',
                        }))}

                        ${rawHtml(renderPaneToggleButton({
                            id: 'btn-toggle-sort',
                            label: 'Sort',
                            panelId: 'media-sort-panel',
                            isExpanded: this.state.sortExpanded,
                            count: sortLevelCount,
                            countLabel: 'active sort levels',
                        }))}
                    </div>
                </div>

                ${rawHtml(renderCollapsiblePanel({
                    id: 'media-grid-filter-panel',
                    isExpanded: this.state.filtersExpanded,
                    body: filterTrayBody,
                }))}

                ${rawHtml(renderCollapsiblePanel({
                    id: 'media-sort-panel',
                    isExpanded: this.state.sortExpanded,
                    body: this.renderSortPanelBody(),
                }))}
            </div>
        `;

        container.appendChild(header);
        this.setupListeners(header);
    }

    private renderContent(container: HTMLElement) {
        this.activeLayoutComponent?.destroy?.();
        container.innerHTML = '';

        const layoutRoot = document.createElement('div');
        layoutRoot.className = 'media-library-layout-root';
        // Flex children default to min-width:auto, which can prevent shrinking and create
        // horizontal overflow (then clipped by the app shell). Allow the library layouts
        // to shrink properly at narrow window widths.
        layoutRoot.style.cssText = 'display: flex; flex: 1; min-height: 0; min-width: 0;';
        container.appendChild(layoutRoot);

        const rows: LibraryRow[] = measureSynchronous(
            'aggregation',
            'library_filter',
            () => buildLibraryRows(
                this.getVisibleMediaList(),
                this.state.groupByType ? this.state.contentTypeOrder : null,
            ),
            { media_count: this.state.mediaList.length },
        );

        // Navigation order is taken from the rendered rows rather than the sorted list, so the
        // detail view's prev/next follows what is actually on screen once type grouping reorders
        // items into sections.
        const navigationIds = rows.flatMap((row) => (
            row.kind === 'item' && typeof row.media.id === 'number' ? [row.media.id] : []
        ));
        const onVisibleMediaClick = (mediaId: number) => {
            this.onMediaClick({ mediaId, navigationIds: [...navigationIds] });
        };

        if (this.getActiveLayout() === 'grid') {
            this.activeLayoutComponent = new MediaGrid(
                layoutRoot,
                { rows, gridZoom: this.state.gridZoom },
                onVisibleMediaClick,
            );
        } else {
            this.activeLayoutComponent = new MediaList(
                layoutRoot,
                {
                    rows,
                    metricsByMediaId: this.state.listMetricsByMediaId,
                    isMetricsLoading: this.state.isListMetricsLoading,
                },
                onVisibleMediaClick,
            );
        }

        this.activeLayoutComponent.render();
    }

    private setupListeners(header: HTMLElement) {
        header.querySelector('#btn-add-media-grid')?.addEventListener('click', async () => {
            const result = await showAddMediaModal();
            if (!result) return;

            const newId = await addMedia({
                title: result.title,
                variant: result.variant,
                default_activity_type: result.type,
                status: MEDIA_STATUS.ACTIVE,
                language: 'Japanese',
                description: '',
                cover_image: '',
                extra_data: '{}',
                content_type: result.contentType,
                tracking_status: 'Untracked',
            });
            await this.onDataChange(newId);
            globalThis.dispatchEvent(new CustomEvent(EVENTS.LOCAL_DATA_CHANGED));
        });

        header.querySelector('#btn-refresh-grid')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget as HTMLElement;
            const icon = btn.querySelector<HTMLElement>('#refresh-icon');
            if (icon) icon.style.animation = 'spin 0.8s linear infinite';

            await this.onDataChange();

            if (icon) icon.style.animation = '';
        });

        const searchFilter = header.querySelector<HTMLInputElement>('#grid-search-filter');
        searchFilter?.addEventListener('input', () => {
            this.state.searchQuery = searchFilter.value;
            this.container.querySelector<HTMLElement>('#media-library-content')
                ?.setAttribute('aria-busy', 'true');
            if (this.searchRenderTimer !== null) {
                globalThis.clearTimeout(this.searchRenderTimer);
            }
            this.searchRenderTimer = globalThis.setTimeout(() => {
                this.searchRenderTimer = null;
                const content = this.container.querySelector<HTMLElement>('#media-library-content');
                if (!content) return;
                this.renderContent(content);
                content.setAttribute('aria-busy', 'false');
                this.notifyFilterChange();
            }, 120);
        });

        header.querySelector('#btn-toggle-filters')?.addEventListener('click', () => {
            this.toggleFiltersPanel();
        });

        header.querySelector('#btn-toggle-sort')?.addEventListener('click', () => {
            this.toggleSortPanel();
        });

        header.querySelectorAll<HTMLButtonElement>('.media-filter-chip').forEach((chip) => {
            chip.addEventListener('click', () => {
                const group = chip.dataset.filterGroup;
                const value = chip.dataset.filterValue;
                if (!group || !value) return;

                if (group === 'status') {
                    this.updateMultiFilter('statusFilters', value, [...TRACKING_STATUSES]);
                } else {
                    this.updateMultiFilter('typeFilters', value, this.getUniqueTypes());
                }
            });
        });

        const hideArchived = header.querySelector<HTMLInputElement>('#grid-hide-archived');
        hideArchived?.addEventListener('change', () => {
            this.state.hideArchived = hideArchived.checked;
            this.applyPresentationStateChange();
        });

        header.querySelector('#btn-layout-grid')?.addEventListener('click', () => {
            this.setLayout('grid');
        });

        header.querySelector('#btn-layout-list')?.addEventListener('click', () => {
            this.setLayout('list');
        });

        header.querySelector('#btn-grid-zoom-out')?.addEventListener('click', () => {
            this.setGridZoom(this.state.gridZoom - LIBRARY_GRID_ZOOM.STEP);
        });

        header.querySelector('#btn-grid-zoom-reset')?.addEventListener('click', () => {
            this.setGridZoom(LIBRARY_GRID_ZOOM.DEFAULT);
        });

        header.querySelector('#btn-grid-zoom-in')?.addEventListener('click', () => {
            this.setGridZoom(this.state.gridZoom + LIBRARY_GRID_ZOOM.STEP);
        });

        SORT_SWITCH_CONFIGS.forEach(({ id, stateKey }) => {
            const switchInput = header.querySelector<HTMLInputElement>(`#${id}`);
            switchInput?.addEventListener('change', () => {
                this.state[stateKey] = switchInput.checked;
                this.applyPresentationStateChange();
            });
        });

        header.querySelectorAll<HTMLSelectElement>('.media-sort-level-select').forEach((select) => {
            select.addEventListener('change', () => {
                const stageIndex = Number(select.dataset.levelIndex);
                const stage = this.state.sortStages[stageIndex];
                if (!stage) return;

                const extraFieldNames = this.getExtraFieldNames();
                const parsedField = fromSortFieldOptionValue(select.value, extraFieldNames);
                if (!parsedField) return;

                stage.field = parsedField;
                this.applyPresentationStateChange();
            });
        });

        header.querySelectorAll<HTMLButtonElement>('.media-sort-direction-option').forEach((button) => {
            button.addEventListener('click', () => {
                const stageIndex = Number(button.dataset.levelIndex);
                const direction = button.dataset.direction as LibrarySortDirection | undefined;
                const stage = this.state.sortStages[stageIndex];
                if (!stage || !direction) return;

                stage.direction = direction;
                this.applyPresentationStateChange();
            });
        });

        header.querySelectorAll<HTMLButtonElement>('.media-sort-level-remove').forEach((button) => {
            button.addEventListener('click', () => {
                const stageIndex = Number(button.dataset.levelIndex);
                this.state.sortStages = this.state.sortStages.filter((_, index) => index !== stageIndex);
                this.applyPresentationStateChange();
            });
        });

        header.querySelector('#btn-add-sort-level')?.addEventListener('click', () => {
            const extraFieldNames = this.getExtraFieldNames();
            const usedFieldKeys = new Set(this.state.sortStages.map((stage) => toSortFieldOptionValue(stage.field)));
            const nextField = this.pickNextAvailableSortField(usedFieldKeys, extraFieldNames);
            this.state.sortStages = [...this.state.sortStages, { field: nextField, direction: 'ascending' }];
            this.applyPresentationStateChange();
        });

        header.querySelectorAll<HTMLSelectElement>('.media-extra-filter-field').forEach((select) => {
            select.addEventListener('change', () => {
                const ruleIndex = Number(select.dataset.ruleIndex);
                const rule = this.state.filterRules[ruleIndex];
                const fieldName = this.getExtraDataFacets().valuedFieldNames
                    .find(name => name.toLowerCase() === select.value.toLowerCase());
                if (rule?.kind !== 'extra' || fieldName === undefined) return;

                const valueKind = getLibraryExtraFieldValueKind(this.getExtraDataIndex(), fieldName);
                rule.fieldName = fieldName;
                rule.operator = getDefaultLibraryExtraFilterOperator(valueKind);
                rule.value = '';
                this.applyPresentationStateChange();
            });
        });

        header.querySelectorAll<HTMLSelectElement>('.media-extra-filter-operator').forEach((select) => {
            select.addEventListener('change', () => {
                const ruleIndex = Number(select.dataset.ruleIndex);
                const rule = this.state.filterRules[ruleIndex];
                if (rule?.kind !== 'extra') return;

                rule.operator = select.value as LibraryExtraFilterOperator;
                this.applyPresentationStateChange();
            });
        });

        header.querySelectorAll<HTMLInputElement>('.media-extra-filter-value').forEach((input) => {
            input.addEventListener('input', () => {
                const ruleIndex = Number(input.dataset.ruleIndex);
                const rule = this.state.filterRules[ruleIndex];
                if (rule?.kind !== 'extra') return;

                rule.value = input.value;
                this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
                this.updateFilterCountBadge(header);
                this.notifyFilterChange();
            });
        });

        header.querySelectorAll<HTMLSelectElement>('.media-filter-logic').forEach((select) => {
            select.addEventListener('change', () => {
                const ruleIndex = Number(select.dataset.ruleIndex);
                const rule = this.state.filterRules[ruleIndex];
                if (!rule) return;

                const logic = select.value;
                rule.join = logic.startsWith('or') ? 'or' : 'and';
                rule.negated = logic === 'not' || logic.endsWith('Not');
                this.applyPresentationStateChange();
            });
        });

        header.querySelectorAll<HTMLButtonElement>('.media-filter-rule-remove').forEach((button) => {
            button.addEventListener('click', () => {
                const ruleIndex = Number(button.dataset.ruleIndex);
                this.state.filterRules = this.state.filterRules
                    .filter((_, index) => index !== ruleIndex);
                this.applyPresentationStateChange();
            });
        });

        header.querySelector('#btn-add-extra-filter-rule')?.addEventListener('click', () => {
            const fieldName = this.getExtraDataFacets().valuedFieldNames[0];
            if (fieldName === undefined) return;

            const valueKind = getLibraryExtraFieldValueKind(this.getExtraDataIndex(), fieldName);
            this.state.filterRules = [
                ...this.state.filterRules,
                {
                    kind: 'extra',
                    fieldName,
                    operator: getDefaultLibraryExtraFilterOperator(valueKind),
                    value: '',
                    join: 'and',
                    negated: false,
                },
            ];
            this.applyPresentationStateChange();
        });

        header.querySelector<HTMLSelectElement>('#media-boolean-tag-add')?.addEventListener('change', (event) => {
            const select = event.currentTarget as HTMLSelectElement;
            if (select.value === '') return;

            const tagName = this.getExtraDataFacets().booleanTagNames
                .find(name => name.toLowerCase() === select.value.toLowerCase());
            const isAlreadySelected = this.state.filterRules.some(rule => (
                rule.kind === 'booleanTag'
                && rule.tagName.toLowerCase() === tagName?.toLowerCase()
            ));
            if (tagName === undefined || isAlreadySelected) return;

            this.state.filterRules = [
                ...this.state.filterRules,
                {
                    kind: 'booleanTag',
                    tagName,
                    join: 'and',
                    negated: false,
                },
            ];
            this.applyPresentationStateChange();
        });
    }

    private pickNextAvailableSortField(usedFieldKeys: Set<string>, extraFieldNames: string[]): LibrarySortField {
        const candidateBuiltinKeys = LIBRARY_BUILTIN_SORT_KEYS.filter((key) => key !== 'default');
        for (const key of candidateBuiltinKeys) {
            const field: LibrarySortField = { kind: 'builtin', key };
            if (!usedFieldKeys.has(toSortFieldOptionValue(field))) return field;
        }

        for (const fieldName of extraFieldNames) {
            const field: LibrarySortField = { kind: 'extra', fieldName };
            if (!usedFieldKeys.has(toSortFieldOptionValue(field))) return field;
        }

        return { kind: 'builtin', key: 'default' };
    }

    private applyPresentationStateChange() {
        this.renderHeader(this.container.querySelector<HTMLElement>('#media-library-header')!);
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        this.notifyFilterChange();
    }

    private updateFilterCountBadge(header: HTMLElement) {
        const button = header.querySelector<HTMLButtonElement>('#btn-toggle-filters');
        if (!button) return;

        const count = this.getActiveFilterCount();
        let badge = button.querySelector<HTMLElement>('.media-grid-filter-count');
        if (count === 0) {
            badge?.remove();
            return;
        }

        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'media-grid-filter-count';
            button.querySelector('svg')?.before(badge);
        }
        badge.setAttribute('aria-label', `${count} active library filters`);
        badge.textContent = count.toString();
    }

    private setLayout(layout: LibraryLayoutMode) {
        if (layout === 'grid' && !this.state.isGridSupported) {
            return;
        }

        if (this.state.preferredLayout === layout) {
            return;
        }

        this.state.preferredLayout = layout;
        this.renderHeader(this.container.querySelector<HTMLElement>('#media-library-header')!);
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        this.onLayoutChange?.(layout);
    }

    private setGridZoom(gridZoom: number) {
        if (this.getActiveLayout() !== 'grid') {
            return;
        }

        const nextGridZoom = normalizeLibraryGridZoom(gridZoom);
        if (this.state.gridZoom === nextGridZoom) {
            return;
        }

        this.state.gridZoom = nextGridZoom;
        this.renderHeader(this.container.querySelector<HTMLElement>('#media-library-header')!);
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        this.onGridZoomChange?.(nextGridZoom);
    }

    private toggleFiltersPanel() {
        this.togglePanel('media-grid-filter-panel', 'btn-toggle-filters', this.state.filtersExpanded, (nextExpanded) => {
            this.state.filtersExpanded = nextExpanded;
        });
    }

    private toggleSortPanel() {
        this.togglePanel('media-sort-panel', 'btn-toggle-sort', this.state.sortExpanded, (nextExpanded) => {
            this.state.sortExpanded = nextExpanded;
        });
    }

    private togglePanel(panelId: string, buttonId: string, isExpanded: boolean, setExpanded: (nextExpanded: boolean) => void) {
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
        const panel = header?.querySelector<HTMLElement>(`#${panelId}`);
        const button = header?.querySelector<HTMLButtonElement>(`#${buttonId}`);
        if (!panel || !button) return;

        const nextExpanded = !isExpanded;
        setExpanded(nextExpanded);
        button.setAttribute('aria-expanded', String(nextExpanded));
        panel.setAttribute('aria-hidden', String(!nextExpanded));
        panel.classList.toggle('is-expanded', nextExpanded);
        panel.classList.toggle('is-collapsed', !nextExpanded);

        if (nextExpanded) {
            panel.style.height = 'auto';
            panel.style.opacity = '1';
            panel.style.transform = 'translateY(0)';
            panel.style.overflow = 'visible';
            panel.style.pointerEvents = 'auto';
        } else {
            panel.style.height = '0px';
            panel.style.opacity = '0';
            panel.style.transform = 'translateY(-8px)';
            panel.style.overflow = 'hidden';
            panel.style.pointerEvents = 'none';
        }
    }

    private updateMultiFilter(
        key: 'statusFilters' | 'typeFilters',
        value: string,
        availableValues: string[],
    ) {
        const currentValues = this.state[key];
        let nextValues: string[];

        if (value === FILTERS.ALL) {
            nextValues = [];
        } else if (currentValues.includes(value)) {
            nextValues = currentValues.filter((currentValue) => currentValue !== value);
        } else {
            nextValues = [...currentValues, value].sort((a, b) => availableValues.indexOf(a) - availableValues.indexOf(b));
        }

        if (
            nextValues.length === currentValues.length
            && nextValues.every((currentValue, index) => currentValue === currentValues[index])
        ) {
            return;
        }

        if (key === 'statusFilters') {
            this.state.statusFilters = nextValues;
        } else {
            this.state.typeFilters = nextValues;
        }
        this.renderHeader(this.container.querySelector<HTMLElement>('#media-library-header')!);
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        this.notifyFilterChange();
    }

    private notifyFilterChange() {
        this.onFilterChange?.({
            searchQuery: this.state.searchQuery,
            typeFilters: [...this.state.typeFilters],
            statusFilters: [...this.state.statusFilters],
            hideArchived: this.state.hideArchived,
            filterRules: this.state.filterRules.map(rule => ({ ...rule })),
            sortStages: this.state.sortStages.map((stage) => ({ ...stage })),
            groupByType: this.state.groupByType,
            keepOngoingFirst: this.state.keepOngoingFirst,
            keepArchivedLast: this.state.keepArchivedLast,
        });
    }
}

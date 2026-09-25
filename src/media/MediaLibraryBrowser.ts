import { Component } from '../component';
import { html, escapeHTML, escapeAttribute, rawHtml } from '../html';
import { Media, addMedia } from '../api';
import { showAddMediaModal } from './modal';
import { createCancelableOverlay, OVERLAY_FADE_OUT_MS, type CancelableOverlayHandle } from '../modal_base';
import { captureHostFocusState, restoreHostFocusState } from '../focus_preservation';
import { CONTENT_TYPES, EVENTS, TRACKING_STATUSES, MEDIA_STATUS } from '../constants';
import { MediaGrid } from './MediaGrid';
import { MediaList } from './MediaList';
import { openLibraryBackgroundMenu, openLibraryContextMenu } from './library_context_menu';
import { createMultiSelectField, type MultiSelectField, type MultiSelectFieldOptions, type PopupMenuHandle } from '../popups';
import { LibraryPlacementBeforeRow, resolveLibraryItemPlacement } from './library_item_placement';
import {
    LIBRARY_GRID_ZOOM,
    normalizeLibraryGridZoom,
    type LibraryActivityMetrics,
    type LibraryLayoutMode,
    type LibraryMutation,
} from './library_types';
import { measureSynchronous } from '../performance';
import { Logger } from '../logger';
import { resolveDisplayContentType } from './content_type';
import {
    appendRuleGroup,
    appendRuleToGroup,
    filterMediaByExtraData,
    getDefaultLibraryExtraFilterOperator,
    getLibraryExtraDataFacets,
    getLibraryExtraFieldValueKind,
    groupLibraryFilterRules,
    isLibraryFilterRuleReady,
    LIBRARY_NUMERIC_FILTER_OPERATORS,
    LIBRARY_TEXT_FILTER_OPERATORS,
    removeLibraryFilterRule,
    removeLibraryFilterRuleGroup,
    stripNonNumericFilterValueCharacters,
    revalidateLibraryFilterRules,
    toggleLibraryFilterRuleJoin,
    type LibraryExtraDataFacets,
    type LibraryExtraFilterOperator,
    type LibraryExtraFilterRule,
    type LibraryFilterRule,
    type LibraryFilterRuleGroup,
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
    hiddenTypes: ReadonlySet<string>;
    hiddenStatuses: ReadonlySet<string>;
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
    hiddenTypes?: ReadonlySet<string>;
    hiddenStatuses?: ReadonlySet<string>;
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

const LIBRARY_GRID_UNAVAILABLE_HINT = 'Grid re-enables when the window is wider.';
const LIBRARY_SORT_TIEBREAKER_NOTE ='Ties broken by last activity (newest first)';

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
    hiddenWhenArchivedHidden: boolean;
}

const SORT_SWITCH_CONFIGS: readonly SortSwitchConfig[] = [
    { id: 'sort-group-by-type', label: 'Group by type', stateKey: 'groupByType', hiddenWhenArchivedHidden: false },
    { id: 'sort-keep-ongoing-first', label: 'Keep ongoing first', stateKey: 'keepOngoingFirst', hiddenWhenArchivedHidden: false },
    { id: 'sort-keep-archived-last', label: 'Keep archived last', stateKey: 'keepArchivedLast', hiddenWhenArchivedHidden: true },
];

const KEEP_ARCHIVED_LAST_SWITCH_ID = SORT_SWITCH_CONFIGS.find(config => config.hiddenWhenArchivedHidden)!.id;

interface SwitchRowConfig {
    id: string;
    label: string;
    isChecked: boolean;
    isHidden: boolean;
}

function renderSwitchGroup(switches: readonly SwitchRowConfig[], ariaLabel: string): string {
    const switchesMarkup = switches.map(({ id, label, isChecked, isHidden }) => `
        <label class="media-sort-switch" id="${id}-switch" ${isHidden ? 'hidden' : ''}>
            <span>${label}</span>
            <span class="switch">
                <input type="checkbox" id="${id}" ${isChecked ? 'checked' : ''} ${isHidden ? 'disabled' : ''}>
                <span class="slider round"></span>
            </span>
        </label>
    `).join('');

    return `
        <div class="media-sort-switch-group" role="group" aria-label="${ariaLabel}">
            ${switchesMarkup}
        </div>
    `;
}

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

function renderPanelStyleAttribute(isExpanded: boolean): string {
    return isExpanded
        ? 'style="height: auto; opacity: 1; transform: translateY(0); pointer-events: auto;"'
        : 'style="height: 0; opacity: 0; transform: translateY(-8px); pointer-events: none;"';
}

type LibraryPaneKind = 'filter' | 'sort';

const LIBRARY_PANE_CONFIGS: Record<LibraryPaneKind, { panelId: string; buttonId: string; title: string; modalTitleId: string }> = {
    filter: { panelId: 'media-grid-filter-panel', buttonId: 'btn-toggle-filters', title: 'Filter', modalTitleId: 'media-filter-modal-title' },
    sort: { panelId: 'media-sort-panel', buttonId: 'btn-toggle-sort', title: 'Sort', modalTitleId: 'media-sort-modal-title' },
};

function applyPanelExpansion(panel: HTMLElement, button: HTMLButtonElement, isExpanded: boolean): void {
    button.setAttribute('aria-expanded', String(isExpanded));
    panel.setAttribute('aria-hidden', String(!isExpanded));
    panel.classList.toggle('is-expanded', isExpanded);
    panel.classList.toggle('is-collapsed', !isExpanded);
    panel.style.height = isExpanded ? 'auto' : '0px';
    panel.style.opacity = isExpanded ? '1' : '0';
    panel.style.transform = isExpanded ? 'translateY(0)' : 'translateY(-8px)';
    panel.style.overflow = isExpanded ? 'visible' : 'hidden';
    panel.style.pointerEvents = isExpanded ? 'auto' : 'none';
}

const VISIBILITY_SUMMARY_LABELS: Pick<MultiSelectFieldOptions<string>, 'noneLabel' | 'allLabel' | 'partialLabel'> = {
    noneLabel: 'None shown',
    allLabel: ({ totalCount }) => ({ value: `All ${totalCount} shown` }),
    partialLabel: ({ selectedCount, totalCount }) => ({ value: `${selectedCount} of ${totalCount} shown` }),
};

type FilterSubjectKind = 'field' | 'tag';

const FILTER_SUBJECT_OPTION_SEPARATOR = ':';

function toFilterSubjectOptionValue(kind: FilterSubjectKind, name: string): string {
    return `${kind}${FILTER_SUBJECT_OPTION_SEPARATOR}${name}`;
}

function fromFilterSubjectOptionValue(optionValue: string): { kind: FilterSubjectKind; name: string } | null {
    const separatorIndex = optionValue.indexOf(FILTER_SUBJECT_OPTION_SEPARATOR);
    if (separatorIndex === -1) return null;

    const kind = optionValue.slice(0, separatorIndex);
    if (kind !== 'field' && kind !== 'tag') return null;
    return { kind, name: optionValue.slice(separatorIndex + FILTER_SUBJECT_OPTION_SEPARATOR.length) };
}

function computeTypeOptionsKey(uniqueTypes: readonly string[]): string {
    return uniqueTypes.join('\u0000');
}

export interface LibraryMediaSelection {
    mediaId: number;
    navigationIds: readonly number[];
}

export interface MediaLibraryBrowserCallbacks {
    onFilterChange?: (filters: MediaLibraryFilters) => void;
    onLayoutChange?: (layout: LibraryLayoutMode) => void;
    onGridZoomChange?: (gridZoom: number) => void;
    onActionCommitted?: () => Promise<void>;
}

export class MediaLibraryBrowser extends Component<MediaLibraryBrowserState> {
    private readonly onMediaClick: (selection: LibraryMediaSelection) => void;
    private readonly onDataChange: (jumpToId?: number) => Promise<void>;
    private readonly onFilterChange?: (filters: MediaLibraryFilters) => void;
    private readonly onLayoutChange?: (layout: LibraryLayoutMode) => void;
    private readonly onGridZoomChange?: (gridZoom: number) => void;
    private readonly onActionCommitted?: () => Promise<void>;
    private activeLayoutComponent: MediaGrid | MediaList | null = null;
    private activeLayoutKind: LibraryLayoutMode | null = null;
    private renderedRows: LibraryRow[] | null = null;
    private contextMenuHandle: PopupMenuHandle | null = null;
    private shellRendered = false;
    private headerElement: HTMLElement | null = null;
    private filterCardElement: HTMLElement | null = null;
    private sortCardElement: HTMLElement | null = null;
    private openPaneModal: { kind: LibraryPaneKind; handle: CancelableOverlayHandle } | null = null;
    private statusMultiSelectField: MultiSelectField | null = null;
    private typeMultiSelectField: MultiSelectField | null = null;
    private renderedTypeOptionsKey: string | null = null;
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
        {
            onFilterChange,
            onLayoutChange,
            onGridZoomChange,
            onActionCommitted,
        }: MediaLibraryBrowserCallbacks = {},
    ) {
        const initialExtraDataIndex = buildExtraDataIndex(initialState.mediaList);
        const revalidatedFilterRules = revalidateLibraryFilterRules(
            initialState.filterRules ?? [],
            initialExtraDataIndex,
        );
        super(container, {
            ...initialState,
            hiddenTypes: new Set(initialState.hiddenTypes),
            hiddenStatuses: new Set(initialState.hiddenStatuses),
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
        this.onActionCommitted = onActionCommitted;
    }

    public override destroy() {
        if (this.searchRenderTimer !== null) {
            globalThis.clearTimeout(this.searchRenderTimer);
            this.searchRenderTimer = null;
        }
        this.openPaneModal?.handle.dismiss();
        this.closeContextMenu();
        this.statusMultiSelectField?.close();
        this.typeMultiSelectField?.close();
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

        if (!this.headerElement) {
            this.renderHeaderShell(headerContainer);
        }
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
            hiddenTypes,
            hiddenStatuses,
            hideArchived,
            filterRules,
        } = this.state;
        const normalizedQuery = searchQuery.toLowerCase();
        const standardFilteredList = mediaList.filter((media) => {
            const matchesQuery = media.title.toLowerCase().includes(normalizedQuery)
                || (media.variant || '').toLowerCase().includes(normalizedQuery);
            const mediaType = resolveDisplayContentType(media);
            const typeMatch = !hiddenTypes.has(mediaType);
            const statusMatch = !hiddenStatuses.has(media.tracking_status);
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
        const readyRuleCount = this.state.filterRules.filter(rule => (
            isLibraryFilterRuleReady(rule, this.getExtraDataIndex(), this.getExtraDataFacets())
        )).length;
        const narrowedGroupCount = (this.state.hiddenStatuses.size > 0 ? 1 : 0)
            + (this.state.hiddenTypes.size > 0 ? 1 : 0);
        return narrowedGroupCount + readyRuleCount;
    }

    private getSortLevelCount(): number {
        return this.state.sortStages.length;
    }

    private createStatusMultiSelectField(): MultiSelectField {
        return createMultiSelectField({
            id: 'media-status-multiselect-trigger',
            label: 'Status',
            items: TRACKING_STATUSES.map((status) => ({ value: status, label: status })),
            getSelectedValues: () => new Set(
                TRACKING_STATUSES.filter((status) => !this.state.hiddenStatuses.has(status)),
            ),
            onToggle: (value, isSelected) => this.toggleHiddenStatus(value, isSelected),
            ...VISIBILITY_SUMMARY_LABELS,
        });
    }

    private createTypeMultiSelectField(uniqueTypes: string[]): MultiSelectField {
        return createMultiSelectField({
            id: 'media-type-multiselect-trigger',
            label: 'Type',
            items: uniqueTypes.map((type) => ({ value: type, label: type })),
            getSelectedValues: () => new Set(
                uniqueTypes.filter((type) => !this.state.hiddenTypes.has(type)),
            ),
            onToggle: (value, isSelected) => this.toggleHiddenType(value, isSelected),
            ...VISIBILITY_SUMMARY_LABELS,
        });
    }

    private toggleHiddenStatus(status: string, isSelected: boolean): void {
        const nextHiddenStatuses = new Set(this.state.hiddenStatuses);
        if (isSelected) nextHiddenStatuses.delete(status); else nextHiddenStatuses.add(status);
        this.state.hiddenStatuses = nextHiddenStatuses;
        this.commitVisibilityFilterChange();
    }

    private toggleHiddenType(type: string, isSelected: boolean): void {
        const nextHiddenTypes = new Set(this.state.hiddenTypes);
        if (isSelected) nextHiddenTypes.delete(type); else nextHiddenTypes.add(type);
        this.state.hiddenTypes = nextHiddenTypes;
        this.commitVisibilityFilterChange();
    }

    private commitVisibilityFilterChange(): void {
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
        if (header) this.updateFilterCountBadge(header);
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        this.notifyFilterChange();
    }

    private renderFieldOrTagOptions(
        rule: LibraryFilterRule,
        valuedFieldNames: string[],
        booleanTagNames: string[],
    ): string {
        const selectedValue = rule.kind === 'booleanTag'
            ? toFilterSubjectOptionValue('tag', rule.tagName)
            : toFilterSubjectOptionValue('field', rule.fieldName);

        const renderOption = (kind: FilterSubjectKind, name: string, label: string): string => {
            const optionValue = toFilterSubjectOptionValue(kind, name);
            const isSelected = optionValue.toLowerCase() === selectedValue.toLowerCase();
            return `<option value="${escapeAttribute(optionValue)}" ${isSelected ? 'selected' : ''}>${escapeHTML(label)}</option>`;
        };

        const fieldOptions = valuedFieldNames.map((fieldName) => renderOption('field', fieldName, fieldName)).join('');
        const tagOptions = booleanTagNames.map((tagName) => renderOption('tag', tagName, `#${tagName}`)).join('');

        return `
            ${fieldOptions ? `<optgroup label="Fields">${fieldOptions}</optgroup>` : ''}
            ${tagOptions ? `<optgroup label="Tags">${tagOptions}</optgroup>` : ''}
        `;
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

    private renderFilterNegationToggle(rule: LibraryFilterRule, ruleIndex: number): string {
        return `
            <div class="media-filter-negation-toggle" role="group" aria-label="Rule ${ruleIndex + 1} match mode">
                <button type="button" class="media-filter-negation-option ${!rule.negated ? 'is-active' : ''}" data-focus-key="filter-negation-option" data-rule-index="${ruleIndex}" data-negated="false" aria-pressed="${!rule.negated}" aria-label="Switch rule ${ruleIndex + 1} to Match">Match</button>
                <button type="button" class="media-filter-negation-option ${rule.negated ? 'is-active' : ''}" data-focus-key="filter-negation-option" data-rule-index="${ruleIndex}" data-negated="true" aria-pressed="${rule.negated}" aria-label="Switch rule ${ruleIndex + 1} to Not">Not</button>
            </div>
        `;
    }

    private renderFilterOrDivider(ruleIndex: number): string {
        return `<button type="button" class="media-filter-join-toggle media-filter-or-divider" data-focus-key="filter-join-toggle" data-rule-index="${ruleIndex}" aria-label="Switch to AND">or</button>`;
    }

    private renderFilterConnectorCell(ruleIndex: number, isFirstInGroup: boolean): string {
        return isFirstInGroup
            ? '<div class="media-filter-connector media-filter-connector-label">Where</div>'
            : `<button type="button" class="media-filter-join-toggle media-filter-connector media-filter-and-pill" data-focus-key="filter-join-toggle" data-rule-index="${ruleIndex}" aria-label="Switch to OR">and</button>`;
    }

    private renderExtraFilterConditionMarkup(rule: LibraryExtraFilterRule, ruleIndex: number): string {
        const valueKind = getLibraryExtraFieldValueKind(this.getExtraDataIndex(), rule.fieldName);
        const isNumeric = valueKind === 'numeric';
        return `
            <select class="media-extra-filter-operator" data-focus-key="filter-operator" data-rule-index="${ruleIndex}" aria-label="Field rule ${ruleIndex + 1} operator">
                ${this.renderExtraFilterOperatorOptions(rule)}
            </select>
            <input
                type="text"
                class="media-extra-filter-value"
                data-focus-key="filter-value"
                data-rule-index="${ruleIndex}"
                aria-label="Field rule ${ruleIndex + 1} value"
                aria-invalid="${!isLibraryFilterRuleReady(rule, this.getExtraDataIndex(), this.getExtraDataFacets())}"
                placeholder="${isNumeric ? 'Enter a number to apply' : 'Enter text to apply'}"
                value="${escapeAttribute(rule.value)}"
                ${isNumeric ? 'inputmode="decimal"' : ''}
                autocomplete="off"
            />
        `;
    }

    private renderFilterRuleRow(
        rule: LibraryFilterRule,
        ruleIndex: number,
        isFirstInGroup: boolean,
        valuedFieldNames: string[],
        booleanTagNames: string[],
    ): string {
        const conditionMarkup = rule.kind === 'booleanTag' ? '' : this.renderExtraFilterConditionMarkup(rule, ruleIndex);

        return `
            <div class="media-extra-filter-rule" data-rule-kind="${rule.kind}" data-rule-index="${ruleIndex}">
                ${this.renderFilterConnectorCell(ruleIndex, isFirstInGroup)}
                ${this.renderFilterNegationToggle(rule, ruleIndex)}
                <select class="media-extra-filter-field" data-focus-key="filter-field" data-rule-index="${ruleIndex}" aria-label="Rule ${ruleIndex + 1} field">
                    ${this.renderFieldOrTagOptions(rule, valuedFieldNames, booleanTagNames)}
                </select>
                ${conditionMarkup}
                <button type="button" class="media-filter-rule-remove" data-focus-key="filter-rule-remove" data-rule-index="${ruleIndex}" aria-label="Remove rule ${ruleIndex + 1}">×</button>
            </div>
        `;
    }

    private renderFilterRuleGroupMarkup(
        group: LibraryFilterRuleGroup,
        groupIndex: number,
        valuedFieldNames: string[],
        booleanTagNames: string[],
    ): string {
        const rowsMarkup = group.map((entry, entryIndex) => (
            this.renderFilterRuleRow(entry.rule, entry.ruleIndex, entryIndex === 0, valuedFieldNames, booleanTagNames)
        )).join('');

        return `
            <div class="media-filter-rule-group media-pane-subcard" data-group-index="${groupIndex}">
                ${rowsMarkup}
                <div class="media-filter-group-footer">
                    <button type="button" class="media-filter-connector media-filter-add-and" data-group-index="${groupIndex}" aria-label="Add a rule to group ${groupIndex + 1}">+ and</button>
                    <button type="button" class="media-filter-remove-group" data-group-index="${groupIndex}" aria-label="Delete group ${groupIndex + 1}">Delete group</button>
                </div>
            </div>
        `;
    }

    private renderFilterRuleStackContents(valuedFieldNames: string[], booleanTagNames: string[]): string {
        const groups = groupLibraryFilterRules(this.state.filterRules);
        const groupsMarkup = groups.map((group, groupIndex) => {
            const orDivider = groupIndex > 0 ? this.renderFilterOrDivider(group[0].ruleIndex) : '';
            return orDivider + this.renderFilterRuleGroupMarkup(group, groupIndex, valuedFieldNames, booleanTagNames);
        }).join('');

        const addGroupSlot = groups.length === 0
            ? '<button type="button" class="media-pane-add-slot" id="btn-add-filter-rule-group">+ Add filter</button>'
            : '<button type="button" class="media-filter-add-or-divider" id="btn-add-filter-rule-group" aria-label="Add an OR group">+ or</button>';

        return `${groupsMarkup}${addGroupSlot}`;
    }

    private renderFilterRuleSectionMarkup(): string {
        const { valuedFieldNames, booleanTagNames } = this.getExtraDataFacets();
        const shouldShow = valuedFieldNames.length > 0 || booleanTagNames.length > 0;

        return `
            <div id="media-filter-rule-section" class="media-filter-rule-section" ${shouldShow ? '' : 'hidden'}>
                <div id="media-filter-rule-stack" class="media-extra-filter-rules">
                    ${shouldShow ? this.renderFilterRuleStackContents(valuedFieldNames, booleanTagNames) : ''}
                </div>            </div>
        `;
    }

    private renderSortLevelRow(stage: LibrarySortStage, stageIndex: number, extraFieldNames: string[]): string {
        const isDefaultField = stage.field.kind === 'builtin' && stage.field.key === 'default';

        return `
            <div class="media-sort-level-row">
                <div class="media-sort-level-label">${stageIndex === 0 ? 'Sort by' : 'Then by'}</div>
                <select class="media-sort-level-select" data-focus-key="sort-level-select" data-level-index="${stageIndex}" aria-label="Sort level ${stageIndex + 1} field">
                    ${this.renderSortFieldOptions(stageIndex, extraFieldNames)}
                </select>
                <div class="media-sort-direction-toggle" role="group" aria-label="Sort level ${stageIndex + 1} direction">
                    <button type="button" class="media-sort-direction-option ${stage.direction === 'ascending' ? 'is-active' : ''}" data-focus-key="sort-direction-option" data-level-index="${stageIndex}" data-direction="ascending" ${isDefaultField ? 'disabled' : ''}>Ascending</button>
                    <button type="button" class="media-sort-direction-option ${stage.direction === 'descending' ? 'is-active' : ''}" data-focus-key="sort-direction-option" data-level-index="${stageIndex}" data-direction="descending" ${isDefaultField ? 'disabled' : ''}>Descending</button>
                </div>
                <button type="button" class="media-sort-level-remove" data-focus-key="sort-level-remove" data-level-index="${stageIndex}" aria-label="Remove sort level ${stageIndex + 1}">×</button>
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

    private renderSortLevelsMarkup(): string {
        const extraFieldNames = this.getExtraFieldNames();
        const rowsMarkup = this.state.sortStages
            .map((stage, stageIndex) => this.renderSortLevelRow(stage, stageIndex, extraFieldNames))
            .join('');

        return `
            ${rowsMarkup}
            <button type="button" class="media-pane-add-slot media-sort-add-level" id="btn-add-sort-level">+ Add sort</button>
        `;
    }

    private renderSortPaneMarkup(): string {
        const switchesMarkup = renderSwitchGroup(
            SORT_SWITCH_CONFIGS.map(({ id, label, stateKey, hiddenWhenArchivedHidden }) => ({
                id,
                label,
                isChecked: this.state[stateKey],
                isHidden: hiddenWhenArchivedHidden && this.state.hideArchived,
            })),
            'Library grouping and ordering switches',
        );

        return `
            <div class="media-sort-tray card">
                <div class="media-pane-header">
                    <h2 class="media-pane-title" id="media-sort-pane-title">Sort</h2>
                    <div class="media-pane-header-controls">
                        ${switchesMarkup}
                    </div>
                </div>
                <div class="media-sort-levels" id="media-sort-levels" aria-describedby="media-sort-tiebreaker-note">
                    ${this.renderSortLevelsMarkup()}
                </div>
                <div class="media-sort-tiebreaker-divider"></div>
                <p class="media-sort-tiebreaker-note media-pane-note" id="media-sort-tiebreaker-note">${LIBRARY_SORT_TIEBREAKER_NOTE}</p>
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

    private renderHeaderShell(container: HTMLElement) {
        container.innerHTML = '';

        const uniqueTypes = this.getUniqueTypes();
        this.renderedTypeOptionsKey = computeTypeOptionsKey(uniqueTypes);
        const statusMultiSelectField = this.createStatusMultiSelectField();
        const typeMultiSelectField = this.createTypeMultiSelectField(uniqueTypes);
        this.statusMultiSelectField = statusMultiSelectField;
        this.typeMultiSelectField = typeMultiSelectField;

        const activeLayout = this.getActiveLayout();
        const activeFilterCount = this.getActiveFilterCount();
        const sortLevelCount = this.getSortLevelCount();
        const compactHint = this.state.isGridSupported
            ? ''
            : `<span class="media-layout-hint">${LIBRARY_GRID_UNAVAILABLE_HINT}</span>`;

        const hideArchivedSwitchMarkup = renderSwitchGroup(
            [{
                id: 'grid-hide-archived',
                label: 'Hide archived',
                isChecked: this.state.hideArchived,
                isHidden: false,
            }],
            'Library archive visibility',
        );

        const header = html`
            <div class="media-grid-toolbar-shell">
                <div class="media-grid-toolbar">
                    <div class="media-grid-toolbar-primary">
                        <button class="btn btn-primary media-grid-new-media-button" id="btn-add-media-grid">+ New Media</button>
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
                            label: 'Filter',
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

                <div id="media-grid-filter-panel" class="media-grid-filter-panel ${this.state.filtersExpanded ? 'is-expanded' : 'is-collapsed'}" aria-hidden="${this.state.filtersExpanded ? 'false' : 'true'}" aria-labelledby="media-filters-pane-title" ${rawHtml(renderPanelStyleAttribute(this.state.filtersExpanded))}>
                    <div class="media-grid-filter-panel-body">
                        <div id="media-grid-filter-tray" class="media-grid-filter-tray card">
                            <div class="media-pane-header">
                                <h2 class="media-pane-title" id="media-filters-pane-title">Filter</h2>
                                <div class="media-pane-header-controls">
                                    <div class="media-grid-filter-field">
                                        <div class="media-grid-filter-label">Status</div>
                                        <div class="media-grid-filter-trigger-slot" id="media-status-multiselect-slot">${statusMultiSelectField.element}</div>
                                    </div>
                                    <div class="media-grid-filter-field">
                                        <div class="media-grid-filter-label">Type</div>
                                        <div class="media-grid-filter-trigger-slot" id="media-type-multiselect-slot">${typeMultiSelectField.element}</div>
                                    </div>
                                    ${rawHtml(hideArchivedSwitchMarkup)}
                                </div>
                            </div>
                            ${rawHtml(this.renderFilterRuleSectionMarkup())}
                        </div>
                    </div>
                </div>

                <div id="media-sort-panel" class="media-grid-filter-panel ${this.state.sortExpanded ? 'is-expanded' : 'is-collapsed'}" aria-hidden="${this.state.sortExpanded ? 'false' : 'true'}" aria-labelledby="media-sort-pane-title" ${rawHtml(renderPanelStyleAttribute(this.state.sortExpanded))}>
                    <div class="media-grid-filter-panel-body">
                        ${rawHtml(this.renderSortPaneMarkup())}
                    </div>
                </div>
            </div>
        `;

        container.appendChild(header);
        this.headerElement = header;
        this.filterCardElement = header.querySelector<HTMLElement>('#media-grid-filter-tray');
        this.sortCardElement = header.querySelector<HTMLElement>('.media-sort-tray');
        this.bindShellListeners(header);
    }

    private bindShellListeners(header: HTMLElement) {
        header.querySelector('#btn-add-media-grid')?.addEventListener('click', async () => {
            await this.createMediaFromModal();
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

        const hideArchived = this.filterCardElement?.querySelector<HTMLInputElement>('#grid-hide-archived');
        hideArchived?.addEventListener('change', () => {
            this.handleHideArchivedChange(hideArchived);
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
            const switchInput = this.sortCardElement?.querySelector<HTMLInputElement>(`#${id}`);
            switchInput?.addEventListener('change', () => {
                this.state[stateKey] = switchInput.checked;
                this.commitSortSwitchChange();
            });
        });

        const sortLevelsHost = this.sortCardElement?.querySelector<HTMLElement>('#media-sort-levels');
        if (sortLevelsHost) this.bindSortLevelsDelegation(sortLevelsHost);

        const filterRuleStackHost = this.filterCardElement?.querySelector<HTMLElement>('#media-filter-rule-stack');
        if (filterRuleStackHost) this.bindFilterRuleStackDelegation(filterRuleStackHost);
    }

    private bindSortLevelsDelegation(host: HTMLElement) {
        host.addEventListener('change', (event) => {
            const target = event.target;
            if (target instanceof HTMLSelectElement && target.classList.contains('media-sort-level-select')) {
                this.handleSortLevelFieldChange(target);
            }
        });

        host.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            const directionButton = target.closest<HTMLButtonElement>('.media-sort-direction-option');
            if (directionButton) {
                this.handleSortDirectionClick(directionButton);
                return;
            }

            const removeButton = target.closest<HTMLButtonElement>('.media-sort-level-remove');
            if (removeButton) {
                this.handleSortLevelRemove(removeButton);
                return;
            }

            if (target.closest('#btn-add-sort-level')) this.handleAddSortLevel();
        });
    }

    private bindFilterRuleStackDelegation(host: HTMLElement) {
        host.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLSelectElement)) return;

            if (target.classList.contains('media-extra-filter-field')) {
                this.handleFieldOrTagChange(target);
            } else if (target.classList.contains('media-extra-filter-operator')) {
                this.handleExtraFilterOperatorChange(target);
            }
        });

        host.addEventListener('input', (event) => {
            const target = event.target;
            if (target instanceof HTMLInputElement && target.classList.contains('media-extra-filter-value')) {
                this.handleExtraFilterValueInput(target);
            }
        });

        host.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            const negationOption = target.closest<HTMLButtonElement>('.media-filter-negation-option');
            if (negationOption) {
                this.handleFilterNegationClick(negationOption);
                return;
            }

            const joinDivider = target.closest<HTMLButtonElement>('.media-filter-join-toggle');
            if (joinDivider) {
                this.handleFilterJoinDividerClick(joinDivider);
                return;
            }

            const removeButton = target.closest<HTMLButtonElement>('.media-filter-rule-remove');
            if (removeButton) {
                this.handleFilterRuleRemove(removeButton);
                return;
            }

            const removeGroupButton = target.closest<HTMLButtonElement>('.media-filter-remove-group');
            if (removeGroupButton) {
                this.handleRemoveFilterRuleGroup(Number(removeGroupButton.dataset.groupIndex));
                return;
            }

            const addAndButton = target.closest<HTMLButtonElement>('.media-filter-add-and');
            if (addAndButton) {
                this.handleAddRuleToGroup(Number(addAndButton.dataset.groupIndex));
                return;
            }

            if (target.closest('#btn-add-filter-rule-group')) this.handleAddFilterRuleGroup();
        });
    }

    private handleSortLevelFieldChange(select: HTMLSelectElement): void {
        const stageIndex = Number(select.dataset.levelIndex);
        const stage = this.state.sortStages[stageIndex];
        if (!stage) return;

        const extraFieldNames = this.getExtraFieldNames();
        const parsedField = fromSortFieldOptionValue(select.value, extraFieldNames);
        if (!parsedField) return;

        stage.field = parsedField;
        this.commitSortLevelsChange();
    }

    private handleSortDirectionClick(button: HTMLButtonElement): void {
        const stageIndex = Number(button.dataset.levelIndex);
        const direction = button.dataset.direction as LibrarySortDirection | undefined;
        const stage = this.state.sortStages[stageIndex];
        if (!stage || !direction) return;

        stage.direction = direction;
        this.commitSortLevelsChange();
    }

    private handleSortLevelRemove(button: HTMLButtonElement): void {
        const stageIndex = Number(button.dataset.levelIndex);
        this.state.sortStages = this.state.sortStages.filter((_, index) => index !== stageIndex);
        this.commitSortLevelsChange();
    }

    private handleAddSortLevel(): void {
        const extraFieldNames = this.getExtraFieldNames();
        const usedFieldKeys = new Set(this.state.sortStages.map((stage) => toSortFieldOptionValue(stage.field)));
        const nextField = this.pickNextAvailableSortField(usedFieldKeys, extraFieldNames);
        this.state.sortStages = [...this.state.sortStages, { field: nextField, direction: 'ascending' }];
        this.commitSortLevelsChange();
    }

    private buildDefaultFilterRule(): LibraryFilterRule | null {
        const { valuedFieldNames, booleanTagNames } = this.getExtraDataFacets();
        const fieldName = valuedFieldNames[0];
        if (fieldName !== undefined) {
            const valueKind = getLibraryExtraFieldValueKind(this.getExtraDataIndex(), fieldName);
            return {
                kind: 'extra',
                fieldName,
                operator: getDefaultLibraryExtraFilterOperator(valueKind),
                value: '',
                join: 'and',
                negated: false,
            };
        }

        const tagName = booleanTagNames[0];
        return tagName === undefined ? null : { kind: 'booleanTag', tagName, join: 'and', negated: false };
    }

    private handleFieldOrTagChange(select: HTMLSelectElement): void {
        const ruleIndex = Number(select.dataset.ruleIndex);
        const rule = this.state.filterRules[ruleIndex];
        if (!rule) return;

        const subject = fromFilterSubjectOptionValue(select.value);
        if (!subject) return;
        const { kind, name } = subject;
        const facets = this.getExtraDataFacets();

        if (kind === 'tag') {
            const tagName = facets.booleanTagNames.find(candidate => candidate.toLowerCase() === name.toLowerCase());
            if (tagName === undefined) return;
            this.state.filterRules[ruleIndex] = { kind: 'booleanTag', tagName, join: rule.join, negated: rule.negated };
        } else {
            const fieldName = facets.valuedFieldNames.find(candidate => candidate.toLowerCase() === name.toLowerCase());
            if (fieldName === undefined) return;
            const valueKind = getLibraryExtraFieldValueKind(this.getExtraDataIndex(), fieldName);
            this.state.filterRules[ruleIndex] = {
                kind: 'extra',
                fieldName,
                operator: getDefaultLibraryExtraFilterOperator(valueKind),
                value: '',
                join: rule.join,
                negated: rule.negated,
            };
        }
        this.commitFilterRuleStackChange();
    }

    private handleExtraFilterOperatorChange(select: HTMLSelectElement): void {
        const ruleIndex = Number(select.dataset.ruleIndex);
        const rule = this.state.filterRules[ruleIndex];
        if (rule?.kind !== 'extra') return;

        rule.operator = select.value as LibraryExtraFilterOperator;
        this.commitFilterRuleStackChange();
    }

    private handleExtraFilterValueInput(input: HTMLInputElement): void {
        const ruleIndex = Number(input.dataset.ruleIndex);
        const rule = this.state.filterRules[ruleIndex];
        if (rule?.kind !== 'extra') return;

        if (getLibraryExtraFieldValueKind(this.getExtraDataIndex(), rule.fieldName) === 'numeric') {
            this.stripNonNumericCharactersKeepingCaret(input);
        }
        rule.value = input.value;
        input.setAttribute(
            'aria-invalid',
            String(!isLibraryFilterRuleReady(rule, this.getExtraDataIndex(), this.getExtraDataFacets())),
        );
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
        if (header) this.updateFilterCountBadge(header);
        this.notifyFilterChange();
    }

    private stripNonNumericCharactersKeepingCaret(input: HTMLInputElement): void {
        const strippedValue = stripNonNumericFilterValueCharacters(input.value);
        if (strippedValue === input.value) return;

        const caretPosition = input.selectionStart ?? input.value.length;
        const caretAfterStripping = stripNonNumericFilterValueCharacters(input.value.slice(0, caretPosition)).length;
        input.value = strippedValue;
        input.setSelectionRange(caretAfterStripping, caretAfterStripping);
    }

    private handleFilterNegationClick(button: HTMLButtonElement): void {
        const ruleIndex = Number(button.dataset.ruleIndex);
        const rule = this.state.filterRules[ruleIndex];
        if (!rule) return;

        rule.negated = button.dataset.negated === 'true';
        this.commitFilterRuleStackChange();
    }

    private handleFilterJoinDividerClick(button: HTMLButtonElement): void {
        const ruleIndex = Number(button.dataset.ruleIndex);
        this.state.filterRules = toggleLibraryFilterRuleJoin(this.state.filterRules, ruleIndex);
        this.commitFilterRuleStackChange();
    }

    private handleFilterRuleRemove(button: HTMLButtonElement): void {
        const ruleIndex = Number(button.dataset.ruleIndex);
        this.state.filterRules = removeLibraryFilterRule(this.state.filterRules, ruleIndex);
        this.commitFilterRuleStackChange();
    }

    private handleAddFilterRuleGroup(): void {
        const rule = this.buildDefaultFilterRule();
        if (!rule) return;

        this.state.filterRules = appendRuleGroup(this.state.filterRules, rule);
        this.commitFilterRuleStackChange();
    }

    private handleRemoveFilterRuleGroup(groupIndex: number): void {
        this.state.filterRules = removeLibraryFilterRuleGroup(this.state.filterRules, groupIndex);
        this.commitFilterRuleStackChange();
    }

    private handleAddRuleToGroup(groupIndex: number): void {
        const rule = this.buildDefaultFilterRule();
        if (!rule) return;

        this.state.filterRules = appendRuleToGroup(this.state.filterRules, groupIndex, rule);
        this.commitFilterRuleStackChange();
    }

    private commitSortLevelsChange(): void {
        this.patchHost(this.sortCardElement, 'media-sort-levels', () => this.renderSortLevelsMarkup());
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
        if (header) this.updateSortCountBadge(header);
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        this.notifyFilterChange();
    }

    private commitFilterRuleStackChange(): void {
        this.patchHost(this.filterCardElement, 'media-filter-rule-stack', () => {
            const { valuedFieldNames, booleanTagNames } = this.getExtraDataFacets();
            return this.renderFilterRuleStackContents(valuedFieldNames, booleanTagNames);
        });
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
        if (header) this.updateFilterCountBadge(header);
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        this.notifyFilterChange();
    }

    private commitSortSwitchChange(): void {
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        this.notifyFilterChange();
    }

    private patchHost(root: HTMLElement | null, hostId: string, renderInner: () => string): void {
        const host = root?.querySelector<HTMLElement>(`#${hostId}`);
        if (!host) return;

        const focusState = captureHostFocusState(host);
        host.innerHTML = renderInner();
        restoreHostFocusState(host, focusState);
    }

    private handleHideArchivedChange(checkbox: HTMLInputElement): void {
        this.state.hideArchived = checkbox.checked;
        this.updateKeepArchivedLastVisibility();
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
        if (header) this.updateFilterCountBadge(header);
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        this.notifyFilterChange();
    }

    private updateKeepArchivedLastVisibility(): void {
        const isHidden = this.state.hideArchived;
        const switchLabel = this.sortCardElement?.querySelector<HTMLElement>(`#${KEEP_ARCHIVED_LAST_SWITCH_ID}-switch`);
        const checkbox = this.sortCardElement?.querySelector<HTMLInputElement>(`#${KEEP_ARCHIVED_LAST_SWITCH_ID}`);
        if (switchLabel) switchLabel.hidden = isHidden;
        if (checkbox) checkbox.disabled = isHidden;
    }

    private renderContent(container: HTMLElement) {
        this.closeContextMenu();
        this.activeLayoutComponent?.destroy?.();
        container.innerHTML = '';

        const layoutRoot = document.createElement('div');
        layoutRoot.className = 'media-library-layout-root';
        // Flex children default to min-width:auto, which can prevent shrinking and create
        // horizontal overflow (then clipped by the app shell). Allow the library layouts
        // to shrink properly at narrow window widths.
        layoutRoot.style.cssText = 'display: flex; flex: 1; min-height: 0; min-width: 0;';
        layoutRoot.addEventListener('contextmenu', (event) => this.handleContextMenu(event));
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
        const onVisibleMediaClick = (mediaId: number) => {
            this.onMediaClick({ mediaId, navigationIds: this.getRenderedNavigationIds() });
        };

        this.activeLayoutKind = this.getActiveLayout();
        if (this.activeLayoutKind === 'grid') {
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
        this.renderedRows = rows;
    }

    private closeContextMenu(): void {
        this.contextMenuHandle?.close();
        this.contextMenuHandle = null;
    }

    private async createMediaFromModal(): Promise<void> {
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
    }

    private handleContextMenu(event: MouseEvent): void {
        if (typeof globalThis.matchMedia !== 'function' || !globalThis.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            return;
        }

        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const card = target.closest<HTMLElement>('[data-media-id]');
        const media = card
            ? this.state.mediaList.find((candidate) => candidate.id === Number(card.dataset.mediaId))
            : undefined;

        event.preventDefault();
        this.closeContextMenu();
        this.contextMenuHandle = media
            ? openLibraryContextMenu({
                media,
                clientX: event.clientX,
                clientY: event.clientY,
                onActionCommitted: () => {
                    this.contextMenuHandle = null;
                    this.runActionCommitted();
                },
            })
            : openLibraryBackgroundMenu({
                clientX: event.clientX,
                clientY: event.clientY,
                onCreateMedia: () => {
                    this.contextMenuHandle = null;
                    this.createMediaFromModal()
                        .catch((error) => Logger.error('Failed to create media from the library menu', error));
                },
            });
    }

    private runActionCommitted(): void {
        this.onActionCommitted?.().catch((error) => Logger.error('Failed to apply a library action', error));
    }

    public async applyLibraryMutation(
        mutation: LibraryMutation,
        freshMediaList: Media[],
        freshMetrics: Record<number, LibraryActivityMetrics>,
    ): Promise<void> {
        this.state.mediaList = freshMediaList;
        this.state.listMetricsByMediaId = freshMetrics;
        this.pruneHiddenTypesToAvailableTypes();
        this.reconcileHeaderForDataChange();

        const layout = this.activeLayoutComponent;
        const previousRows = this.renderedRows;
        if (!layout || !previousRows || !layout.isRenderingComplete()) {
            this.fullyRerenderContent();
            return;
        }

        const nextRows = measureSynchronous(
            'aggregation',
            'library_filter',
            () => buildLibraryRows(
                this.getVisibleMediaList(),
                this.state.groupByType ? this.state.contentTypeOrder : null,
            ),
            { media_count: this.state.mediaList.length },
        );

        if (nextRows.length === 0) {
            this.fullyRerenderContent();
            return;
        }

        const { decision, removedContentTypes } = resolveLibraryItemPlacement(previousRows, nextRows, mutation.mediaId);
        if (decision.kind === 'fullRender') {
            this.fullyRerenderContent();
            return;
        }

        const mutatedElement = layout.getMediaElement(mutation.mediaId);
        if (!mutatedElement) {
            this.fullyRerenderContent();
            return;
        }

        if (decision.kind === 'remove') {
            layout.removeMediaItem(mutation.mediaId);
        } else if (!await this.moveMutatedElement(layout, mutation, decision.before, mutatedElement, freshMetrics)) {
            this.fullyRerenderContent();
            return;
        }

        for (const contentType of removedContentTypes) {
            layout.removeHeaderElement(contentType);
        }

        this.renderedRows = nextRows;
    }

    private getRenderedNavigationIds(): number[] {
        return (this.renderedRows ?? []).flatMap((row) => (
            row.kind === 'item' && typeof row.media.id === 'number' ? [row.media.id] : []
        ));
    }

    private async moveMutatedElement(
        layout: MediaGrid | MediaList,
        mutation: LibraryMutation,
        before: LibraryPlacementBeforeRow,
        mutatedElement: HTMLElement,
        freshMetrics: Record<number, LibraryActivityMetrics>,
    ): Promise<boolean> {
        if (mutation.kind === 'updated' && mutation.media) {
            if (this.activeLayoutKind === 'grid') {
                await (layout as MediaGrid).updateMediaItem(mutation.media);
            } else {
                await (layout as MediaList).updateMediaItem(mutation.media, freshMetrics[mutation.mediaId] ?? null);
            }
        }

        let referenceElement: HTMLElement | null = null;
        if (before) {
            referenceElement = before.kind === 'item'
                ? layout.getMediaElement(before.mediaId)
                : layout.getHeaderElement(before.contentType);
            if (!referenceElement) return false;
        }

        if (referenceElement) {
            referenceElement.before(mutatedElement);
            return true;
        }

        const scrollContainer = layout.getScrollContainer();
        if (!scrollContainer) return false;

        scrollContainer.append(mutatedElement);
        return true;
    }

    private fullyRerenderContent(): void {
        const content = this.container.querySelector<HTMLElement>('#media-library-content');
        if (content) this.renderContent(content);
    }

    private reconcileHeaderForDataChange(): void {
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
        if (!header) return;

        const uniqueTypes = this.getUniqueTypes();
        const typeOptionsKey = computeTypeOptionsKey(uniqueTypes);
        if (typeOptionsKey !== this.renderedTypeOptionsKey) {
            this.rebuildTypeMultiSelectField(uniqueTypes, typeOptionsKey);
        }

        this.patchHost(this.sortCardElement, 'media-sort-levels', () => this.renderSortLevelsMarkup());
        this.reconcileFilterRuleSection();
        this.updateFilterCountBadge(header);
        this.updateSortCountBadge(header);
    }

    private rebuildTypeMultiSelectField(uniqueTypes: string[], typeOptionsKey: string): void {
        const slot = this.filterCardElement?.querySelector<HTMLElement>('#media-type-multiselect-slot');
        if (!slot) return;

        this.typeMultiSelectField?.close();
        const field = this.createTypeMultiSelectField(uniqueTypes);
        slot.replaceChildren(field.element);
        this.typeMultiSelectField = field;
        this.renderedTypeOptionsKey = typeOptionsKey;
    }

    private reconcileFilterRuleSection(): void {
        const section = this.filterCardElement?.querySelector<HTMLElement>('#media-filter-rule-section');
        const stack = this.filterCardElement?.querySelector<HTMLElement>('#media-filter-rule-stack');
        if (!section || !stack) return;

        const { valuedFieldNames, booleanTagNames } = this.getExtraDataFacets();
        const shouldShow = valuedFieldNames.length > 0 || booleanTagNames.length > 0;
        section.hidden = !shouldShow;
        if (shouldShow) stack.innerHTML = this.renderFilterRuleStackContents(valuedFieldNames, booleanTagNames);
    }

    private pruneHiddenTypesToAvailableTypes(): void {
        const availableTypes = new Set(this.state.mediaList.map((media) => resolveDisplayContentType(media)));
        const prunedHiddenTypes = new Set(
            [...this.state.hiddenTypes].filter((type) => availableTypes.has(type)),
        );
        if (prunedHiddenTypes.size === this.state.hiddenTypes.size) return;

        this.state.hiddenTypes = prunedHiddenTypes;
        this.notifyFilterChange();
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

    private updateSortCountBadge(header: HTMLElement) {
        const button = header.querySelector<HTMLButtonElement>('#btn-toggle-sort');
        if (!button) return;

        const count = this.getSortLevelCount();
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
        badge.setAttribute('aria-label', `${count} active sort levels`);
        badge.textContent = count.toString();
    }

    public setGridSupport(isGridSupported: boolean): void {
        if (this.state.isGridSupported === isGridSupported) return;

        this.state.isGridSupported = isGridSupported;
        if (isGridSupported) {
            this.openPaneModal?.handle.dismiss();
        } else {
            this.collapseInlinePanels();
        }
        this.updateLayoutToggleControls();
        this.updateCompactLayoutHint();
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
    }

    private collapseInlinePanels(): void {
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
        if (!header) return;

        Object.values(LIBRARY_PANE_CONFIGS).forEach(({ panelId, buttonId }) => {
            const panel = header.querySelector<HTMLElement>(`#${panelId}`);
            const button = header.querySelector<HTMLButtonElement>(`#${buttonId}`);
            if (panel && button) applyPanelExpansion(panel, button, false);
        });

        this.state.filtersExpanded = false;
        this.state.sortExpanded = false;
    }

    private updateCompactLayoutHint(): void {
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
        const toggleShell = header?.querySelector<HTMLElement>('.toggle-shell');
        if (!toggleShell) return;

        let hint = toggleShell.querySelector<HTMLElement>('.media-layout-hint');
        if (this.state.isGridSupported) {
            hint?.remove();
            return;
        }

        if (hint) return;
        hint = document.createElement('span');
        hint.className = 'media-layout-hint';
        hint.textContent = LIBRARY_GRID_UNAVAILABLE_HINT;
        toggleShell.appendChild(hint);
    }

    private setLayout(layout: LibraryLayoutMode) {
        if (layout === 'grid' && !this.state.isGridSupported) {
            return;
        }

        if (this.state.preferredLayout === layout) {
            return;
        }

        this.state.preferredLayout = layout;
        this.updateLayoutToggleControls();
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        this.onLayoutChange?.(layout);
    }

    private updateLayoutToggleControls(): void {
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
        if (!header) return;

        const activeLayout = this.getActiveLayout();
        const gridButton = header.querySelector<HTMLButtonElement>('#btn-layout-grid');
        const listButton = header.querySelector<HTMLButtonElement>('#btn-layout-list');
        if (gridButton) gridButton.disabled = !this.state.isGridSupported;
        gridButton?.classList.toggle('is-active', activeLayout === 'grid');
        gridButton?.setAttribute('aria-pressed', String(activeLayout === 'grid'));
        listButton?.classList.toggle('is-active', activeLayout === 'list');
        listButton?.setAttribute('aria-pressed', String(activeLayout === 'list'));
        this.updateGridZoomControls();
    }

    private updateGridZoomControls(): void {
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
        if (!header) return;

        const gridZoomDisabled = this.getActiveLayout() !== 'grid';
        const zoomOut = header.querySelector<HTMLButtonElement>('#btn-grid-zoom-out');
        const zoomReset = header.querySelector<HTMLButtonElement>('#btn-grid-zoom-reset');
        const zoomIn = header.querySelector<HTMLButtonElement>('#btn-grid-zoom-in');
        if (zoomOut) zoomOut.disabled = gridZoomDisabled || this.state.gridZoom <= LIBRARY_GRID_ZOOM.MIN;
        if (zoomReset) {
            zoomReset.disabled = gridZoomDisabled;
            zoomReset.textContent = `${this.state.gridZoom}%`;
        }
        if (zoomIn) zoomIn.disabled = gridZoomDisabled || this.state.gridZoom >= LIBRARY_GRID_ZOOM.MAX;
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
        this.updateGridZoomControls();
        this.renderContent(this.container.querySelector<HTMLElement>('#media-library-content')!);
        this.onGridZoomChange?.(nextGridZoom);
    }

    private toggleFiltersPanel() {
        if (!this.state.isGridSupported) {
            this.togglePaneModal('filter');
            return;
        }

        this.togglePanel('media-grid-filter-panel', 'btn-toggle-filters', this.state.filtersExpanded, (nextExpanded) => {
            this.state.filtersExpanded = nextExpanded;
        });
    }

    private toggleSortPanel() {
        if (!this.state.isGridSupported) {
            this.togglePaneModal('sort');
            return;
        }

        this.togglePanel('media-sort-panel', 'btn-toggle-sort', this.state.sortExpanded, (nextExpanded) => {
            this.state.sortExpanded = nextExpanded;
        });
    }

    private togglePaneModal(kind: LibraryPaneKind): void {
        if (this.openPaneModal?.kind === kind) {
            this.openPaneModal.handle.dismiss();
            return;
        }

        this.openPaneModal?.handle.dismiss();
        this.openPaneModalFor(kind);
    }

    private openPaneModalFor(kind: LibraryPaneKind): void {
        const { buttonId, title, modalTitleId } = LIBRARY_PANE_CONFIGS[kind];
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
        const card = kind === 'filter' ? this.filterCardElement : this.sortCardElement;
        const button = header?.querySelector<HTMLButtonElement>(`#${buttonId}`);
        if (!header || !card || !button) return;

        const handle = createCancelableOverlay(() => {
            this.closePaneModal(kind, card, header, handle.overlay);
        }, { closeOnEscape: true });

        handle.overlay.innerHTML = `
            <div class="modal-content media-pane-modal-content" role="dialog" aria-modal="true" aria-labelledby="${modalTitleId}">
                <div class="media-pane-modal-title-row">
                    <h2 class="media-pane-modal-title" id="${modalTitleId}">${title}</h2>
                </div>
                <div class="media-pane-modal-body"></div>
                <div class="media-pane-modal-footer">
                    <button type="button" class="btn btn-ghost media-pane-modal-done">Done</button>
                </div>
            </div>
        `;

        handle.overlay.querySelector<HTMLElement>('.media-pane-modal-body')!.appendChild(card);
        handle.overlay.querySelector('.media-pane-modal-done')?.addEventListener('click', () => handle.dismiss());

        button.setAttribute('aria-expanded', 'true');
        this.openPaneModal = { kind, handle };
    }

    private closePaneModal(kind: LibraryPaneKind, card: HTMLElement, header: HTMLElement, overlay: HTMLElement): void {
        const { panelId, buttonId } = LIBRARY_PANE_CONFIGS[kind];
        header.querySelector<HTMLButtonElement>(`#${buttonId}`)?.setAttribute('aria-expanded', 'false');
        if (this.openPaneModal?.kind === kind) this.openPaneModal = null;

        setTimeout(() => {
            if (!overlay.contains(card)) return;
            header.querySelector<HTMLElement>(`#${panelId} .media-grid-filter-panel-body`)?.appendChild(card);
        }, OVERLAY_FADE_OUT_MS);
    }

    private togglePanel(panelId: string, buttonId: string, isExpanded: boolean, setExpanded: (nextExpanded: boolean) => void) {
        const header = this.container.querySelector<HTMLElement>('#media-library-header');
        const panel = header?.querySelector<HTMLElement>(`#${panelId}`);
        const button = header?.querySelector<HTMLButtonElement>(`#${buttonId}`);
        if (!panel || !button) return;

        const nextExpanded = !isExpanded;
        setExpanded(nextExpanded);
        applyPanelExpansion(panel, button, nextExpanded);
    }

    private notifyFilterChange() {
        this.onFilterChange?.({
            searchQuery: this.state.searchQuery,
            hiddenTypes: new Set(this.state.hiddenTypes),
            hiddenStatuses: new Set(this.state.hiddenStatuses),
            hideArchived: this.state.hideArchived,
            filterRules: this.state.filterRules.map(rule => ({ ...rule })),
            sortStages: this.state.sortStages.map((stage) => ({ ...stage })),
            groupByType: this.state.groupByType,
            keepOngoingFirst: this.state.keepOngoingFirst,
            keepArchivedLast: this.state.keepArchivedLast,
        });
    }
}

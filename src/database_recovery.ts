import { applyDatabaseRecovery } from './api';
import { escapeHTML } from './html';
import { Logger } from './logger';
import { customConfirm } from './modal_base';
import { getServices } from './services';
import type {
    DatabaseRecoveryPlan,
    DatabaseRecoveryResolution,
    OrphanedMilestoneGroup,
    RecoveryMediaOption,
} from './types';

function formatDuration(minutes: number): string {
    if (minutes <= 0) return '0m';
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (hours === 0) return `${remainder}m`;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

function mediaLabel(media: RecoveryMediaOption): string {
    return `${media.title} — ${media.variant.trim() || '(no variant)'}`;
}

function localStorageSnapshot(): string {
    try {
        const snapshot: Record<string, string> = {};
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key !== null) snapshot[key] = localStorage.getItem(key) || '';
        }
        return JSON.stringify(snapshot);
    } catch {
        return '{}';
    }
}

function orphanedGroups(plan: DatabaseRecoveryPlan): OrphanedMilestoneGroup[] {
    return plan.issues.flatMap(issue =>
        issue.kind === 'orphaned_milestone_groups' ? issue.groups : []
    );
}

function renderMilestones(group: OrphanedMilestoneGroup): string {
    return group.milestones.map(milestone => {
        const date = milestone.date?.trim() || 'No date';
        return `
            <li class="database-recovery-milestone">
                <span class="database-recovery-milestone-name">${escapeHTML(milestone.name)}</span>
                <span class="database-recovery-milestone-meta">
                    ${escapeHTML(date)} · ${formatDuration(milestone.duration)} · ${milestone.characters.toLocaleString()} characters
                </span>
            </li>
        `;
    }).join('');
}

function renderGroup(group: OrphanedMilestoneGroup, index: number): string {
    const token = escapeHTML(group.group_token);
    const milestoneCount = group.milestones.length;
    return `
        <article class="database-recovery-group" data-recovery-group="${token}">
            <div class="database-recovery-group-heading">
                <div>
                    <span class="database-recovery-eyebrow">Missing parent</span>
                    <h2>${escapeHTML(group.media_title)}</h2>
                </div>
                <span class="database-recovery-count">${milestoneCount} milestone${milestoneCount === 1 ? '' : 's'}</span>
            </div>
            <ul class="database-recovery-milestones">${renderMilestones(group)}</ul>

            <fieldset class="database-recovery-actions">
                <legend>What should Kechimochi do with this group?</legend>
                <label>
                    <input type="radio" name="recovery-action-${index}" value="attach" />
                    <span>Attach to an existing media entry</span>
                </label>
                <label>
                    <input type="radio" name="recovery-action-${index}" value="create" />
                    <span>Create a new media entry titled “${escapeHTML(group.media_title)}”</span>
                </label>
                <label class="database-recovery-discard-choice">
                    <input type="radio" name="recovery-action-${index}" value="discard" />
                    <span>Discard these milestones</span>
                </label>
            </fieldset>

            <div class="database-recovery-action-panel" data-action-panel="attach" hidden>
                <label for="recovery-media-${index}">Search existing media by title or variant</label>
                <div class="database-recovery-combobox">
                    <input
                        id="recovery-media-${index}"
                        class="database-recovery-media-input"
                        type="text"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded="false"
                        aria-controls="recovery-media-options-${index}"
                        autocomplete="off"
                        placeholder="Start typing, or scroll through the list"
                    />
                    <div
                        id="recovery-media-options-${index}"
                        class="database-recovery-media-options"
                        role="listbox"
                        hidden
                    ></div>
                </div>
                <div class="database-recovery-selection" aria-live="polite"></div>
            </div>

            <div class="database-recovery-action-panel" data-action-panel="create" hidden>
                <label for="recovery-variant-${index}">Variant for the new entry (optional)</label>
                <input
                    id="recovery-variant-${index}"
                    class="database-recovery-variant-input"
                    type="text"
                    autocomplete="off"
                    placeholder="e.g. Manga, Audiobook, 2024 remake"
                />
                <p>The title will be created as “${escapeHTML(group.media_title)}”.</p>
            </div>

            <div class="database-recovery-action-panel database-recovery-discard-panel" data-action-panel="discard" hidden>
                These ${milestoneCount} milestone${milestoneCount === 1 ? '' : 's'} will be permanently deleted after confirmation.
            </div>
        </article>
    `;
}

function wireActionPanels(groupElement: HTMLElement): void {
    const panels = groupElement.querySelectorAll<HTMLElement>('[data-action-panel]');
    groupElement.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', () => {
            panels.forEach(panel => {
                panel.hidden = panel.dataset.actionPanel !== radio.value;
            });
        });
    });
}

function wireMediaCombobox(
    groupElement: HTMLElement,
    media: RecoveryMediaOption[],
): void {
    const input = groupElement.querySelector<HTMLInputElement>('.database-recovery-media-input');
    const options = groupElement.querySelector<HTMLElement>('.database-recovery-media-options');
    const selection = groupElement.querySelector<HTMLElement>('.database-recovery-selection');
    if (!input || !options || !selection) return;

    let matches: RecoveryMediaOption[] = [];
    let highlightedIndex = -1;
    let hideTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    const hideOptions = () => {
        options.hidden = true;
        options.innerHTML = '';
        matches = [];
        highlightedIndex = -1;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
    };

    const selectMedia = (selected: RecoveryMediaOption) => {
        input.value = selected.title;
        input.dataset.selectedUid = selected.uid;
        selection.textContent = `Selected: ${mediaLabel(selected)}`;
        hideOptions();
        input.focus({ preventScroll: true });
    };

    const highlight = (nextIndex: number) => {
        if (matches.length === 0) return;
        highlightedIndex = (nextIndex + matches.length) % matches.length;
        options.querySelectorAll<HTMLElement>('[role="option"]').forEach((option, index) => {
            const active = index === highlightedIndex;
            option.setAttribute('aria-selected', String(active));
            option.classList.toggle('is-highlighted', active);
            if (active) option.scrollIntoView({ block: 'nearest' });
        });
        input.setAttribute(
            'aria-activedescendant',
            `database-recovery-media-option-${input.id}-${highlightedIndex}`,
        );
    };

    const renderOptions = () => {
        const query = input.value.trim().toLocaleLowerCase();
        matches = media.filter(candidate =>
            query.length === 0
            || candidate.title.toLocaleLowerCase().includes(query)
            || candidate.variant.toLocaleLowerCase().includes(query)
        );
        highlightedIndex = -1;
        if (matches.length === 0 || document.activeElement !== input) {
            hideOptions();
            return;
        }

        options.innerHTML = matches.map((candidate, index) => {
            const secondary = candidate.variant.trim() || '(no variant)';
            const state = [candidate.status, candidate.tracking_status]
                .filter(value => value.trim().length > 0)
                .join(' · ');
            return `
                <button
                    type="button"
                    id="database-recovery-media-option-${input.id}-${index}"
                    class="database-recovery-media-option"
                    role="option"
                    aria-selected="false"
                    data-media-uid="${escapeHTML(candidate.uid)}"
                >
                    <span>${escapeHTML(candidate.title)}</span>
                    <span class="database-recovery-media-variant">${escapeHTML(secondary)}</span>
                    ${state ? `<span class="database-recovery-media-state">${escapeHTML(state)}</span>` : ''}
                </button>
            `;
        }).join('');
        options.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    };

    options.addEventListener('pointerdown', event => event.preventDefault());
    options.addEventListener('click', event => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const option = target.closest<HTMLElement>('[data-media-uid]');
        const selected = media.find(candidate => candidate.uid === option?.dataset.mediaUid);
        if (selected) selectMedia(selected);
    });
    input.addEventListener('focus', () => {
        if (hideTimer !== null) globalThis.clearTimeout(hideTimer);
        renderOptions();
    });
    input.addEventListener('input', () => {
        delete input.dataset.selectedUid;
        selection.textContent = '';
        renderOptions();
    });
    input.addEventListener('blur', () => {
        hideTimer = globalThis.setTimeout(hideOptions, 120);
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            hideOptions();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (options.hidden) renderOptions();
            highlight(highlightedIndex + (event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Enter' && highlightedIndex >= 0) {
            event.preventDefault();
            const selected = matches[highlightedIndex];
            if (selected) selectMedia(selected);
        }
    });
}

function collectResolutions(
    plan: DatabaseRecoveryPlan,
): { resolutions: DatabaseRecoveryResolution[]; error?: string } {
    const resolutions: DatabaseRecoveryResolution[] = [];
    for (const group of orphanedGroups(plan)) {
        const groupElement = document.querySelector<HTMLElement>(
            `[data-recovery-group="${group.group_token}"]`,
        );
        const action = groupElement?.querySelector<HTMLInputElement>(
            'input[type="radio"]:checked',
        )?.value;
        if (!groupElement || !action) {
            return {
                resolutions,
                error: `Choose an action for the milestone group “${group.media_title}”.`,
            };
        }

        if (action === 'attach') {
            const mediaUid = groupElement.querySelector<HTMLInputElement>(
                '.database-recovery-media-input',
            )?.dataset.selectedUid;
            if (!mediaUid) {
                return {
                    resolutions,
                    error: `Choose an existing media entry for “${group.media_title}”.`,
                };
            }
            resolutions.push({
                kind: 'attach_milestone_group',
                group_token: group.group_token,
                media_uid: mediaUid,
            });
        } else if (action === 'create') {
            const variant = groupElement.querySelector<HTMLInputElement>(
                '.database-recovery-variant-input',
            )?.value.trim() || '';
            resolutions.push({
                kind: 'create_media_for_milestone_group',
                group_token: group.group_token,
                variant,
            });
        } else {
            resolutions.push({
                kind: 'discard_milestone_group',
                group_token: group.group_token,
            });
        }
    }
    return { resolutions };
}

function showRecoveryError(errorElement: HTMLElement | null, message: string): void {
    if (!errorElement) return;
    errorElement.textContent = message;
    errorElement.hidden = false;
}

function setRecoveryApplying(button: HTMLButtonElement | null, applying: boolean): void {
    if (!button) return;
    button.disabled = applying;
    button.textContent = applying ? 'Applying recovery…' : 'Apply recovery and continue';
}

function restoreImportedLocalStorage(serializedStorage?: string): void {
    if (!serializedStorage) return;
    try {
        const restoredStorage = JSON.parse(serializedStorage) as Record<string, string>;
        localStorage.clear();
        for (const [key, value] of Object.entries(restoredStorage)) {
            localStorage.setItem(key, value);
        }
    } catch (error) {
        Logger.error('Failed to restore local storage after database recovery', error);
    }
}

async function confirmDiscardedMilestones(
    resolutions: DatabaseRecoveryResolution[],
    groups: OrphanedMilestoneGroup[],
): Promise<boolean> {
    const discardCount = resolutions
        .filter(resolution => resolution.kind === 'discard_milestone_group')
        .reduce((total, resolution) => {
            const group = groups.find(candidate => candidate.group_token === resolution.group_token);
            return total + (group?.milestones.length || 0);
        }, 0);
    if (discardCount === 0) return true;
    return customConfirm(
        'Discard milestones?',
        `This will permanently delete ${discardCount} milestone${discardCount === 1 ? '' : 's'}. A full safety backup will be created first.`,
        'btn-danger',
        'Discard and Continue',
    );
}

async function handleApplyRecovery(
    plan: DatabaseRecoveryPlan,
    groups: OrphanedMilestoneGroup[],
    appRoot: HTMLElement,
): Promise<void> {
    const errorElement = appRoot.querySelector<HTMLElement>('.database-recovery-error');
    const applyButton = appRoot.querySelector<HTMLButtonElement>('#database-recovery-apply');
    const collected = collectResolutions(plan);
    if (collected.error) {
        showRecoveryError(errorElement, collected.error);
        return;
    }
    if (!await confirmDiscardedMilestones(collected.resolutions, groups)) return;

    if (errorElement) errorElement.hidden = true;
    setRecoveryApplying(applyButton, true);
    try {
        const result = await applyDatabaseRecovery({
            session_token: plan.session_token,
            resolutions: collected.resolutions,
            local_storage: localStorageSnapshot(),
        });
        restoreImportedLocalStorage(result.local_storage);
        globalThis.location.reload();
    } catch (error) {
        showRecoveryError(errorElement, error instanceof Error ? error.message : String(error));
        setRecoveryApplying(applyButton, false);
    }
}

export function renderDatabaseRecoveryScreen(plan: DatabaseRecoveryPlan): void {
    const appRoot = document.getElementById('app');
    if (!appRoot) return;
    const groups = orphanedGroups(plan);
    appRoot.innerHTML = `
        <main class="database-recovery-root">
            <section class="database-recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="database-recovery-title">
                <header class="database-recovery-header">
                    <p class="database-recovery-eyebrow">Database recovery required</p>
                    <h1 id="database-recovery-title">Some data needs your help</h1>
                    <p>
                        We have found these milestones without a parent. What do you want to do with
                        them? Choose one action for each missing-title group. Kechimochi will create a
                        full safety backup before saving any recovery changes.
                    </p>
                </header>
                <div class="database-recovery-groups">
                    ${groups.map(renderGroup).join('')}
                </div>
                <p class="database-recovery-error" role="alert" hidden></p>
                <footer class="database-recovery-footer">
                    <button class="btn btn-ghost" id="database-recovery-quit">Quit for now</button>
                    <button class="btn btn-primary" id="database-recovery-apply">Apply recovery and continue</button>
                </footer>
            </section>
        </main>
    `;

    appRoot.querySelectorAll<HTMLElement>('[data-recovery-group]').forEach(groupElement => {
        wireActionPanels(groupElement);
        wireMediaCombobox(groupElement, plan.media);
    });

    appRoot.querySelector('#database-recovery-quit')?.addEventListener('click', () => {
        getServices().closeWindow();
    });
    appRoot.querySelector('#database-recovery-apply')?.addEventListener('click', () => {
        void handleApplyRecovery(plan, groups, appRoot);
    });
}

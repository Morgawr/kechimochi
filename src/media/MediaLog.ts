import { Component } from '../component';
import { html, escapeHTML } from '../html';
import { ActivitySummary, deleteLog } from '../api';
import { formatLoggedDuration } from '../time';
import { showLogActivityModal } from '../activity_modal';
import { customConfirm } from '../modal_base';

interface MediaLogState {
    logs: ActivitySummary[];
}

export class MediaLog extends Component<MediaLogState> {
    constructor(container: HTMLElement, logs: ActivitySummary[]) {
        super(container, { logs });
    }

    render() {
        this.clear();

        if (this.state.logs.length === 0) {
            this.container.innerHTML = '<div style="color: var(--text-secondary);">No activity logs found for this media.</div>';
            return;
        }

        const list = html`<div style="display: flex; flex-direction: column; gap: 0.5rem; flex: 1; overflow-y: auto;"></div>`;

        this.state.logs.forEach(log => {
            const durationStr = log.duration_minutes > 0 ? formatLoggedDuration(log.duration_minutes, true) : '';
            const charStr = log.characters > 0 ? `${escapeHTML(log.characters.toLocaleString())} chars` : '';
            const separator = (durationStr && charStr) ? ' | ' : '';
 
            const entry = html`
                <div class="media-detail-log-item" data-id="${log.id}" data-duration-minutes="${log.duration_minutes}" data-characters="${log.characters}" style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; border-bottom: 1px solid var(--border-color); font-size: 0.9rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.2rem;">
                        <span><span style="color: var(--text-secondary);">Activity:</span> ${durationStr}${separator}${charStr}</span>
                        <span style="color: var(--text-secondary); font-size: 0.8rem;">${log.date}</span>
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-ghost btn-sm edit-log-btn" title="Edit Log" style="padding: 2px 6px;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="btn btn-ghost btn-sm delete-log-btn" title="Delete Log" style="padding: 2px 6px; color: var(--error);">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                    </div>
                </div>
            `;

            entry.querySelector('.edit-log-btn')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                const success = await showLogActivityModal(log.title, log);
                if (success) {
                    // This is a bit hacky but we need to notify the parent to refresh
                    // Or we re-fetch ourselves if we had the mediaId. 
                    // Since Component doesn't easily notify parents without custom logic,
                    // we'll dispatch a custom event that the MediaDetail view can listen to.
                    this.container.dispatchEvent(new CustomEvent('activity-updated', { bubbles: true }));
                }
            });

            entry.querySelector('.delete-log-btn')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                const confirmed = await customConfirm('Delete Log', 'Are you sure you want to permanently delete this activity log?');
                if (confirmed) {
                    await deleteLog(log.id);
                    this.container.dispatchEvent(new CustomEvent('activity-updated', { bubbles: true }));
                }
            });

            list.appendChild(entry);
        });

        this.container.appendChild(list);
    }
}

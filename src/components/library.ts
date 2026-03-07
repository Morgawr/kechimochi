import { getAllMedia, getLogs, Media, addMedia, updateMedia, deleteMedia } from '../api';
import { showAddMediaModal, customConfirm } from '../modals';

export class Library {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async render() {
    this.container.innerHTML = `
      <div class="animate-fade-in" style="display: flex; flex-direction: column; gap: 1.5rem; height: 100%;">
        
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0;">Library Kanban</h2>
          <button class="btn btn-ghost" id="btn-add-media">+ New Media</button>
        </div>

        <div id="media-kanban" style="display: flex; gap: 1rem; overflow-x: auto; flex: 1; min-height: 400px; padding-bottom: 1rem;">
          <!-- Kanban columns -->
        </div>

      </div>
    `;

    await this.loadData();
    this.setupListeners();
  }

  async loadData() {
    try {
      const mediaList = await getAllMedia();
      const logs = await getLogs();
      this.renderKanban(mediaList, logs);
    } catch (e) {
      console.error("Library failed to load data", e);
    }
  }

  private renderKanban(mediaList: Media[], logs: any[]) {
    const kanban = document.getElementById('media-kanban');
    if (!kanban) return;

    const statuses = ['Active', 'Finished'];
    
    // Group media by status
    const grouped = new Map<string, Media[]>();
    grouped.set('Active', []);
    grouped.set('Finished', []);

    for (const m of mediaList) {
        if (m.status === 'Completed' || m.status === 'Finished') {
            grouped.get('Finished')!.push(m);
        } else {
            grouped.get('Active')!.push(m);
        }
    }

    const lastLogMap = new Map<number, string>();
    for (const log of logs) {
        if (!lastLogMap.has(log.media_id) || log.date > lastLogMap.get(log.media_id)!) {
            lastLogMap.set(log.media_id, log.date);
        }
    }

    grouped.get('Finished')!.sort((a, b) => {
        const dateA = lastLogMap.get(a.id!) || '1970-01-01';
        const dateB = lastLogMap.get(b.id!) || '1970-01-01';
        return dateB.localeCompare(dateA);
    });

    let html = '';
    for (const status of statuses) {
        const items = grouped.get(status)!;
        html += `
          <div class="card kanban-column" data-status="${status}" style="flex: 1; display: flex; flex-direction: column; gap: 1rem; background: var(--bg-dark);">
            <h4 style="text-align: center; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; pointer-events: none;">${status} (${items.length})</h4>
            <div style="display: flex; flex-direction: column; gap: 0.5rem; flex: 1; overflow-y: auto;">
              ${items.map(m => `
                <div class="card kanban-item" draggable="true" data-media-id="${m.id}" style="padding: 1rem; cursor: grab; transition: transform 0.1s var(--transition-fast);">
                  <div style="font-weight: 500; font-size: 1rem; color: var(--text-primary); margin-bottom: 0.5rem; pointer-events: none;">${m.title}</div>
                  <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-secondary); pointer-events: none;">
                    <span>${m.language}</span>
                  </div>
                  <div style="margin-top: 0.5rem; display: flex; justify-content: flex-end; gap: 0.5rem;">
                    <button class="btn btn-danger delete-media-btn" data-media-id="${m.id}" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">Del</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
    }

    kanban.innerHTML = html;

    // Attach drag-and-drop listeners
    kanban.querySelectorAll('.kanban-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            const el = e.currentTarget as HTMLElement;
            (e as DragEvent).dataTransfer!.setData('text/plain', el.dataset.mediaId!);
        });
        item.addEventListener('mouseover', (e) => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1.02)';
        });
        item.addEventListener('mouseout', (e) => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
        });
    });

    kanban.querySelectorAll('.kanban-column').forEach(col => {
        col.addEventListener('dragover', (e) => e.preventDefault());
        col.addEventListener('drop', async (e) => {
            e.preventDefault();
            const idStr = (e as DragEvent).dataTransfer!.getData('text/plain');
            if (!idStr) return;
            const id = parseInt(idStr);
            if (!id) return;
            const newStatus = (e.currentTarget as HTMLElement).dataset.status!;

            const mediaList = await getAllMedia();
            const m = mediaList.find(x => x.id === id);
            if (m && (m.status !== newStatus && !(m.status === 'Completed' && newStatus === 'Finished'))) {
                m.status = newStatus;
                await updateMedia(m);
                this.loadData();
            }
        });
    });

    // Delete buttons
    kanban.querySelectorAll('.delete-media-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = parseInt((e.currentTarget as HTMLElement).dataset.mediaId!);
            const yes = await customConfirm("Delete Media", "Are you sure you want to delete this media and all its logs?");
            if (yes) {
                await deleteMedia(id);
                this.loadData();
            }
        });
    });
  }

  private setupListeners() {
    // Add Media
    document.getElementById('btn-add-media')?.addEventListener('click', async () => {
       const result = await showAddMediaModal();
       if (!result) return;
       
       addMedia({ title: result.title, media_type: result.type, status: "Active", language: "Japanese", description: "", cover_image: "", extra_data: "{}", content_type: "Unknown" }).then(() => this.loadData());
    });
  }
}

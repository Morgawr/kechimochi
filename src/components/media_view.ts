import { getAllMedia, getLogsForMedia, updateMedia, uploadCoverImage, readFileBytes, Media } from '../api';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { customPrompt, showImportMergeModal, customAlert } from '../modals';
import { fetchMetadataForUrl } from '../importers';

export class MediaView {
  private container: HTMLElement;
  private currentMediaList: Media[] = [];
  private currentIndex: number = 0;
  private targetMediaId: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async render() {
    this.container.innerHTML = `
      <div class="animate-fade-in" style="display: flex; flex-direction: column; height: 100%; gap: 1rem;">
        
        <!-- Header Carousel Controls -->
        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-dark); padding: 0.5rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
            <button class="btn btn-ghost" id="media-prev" style="font-size: 1.2rem; padding: 0.2rem 1rem;">&lt;&lt;</button>
            
            <!-- Search / Select dropdown -->
            <select id="media-select" style="flex: 1; max-width: 400px; text-align: center; border: none; background: transparent; font-size: 1.1rem; color: var(--text-primary); outline: none; appearance: none; cursor: pointer; text-align-last: center;">
            </select>
            
            <button class="btn btn-ghost" id="media-next" style="font-size: 1.2rem; padding: 0.2rem 1rem;">&gt;&gt;</button>
        </div>

        <!-- Main Media Content area -->
        <div id="media-content-area" style="display: flex; gap: 2rem; flex: 1; overflow-y: auto;">
            <!-- Loading placeholder -->
            <div style="margin: auto;">Loading...</div>
        </div>

      </div>
    `;

    await this.loadData();
    this.setupListeners();
  }

  private async loadData() {
    try {
      this.currentMediaList = await getAllMedia();
      
      // Sort by last activity (using a naive approach or just relying on list order for now, we'll refine if needed)
      // For now, let's reverse to show newest added first, or we can fetch logs to sort perfectly.
      this.currentMediaList.reverse();

      if (this.currentMediaList.length === 0) {
          const area = document.getElementById('media-content-area');
          if (area) area.innerHTML = `<div style="margin: auto; color: var(--text-secondary);">No media entries found. Add activity first.</div>`;
          return;
      }

      if (this.targetMediaId !== null) {
          const idx = this.currentMediaList.findIndex(m => m.id === this.targetMediaId);
          if (idx !== -1) this.currentIndex = idx;
          this.targetMediaId = null;
      }

      this.populateSelect();
      await this.renderCurrentMedia();
    } catch (e) {
      console.error("Failed to load media data", e);
    }
  }

  public async jumpToMedia(mediaId: number) {
      this.targetMediaId = mediaId;
      await this.render();
  }

  private populateSelect() {
      const select = document.getElementById('media-select') as HTMLSelectElement;
      if (!select) return;
      select.innerHTML = this.currentMediaList.map((m, i) => `<option value="${i}">${m.title}</option>`).join('');
      select.value = this.currentIndex.toString();
  }

  private async renderCurrentMedia() {
      const area = document.getElementById('media-content-area');
      const media = this.currentMediaList[this.currentIndex];
      if (!area || !media) return;

      // Handle Image
      let imgSrc = '';
      if (media.cover_image && media.cover_image.trim() !== '') {
          try {
             const bytes = await readFileBytes(media.cover_image);
             const blob = new Blob([new Uint8Array(bytes)]);
             imgSrc = URL.createObjectURL(blob);
          } catch (e) {
             console.error("Failed to load image bytes", e);
          }
      }

      const imgPlaceholderStyles = "width: 100%; aspect-ratio: 2/3; background: var(--bg-dark); border: 2px dashed var(--border-color); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-secondary);";
      const imageHtml = imgSrc !== '' 
        ? `<img src="${imgSrc}" style="width: 100%; aspect-ratio: 2/3; object-fit: cover; border-radius: var(--radius-md); cursor: pointer;" id="media-cover-img" alt="Cover" title="Double click to change image" />`
        : `<div style="${imgPlaceholderStyles}" id="media-cover-img" title="Double click to add image">No Image</div>`;

      // Read extra_data JSON safely
      let extraData: Record<string, string> = {};
      try {
          extraData = JSON.parse(media.extra_data || "{}");
      } catch (e) {
          console.warn("Could not parse extra data", e);
      }

      let extraDataHtml = Object.entries(extraData).map(([k, v]) => `
          <div class="card" style="padding: 0.5rem 1rem; position: relative;" data-ekey="${k}">
              <div style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase;">${k}</div>
              <div class="editable-extra" data-key="${k}" title="Double click to edit" style="cursor: pointer; font-weight: 500;">${v || '-'}</div>
              <div class="delete-extra-btn" data-key="${k}" title="Delete field" style="position: absolute; top: 0.5rem; right: 0.5rem; cursor: pointer; color: var(--accent-red); font-size: 0.8rem; font-weight: bold; opacity: 0.6;">&times;</div>
          </div>
      `).join('');

      area.innerHTML = `
        <!-- Left Column: Cover -->
        <div style="flex: 0 0 300px; display: flex; flex-direction: column;">
            ${imageHtml}
        </div>

        <!-- Right Column: Details -->
        <div style="flex: 1; display: flex; flex-direction: column; gap: 1rem;">
            <div>
               <h1 id="media-title" title="Double click to edit title" style="margin: 0; font-size: 2rem; cursor: pointer;">${media.title}</h1>
               <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; align-items: center;">
                 <span class="badge" id="media-type" title="Double click to edit media type" style="cursor: pointer; background: var(--accent); color: white; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.8rem;">${media.media_type}</span>
                 <span class="badge" id="media-content-type" title="Double click to edit content type" style="cursor: pointer; background: rgba(245, 192, 192, 0.15); color: var(--accent-purple); border: 1px solid rgba(245, 192, 192, 0.3); padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.8rem;">${media.content_type || 'Unknown'}</span>
                 <span class="badge" style="background: var(--bg-lighter); color: var(--text-secondary); padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.8rem;">${media.language}</span>
                 <span class="badge" style="background: var(--bg-lighter); color: var(--text-secondary); padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.8rem;">${media.status}</span>
               </div>
            </div>

            <div class="card" style="display: flex; flex-direction: column; gap: 0.5rem;">
                <h4 style="margin: 0; color: var(--text-secondary);">Description</h4>
                <div id="media-desc" title="Double click to edit description" style="cursor: pointer; white-space: pre-wrap;">${media.description || 'No description provided. Double click here to add one.'}</div>
            </div>

            <!-- Custom fields -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;">
                <div class="card" id="media-first-last-stats" style="grid-column: span 3; display: none; justify-content: flex-start; gap: 2rem; padding: 0.5rem 1rem; font-size: 0.85rem;"></div>
                ${extraDataHtml}
            </div>
            
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <button class="btn btn-ghost" id="btn-add-extra" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">+ Add Extra Field</button>
                <button class="btn btn-ghost" id="btn-import-meta" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; color: var(--accent-purple);">Fetch Metadata from URL</button>
            </div>
            
            <!-- Activity Logs Section -->
            <div class="card" style="margin-top: 1rem; flex: 1; display: flex; flex-direction: column; min-height: 200px;">
                <h4 style="margin: 0 0 1rem 0; color: var(--text-secondary);">Recent Activity</h4>
                <div id="media-logs-container" style="display: flex; flex-direction: column; gap: 0.5rem; flex: 1; overflow-y: auto;">
                    Loading logs...
                </div>
            </div>
        </div>
      `;

      this.setupEditableListeners(media);
      await this.loadLogsForCurrent(media.id!);
  }

  private async loadLogsForCurrent(mediaId: number) {
      const logsContainer = document.getElementById('media-logs-container');
      if (!logsContainer) return;

      try {
          const logs = await getLogsForMedia(mediaId);
          if (logs.length === 0) {
              logsContainer.innerHTML = '<div style="color: var(--text-secondary);">No activity logs found for this media.</div>';
              return;
          }

          // Compute first and last and total
          if (logs.length > 0) {
              const lastLogDate = logs[0].date;
              const firstLogDate = logs[logs.length - 1].date;
              
              let totalMin = 0;
              for (const log of logs) {
                  totalMin += log.duration_minutes;
              }
              const h = Math.floor(totalMin / 60);
              const m = totalMin % 60;
              const totalStr = h > 0 ? `${h}h${m}min` : `${m}min`;
              
              const mType = this.currentMediaList[this.currentIndex].media_type;
              let verb = "Logged";
              let totalLabel = "Total Time";
              
              if (mType === "Playing") { verb = "Played"; totalLabel = "Total Playtime"; }
              else if (mType === "Listening") { verb = "Listened"; totalLabel = "Total Listening Time"; }
              else if (mType === "Watching") { verb = "Watched"; totalLabel = "Total Watchtime"; }
              else if (mType === "Reading") { verb = "Read"; totalLabel = "Total Readtime"; }

              const statsDiv = document.getElementById('media-first-last-stats');
              if (statsDiv) {
                  statsDiv.style.display = 'flex';
                  statsDiv.innerHTML = `
                     <span style="color: var(--text-secondary);">First ${verb}: <strong style="color: var(--text-primary);">${firstLogDate}</strong></span>
                     <span style="color: var(--text-secondary);">Last ${verb}: <strong style="color: var(--text-primary);">${lastLogDate}</strong></span>
                     <span style="color: var(--text-secondary);">${totalLabel}: <strong style="color: var(--text-primary);">${totalStr}</strong></span>
                  `;
              }
          }

          logsContainer.innerHTML = logs.map(log => `
              <div style="display: flex; justify-content: space-between; padding: 0.5rem; border-bottom: 1px solid var(--border-color); font-size: 0.9rem;">
                  <span><span style="color: var(--text-secondary);">Activity:</span> ${log.duration_minutes} Minutes</span>
                  <span style="color: var(--text-secondary);">${log.date}</span>
              </div>
          `).join('');
      } catch(e) {
          console.error("Failed to load logs", e);
          logsContainer.innerHTML = '<div style="color: #ff4757;">Failed to load logs.</div>';
      }
  }

  private setupEditableListeners(media: Media) {
      // Image Upload
      document.getElementById('media-cover-img')?.addEventListener('dblclick', async () => {
          const selected = await open({
              multiple: false,
              filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
          });
          if (selected && typeof selected === 'string') {
              try {
                  const newPath = await uploadCoverImage(media.id!, selected);
                  media.cover_image = newPath;
                  await this.renderCurrentMedia();
              } catch (e) {
                  alert("Failed to upload image: " + e);
              }
          }
      });

      // Inline Editing Helper
      const makeEditable = (id: string, field: keyof Media, isTextArea: boolean = false) => {
          const el = document.getElementById(id);
          if (!el) return;
          el.addEventListener('dblclick', () => {
              const currentVal = media[field] as string;
              
              const input = document.createElement(isTextArea ? 'textarea' : 'input');
              input.value = currentVal;
              input.style.width = '100%';
              if (isTextArea) {
                  input.style.height = '100%';
                  input.style.minHeight = '150px';
                  input.style.resize = 'vertical';
              } else {
                  input.style.fontSize = 'inherit';
                  input.style.fontWeight = 'inherit';
                  input.style.fontFamily = 'inherit';
              }
              
              input.style.background = 'var(--bg-darker)';
              input.style.color = 'var(--text-primary)';
              input.style.border = '1px solid var(--accent)';
              input.style.padding = '0.5rem';
              input.style.outline = 'none';

              const save = async () => {
                  const newVal = input.value.trim();
                  (media as any)[field] = newVal;
                  try {
                      await updateMedia(media);
                      // Update title in select if it's the title
                      if (field === 'title') {
                          this.populateSelect();
                          // Refresh whole view to fix references
                      }
                  } catch (e) {
                      console.error("Update failed", e);
                  }
                  await this.renderCurrentMedia();
              };

              input.addEventListener('blur', save);
              input.addEventListener('keydown', (e: Event) => {
                  const ev = e as KeyboardEvent;
                  if (ev.key === 'Enter' && !isTextArea) {
                      input.blur();
                  }
              });

              el.replaceWith(input);
              input.focus();
          });
      };

      makeEditable('media-title', 'title', false);
      makeEditable('media-desc', 'description', true);
      makeEditable('media-type', 'media_type', false);

      // Content Type Dropdown Editor
      const contentTypeBadge = document.getElementById('media-content-type');
      if (contentTypeBadge) {
          contentTypeBadge.addEventListener('dblclick', () => {
              const select = document.createElement('select');
              select.style.background = 'var(--bg-darker)';
              select.style.color = 'var(--text-primary)';
              select.style.border = '1px solid var(--accent)';
              select.style.padding = '0.2rem 0.5rem';
              select.style.borderRadius = '12px';
              select.style.outline = 'none';

              let validOptions: string[] = ['Unknown'];
              const mType = media.media_type;
              if (mType === 'Reading') validOptions.push('Visual Novel', 'Manga', 'Novel');
              else if (mType === 'Playing') validOptions.push('Videogame');
              else if (mType === 'Listening') validOptions.push('Podcast');
              else if (mType === 'Watching') validOptions.push('Anime', 'Movie', 'Youtube Video', 'Livestream', 'Drama');

              select.innerHTML = validOptions.map(opt => `<option value="${opt}" ${opt === media.content_type ? 'selected' : ''}>${opt}</option>`).join('');

              let isSaving = false;
              const save = async () => {
                  if (isSaving) return;
                  isSaving = true;
                  
                  const newValue = select.value;
                  if (newValue && newValue !== media.content_type) {
                      media.content_type = newValue;
                      try {
                          await updateMedia(media);
                      } catch (e) {
                          alert("Database Error: Restart Kechimochi so the new architecture loads! " + String(e));
                      }
                  }
                  
                  await this.renderCurrentMedia();
              };

              select.addEventListener('change', save);
              
              select.addEventListener('keydown', (e: KeyboardEvent) => {
                  if (e.key === 'Escape') this.renderCurrentMedia();
              });

              // Instead of blur (which randomly triggers when Tauri opens the OS-level dropdown window),
              // we detect outside clicks globally.
              setTimeout(() => {
                  const outsideClick = (e: MouseEvent) => {
                      if (document.body.contains(select) && e.target !== select) {
                          window.removeEventListener('click', outsideClick);
                          if (!isSaving) this.renderCurrentMedia();
                      }
                  };
                  window.addEventListener('click', outsideClick);
              }, 100);

              contentTypeBadge.replaceWith(select);
              select.focus();
          });
      }

      // Extra Data handling
      document.querySelectorAll('.editable-extra').forEach(el => {
          el.addEventListener('dblclick', (e) => {
              const target = e.currentTarget as HTMLElement;
              const key = target.dataset.key!;
              
              let extraData = JSON.parse(media.extra_data || "{}");
              const currentVal = extraData[key] || "";

              const input = document.createElement('input');
              input.value = currentVal;
              input.style.width = '100%';
              input.style.background = 'var(--bg-darker)';
              input.style.color = 'white';
              input.style.border = '1px solid var(--accent)';
              
              const save = async () => {
                  const newVal = input.value.trim();
                  if (newVal === "") {
                      delete extraData[key];
                  } else {
                      extraData[key] = newVal;
                  }
                  media.extra_data = JSON.stringify(extraData);
                  await updateMedia(media);
                  await this.renderCurrentMedia();
              };

              input.addEventListener('blur', save);
              input.addEventListener('keydown', ev => {
                  if (ev.key === 'Enter') input.blur();
              });

              target.replaceWith(input);
              input.focus();
          });
      });
      
      // Delete extra field handling
      document.querySelectorAll('.delete-extra-btn').forEach(el => {
          el.addEventListener('click', async (e) => {
              const target = e.currentTarget as HTMLElement;
              const key = target.dataset.key!;
              let extraData = JSON.parse(media.extra_data || "{}");
              if (key in extraData) {
                  delete extraData[key];
                  media.extra_data = JSON.stringify(extraData);
                  await updateMedia(media);
                  await this.renderCurrentMedia();
              }
          });
      });

      // Add extra field
      document.getElementById('btn-add-extra')?.addEventListener('click', async () => {
          const keyName = await customPrompt("Enter new field name (e.g. Started, Author, Rating):");
          if (!keyName || keyName.trim() === "") return;
          
          let extraData = JSON.parse(media.extra_data || "{}");
          extraData[keyName.trim()] = "Empty";
          media.extra_data = JSON.stringify(extraData);
          await updateMedia(media);
          await this.renderCurrentMedia();
      });

      // Import Metadata
      document.getElementById('btn-import-meta')?.addEventListener('click', async () => {
          const url = await customPrompt(`Enter a valid URL for ${media.content_type} metadata:`);
          if (!url || url.trim() === "") return;
          
          try {
              document.getElementById('btn-import-meta')!.innerText = "Fetching...";
              const scraped = await fetchMetadataForUrl(url.trim(), media.content_type || "Unknown");
              if (!scraped) throw new Error("Could not parse data.");
              
              const currentExtra = JSON.parse(media.extra_data || "{}");
              const selected = await showImportMergeModal(scraped, currentExtra);
              
              if (selected) {
                  if (selected.description !== undefined) media.description = selected.description;
                  
                  if (selected.coverImageUrl) {
                      const newCoverPath = await invoke<string>('download_and_save_image', { 
                          mediaId: media.id, 
                          url: selected.coverImageUrl 
                      });
                      media.cover_image = newCoverPath;
                  }
                  
                  for (const [k, v] of Object.entries(selected.extraData)) {
                      currentExtra[k] = v;
                  }
                  media.extra_data = JSON.stringify(currentExtra);
                  
                  await updateMedia(media);
              }
          } catch (e: any) {
              await customAlert("Import Failed", (e.message || String(e)));
          } finally {
              const btn = document.getElementById('btn-import-meta');
              if (btn) btn.innerText = "Fetch Metadata from URL";
              await this.renderCurrentMedia();
          }
      });
  }

  private setupListeners() {
    document.getElementById('media-prev')?.addEventListener('click', () => {
        if (this.currentMediaList.length === 0) return;
        this.currentIndex = (this.currentIndex - 1 + this.currentMediaList.length) % this.currentMediaList.length;
        this.populateSelect();
        this.renderCurrentMedia();
    });

    document.getElementById('media-next')?.addEventListener('click', () => {
        if (this.currentMediaList.length === 0) return;
        this.currentIndex = (this.currentIndex + 1) % this.currentMediaList.length;
        this.populateSelect();
        this.renderCurrentMedia();
    });

    const select = document.getElementById('media-select') as HTMLSelectElement;
    if (select) {
        select.addEventListener('change', () => {
            this.currentIndex = parseInt(select.value);
            this.renderCurrentMedia();
        });
    }
  }
}

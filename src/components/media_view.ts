import { getAllMedia, getLogsForMedia, updateMedia, uploadCoverImage, readFileBytes, Media, addMedia, deleteMedia } from '../api';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { customPrompt, showImportMergeModal, customAlert, showAddMediaModal, customConfirm } from '../modals';
import { fetchMetadataForUrl, isValidImporterUrl, getAvailableSourcesForContentType } from '../importers';

export class MediaView {
    private container: HTMLElement;
    private currentMediaList: Media[] = [];
    private currentIndex: number = 0;
    private targetMediaId: number | null = null;
    private viewMode: 'grid' | 'detail' = 'grid';
    private gridSearchQuery: string = '';
    private gridTypeFilter: string = 'All';
    private gridStatusFilter: string = 'All';
    private hideArchived: boolean = false;
    private imageCache: Map<string, string> = new Map();

    constructor(container: HTMLElement) {
        this.container = container;
        this.setupGlobalNavigation();
    }

    private setupGlobalNavigation() {
        window.addEventListener('keydown', (e) => {
            if (!document.getElementById('media-root')) return;
            if (this.viewMode !== 'detail') return;

            if (e.key === 'ArrowRight') {
                this.goToNext();
            } else if (e.key === 'ArrowLeft') {
                this.goToPrev();
            } else if (e.key === 'Escape') {
                this.exitDetail();
            }
        });

        window.addEventListener('mousedown', (e) => {
            if (!document.getElementById('media-root')) return;
            if (e.button === 3) {
                // Prevent browser-level "Back" navigation
                e.preventDefault();
                e.stopPropagation();
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (!document.getElementById('media-root')) return;
            
            // Mouse button 3 is "Back"
            if (e.button === 3) {
                if (this.viewMode === 'detail') {
                    this.exitDetail();
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        });
    }

    private async goToNext() {
        if (this.currentMediaList.length === 0) return;
        this.currentIndex = (this.currentIndex + 1) % this.currentMediaList.length;
        this.populateSelect();
        const media = this.currentMediaList[this.currentIndex];
        this.targetMediaId = media.id || null;
        if (media) await this.renderDetailContent(media);
    }

    private async goToPrev() {
        if (this.currentMediaList.length === 0) return;
        this.currentIndex = (this.currentIndex - 1 + this.currentMediaList.length) % this.currentMediaList.length;
        this.populateSelect();
        const media = this.currentMediaList[this.currentIndex];
        this.targetMediaId = media.id || null;
        if (media) await this.renderDetailContent(media);
    }

    private async exitDetail() {
        this.targetMediaId = null;
        this.viewMode = 'grid';
        await this.render();
    }

    async render() {
        await this.loadData();

        this.container.innerHTML = `
      <div class="animate-fade-in" style="display: flex; flex-direction: column; height: 100%; gap: 1rem;" id="media-root">
      </div>
    `;

        if (this.viewMode === 'grid') {
            await this.renderGrid();
        } else {
            await this.renderDetail();
        }
    }

    private async loadData() {
        try {
            this.currentMediaList = await getAllMedia(); // Already sorted by backend: Active first, then by last activity date.

            if (this.targetMediaId !== null) {
                const idx = this.currentMediaList.findIndex(m => m.id === this.targetMediaId);
                if (idx !== -1) {
                    this.currentIndex = idx;
                    this.viewMode = 'detail';
                }
                this.targetMediaId = null;
            }
        } catch (e) {
            console.error("Failed to load media data", e);
        }
    }

    public async jumpToMedia(mediaId: number) {
        this.targetMediaId = mediaId;
        await this.render();
    }

    private async renderGrid() {
        const root = document.getElementById('media-root');
        if (!root) return;

        if (this.currentMediaList.length === 0) {
            root.innerHTML = `<div style="margin: auto; color: var(--text-secondary);">No media entries found. Add activity first.</div>`;
            return;
        }

        const uniqueTypes = Array.from(new Set(this.currentMediaList.map(m => m.content_type || 'Unknown'))).sort();
        const typeOptionsHtml = uniqueTypes.map(t => `<option value="${t}" ${this.gridTypeFilter === t ? 'selected' : ''}>${t}</option>`).join('');

        root.innerHTML = `
          <style>
              .media-grid-item {
                  transition: transform 0.2s, box-shadow 0.2s;
                  z-index: 1;
                  animation: fadeIn 0.3s ease-out forwards;
                  opacity: 0;
              }
              @keyframes fadeIn {
                  from { opacity: 0; transform: translateY(10px); }
                  to { opacity: 1; transform: translateY(0); }
              }
              .media-grid-item:hover {
                  transform: scale(1.05);
                  box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                  z-index: 10;
              }
          </style>
          <div style="padding: 0 1rem; display: flex; gap: 1rem; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 1rem;">
                  <h2 style="margin: 0.5rem 0; color: var(--text-primary); white-space: nowrap;">Library</h2>
                  <button class="btn btn-ghost" id="btn-add-media-grid" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;">+ New Media</button>
              </div>
              <input type="text" id="grid-search-filter" placeholder="Search title..." style="flex: 1; min-width: 0; padding: 0.4rem 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); outline: none;" value="${this.gridSearchQuery}" autocomplete="off" />
              <select id="grid-status-select" style="padding: 0.4rem 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); outline: none; cursor: pointer;">
                  <option value="All" ${this.gridStatusFilter === 'All' ? 'selected' : ''}>All Statuses</option>
                  ${["Ongoing", "Complete", "Paused", "Dropped", "Not Started", "Untracked"].map(s => `<option value="${s}" ${this.gridStatusFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
              <select id="grid-type-select" style="padding: 0.4rem 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); outline: none; cursor: pointer;">
                  <option value="All" ${this.gridTypeFilter === 'All' ? 'selected' : ''}>All Types</option>
                  ${typeOptionsHtml}
              </select>
              <div style="display: flex; align-items: center; gap: 0.6rem; user-select: none;">
                  <span style="font-size: 0.85rem; color: var(--text-secondary);">Hide Archived</span>
                  <label class="switch" style="font-size: 0.7rem;">
                      <input type="checkbox" id="grid-hide-archived" ${this.hideArchived ? 'checked' : ''}>
                      <span class="slider round"></span>
                  </label>
              </div>
          </div>
          
          <div id="media-grid-container" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); grid-auto-rows: 320px; gap: 1.5rem; overflow-y: auto; flex: 1; padding: 0.5rem 1rem 2rem 1rem; align-content: flex-start;">
              <!-- Items will be injected here progressively -->
          </div>
      `;

        const container = document.getElementById('media-grid-container')!;
        
        // Progressive rendering
        const batchSize = 10;
        let currentIndex = 0;

        const renderBatch = async () => {
            const end = Math.min(currentIndex + batchSize, this.currentMediaList.length);
            for (let i = currentIndex; i < end; i++) {
                const media = this.currentMediaList[i];
                const itemDiv = document.createElement('div');
                itemDiv.className = 'media-grid-item';
                itemDiv.dataset.index = i.toString();
                itemDiv.dataset.type = media.content_type || 'Unknown';
                itemDiv.dataset.status = media.status;
                itemDiv.dataset.tracking = media.tracking_status;
                itemDiv.title = media.title;
                itemDiv.style.cssText = `cursor: pointer; border-radius: var(--radius-md); overflow: hidden; background: var(--bg-dark); border: 1px solid var(--border-color); display: flex; flex-direction: column; height: 100%; position: relative;`;
                
                const matchesQuery = media.title.toLowerCase().includes(this.gridSearchQuery.toLowerCase());
                const typeMatch = this.gridTypeFilter === 'All' || (media.content_type || 'Unknown') === this.gridTypeFilter;
                const statusMatch = this.gridStatusFilter === 'All' || media.tracking_status === this.gridStatusFilter;
                const isArchived = media.status === 'Archived' || media.status === 'Inactive' || media.status === 'Finished' || media.status === 'Completed';
                const showStatus = !this.hideArchived || !isArchived;

                if (!matchesQuery || !typeMatch || !statusMatch || !showStatus) itemDiv.style.display = 'none';

                const contentType = media.content_type || 'Unknown';
                const badgeHtml = (contentType !== 'Unknown' && contentType.trim() !== '')
                    ? `<div class="grid-item-type-badge">${contentType}</div>`
                    : '';
                const ledHtml = media.tracking_status !== 'Untracked' 
                    ? `<div class="status-led ${this.getTrackingStatusClass(media.tracking_status)}" title="Status: ${media.tracking_status}"></div>` 
                    : '';

                itemDiv.innerHTML = `
                    <div class="image-placeholder" style="flex: 1; display: flex; flex-direction: column; padding: 1.2rem 1rem; color: var(--text-secondary); text-align: center; justify-content: space-between;">
                        <div style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary); display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; line-height: 1.3;">${media.title}</div>
                        <div style="font-size: 0.75rem; opacity: 0.6; text-transform: uppercase; letter-spacing: 1px;">Loading...</div>
                    </div>
                    ${badgeHtml}
                    ${ledHtml}
                `;

                itemDiv.addEventListener('click', () => {
                   this.currentIndex = i;
                   this.targetMediaId = media.id || null;
                   this.viewMode = 'detail';
                   this.render();
                });

                container.appendChild(itemDiv);

                // Load image asynchronously
                (async () => {
                    if (media.cover_image && media.cover_image.trim() !== '') {
                        let imgSrc = '';
                        if (this.imageCache.has(media.cover_image)) {
                            imgSrc = this.imageCache.get(media.cover_image)!;
                        } else {
                            try {
                                const bytes = await readFileBytes(media.cover_image);
                                const blob = new Blob([new Uint8Array(bytes)]);
                                imgSrc = URL.createObjectURL(blob);
                                this.imageCache.set(media.cover_image, imgSrc);
                            } catch (e) {}
                        }
                        if (imgSrc) {
                            itemDiv.innerHTML = `
                                <img src="${imgSrc}" style="width: 100%; height: 100%; object-fit: cover; display: block;" alt="${media.title}" />
                                ${badgeHtml}
                                ${ledHtml}
                            `;
                        } else {
                            itemDiv.innerHTML = `
                                <div style="flex: 1; display: flex; flex-direction: column; padding: 1.2rem 1rem; color: var(--text-secondary); text-align: center; justify-content: space-between;">
                                    <div style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary); display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; line-height: 1.3;">${media.title}</div>
                                    <div style="font-size: 0.75rem; opacity: 0.6; text-transform: uppercase; letter-spacing: 1px;">No Image</div>
                                </div>
                                ${badgeHtml}
                                ${ledHtml}
                            `;
                        }
                    } else {
                        itemDiv.innerHTML = `
                            <div style="flex: 1; display: flex; flex-direction: column; padding: 1.2rem 1rem; color: var(--text-secondary); text-align: center; justify-content: space-between;">
                                <div style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary); display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; line-height: 1.3;">${media.title}</div>
                                <div style="font-size: 0.75rem; opacity: 0.6; text-transform: uppercase; letter-spacing: 1px;">No Image</div>
                            </div>
                            ${badgeHtml}
                            ${ledHtml}
                        `;
                    }
                })();
            }
            currentIndex = end;
            if (currentIndex < this.currentMediaList.length) {
                requestAnimationFrame(renderBatch);
            }
        };

        requestAnimationFrame(renderBatch);

        // Setup filtering
        const applyFilters = () => {
            const queryLower = this.gridSearchQuery.toLowerCase();
            document.querySelectorAll('.media-grid-item').forEach(el => {
                const itemEl = el as HTMLElement;
                const title = itemEl.getAttribute('title')?.toLowerCase() || "";
                const type = itemEl.getAttribute('data-type') || "";
                const status = itemEl.getAttribute('data-status') || "";
                const tracking = itemEl.getAttribute('data-tracking') || "";
                
                const typeMatch = this.gridTypeFilter === 'All' || type === this.gridTypeFilter;
                const trackingMatch = this.gridStatusFilter === 'All' || tracking === this.gridStatusFilter;
                const isArchived = status === 'Archived' || status === 'Inactive' || status === 'Finished' || status === 'Completed';
                const showStatus = !this.hideArchived || !isArchived;

                if (title.includes(queryLower) && typeMatch && trackingMatch && showStatus) {
                    itemEl.style.display = 'flex';
                } else {
                    itemEl.style.display = 'none';
                }
            });
        };

        // Setup search filter listener
        const searchInput = document.getElementById('grid-search-filter') as HTMLInputElement;
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.gridSearchQuery = (e.target as HTMLInputElement).value;
                applyFilters();
            });
        }

        const typeSelect = document.getElementById('grid-type-select') as HTMLSelectElement;
        if (typeSelect) {
            typeSelect.addEventListener('change', (e) => {
                this.gridTypeFilter = (e.target as HTMLSelectElement).value;
                applyFilters();
            });
        }

        const statusSelect = document.getElementById('grid-status-select') as HTMLSelectElement;
        if (statusSelect) {
            statusSelect.addEventListener('change', (e) => {
                this.gridStatusFilter = (e.target as HTMLSelectElement).value;
                applyFilters();
            });
        }

        const hideArchivedToggle = document.getElementById('grid-hide-archived') as HTMLInputElement;
        if (hideArchivedToggle) {
            hideArchivedToggle.addEventListener('change', (e) => {
                this.hideArchived = (e.target as HTMLInputElement).checked;
                applyFilters();
            });
        }

        // setup add media button
        document.getElementById('btn-add-media-grid')?.addEventListener('click', async () => {
            const result = await showAddMediaModal();
            if (!result) return;
            
            const newId = await addMedia({ 
                title: result.title, 
                media_type: result.type, 
                status: "Active", 
                language: "Japanese", 
                description: "", 
                cover_image: "", 
                extra_data: "{}", 
                content_type: result.contentType, 
                tracking_status: "Untracked" 
            });
            await this.loadData();
            await this.jumpToMedia(newId);
        });

    }

    private async renderDetail() {
        const root = document.getElementById('media-root');
        if (!root) return;

        if (this.currentMediaList.length === 0) {
            root.innerHTML = `<div style="margin: auto; color: var(--text-secondary);">No media entries found. Add activity first.</div>`;
            return;
        }

        const media = this.currentMediaList[this.currentIndex];
        if (!media) return;

        root.innerHTML = `
        <!-- Header Carousel & Back Controls -->
        <div style="display: flex; gap: 1rem; align-items: center; justify-content: space-between; background: var(--bg-dark); padding: 0.5rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
            <div style="flex: 1; display: flex; justify-content: flex-start;">
                <button class="btn btn-ghost" id="btn-back-grid" style="font-size: 0.9rem; padding: 0.4rem 0.8rem; display: flex; align-items: center; gap: 0.3rem;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Back to Grid</button>
            </div>
            
            <div style="display: flex; justify-content: center; align-items: center; gap: 1rem;">
                <button class="btn btn-ghost" id="media-prev" style="font-size: 1.2rem; padding: 0.2rem 1rem;">&lt;&lt;</button>
                
                <!-- Search / Select dropdown -->
                <select id="media-select" style="max-width: 800px; text-align: center; border: none; background: transparent; font-size: 1.1rem; color: var(--text-primary); outline: none; appearance: none; cursor: pointer; text-align-last: center; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">
                </select>
                
                <button class="btn btn-ghost" id="media-next" style="font-size: 1.2rem; padding: 0.2rem 1rem;">&gt;&gt;</button>
            </div>
            
            <div style="flex: 1;"></div>
        </div>

        <!-- Main Media Content area -->
        <div id="media-content-area" style="display: flex; gap: 2rem; flex: 1; overflow-y: auto;">
            <div style="margin: auto;">Loading details...</div>
        </div>
      `;

        this.populateSelect();
        this.setupDetailListeners();
        await this.renderDetailContent(media);
    }

    private populateSelect() {
        const select = document.getElementById('media-select') as HTMLSelectElement;
        if (!select) return;
        select.innerHTML = this.currentMediaList.map((m, i) => `<option value="${i}">${m.title}</option>`).join('');
        select.value = this.currentIndex.toString();
    }

    private async renderDetailContent(media: Media) {
        const area = document.getElementById('media-content-area');
        if (!area || !media) return;

        // Handle Image
        let imgSrc = '';
        if (media.cover_image && media.cover_image.trim() !== '') {
            if (this.imageCache.has(media.cover_image)) {
                imgSrc = this.imageCache.get(media.cover_image)!;
            } else {
                try {
                    const bytes = await readFileBytes(media.cover_image);
                    const blob = new Blob([new Uint8Array(bytes)]);
                    imgSrc = URL.createObjectURL(blob);
                    this.imageCache.set(media.cover_image, imgSrc);
                } catch (e) {
                    console.error("Failed to load image bytes", e);
                }
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

        const sortedEntries = Object.entries(extraData).sort((a, b) => {
            const aIsSource = a[0].toLowerCase().includes("source");
            const bIsSource = b[0].toLowerCase().includes("source");
            if (aIsSource && !bIsSource) return -1;
            if (!aIsSource && bIsSource) return 1;
            return 0;
        });

        let extraDataHtml = sortedEntries.map(([k, v]) => {
            const isSourceUrl = k.toLowerCase().includes('source') && typeof v === 'string' && v.startsWith('http') && isValidImporterUrl(v, media.content_type || "Unknown");
            let refreshBtn = '';
            if (isSourceUrl) {
                refreshBtn = `<div class="refresh-extra-btn" data-url="${v}" title="Refresh Metadata" style="position: absolute; bottom: 0.5rem; right: 0.5rem; cursor: pointer; color: var(--accent-purple); display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--bg-dark);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21v-5h5"/></svg>
              </div>`;
            }

            return `
          <div class="card" style="padding: 0.5rem 1rem; position: relative;" data-ekey="${k}">
              <div style="font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase;">${k}</div>
              <div class="editable-extra" data-key="${k}" title="Double click to edit" style="cursor: pointer; font-weight: 500;">${v || '-'}</div>
              <div class="delete-extra-btn" data-key="${k}" title="Delete field" style="position: absolute; top: 0.5rem; right: 0.5rem; cursor: pointer; color: var(--accent-red); font-size: 0.8rem; font-weight: bold; opacity: 0.6;">&times;</div>
              ${refreshBtn}
          </div>
          `;
        }).join('');

        area.innerHTML = `
        <!-- Left Column: Cover -->
        <div style="flex: 0 0 300px; display: flex; flex-direction: column;">
            ${imageHtml}
            <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 0.5rem;">
                <button class="btn" id="btn-delete-media-detail" style="background-color: #ff4757; color: white; border: none; font-weight: bold; width: 100%; padding: 0.6rem; font-size: 0.9rem;">Delete Media</button>
                <div style="font-size: 0.7rem; color: var(--text-secondary); line-height: 1.2; text-align: center;">
                    <strong>DANGER:</strong> COMPLETELY REMOVES THIS MEDIA AND <strong>ALL</strong> ASSOCIATED WORK LOGS FOR ALL USERS.
                </div>
            </div>
        </div>

        <!-- Right Column: Details -->
        <div style="flex: 1; display: flex; flex-direction: column; gap: 1rem;">
            <div>
               <div style="display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap;">
                  <h1 id="media-title" title="Double click to edit title" style="margin: 0; font-size: 2rem; cursor: pointer;">${media.title}</h1>
                  <button class="copy-btn" id="btn-copy-title" title="Copy Title" style="margin-bottom: 3px;">
                     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
               </div>
               <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; align-items: center; flex-wrap: wrap;">
                 <select class="badge badge-select ${this.getTrackingStatusClass(media.tracking_status)}" id="media-tracking-status" title="Click to edit tracking status">
                     ${["Ongoing", "Complete", "Paused", "Dropped", "Not Started", "Untracked"].map(opt => `<option value="${opt}" ${opt === media.tracking_status ? 'selected' : ''}>${opt}</option>`).join('')}
                 </select>
                 <select class="badge badge-select" id="media-type" title="Click to edit activity type">
                     ${["Reading", "Watching", "Playing", "Listening", "None"].map(opt => `<option value="${opt}" ${opt === media.media_type ? 'selected' : ''}>${opt}</option>`).join('')}
                 </select>
                 <select class="badge badge-select badge-content" id="media-content-type" title="Click to edit content type">
                     ${(() => {
                        let validOptions: string[] = ['Unknown'];
                        const mType = media.media_type;
                        if (mType === 'Reading') validOptions.push('Visual Novel', 'Manga', 'Novel');
                        else if (mType === 'Playing') validOptions.push('Videogame');
                        else if (mType === 'Listening') validOptions.push('Podcast');
                        else if (mType === 'Watching') validOptions.push('Anime', 'Movie', 'Youtube Video', 'Livestream', 'Drama');
                        return validOptions.map(opt => `<option value="${opt}" ${opt === media.content_type ? 'selected' : ''}>${opt}</option>`).join('');
                     })()}
                 </select>
                 <span class="badge" style="background: var(--bg-card-hover); color: var(--text-secondary);">${media.language}</span>
                 <span class="badge" style="background: var(--bg-card-hover); color: var(--text-secondary); border: 1px solid var(--border-color); display: flex; align-items: center; gap: 0.5rem; padding: 0.2rem 0.6rem;">
                    <label class="switch">
                        <input type="checkbox" id="status-toggle" ${media.status !== 'Archived' && media.status !== 'Inactive' && media.status !== 'Finished' && media.status !== 'Completed' ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                    <span id="status-label" style="font-weight: 600; font-size: 0.75rem; text-transform: uppercase;">${media.status !== 'Archived' && media.status !== 'Inactive' && media.status !== 'Finished' && media.status !== 'Completed' ? 'Active' : 'Archived'}</span>
                 </span>
                 ${media.tracking_status !== 'Complete' ? `<button class="btn btn-ghost" id="btn-mark-complete" style="padding: 0.2rem 0.8rem; font-size: 0.75rem; border-color: var(--accent-green); color: var(--accent-green); border-radius: 12px; height: 1.6rem; margin-left: 0.5rem;">Mark as complete</button>` : ''}
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
                ${getAvailableSourcesForContentType(media.content_type || "Unknown").length > 0 ? `
                <button class="btn btn-ghost btn-meta-fetch" id="btn-import-meta" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">Fetch Metadata from URL</button>
                ` : ''}
                <button class="btn btn-ghost btn-meta-clear" id="btn-clear-meta" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">Clear Metadata</button>
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
        } catch (e) {
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
                    this.imageCache.delete(newPath); // Ensure cache misses for new image
                    await this.renderDetailContent(media); // Re-render just the inner detail area
                } catch (e) {
                    alert("Failed to upload image: " + e);
                }
            }
        });

        // Copy Title
        document.getElementById('btn-copy-title')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget as HTMLElement;
            try {
                await navigator.clipboard.writeText(media.title);
                btn.classList.add('success');
                const originalSvg = btn.innerHTML;
                btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
                setTimeout(() => {
                    btn.classList.remove('success');
                    btn.innerHTML = originalSvg;
                }, 2000);
            } catch (err) {
                console.error('Failed to copy title: ', err);
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
                    await this.renderDetailContent(media);
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

        // Media Type - native select handling
        const mediaTypeSelect = document.getElementById('media-type') as HTMLSelectElement;
        if (mediaTypeSelect) {
            mediaTypeSelect.addEventListener('change', async () => {
                const newValue = mediaTypeSelect.value;
                if (newValue && newValue !== media.media_type) {
                    media.media_type = newValue;
                    try {
                        await updateMedia(media);
                    } catch (e) {
                        console.error("Update failed", e);
                    }
                    await this.renderDetailContent(media);
                }
            });
        }

        // Content Type - native select handling
        const contentTypeSelect = document.getElementById('media-content-type') as HTMLSelectElement;
        if (contentTypeSelect) {
            contentTypeSelect.addEventListener('change', async () => {
                const newValue = contentTypeSelect.value;
                if (newValue && newValue !== media.content_type) {
                    media.content_type = newValue;
                    try {
                        await updateMedia(media);
                    } catch (e) {
                        alert("Database Error: " + String(e));
                    }
                    await this.renderDetailContent(media);
                }
            });
        }

        // Tracking Status - native select handling
        const trackingStatusSelect = document.getElementById('media-tracking-status') as HTMLSelectElement;
        if (trackingStatusSelect) {
            trackingStatusSelect.addEventListener('change', async () => {
                const newValue = trackingStatusSelect.value;
                if (newValue && newValue !== media.tracking_status) {
                    media.tracking_status = newValue;
                    try {
                        await updateMedia(media);
                    } catch (e) {
                        alert("Database Error: " + String(e));
                    }
                    await this.renderDetailContent(media);
                }
            });
        }

        // Status Toggle handling (this is a click-based toggle already, so no changes needed for "single click")
        const markCompleteBtn = document.getElementById('btn-mark-complete');
        if (markCompleteBtn) {
            markCompleteBtn.addEventListener('click', async () => {
                media.tracking_status = 'Complete';
                try {
                    await updateMedia(media);
                    await this.renderDetailContent(media);
                } catch (e) {
                    console.error("Failed to update status", e);
                }
            });
        }

        const statusToggle = document.getElementById('status-toggle') as HTMLInputElement;
        const statusLabel = document.getElementById('status-label');
        if (statusToggle && statusLabel) {
            statusToggle.addEventListener('change', async () => {
                const isActive = statusToggle.checked;
                media.status = isActive ? 'Active' : 'Archived';
                statusLabel.innerText = media.status;
                try {
                    await updateMedia(media);
                } catch (e) {
                    console.error("Failed to update status", e);
                }
            });
        }

        // Delete Media Detail
        document.getElementById('btn-delete-media-detail')?.addEventListener('click', async () => {
            const yes = await customConfirm(
                "Delete Media", 
                "Are you sure? This will PERMANENTLY delete this media entry and ALL activity logs for ALL users. This cannot be undone.",
                "btn-danger",
                "Delete Permanently"
            );
            if (yes) {
               try {
                   await deleteMedia(media.id!);
                   this.viewMode = 'grid';
                   await this.loadData();
                   await this.render();
               } catch (e) {
                   await customAlert("Error", "Failed to delete media: " + String(e));
               }
            }
        });

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
                    await this.renderDetailContent(media);
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
                    await this.renderDetailContent(media);
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
            await this.renderDetailContent(media);
        });

        // Import Metadata
        document.getElementById('btn-import-meta')?.addEventListener('click', async () => {
            const sources = getAvailableSourcesForContentType(media.content_type || "Unknown");
            const sourceMsg = sources.length > 0 ? `Available sites for this media type: ${sources.join(", ")}.` : "";
            let url = await customPrompt("Enter the URL of the source of metadata", "", sourceMsg);
            if (!url || url.trim() === "") return;
            await this.performMetadataImport(media, url.trim(), false);
        });

        // Refresh Metadata from individual sources
        document.querySelectorAll('.refresh-extra-btn').forEach(el => {
            el.addEventListener('click', async (e) => {
                const target = e.currentTarget as HTMLElement;
                const url = target.dataset.url;
                if (url) {
                    const svg = target.querySelector('svg');
                    if (svg) svg.style.animation = "spin 1s linear infinite"; // Optional: add CSS spin keyframes elsewhere or trust it's somewhat working
                    await this.performMetadataImport(media, url, true);
                    if (svg) svg.style.animation = "none";
                }
            });
        });

        // Clear Metadata
        document.getElementById('btn-clear-meta')?.addEventListener('click', async () => {
            const confirmBox = await customPrompt("Are you sure you want to clear all metadata for this entry?\nType 'yes' to confirm:");
            if (confirmBox && confirmBox.trim().toLowerCase() === 'yes') {
                media.description = "";
                media.cover_image = "";
                media.extra_data = "{}";
                await updateMedia(media);
                await this.renderDetailContent(media);
            }
        });
    }

    private setupDetailListeners() {
        document.getElementById('btn-back-grid')?.addEventListener('click', async () => {
            this.exitDetail();
        });

        document.getElementById('media-prev')?.addEventListener('click', async () => {
            this.goToPrev();
        });

        document.getElementById('media-next')?.addEventListener('click', async () => {
            this.goToNext();
        });

        const select = document.getElementById('media-select') as HTMLSelectElement;
        if (select) {
            select.addEventListener('change', async () => {
                this.currentIndex = parseInt(select.value);
                const media = this.currentMediaList[this.currentIndex];
                if (media) await this.renderDetailContent(media);
            });
        }
    }

    private async performMetadataImport(media: Media, url: string, isRefresh: boolean = false) {
        let targetVolume: number | undefined = undefined;
        let reportedVolume: number | undefined = undefined;

        let defaultVol = "1";
        try {
            const currentExtraMap = JSON.parse(media.extra_data || "{}");
            if (currentExtraMap["Volume"]) {
                defaultVol = currentExtraMap["Volume"];
            }
        } catch (e) { }

        if (url.includes("cmoa.jp/title/")) {
            // If refresh and we have a volume mapped, skip asking
            let volStr: string | null = null;
            if (isRefresh && defaultVol !== "1") {
                volStr = defaultVol;
            } else {
                volStr = await customPrompt("Cmoa detected. Enter Volume Number (leave empty for Volume 1):", defaultVol);
            }

            if (volStr !== null) {
                let volNum = parseInt(volStr.trim(), 10);
                if (isNaN(volNum)) volNum = parseInt(defaultVol, 10) || 1;

                if (volNum >= 1) {
                    reportedVolume = volNum;
                    url = url.replace(/\/vol\/\d+\/?$/, '');
                    if (!url.endsWith('/')) url += '/';

                    if (volNum > 1) {
                        url += `vol/${volNum}/`;
                    }
                }
            } else {
                return; // Cancelled
            }
        } else if (url.includes("bookwalker.jp/")) {
            let volStr: string | null = null;
            if (isRefresh && defaultVol !== "1") {
                volStr = defaultVol;
            } else {
                volStr = await customPrompt("Bookwalker detected. Enter Volume Number (leave empty for Volume 1):", defaultVol);
            }

            if (volStr !== null) {
                let volNum = parseInt(volStr.trim(), 10);
                if (isNaN(volNum)) volNum = parseInt(defaultVol, 10) || 1;

                if (volNum >= 1) {
                    targetVolume = volNum;
                    reportedVolume = volNum;
                }
            } else {
                return; // Cancelled
            }
        }

        try {
            const btn = document.getElementById('btn-import-meta');
            if (btn) btn.innerText = "Fetching...";

            const scraped = await fetchMetadataForUrl(url, media.content_type || "Unknown", targetVolume);
            if (!scraped) throw new Error("Could not parse data.");

            if (reportedVolume !== undefined) {
                scraped.extraData["Volume"] = reportedVolume.toString();
            }
            const currentExtra = JSON.parse(media.extra_data || "{}");

            // Ensure we have a preview for the current image
            let currentCoverPreview = "";
            if (media.cover_image) {
                currentCoverPreview = this.imageCache.get(media.cover_image) || "";
                if (!currentCoverPreview) {
                    try {
                        const bytes = await readFileBytes(media.cover_image);
                        const blob = new Blob([new Uint8Array(bytes)]);
                        currentCoverPreview = URL.createObjectURL(blob);
                        this.imageCache.set(media.cover_image, currentCoverPreview);
                    } catch (err) {
                        console.warn("Could not load current cover for comparison", err);
                    }
                }
            }

            // Check if images are identical by comparing hashes via backend proxy
            let imagesIdentical = false;
            if (media.cover_image && scraped.coverImageUrl) {
                try {
                    const localBytes = await readFileBytes(media.cover_image);
                    const remoteBytes = await invoke<number[]>('fetch_remote_bytes', { url: scraped.coverImageUrl });

                    if (localBytes.length === remoteBytes.length) {
                        imagesIdentical = true;
                        for (let i = 0; i < localBytes.length; i++) {
                            if (localBytes[i] !== remoteBytes[i]) {
                                imagesIdentical = false;
                                break;
                            }
                        }
                    }
                } catch (err) {
                    console.warn("Could not compare image contents", err);
                }
            }

            const currentData = {
                description: media.description,
                coverImageUrl: currentCoverPreview,
                extraData: currentExtra,
                imagesIdentical
            };
            const selected = await showImportMergeModal(scraped, currentData);

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
            await this.renderDetailContent(media);
        }
    }

    private getTrackingStatusClass(status: string): string {
        switch (status) {
            case "Ongoing": return "status-ongoing";
            case "Complete": return "status-complete";
            case "Paused": return "status-paused";
            case "Dropped": return "status-dropped";
            case "Not Started": return "status-not-started";
            default: return "status-untracked";
        }
    }
}

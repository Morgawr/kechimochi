import { MediaConflict, MediaCsvRow, Media } from '../api';
import { searchJiten, getJitenCoverUrl, getJitenDeckUrl, getJitenDeckChildren, JitenResult, getJitenMediaLabel } from '../jiten_api';
import { customAlert, createOverlay } from './base';
import { escapeHTML } from '../core/html';

export async function showAddMediaModal(): Promise<{title: string, type: string, contentType: string} | null> {
    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();
        
        overlay.innerHTML = `
            <div class="modal-content">
                <h3>Add New Media</h3>
                <div style="margin-top: 1rem; display: flex; flex-direction: column; gap: 1rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Media Title</label>
                        <input type="text" id="add-media-title" autocomplete="off" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm);" />
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Activity Type</label>
                        <select id="add-media-type" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); outline: none;">
                            <option value="Reading">Reading</option>
                            <option value="Watching">Watching</option>
                            <option value="Playing">Playing</option>
                            <option value="Listening">Listening</option>
                            <option value="None">None</option>
                        </select>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Media Content Type</label>
                        <select id="add-media-content-type" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); outline: none;">
                        </select>
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button class="btn btn-ghost" id="add-media-cancel">Cancel</button>
                    <button class="btn btn-primary" id="add-media-confirm">Add</button>
                </div>
            </div>
        `;
        
        const titleInput = overlay.querySelector('#add-media-title') as HTMLInputElement;
        const typeInput = overlay.querySelector('#add-media-type') as HTMLSelectElement;
        const contentInput = overlay.querySelector('#add-media-content-type') as HTMLSelectElement;

        const updateContentTypes = () => {
            const mType = typeInput.value;
            const options: string[] = ['Unknown'];
            if (mType === 'Reading') options.push('Visual Novel', 'Manga', 'Novel', 'WebNovel', 'NonFiction');
            else if (mType === 'Playing') options.push('Videogame');
            else if (mType === 'Listening') options.push('Audio');
            else if (mType === 'Watching') options.push('Anime', 'Movie', 'Youtube Video', 'Livestream', 'Drama');

            contentInput.innerHTML = options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
        };

        typeInput.addEventListener('change', updateContentTypes);
        updateContentTypes();
        
        overlay.querySelector('#add-media-cancel')!.addEventListener('click', () => { cleanup(); resolve(null); });
        overlay.querySelector('#add-media-confirm')!.addEventListener('click', () => { 
            const title = titleInput.value.trim();
            if (!title) return;
            cleanup(); 
            resolve({ title, type: typeInput.value, contentType: contentInput.value }); 
        });
        titleInput.focus();
    });
}

interface JitenImportResult {
    description?: string;
    coverImageUrl?: string;
    extraData: Record<string, string>;
}

export async function showImportMergeModal(scraped: import('../importers/index').ScrapedMetadata, currentData: { description?: string, coverImageUrl?: string, extraData: Record<string, string>, imagesIdentical?: boolean }): Promise<JitenImportResult | null> {
    const extraFields = buildExtraFieldsHtml(scraped, currentData);
    const descField = buildDescriptionHtml(scraped, currentData);
    const coverField = buildCoverHtml(scraped, currentData);

    if (!extraFields.count && !descField.show && !coverField.show) {
        await customAlert("Notice", "No new metadata found, skipping import.");
        return null;
    }

    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 600px; width: 90vw; max-height: 90vh; display: flex; flex-direction: column;">
                <h3>Import Metadata</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1rem;">Select which scraped fields to merge into your entry.</p>
                <div style="display: flex; flex-direction: column; gap: 0.5rem; overflow-y: auto; flex: 1; padding-right: 0.5rem;">
                    ${descField.html}${coverField.html}${extraFields.html}
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                    <button class="btn btn-ghost" id="import-cancel">Cancel</button>
                    <button class="btn btn-primary" id="import-confirm">Merge Selected Data</button>
                </div>
            </div>`;
        
        overlay.querySelector('#import-cancel')!.addEventListener('click', () => { cleanup(); resolve(null); });
        overlay.querySelector('#import-confirm')!.addEventListener('click', () => {
            const result = processImportMerge(overlay, scraped);
            cleanup();
            resolve(result);
        });
    });
}

function buildExtraFieldsHtml(scraped: import('../importers/index').ScrapedMetadata, currentData: { extraData: Record<string, string> }) {
    let html = '';
    let count = 0;
    for (const [key, val] of Object.entries(scraped.extraData)) {
        if (val === currentData.extraData[key]) continue;
        count++;
        const isOverwrite = !!currentData.extraData[key];
        const overwriteText = isOverwrite ? `<span style="color: var(--accent-red); font-size: 0.7rem; margin-left: 0.5rem;">(Overwrites existing)</span>` : `<span style="color: var(--accent-green); font-size: 0.7rem; margin-left: 0.5rem;">(New field)</span>`;
        const valHtml = isOverwrite ? `
            <div style="display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.25rem;">
                <span style="font-size: 0.75rem; color: var(--accent-red); text-decoration: line-through; word-wrap: break-word; opacity: 0.8;">${escapeHTML(currentData.extraData[key])}</span>
                <span style="font-size: 0.8rem; color: var(--text-secondary); word-wrap: break-word;">${escapeHTML(val)}</span>
            </div>` : `<span style="font-size: 0.8rem; color: var(--text-secondary); word-wrap: break-word;">${escapeHTML(val)}</span>`;

        html += `
        <label style="display: flex; gap: 0.5rem; align-items: flex-start; cursor: pointer; padding: 0.5rem; background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
            <input type="checkbox" class="import-checkbox" data-field="extra-${escapeHTML(key)}" checked />
            <div style="flex: 1; display: flex; flex-direction: column;">
                <span style="font-size: 0.85rem; font-weight: 500;">${escapeHTML(key)} ${overwriteText}</span>
                ${valHtml}
            </div>
        </label>`;
    }
    return { html, count };
}

function buildDescriptionHtml(scraped: import('../importers/index').ScrapedMetadata, currentData: { description?: string }) {
    const show = !!(scraped.description && scraped.description !== currentData.description);
    if (!show) return { html: '', show: false };
    const isOverwrite = !!currentData.description;
    const overwriteText = isOverwrite ? `<span style="color: var(--accent-red); font-size: 0.7rem; margin-left: 0.5rem;">(Overwrites existing)</span>` : `<span style="color: var(--accent-green); font-size: 0.7rem; margin-left: 0.5rem;">(New field)</span>`;
    const innerHtml = isOverwrite ? `
        <div style="display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.25rem;">
            <span style="font-size: 0.75rem; color: var(--accent-red); text-decoration: line-through; max-height: 50px; overflow-y: auto; white-space: pre-wrap; opacity: 0.8;">${escapeHTML(currentData.description || "")}</span>
            <span style="font-size: 0.8rem; color: var(--text-secondary); max-height: 100px; overflow-y: auto; white-space: pre-wrap;">${escapeHTML(scraped.description)}</span>
        </div>` : `<span style="font-size: 0.8rem; color: var(--text-secondary); max-height: 100px; overflow-y: auto; white-space: pre-wrap; margin-top: 0.25rem;">${escapeHTML(scraped.description)}</span>`;
    return {
        show: true,
        html: `
        <label style="display: flex; gap: 0.5rem; align-items: flex-start; cursor: pointer; padding: 0.5rem; background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
            <input type="checkbox" class="import-checkbox" data-field="description" checked />
            <div style="flex: 1; display: flex; flex-direction: column;">
                <span style="font-size: 0.85rem; font-weight: 500;">Description ${overwriteText}</span>
                ${innerHtml}
            </div>
        </label>`
    };
}

function buildCoverHtml(scraped: import('../importers/index').ScrapedMetadata, currentData: { coverImageUrl?: string, imagesIdentical?: boolean }) {
    const show = !!(scraped.coverImageUrl && !currentData.imagesIdentical);
    if (!show) return { html: '', show: false };
    const isOverwrite = !!currentData.coverImageUrl;
    const overwriteText = isOverwrite ? `<span style="color: var(--accent-red); font-size: 0.7rem; margin-left: 0.5rem;">(Overwrites existing)</span>` : `<span style="color: var(--accent-green); font-size: 0.7rem; margin-left: 0.5rem;">(New field)</span>`;
    const innerHtml = isOverwrite ? `
        <div style="display: flex; gap: 1rem; margin-top: 0.5rem; align-items: center;">
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; opacity: 0.5; position: relative;">
                <span style="font-size: 0.6rem; color: var(--bg-dark); background: var(--accent-red); padding: 0.1rem 0.3rem; border-radius: 4px; position: absolute; top: -5px; left: -5px;">OLD</span>
                <img src="${currentData.coverImageUrl}" style="max-height: 150px; object-fit: contain; border-radius: var(--radius-sm);" />
            </div>
            <span style="color: var(--text-secondary);">→</span>
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; position: relative;">
                <span style="font-size: 0.6rem; color: var(--bg-dark); background: var(--accent-green); padding: 0.1rem 0.3rem; border-radius: 4px; position: absolute; top: -5px; right: -5px;">NEW</span>
                <img src="${scraped.coverImageUrl}" style="max-height: 150px; object-fit: contain; border-radius: var(--radius-sm);" />
            </div>
        </div>` : `<img src="${scraped.coverImageUrl}" style="max-height: 150px; object-fit: contain; margin-top: 0.5rem; border-radius: var(--radius-sm);" />`;
    return {
        show: true,
        html: `
        <label style="display: flex; gap: 0.5rem; align-items: flex-start; cursor: pointer; padding: 0.5rem; background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
            <input type="checkbox" class="import-checkbox" data-field="cover" checked />
            <div style="flex: 1; display: flex; flex-direction: column;">
                <span style="font-size: 0.85rem; font-weight: 500;">Cover Image ${overwriteText}</span>
                ${innerHtml}
            </div>
        </label>`
    };
}

function processImportMerge(overlay: HTMLElement, scraped: import('../importers/index').ScrapedMetadata) {
    const result: JitenImportResult = { extraData: {} };
    overlay.querySelectorAll('.import-checkbox:checked').forEach((el) => {
        const field = (el as HTMLInputElement).dataset.field;
        if (field === 'description') result.description = scraped.description;
        else if (field === 'cover') result.coverImageUrl = scraped.coverImageUrl;
        else if (field?.startsWith('extra-')) {
            const key = field.substring(6);
            result.extraData[key] = scraped.extraData[key];
        }
    });
    return result;
}

export async function showMediaCsvConflictModal(conflicts: MediaConflict[]): Promise<MediaCsvRow[] | null> {
    const overlapping = conflicts.filter(c => c.existing);
    if (overlapping.length === 0) return conflicts.map(c => c.incoming);

    return new Promise((resolve) => {
        const { overlay, cleanup } = createOverlay();

        const rowsHtml = overlapping.map((conflict, idx) => `
            <div style="padding: 0.5rem; background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: var(--radius-sm); margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
                <div style="flex: 1;">
                    <div style="font-weight: 500; font-size: 0.9rem;">${conflict.incoming["Title"]}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">Currently: ${conflict.existing!.status} | Incoming: ${conflict.incoming["Status"]}</div>
                </div>
                <div style="display: flex; gap: 1rem;">
                    <label style="display: flex; align-items: center; gap: 0.25rem; font-size: 0.85rem; cursor: pointer;">
                        <input type="radio" name="conflict-${idx}" value="keep" checked /> Keep Existing
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.25rem; font-size: 0.85rem; cursor: pointer;">
                        <input type="radio" name="conflict-${idx}" value="replace" /> Replace
                    </label>
                </div>
            </div>`).join('');

        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 600px; width: 90vw; max-height: 90vh; display: flex; flex-direction: column;">
                <h3>Import Conflicts</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1rem;">Some entries already exist. How do you want to handle them?</p>
                <div style="display: flex; flex-direction: column; overflow-y: auto; flex: 1; padding-right: 0.5rem;">
                    ${rowsHtml}
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                    <button class="btn btn-ghost" id="conflict-cancel">Cancel Import</button>
                    <button class="btn btn-primary" id="conflict-confirm">Continue</button>
                </div>
            </div>`;
        
        overlay.querySelector('#conflict-cancel')!.addEventListener('click', () => { cleanup(); resolve(null); });
        overlay.querySelector('#conflict-confirm')!.addEventListener('click', () => {
            const finalRecords: MediaCsvRow[] = [];
            conflicts.filter(c => !c.existing).forEach(c => finalRecords.push(c.incoming));
            overlapping.forEach((conflict, idx) => {
                if ((overlay.querySelector(`input[name="conflict-${idx}"]:checked`) as HTMLInputElement).value === 'replace') finalRecords.push(conflict.incoming);
            });
            cleanup();
            resolve(finalRecords);
        });
    });
}

export async function showJitenSearchModal(media: Media): Promise<string | null> {
    const { overlay, cleanup } = createOverlay();
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup(); };
    globalThis.addEventListener('keydown', handleEsc, true);

    const originalCleanup = cleanup;
    const newCleanup = () => {
        globalThis.removeEventListener('keydown', handleEsc, true);
        originalCleanup();
    };

    return new Promise((resolve) => {
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 800px; width: 95vw; max-height: 90vh; display: flex; flex-direction: column; padding: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h3 style="margin: 0; font-size: 1.5rem; font-weight: 700; color: #fff;">Search on Jiten.moe</h3>
                    <div id="jiten-back-container"></div>
                </div>
                <div style="position: relative; margin-bottom: 1rem;">
                    <input type="text" id="jiten-search-input" value="${media.title}" style="width: 100%; padding: 0.8rem 2.8rem 0.8rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); font-size: 1rem; outline: none;" placeholder="Search for media..." />
                    <div id="jiten-search-clear" style="position: absolute; right: 1rem; top: 50%; transform: translateY(-50%); cursor: pointer; color: var(--text-secondary); opacity: 0.6; font-size: 1.2rem;">&times;</div>
                </div>
                <div id="jiten-results-container" style="flex: 1; overflow-y: auto; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: rgba(0,0,0,0.3); min-height: 350px; padding: 1.2rem;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 1.2rem;" id="jiten-results-grid"></div>
                </div>
                <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 0.8rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.4rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">Alternatively, paste a direct link:</label>
                        <input type="text" id="jiten-direct-link" placeholder="https://jiten.moe/decks/..." style="width: 100%; padding: 0.7rem 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); outline: none; font-size: 0.9rem;" />
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 0.5rem;">
                        <button class="btn btn-ghost" id="jiten-cancel" style="padding: 0.6rem 1.5rem;">Cancel</button>
                        <button class="btn btn-primary" id="jiten-confirm" style="padding: 0.6rem 2rem;">Link Manually</button>
                    </div>
                </div>
            </div>`;

        const resultsGrid = overlay.querySelector('#jiten-results-grid') as HTMLElement;
        const searchInput = overlay.querySelector('#jiten-search-input') as HTMLInputElement;
        const directLinkInput = overlay.querySelector('#jiten-direct-link') as HTMLInputElement;
        const backContainer = overlay.querySelector('#jiten-back-container') as HTMLElement;

        const performSearch = async (title: string) => {
            backContainer.innerHTML = '';
            resultsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 3rem;">Searching...</div>';
            const results = await searchJiten(title, media.content_type || "Unknown");
            if (!results.length) {
                resultsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--accent-red); padding: 3rem; font-weight: 500;">No results found.</div>';
                return;
            }
            renderJitenResults(resultsGrid, results, (selected) => {
                if (selected.childrenDeckCount) {
                    void showVolumes(selected);
                }
                else { newCleanup(); resolve(getJitenDeckUrl(selected.deckId)); }
            });
        };

        const showVolumes = async (parent: JitenResult) => {
            resultsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 3rem;">Loading...</div>';
            const backBtn = document.createElement('button');
            backBtn.className = 'btn btn-ghost'; backBtn.innerHTML = '← Back';
            backBtn.addEventListener('click', () => {
                void performSearch(searchInput.value);
            });
            backContainer.innerHTML = ''; backContainer.appendChild(backBtn);
            const children = await getJitenDeckChildren(parent.deckId);
            renderJitenVolumes(resultsGrid, parent, children, (deckId) => {
                newCleanup(); resolve(getJitenDeckUrl(deckId));
            });
        };

        overlay.querySelector('#jiten-search-clear')!.addEventListener('click', () => { searchInput.value = ''; searchInput.focus(); });
        searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { void performSearch(searchInput.value.trim()); } });
        overlay.querySelector('#jiten-cancel')!.addEventListener('click', () => { newCleanup(); resolve(null); });
        overlay.querySelector('#jiten-confirm')!.addEventListener('click', () => { 
            if (directLinkInput.value) { newCleanup(); resolve(directLinkInput.value.trim()); } 
        });
        void performSearch(media.title);
    });
}

function renderJitenResults(grid: HTMLElement, results: JitenResult[], onSelect: (res: JitenResult) => void) {
    grid.innerHTML = results.map(res => `
        <div class="jiten-result-card" data-id="${res.deckId}" style="cursor: pointer; background: #1a151f; border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s; position: relative;">
            <div style="aspect-ratio: 2/3; position: relative; background: #000; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                <img src="${getJitenCoverUrl(res.deckId, res.parentDeckId)}" style="max-width: 100%; max-height: 100%; object-fit: contain; min-height: 100%;" />
                <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.73); color: white; padding: 0.2rem 0.4rem; font-size: 0.65rem; font-weight: 600; text-transform: uppercase;">
                    ${getJitenMediaLabel(res.mediaType)}
                </div>
            </div>
            <div style="padding: 0.6rem 0.4rem; flex: 1; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.02);">
                <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-primary); text-align: center; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.3;">${res.originalTitle}</div>
            </div>
        </div>`).join('');

    grid.querySelectorAll('.jiten-result-card').forEach((card) => {
        card.addEventListener('click', () => {
            const id = Number.parseInt((card as HTMLElement).dataset.id || "0");
            const res = results.find(r => r.deckId === id);
            if (res) onSelect(res);
        });
    });
}

function renderJitenVolumes(grid: HTMLElement, parent: JitenResult, children: JitenResult[], onSelect: (id: number) => void) {
    grid.innerHTML = [
        `<div class="jiten-result-card jiten-volume-card" data-deck-id="${parent.deckId}" style="cursor: pointer; background: #1a151f; border: 2px solid var(--accent-blue); border-radius: var(--radius-md); overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s; position: relative;">
            <div style="aspect-ratio: 2/3; position: relative; background: #000; display: flex; align-items: center; justify-content: center;"><img src="${getJitenCoverUrl(parent.deckId, parent.parentDeckId)}" style="max-width: 100%; max-height: 100%; object-fit: contain; min-height: 100%;" /></div>
            <div style="padding: 0.6rem 0.4rem; flex: 1; display: flex; align-items: center; justify-content: center; background: #2a2135;"><div style="font-size: 0.8rem; font-weight: 800; color: #fff; text-align: center;">Entire Series</div></div>
        </div>`,
        ...children.map((res, i) => `
        <div class="jiten-result-card jiten-volume-card" data-deck-id="${res.deckId}" style="cursor: pointer; background: #1a151f; border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s; position: relative;">
            <div style="aspect-ratio: 2/3; position: relative; background: #000; display: flex; align-items: center; justify-content: center;"><img src="${getJitenCoverUrl(res.deckId, res.parentDeckId || parent.deckId)}" style="max-width: 100%; max-height: 100%; object-fit: contain; opacity: 0.9; min-height: 100%;" /><div style="position: absolute; top: 0.3rem; left: 0.3rem; background: rgba(0,0,0,0.7); color: #fff; min-width: 1.3rem; height: 1.3rem; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 900; border: 1px solid rgba(255,255,255,0.2);">${i+1}</div></div>
            <div style="padding: 0.6rem 0.4rem; flex: 1; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.02);"><div style="font-size: 0.75rem; font-weight: 600; color: var(--text-primary); text-align: center;">${res.originalTitle}</div></div>
        </div>`)
    ].join('');
    
    grid.querySelectorAll('.jiten-volume-card').forEach((card) => {
        card.addEventListener('click', () => onSelect(Number.parseInt((card as HTMLElement).dataset.deckId!)));
    });
}

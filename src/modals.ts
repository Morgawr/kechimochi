export async function customPrompt(title: string, defaultValue = "", text = ""): Promise<string | null> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        document.body.appendChild(overlay);
        // Force reflow
        void overlay.offsetWidth;
        overlay.classList.add('active');
        
        overlay.innerHTML = `
            <div class="modal-content">
                <h3>${title}</h3>
                <div style="margin-top: 1rem;">
                    <input type="text" id="prompt-input" style="width: 100%; border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); padding: 0.5rem; border-radius: var(--radius-sm);" value="${defaultValue}" autocomplete="off" />
                </div>
                ${text ? `<p style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">${text}</p>` : ''}
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button class="btn btn-ghost" id="prompt-cancel">Cancel</button>
                    <button class="btn btn-primary" id="prompt-confirm">OK</button>
                </div>
            </div>
        `;
        
        const input = overlay.querySelector('#prompt-input') as HTMLInputElement;
        
        const cleanup = () => {
             overlay.classList.remove('active');
             setTimeout(() => overlay.remove(), 300);
        };
        
        overlay.querySelector('#prompt-cancel')!.addEventListener('click', () => { cleanup(); resolve(null); });
        overlay.querySelector('#prompt-confirm')!.addEventListener('click', () => { cleanup(); resolve(input.value); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { cleanup(); resolve(input.value); }
            if (e.key === 'Escape') { cleanup(); resolve(null); }
        });
        
        input.focus();
    });
}

import { MediaConflict, MediaCsvRow } from './api';

export async function initialProfilePrompt(defaultName: string = "User"): Promise<string> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        document.body.appendChild(overlay);
        void overlay.offsetWidth;
        overlay.classList.add('active');
        
        overlay.innerHTML = `
            <div class="modal-content" style="text-align: center;">
                <h3 style="margin-bottom: 0.5rem;">Welcome to Kechimochi!</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.5rem;">Please enter a name for your first profile to get started.</p>
                <div style="margin-top: 1rem; text-align: left;">
                    <input type="text" id="initial-prompt-input" placeholder="e.g. ${defaultName}" style="width: 100%; border: 1px solid var(--border-color); background: var(--bg-dark); color: var(--text-primary); padding: 0.5rem; border-radius: var(--radius-sm);" autocomplete="off" />
                </div>
                <div style="display: flex; justify-content: center; margin-top: 1.5rem;">
                    <button class="btn btn-primary" id="initial-prompt-confirm" disabled>Start</button>
                </div>
            </div>
        `;
        
        const input = overlay.querySelector('#initial-prompt-input') as HTMLInputElement;
        const confirmBtn = overlay.querySelector('#initial-prompt-confirm') as HTMLButtonElement;
        
        const cleanup = () => {
             overlay.classList.remove('active');
             setTimeout(() => overlay.remove(), 300);
        };
        
        const checkInput = () => {
            confirmBtn.disabled = input.value.trim().length === 0;
        };

        input.addEventListener('input', checkInput);

        confirmBtn.addEventListener('click', () => { 
            const val = input.value.trim();
            if (val) {
                cleanup(); 
                resolve(val); 
            }
        });
        
        input.addEventListener('keydown', (e) => {
            const val = input.value.trim();
            if (e.key === 'Enter' && val) { 
                cleanup(); 
                resolve(val); 
            }
            // NO ESCAPE allowed
        });
        
        input.focus();
    });
}

export async function customConfirm(title: string, text: string, confirmButtonClass = "btn-danger", confirmButtonText = "Yes"): Promise<boolean> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        document.body.appendChild(overlay);
        void overlay.offsetWidth;
        overlay.classList.add('active');
        
        overlay.innerHTML = `
            <div class="modal-content">
                <h3>${title}</h3>
                <p style="margin-top: 1rem; color: var(--text-secondary);">${text}</p>
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button class="btn btn-ghost" id="confirm-cancel">Cancel</button>
                    <button class="btn ${confirmButtonClass}" id="confirm-ok">${confirmButtonText}</button>
                </div>
            </div>
        `;
        
        const cleanup = () => {
             overlay.classList.remove('active');
             setTimeout(() => overlay.remove(), 300);
        };
        
        overlay.querySelector('#confirm-cancel')!.addEventListener('click', () => { cleanup(); resolve(false); });
        overlay.querySelector('#confirm-ok')!.addEventListener('click', () => { cleanup(); resolve(true); });
    });
}

export async function customAlert(title: string, text: string): Promise<void> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        document.body.appendChild(overlay);
        void overlay.offsetWidth;
        overlay.classList.add('active');
        
        overlay.innerHTML = `
            <div class="modal-content">
                <h3>${title}</h3>
                <p style="margin-top: 1rem; color: var(--text-secondary);">${text}</p>
                <div style="display: flex; justify-content: flex-end; margin-top: 1.5rem;">
                    <button class="btn btn-primary" id="alert-ok">OK</button>
                </div>
            </div>
        `;
        
        const cleanup = () => {
             overlay.classList.remove('active');
             setTimeout(() => overlay.remove(), 300);
        };
        
        overlay.querySelector('#alert-ok')!.addEventListener('click', () => { cleanup(); resolve(); });
    });
}

export function buildCalendar(containerId: string, initialDate: string, onSelect: (d: string) => void) {
    const container = document.getElementById(containerId)!;
    const curr = initialDate ? new Date(initialDate + "T00:00:00") : new Date();
    let vY = curr.getFullYear();
    let vM = curr.getMonth();
    
    let activeDateStr = initialDate;

    const render = () => {
        const firstDay = new Date(vY, vM, 1).getDay();
        const daysInMonth = new Date(vY, vM + 1, 0).getDate();
        
        let html = `
            <div style="background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.5rem; width: 230px; user-select: none;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                    <button type="button" class="btn btn-ghost" style="padding: 0 0.5rem; height: 24px; min-width: 24px; font-size: 0.8rem;" id="c-p-${containerId}">&lt;</button>
                    <span style="font-size: 0.9rem; font-weight: 500;">${vY} / ${vM + 1}</span>
                    <button type="button" class="btn btn-ghost" style="padding: 0 0.5rem; height: 24px; min-width: 24px; font-size: 0.8rem;" id="c-n-${containerId}">&gt;</button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
                    <div style="color: #ff4757;">Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div style="color: #1e90ff;">Sa</div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;">
        `;
        for (let i = 0; i < firstDay; i++) html += `<div></div>`;
        for (let i = 1; i <= daysInMonth; i++) {
            const pad = (n: number) => n.toString().padStart(2, '0');
            const dStr = `${vY}-${pad(vM + 1)}-${pad(i)}`;
            const isSel = dStr === activeDateStr;
            const bg = isSel ? 'var(--accent-blue)' : 'transparent';
            const fg = isSel ? '#fff' : 'var(--text-primary)';
            html += `<div class="cal-day" data-date="${dStr}" style="text-align: center; cursor: pointer; padding: 0.3rem 0; font-size: 0.85rem; border-radius: 4px; background: ${bg}; color: ${fg};">${i}</div>`;
        }
        html += `</div></div>`;
        container.innerHTML = html;
        
        container.querySelector(`#c-p-${containerId}`)!.addEventListener('click', (e) => { e.preventDefault(); vM--; if(vM < 0){vM=11; vY--;} render(); });
        container.querySelector(`#c-n-${containerId}`)!.addEventListener('click', (e) => { e.preventDefault(); vM++; if(vM > 11){vM=0; vY++;} render(); });
        container.querySelectorAll('.cal-day').forEach(el => {
            el.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                activeDateStr = target.getAttribute('data-date')!;
                render();
                onSelect(activeDateStr);
            });
            el.addEventListener('mouseover', (e) => {
                const target = e.target as HTMLElement;
                if(target.getAttribute('data-date') !== activeDateStr) target.style.background = 'var(--bg-card-hover)';
            });
            el.addEventListener('mouseout', (e) => {
                const target = e.target as HTMLElement;
                if(target.getAttribute('data-date') !== activeDateStr) target.style.background = 'transparent';
            });
        });
    };
    render();
}

export async function showExportCsvModal(): Promise<{mode: 'all' | 'range', start?: string, end?: string} | null> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        document.body.appendChild(overlay);
        void overlay.offsetWidth;
        overlay.classList.add('active');
        
        const pad = (n: number) => n.toString().padStart(2, '0');
        const todayD = new Date();
        const todayStr = `${todayD.getFullYear()}-${pad(todayD.getMonth() + 1)}-${pad(todayD.getDate())}`;
        
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 90vw; width: max-content;">
                <h3>Export CSV</h3>
                
                <div style="margin-top: 1rem;">
                    <label style="display: flex; gap: 0.5rem; align-items: center; cursor: pointer;">
                        <input type="radio" name="export-mode" value="all" checked /> All History
                    </label>
                    <label style="display: flex; gap: 0.5rem; align-items: center; cursor: pointer; margin-top: 0.5rem;">
                        <input type="radio" name="export-mode" value="range" /> Date Range
                    </label>
                </div>
                
                <div id="export-range-inputs" style="display: none; align-items: flex-start; gap: 1.5rem; margin-top: 1rem; padding: 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: #1a151f;">
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Start Date</label>
                        <div id="cal-start-container"></div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: center;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">End Date</label>
                        <div id="cal-end-container"></div>
                    </div>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button class="btn btn-ghost" id="export-cancel">Cancel</button>
                    <button class="btn btn-primary" id="export-confirm">Export</button>
                </div>
            </div>
        `;
        
        let selectedStart = todayStr;
        let selectedEnd = todayStr;
        buildCalendar('cal-start-container', todayStr, (d) => selectedStart = d);
        buildCalendar('cal-end-container', todayStr, (d) => selectedEnd = d);

        const modeAll = overlay.querySelector('input[value="all"]') as HTMLInputElement;
        const modeRange = overlay.querySelector('input[value="range"]') as HTMLInputElement;
        const rangeInputs = overlay.querySelector('#export-range-inputs') as HTMLElement;
        
        modeAll.addEventListener('change', () => rangeInputs.style.display = 'none');
        modeRange.addEventListener('change', () => rangeInputs.style.display = 'flex');

        const cleanup = () => {
             overlay.classList.remove('active');
             setTimeout(() => overlay.remove(), 300);
        };
        
        overlay.querySelector('#export-cancel')!.addEventListener('click', () => { cleanup(); resolve(null); });
        overlay.querySelector('#export-confirm')!.addEventListener('click', () => { 
            if (modeRange.checked) {
                if (!selectedStart || !selectedEnd) {
                    alert('Please select both start and end dates.');
                    return;
                }
                const start = selectedStart <= selectedEnd ? selectedStart : selectedEnd;
                const end = selectedStart <= selectedEnd ? selectedEnd : selectedStart;
                resolve({ mode: 'range', start, end });
            } else {
                resolve({ mode: 'all' });
            }
            cleanup();
        });
    });
}

export async function showAddMediaModal(): Promise<{title: string, type: string} | null> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        document.body.appendChild(overlay);
        void overlay.offsetWidth;
        overlay.classList.add('active');
        
        overlay.innerHTML = `
            <div class="modal-content">
                <h3>Add New Media</h3>
                <div style="margin-top: 1rem; display: flex; flex-direction: column; gap: 1rem;">
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Media Title</label>
                        <input type="text" id="add-media-title" autocomplete="off" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm);" />
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <label style="font-size: 0.85rem; color: var(--text-secondary);">Media Type</label>
                        <select id="add-media-type" style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-sm); outline: none;">
                            <option value="Reading">Reading</option>
                            <option value="Watching">Watching</option>
                            <option value="Playing">Playing</option>
                            <option value="Listening">Listening</option>
                            <option value="None">None</option>
                        </select>
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem;">
                    <button class="btn btn-ghost" id="add-media-cancel">Cancel</button>
                    <button class="btn btn-primary" id="add-media-confirm">Add</button>
                </div>
            </div>
        `;
        
        const cleanup = () => {
             overlay.classList.remove('active');
             setTimeout(() => overlay.remove(), 300);
        };
        
        const titleInput = overlay.querySelector('#add-media-title') as HTMLInputElement;
        const typeInput = overlay.querySelector('#add-media-type') as HTMLSelectElement;
        
        overlay.querySelector('#add-media-cancel')!.addEventListener('click', () => { cleanup(); resolve(null); });
        overlay.querySelector('#add-media-confirm')!.addEventListener('click', () => { 
            const title = titleInput.value.trim();
            if (!title) return;
            cleanup(); 
            resolve({ title, type: typeInput.value }); 
        });
        titleInput.focus();
    });
}

export async function showImportMergeModal(scraped: import('./importers/index').ScrapedMetadata, currentData: { description?: string, coverImageUrl?: string, extraData: Record<string, string>, imagesIdentical?: boolean }): Promise<{
    description?: string;
    coverImageUrl?: string;
    extraData: Record<string, string>;
} | null> {
    return new Promise((resolve) => {
        let fieldsToShow = 0;

        // Generate UI for extra fields
        let extraFieldsHtml = '';
        for (const [key, val] of Object.entries(scraped.extraData)) {
            if (val === currentData.extraData[key]) continue; // Skip if exact match
            
            fieldsToShow++;
            const isOverwrite = currentData.extraData[key] !== undefined && currentData.extraData[key] !== "";
            const overwriteText = isOverwrite ? `<span style="color: var(--accent-red); font-size: 0.7rem; margin-left: 0.5rem;">(Overwrites existing)</span>` : `<span style="color: var(--accent-green); font-size: 0.7rem; margin-left: 0.5rem;">(New field)</span>`;
            
            let valHtml = '';
            if (isOverwrite) {
                valHtml = `
                    <div style="display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.25rem;">
                        <span style="font-size: 0.75rem; color: var(--accent-red); text-decoration: line-through; word-wrap: break-word; opacity: 0.8;">${currentData.extraData[key]}</span>
                        <span style="font-size: 0.8rem; color: var(--text-secondary); word-wrap: break-word;">${val}</span>
                    </div>
                `;
            } else {
                valHtml = `<span style="font-size: 0.8rem; color: var(--text-secondary); word-wrap: break-word;">${val}</span>`;
            }

            extraFieldsHtml += `
            <label style="display: flex; gap: 0.5rem; align-items: flex-start; cursor: pointer; padding: 0.5rem; background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                <input type="checkbox" class="import-checkbox" data-field="extra-${key}" checked />
                <div style="flex: 1; display: flex; flex-direction: column;">
                    <span style="font-size: 0.85rem; font-weight: 500;">${key} ${overwriteText}</span>
                    ${valHtml}
                </div>
            </label>
            `;
        }
        
        let descHtml = '';
        const showDesc = scraped.description && scraped.description !== currentData.description;
        if (showDesc) {
            fieldsToShow++;
            const isDescOverwrite = !!currentData.description && currentData.description !== "";
            const descOverwriteText = isDescOverwrite ? `<span style="color: var(--accent-red); font-size: 0.7rem; margin-left: 0.5rem;">(Overwrites existing)</span>` : `<span style="color: var(--accent-green); font-size: 0.7rem; margin-left: 0.5rem;">(New field)</span>`;
            
            let descInnerHtml = '';
            if (isDescOverwrite) {
                descInnerHtml = `
                    <div style="display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.25rem;">
                        <span style="font-size: 0.75rem; color: var(--accent-red); text-decoration: line-through; max-height: 50px; overflow-y: auto; white-space: pre-wrap; opacity: 0.8;">${currentData.description}</span>
                        <span style="font-size: 0.8rem; color: var(--text-secondary); max-height: 100px; overflow-y: auto; white-space: pre-wrap;">${scraped.description}</span>
                    </div>
                `;
            } else {
                descInnerHtml = `<span style="font-size: 0.8rem; color: var(--text-secondary); max-height: 100px; overflow-y: auto; white-space: pre-wrap; margin-top: 0.25rem;">${scraped.description}</span>`;
            }
            descHtml = `
            <label style="display: flex; gap: 0.5rem; align-items: flex-start; cursor: pointer; padding: 0.5rem; background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                <input type="checkbox" class="import-checkbox" data-field="description" checked />
                <div style="flex: 1; display: flex; flex-direction: column;">
                    <span style="font-size: 0.85rem; font-weight: 500;">Description ${descOverwriteText}</span>
                    ${descInnerHtml}
                </div>
            </label>
            `;
        }
        
        let coverHtml = '';
        const showCover = scraped.coverImageUrl && !currentData.imagesIdentical;
        if (showCover) {
            fieldsToShow++;
            const isCoverOverwrite = !!currentData.coverImageUrl && currentData.coverImageUrl !== "";
            const coverOverwriteText = isCoverOverwrite ? `<span style="color: var(--accent-red); font-size: 0.7rem; margin-left: 0.5rem;">(Overwrites existing)</span>` : `<span style="color: var(--accent-green); font-size: 0.7rem; margin-left: 0.5rem;">(New field)</span>`;
            
            let innerCoverHtml = '';
            if (isCoverOverwrite) {
                innerCoverHtml = `
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
                    </div>
                `;
            } else {
                innerCoverHtml = `<img src="${scraped.coverImageUrl}" style="max-height: 150px; object-fit: contain; margin-top: 0.5rem; border-radius: var(--radius-sm);" />`;
            }

            coverHtml = `
            <label style="display: flex; gap: 0.5rem; align-items: flex-start; cursor: pointer; padding: 0.5rem; background: var(--bg-dark); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                <input type="checkbox" class="import-checkbox" data-field="cover" checked />
                <div style="flex: 1; display: flex; flex-direction: column;">
                    <span style="font-size: 0.85rem; font-weight: 500;">Cover Image ${coverOverwriteText}</span>
                    ${innerCoverHtml}
                </div>
            </label>
            `;
        }

        if (fieldsToShow === 0) {
            customAlert("Notice", "No new metadata found, skipping import.");
            resolve(null);
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        document.body.appendChild(overlay);
        void overlay.offsetWidth;
        overlay.classList.add('active');

        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 600px; width: 90vw; max-height: 90vh; display: flex; flex-direction: column;">
                <h3>Import Metadata</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1rem;">Select which scraped fields to merge into your entry.</p>
                
                <div style="display: flex; flex-direction: column; gap: 0.5rem; overflow-y: auto; flex: 1; padding-right: 0.5rem;">
                    ${descHtml}
                    ${coverHtml}
                    ${extraFieldsHtml}
                </div>
                
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                    <button class="btn btn-ghost" id="import-cancel">Cancel</button>
                    <button class="btn btn-primary" id="import-confirm">Merge Selected Data</button>
                </div>
            </div>
        `;
        
        const cleanup = () => {
             overlay.classList.remove('active');
             setTimeout(() => overlay.remove(), 300);
        };
        
        overlay.querySelector('#import-cancel')!.addEventListener('click', () => { cleanup(); resolve(null); });
        
        overlay.querySelector('#import-confirm')!.addEventListener('click', () => {
            const result: { description?: string; coverImageUrl?: string; extraData: Record<string, string> } = { extraData: {} };
            
            const checks = overlay.querySelectorAll('.import-checkbox:checked');
            checks.forEach((el) => {
                const field = (el as HTMLInputElement).getAttribute('data-field');
                if (!field) return;
                
                if (field === 'description') result.description = scraped.description;
                else if (field === 'cover') result.coverImageUrl = scraped.coverImageUrl;
                else if (field.startsWith('extra-')) {
                    const key = field.substring(6);
                    result.extraData[key] = scraped.extraData[key];
                }
            });
            
            cleanup();
            resolve(result);
        });
    });
}

export async function showMediaCsvConflictModal(conflicts: MediaConflict[]): Promise<MediaCsvRow[] | null> {
    const overlapping = conflicts.filter(c => c.existing);
    
    // If no conflicts, just auto-resolve to import them all
    if (overlapping.length === 0) {
        return conflicts.map(c => c.incoming);
    }

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        document.body.appendChild(overlay);
        void overlay.offsetWidth;
        overlay.classList.add('active');

        let rowsHtml = '';
        overlapping.forEach((conflict, idx) => {
            rowsHtml += `
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
            </div>`;
        });

        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 600px; width: 90vw; max-height: 90vh; display: flex; flex-direction: column;">
                <h3>Import Conflicts</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1rem;">Some of the media library entries you're importing already exist. How do you want to handle them?</p>
                
                <div style="display: flex; flex-direction: column; overflow-y: auto; flex: 1; padding-right: 0.5rem;">
                    ${rowsHtml}
                </div>
                
                <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                    <button class="btn btn-ghost" id="conflict-cancel">Cancel Import</button>
                    <button class="btn btn-primary" id="conflict-confirm">Continue</button>
                </div>
            </div>
        `;

        const cleanup = () => {
             overlay.classList.remove('active');
             setTimeout(() => overlay.remove(), 300);
        };
        
        overlay.querySelector('#conflict-cancel')!.addEventListener('click', () => { cleanup(); resolve(null); });
        
        overlay.querySelector('#conflict-confirm')!.addEventListener('click', () => {
            const finalRecords: MediaCsvRow[] = [];
            
            // Add all non-conflicting items automatically
            conflicts.filter(c => !c.existing).forEach(c => finalRecords.push(c.incoming));
            
            // Resolve overlapping based on radio buttons
            overlapping.forEach((conflict, idx) => {
                const checked = overlay.querySelector(`input[name="conflict-${idx}"]:checked`) as HTMLInputElement;
                if (checked.value === 'replace') {
                    finalRecords.push(conflict.incoming);
                }
            });
            
            cleanup();
            resolve(finalRecords);
        });
    });
}

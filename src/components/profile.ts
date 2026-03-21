import { Logger } from '../core/logger';
import { Component } from '../core/component';
import { html } from '../core/html';
import {
    getAllMedia, getLogsForMedia,
    clearActivities, wipeEverything,
    applyMediaImport, getSetting, setSetting,
    getAppVersion, importMilestonesCsv, exportMilestonesCsv
} from '../api';
import {
    customPrompt, showExportCsvModal, customAlert, customConfirm,
    showMediaCsvConflictModal
} from '../modals';
import { getServices } from '../services';
import { STORAGE_KEYS, SETTING_KEYS, DEFAULTS, EVENTS } from '../constants';

interface ProfileState {
    currentProfile: string;
    theme: string;
    report: {
        novelSpeed: string;
        novelCount: string;
        mangaSpeed: string;
        mangaCount: string;
        vnSpeed: string;
        vnCount: string;
        timestamp: string;
    };
    appVersion: string;
    isInitialized: boolean;
}

export class ProfileView extends Component<ProfileState> {
    private isRefreshing = false;

    constructor(container: HTMLElement) {
        super(container, {
            currentProfile: localStorage.getItem(STORAGE_KEYS.CURRENT_PROFILE) || DEFAULTS.PROFILE,
            theme: localStorage.getItem(STORAGE_KEYS.THEME_CACHE) || DEFAULTS.THEME,
            report: {
                novelSpeed: '0',
                novelCount: '0',
                mangaSpeed: '0',
                mangaCount: '0',
                vnSpeed: '0',
                vnCount: '0',
                timestamp: ''
            },
            appVersion: '',
            isInitialized: false
        });
    }

    async loadData() {
        const theme = await getSetting(SETTING_KEYS.THEME) || DEFAULTS.THEME;
        const novelSpeed = await getSetting(SETTING_KEYS.STATS_NOVEL_SPEED) || '0';
        const novelCount = await getSetting(SETTING_KEYS.STATS_NOVEL_COUNT) || '0';
        const mangaSpeed = await getSetting(SETTING_KEYS.STATS_MANGA_SPEED) || '0';
        const mangaCount = await getSetting(SETTING_KEYS.STATS_MANGA_COUNT) || '0';
        const vnSpeed = await getSetting(SETTING_KEYS.STATS_VN_SPEED) || '0';
        const vnCount = await getSetting(SETTING_KEYS.STATS_VN_COUNT) || '0';
        const timestamp = await getSetting(SETTING_KEYS.STATS_REPORT_TIMESTAMP) || '';
        const appVersion = await getAppVersion();

        const currentProfile = await getSetting('profile_name') || DEFAULTS.PROFILE;
        localStorage.setItem(STORAGE_KEYS.THEME_CACHE, theme);
        this.setState({
            currentProfile,
            theme,
            report: {
                novelSpeed,
                novelCount,
                mangaSpeed,
                mangaCount,
                vnSpeed,
                vnCount,
                timestamp
            },
            appVersion,
            isInitialized: true
        });
    }

    render() {
        const needsLoad = !this.state.isInitialized;
        if (!this.isRefreshing && needsLoad) {
            this.isRefreshing = true;
            this.loadData()
                .catch(e => Logger.error('Failed to load profile data', e))
                .finally(() => { this.isRefreshing = false; });
            return;
        }

        this.clear();
        const { currentProfile, theme, report, appVersion } = this.state;

        const content = html`
            <div id="profile-root" class="animate-fade-in" style="display: flex; flex-direction: column; gap: 2rem; max-width: 600px; margin: 0 auto; padding-top: 1rem; padding-bottom: 2rem;">
                
                <div style="text-align: center; margin-bottom: 2rem;">
                    <h2 id="profile-name" title="Double click to rename" style="margin: 0; font-size: 2rem; color: var(--text-primary); cursor: pointer; transition: opacity 0.2s;">${currentProfile}</h2>
                    <p style="color: var(--text-secondary); margin-top: 0.5rem;">Manage your profile and data</p>
                </div>

                <!-- Reading Report Card -->
                <div class="card" id="profile-report-card" style="display: flex; flex-direction: column; gap: 1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0;">Reading Report Card</h3>
                        <button class="btn btn-primary" id="profile-btn-calculate-report" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;">Calculate Report</button>
                    </div>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">Aggregated reading speed for the last 12 months based on complete entries.</p>
                    
                    <div id="profile-report-card-content" style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.5rem; font-size: 0.95rem;">
                        ${this.renderReportContent()}
                    </div>
                    ${report.timestamp ? html`<div id="profile-report-timestamp" style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem; text-align: right;">Since ${new Date(report.timestamp).toISOString().split('T')[0]}</div>` : ''}
                </div>

                <!-- Appearance -->
                <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
                    <h3>Appearance</h3>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">Choose your preferred theme for this profile.</p>
                    
                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                        <label for="profile-select-theme" style="font-size: 0.85rem; font-weight: 500;">Theme</label>
                        <select id="profile-select-theme" style="width: 100%;">
                            <option value="pastel-pink" ${theme === 'pastel-pink' ? 'selected' : ''}>Pastel Pink (Default)</option>
                            <option value="light" ${theme === 'light' ? 'selected' : ''}>Light Theme</option>
                            <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Dark Theme</option>
                            <option value="light-greyscale" ${theme === 'light-greyscale' ? 'selected' : ''}>Light Greyscale</option>
                            <option value="dark-greyscale" ${theme === 'dark-greyscale' ? 'selected' : ''}>Dark Greyscale</option>
                            <option value="molokai" ${theme === 'molokai' ? 'selected' : ''}>Molokai</option>
                            <option value="green-olive" ${theme === 'green-olive' ? 'selected' : ''}>Green Olive</option>
                            <option value="deep-blue" ${theme === 'deep-blue' ? 'selected' : ''}>Deep Blue</option>
                            <option value="purple" ${theme === 'purple' ? 'selected' : ''}>Purple</option>
                            <option value="fire-red" ${theme === 'fire-red' ? 'selected' : ''}>Fire Red</option>
                            <option value="yellow-lime" ${theme === 'yellow-lime' ? 'selected' : ''}>Yellow Lime</option>
                            <option value="noctua-brown" ${theme === 'noctua-brown' ? 'selected' : ''}>Noctua Brown</option>
                        </select>
                    </div>
                </div>

                <!-- Activity Logs -->
                <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
                    <h3>Activity Logs</h3>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">Import or export chronological activity logs for the current user in CSV format.</p>
                    
                    <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
                        <button class="btn btn-primary" id="profile-btn-import-csv" style="flex: 1;">Import Activities (CSV)</button>
                        <button class="btn btn-primary" id="profile-btn-export-csv" style="flex: 1;">Export Activities (CSV)</button>
                    </div>
                </div>

                <!-- Media Library -->
                <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
                    <h3>Media Library</h3>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">Import or export the global media library. This dataset is shared across all profiles and includes embedded cover images.</p>
                    
                    <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
                        <button class="btn btn-primary" id="profile-btn-import-media" style="flex: 1;">Import Media Library (CSV)</button>
                        <button class="btn btn-primary" id="profile-btn-export-media" style="flex: 1;">Export Media Library (CSV)</button>
                    </div>
                </div>

                <!-- Milestones -->
                <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
                    <h3>Milestones</h3>
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">Import or export user-specific milestones for the current profile.</p>
                    
                    <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
                        <button class="btn btn-primary" id="profile-btn-import-milestones" style="flex: 1;">Import Milestones (CSV)</button>
                        <button class="btn btn-primary" id="profile-btn-export-milestones" style="flex: 1;">Export Milestones (CSV)</button>
                    </div>
                </div>

                <!-- Danger Zone -->
                <div class="card" style="display: flex; flex-direction: column; gap: 1rem; border: 1px solid #ff4757;">
                    <h3 style="color: #ff4757;">Danger Zone</h3>
                    
                    <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 0.5rem;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-color);">
                            <div>
                                <strong style="color: #ff4757;">Clear User Activities</strong>
                                <p style="color: var(--text-secondary); font-size: 0.8rem; margin: 0;">Removes all recorded activity logs, but keeps the profile and media library intact.</p>
                            </div>
                            <button class="btn btn-danger" id="profile-btn-clear-activities" style="background-color: transparent !important; border: 1px solid #ff4757; color: #ff4757 !important; min-width: 140px;">Clear Activities</button>
                        </div>


                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
                            <div>
                                <strong style="color: #ff4757;">Delete Everything</strong>
                                <p style="color: var(--text-secondary); font-size: 0.8rem; margin: 0;">Perform a total factory reset. Deletes ALL profiles, ALL activity logs, and the ENTIRE media library along with its cover images. Irreversible.</p>
                            </div>
                            <button class="btn btn-danger" id="profile-btn-wipe-everything" style="background-color: darkred !important; color: #ffffff !important; border: none; min-width: 140px; font-weight: bold;">Factory Reset</button>
                        </div>
                    </div>
                </div>

                <div style="text-align: center; margin-top: 1rem; font-size: 0.8rem; color: var(--text-secondary); opacity: 0.7;">
                    <div>Kechimochi v${appVersion}</div>
                    <div style="margin-top: 0.4rem;">
                        Found a bug? File an issue on <a href="https://github.com/Morgawr/kechimochi/issues" target="_blank" style="color: var(--text-secondary); text-decoration: underline;">github</a>
                    </div>
                </div>

            </div>
        `;

        this.container.appendChild(content);
        this.setupListeners(content);
    }

    private renderReportContent() {
        const { report } = this.state;
        if (!report.timestamp) {
            return html`<div style="color: var(--text-secondary); text-align: center; padding: 1rem;">No report calculated yet.</div>`;
        }

        return html`
            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.5rem;">
                    <span>Average Novel Reading Speed: <strong>${Number.parseInt(report.novelSpeed, 10).toLocaleString()} char/hr</strong></span>
                    <span style="color: var(--text-secondary); font-size: 0.85rem;">(out of ${report.novelCount} books)</span>
                </div>
                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.5rem;">
                    <span>Average Manga Reading Speed: <strong>${Number.parseInt(report.mangaSpeed, 10).toLocaleString()} char/hr</strong></span>
                    <span style="color: var(--text-secondary); font-size: 0.85rem;">(out of ${report.mangaCount} manga)</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Average Visual Novel Reading Speed: <strong>${Number.parseInt(report.vnSpeed, 10).toLocaleString()} char/hr</strong></span>
                    <span style="color: var(--text-secondary); font-size: 0.85rem;">(out of ${report.vnCount} VNs)</span>
                </div>
            </div>
        `;
    }

    private setupListeners(root: HTMLElement) {
        const { currentProfile } = this.state;

        const nameEl = root.querySelector('#profile-name') as HTMLElement;
        if (nameEl) {
            nameEl.addEventListener('dblclick', () => {
                const input = document.createElement('input');
                input.type = 'text';
                input.value = this.state.currentProfile;
                input.style.fontSize = '2rem';
                input.style.fontWeight = 'bold';
                input.style.color = 'var(--text-primary)';
                input.style.background = 'transparent';
                input.style.border = '1px solid var(--border-color)';
                input.style.borderRadius = 'var(--radius-sm)';
                input.style.padding = '0.2rem 0.5rem';
                input.style.margin = '0';
                input.style.outline = 'none';
                input.style.fontFamily = 'inherit';
                input.style.width = '100%';
                input.style.maxWidth = '400px';
                input.style.textAlign = 'center';

                const saveName = async () => {
                    const newName = input.value.trim();
                    if (newName && newName !== this.state.currentProfile) {
                        await setSetting('profile_name', newName);
                        localStorage.setItem(STORAGE_KEYS.CURRENT_PROFILE, newName);
                        this.setState({ currentProfile: newName });
                        globalThis.dispatchEvent(new CustomEvent(EVENTS.PROFILE_UPDATED));
                    }
                    this.render();
                };

                input.addEventListener('blur', saveName);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        input.blur();
                    } else if (e.key === 'Escape') {
                        this.render(); // Cancel
                    }
                });

                nameEl.replaceWith(input);
                input.focus();
                input.select();
            });
        }

        root.querySelector('#profile-select-theme')?.addEventListener('change', async (e) => {
            const theme = (e.target as HTMLSelectElement).value;
            await setSetting(SETTING_KEYS.THEME, theme);
            document.body.dataset.theme = theme;
            localStorage.setItem(STORAGE_KEYS.THEME_CACHE, theme);
            this.setState({ theme });
        });

        root.querySelector('#profile-btn-import-csv')?.addEventListener('click', async () => {
            try {
                const count = await getServices().pickAndImportActivities();
                if (count !== null) await customAlert("Success", `Successfully imported ${count} activity logs!`);
            } catch (e) {
                await customAlert("Error", `Import failed: ${e}`);
            }
        });

        root.querySelector('#profile-btn-export-csv')?.addEventListener('click', async () => {
            const modeData = await showExportCsvModal();
            if (!modeData) return;
            try {
                let count: number | null;
                if (modeData.mode === 'range') {
                    count = await getServices().exportActivities(modeData.start, modeData.end);
                } else {
                    count = await getServices().exportActivities();
                }
                if (count !== null) await customAlert("Success", `Successfully exported ${count} activity logs!`);
            } catch (e) {
                await customAlert("Error", `Export failed: ${e}`);
            }
        });

        root.querySelector('#profile-btn-import-media')?.addEventListener('click', async () => {
            try {
                const conflicts = await getServices().analyzeMediaCsvFromPick();
                if (!conflicts) return;
                if (conflicts.length === 0) {
                    await customAlert("Info", "No valid media rows found in the CSV.");
                    return;
                }
                const resolvedRecords = await showMediaCsvConflictModal(conflicts);
                if (!resolvedRecords || resolvedRecords.length === 0) return;
                const count = await applyMediaImport(resolvedRecords);
                await customAlert("Success", `Successfully imported ${count} media library entries!`);
            } catch (e) {
                await customAlert("Error", `Import failed: ${e}`);
            }
        });

        root.querySelector('#profile-btn-export-media')?.addEventListener('click', async () => {
            try {
                const count = await getServices().exportMediaLibrary(currentProfile);
                if (count !== null) await customAlert("Success", `Successfully exported ${count} media library entries!`);
            } catch (e) {
                await customAlert("Error", `Export failed: ${e}`);
            }
        });

        // Listeners for milestones (using delegation for robustness)
        root.addEventListener('click', async (e) => {
            const target = (e.target as HTMLElement).closest('button');
            if (!target) return;

            if (target.id === 'profile-btn-import-milestones') {
                try {
                    const count = await importMilestonesCsv('');
                    await customAlert("Success", `Successfully imported ${count} milestones!`);
                } catch (e) {
                    await customAlert("Error", `Import failed: ${e}`);
                }
            }

            if (target.id === 'profile-btn-export-milestones') {
                try {
                    const count = await exportMilestonesCsv('');
                    await customAlert("Success", `Successfully exported ${count} milestones!`);
                } catch (e) {
                    await customAlert("Error", `Export failed: ${e}`);
                }
            }
        });

        root.querySelector('#profile-btn-clear-activities')?.addEventListener('click', async () => {
            if (await customConfirm("Clear Activities", `Are you sure you want to delete all activity logs?`, "btn-danger", "Clear")) {
                await clearActivities();
                await customAlert("Success", "All activity logs removed.");
            }
        });

        root.querySelector('#profile-btn-wipe-everything')?.addEventListener('click', async () => {
            if (await customPrompt(`DANGER! Type 'WIPE_EVERYTHING' to confirm a total factory reset:`) === 'WIPE_EVERYTHING') {
                await wipeEverything();
                localStorage.removeItem(STORAGE_KEYS.CURRENT_PROFILE);
                globalThis.location.reload();
            }
        });

        root.querySelector('#profile-btn-calculate-report')?.addEventListener('click', async () => {
            const btn = root.querySelector('#profile-btn-calculate-report') as HTMLButtonElement;
            const originalText = btn.innerText;
            btn.disabled = true;
            btn.innerText = "Calculating...";
            try {
                await this.calculateReport();
                await this.loadData();
                this.render();
                await customAlert("Success", "Reading report card calculated successfully!");
            } catch {
                await customAlert("Error", "Failed to calculate report card.");
            } finally {
                btn.disabled = false;
                btn.innerText = originalText;
            }
        });
    }

    private async calculateReport() {
        const now = new Date();
        const cutoffDate = new Date();
        cutoffDate.setFullYear(now.getFullYear() - 1);
        const cutoffStr = cutoffDate.toISOString().split('T')[0];

        const mediaList = await getAllMedia();
        const stats: Record<string, { totalSpeed: number, count: number }> = {
            "Novel": { totalSpeed: 0, count: 0 },
            "Manga": { totalSpeed: 0, count: 0 },
            "Visual Novel": { totalSpeed: 0, count: 0 }
        };
        for (const media of mediaList) {
            if (media.tracking_status !== 'Complete' || !stats[media.content_type ?? ""]) continue;

            let extraData: Record<string, string>;
            try { extraData = JSON.parse(media.extra_data || "{}"); } catch { continue; }

            const charCount = Number.parseInt((extraData["Character count"] || "").replaceAll(',', ''), 10);
            if (Number.isNaN(charCount)) continue;

            const logs = await getLogsForMedia(media.id!);
            if (logs.length === 0 || logs[0].date < cutoffStr) continue;

            const totalMinutes = logs.reduce((acc, log) => acc + log.duration_minutes, 0);
            if (totalMinutes > 0) {
                stats[media.content_type ?? ""].totalSpeed += charCount / (totalMinutes / 60);
                stats[media.content_type ?? ""].count += 1;
            }
        }

        await this.saveReportStats(stats, cutoffDate);
    }

    private async saveReportStats(stats: Record<string, { totalSpeed: number, count: number }>, cutoffDate: Date): Promise<void> {
        await setSetting(SETTING_KEYS.STATS_REPORT_TIMESTAMP, cutoffDate.toISOString());
        const prefixMap: Record<string, string> = { "Novel": "novel", "Manga": "manga", "Visual Novel": "vn" };
        for (const key of ["Novel", "Manga", "Visual Novel"]) {
            const s = stats[key];
            const avgSpeed = s.count > 0 ? Math.round(s.totalSpeed / s.count) : 0;
            await setSetting(`stats_${prefixMap[key]}_speed`, avgSpeed.toString());
            await setSetting(`stats_${prefixMap[key]}_count`, s.count.toString());
        }
    }
}

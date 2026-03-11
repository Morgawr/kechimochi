import { Component } from '../core/component';
import { html } from '../core/html';
import {
    getAllMedia, getLogsForMedia, importCsv, exportCsv, deleteProfile,
    clearActivities, wipeEverything, exportMediaCsv, analyzeMediaCsv,
    applyMediaImport, switchProfile, listProfiles, getSetting, setSetting,
    getAppVersion
} from '../api';
import {
    customPrompt, showExportCsvModal, customAlert, customConfirm,
    showMediaCsvConflictModal, initialProfilePrompt
} from '../modals';
import { open, save } from '../utils/dialogs';

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
            currentProfile: localStorage.getItem('kechimochi_profile') || 'default',
            theme: 'pastel-pink',
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
        const theme = await getSetting('theme') || 'pastel-pink';
        const novelSpeed = await getSetting('stats_novel_speed') || '0';
        const novelCount = await getSetting('stats_novel_count') || '0';
        const mangaSpeed = await getSetting('stats_manga_speed') || '0';
        const mangaCount = await getSetting('stats_manga_count') || '0';
        const vnSpeed = await getSetting('stats_vn_speed') || '0';
        const vnCount = await getSetting('stats_vn_count') || '0';
        const timestamp = await getSetting('stats_report_timestamp') || '';
        const appVersion = await getAppVersion();

        const currentProfile = localStorage.getItem('kechimochi_profile') || 'default';
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

    async render() {
        const localStorageProfile = localStorage.getItem('kechimochi_profile') || 'default';
        const needsLoad = !this.state.isInitialized || this.state.currentProfile !== localStorageProfile;
        if (!this.isRefreshing && needsLoad) {
            this.isRefreshing = true;
            try {
                await this.loadData();
            } finally {
                this.isRefreshing = false;
            }
            return;
        }

        this.clear();
        const { currentProfile, theme, report, appVersion } = this.state;

        const content = html`
            <div class="animate-fade-in" style="display: flex; flex-direction: column; gap: 2rem; max-width: 600px; margin: 0 auto; padding-top: 1rem; padding-bottom: 2rem;">
                
                <div style="text-align: center; margin-bottom: 2rem;">
                    <h2 style="margin: 0; font-size: 2rem; color: var(--text-primary);">${currentProfile}</h2>
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

                <!-- Danger Zone -->
                <div class="card" style="display: flex; flex-direction: column; gap: 1rem; border: 1px solid #ff4757;">
                    <h3 style="color: #ff4757;">Danger Zone</h3>
                    
                    <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 0.5rem;">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-color);">
                            <div>
                                <strong style="color: #ff4757;">Clear User Activities</strong>
                                <p style="color: var(--text-secondary); font-size: 0.8rem; margin: 0;">Removes all recorded activity logs for '${currentProfile}', but keeps the profile and media library intact.</p>
                            </div>
                            <button class="btn btn-danger" id="profile-btn-clear-activities" style="background-color: transparent !important; border: 1px solid #ff4757; color: #ff4757 !important; min-width: 140px;">Clear Activities</button>
                        </div>

                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-color);">
                            <div>
                                <strong style="color: #ff4757;">Delete User Profile</strong>
                                <p style="color: var(--text-secondary); font-size: 0.8rem; margin: 0;">Deletes the '${currentProfile}' profile and its activity logs permanently. Cannot be undone.</p>
                            </div>
                            <button class="btn btn-danger" id="profile-btn-delete-profile" style="background-color: #ff4757 !important; color: #ffffff !important; border: none; min-width: 140px;">Delete Profile</button>
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
                    <span>Average Novel Reading Speed: <strong>${parseInt(report.novelSpeed).toLocaleString()} char/hr</strong></span>
                    <span style="color: var(--text-secondary); font-size: 0.85rem;">(out of ${report.novelCount} books)</span>
                </div>
                <div style="display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.5rem;">
                    <span>Average Manga Reading Speed: <strong>${parseInt(report.mangaSpeed).toLocaleString()} char/hr</strong></span>
                    <span style="color: var(--text-secondary); font-size: 0.85rem;">(out of ${report.mangaCount} manga)</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Average Visual Novel Reading Speed: <strong>${parseInt(report.vnSpeed).toLocaleString()} char/hr</strong></span>
                    <span style="color: var(--text-secondary); font-size: 0.85rem;">(out of ${report.vnCount} VNs)</span>
                </div>
            </div>
        `;
    }

    private setupListeners(root: HTMLElement) {
        const { currentProfile } = this.state;

        root.querySelector('#profile-select-theme')?.addEventListener('change', async (e) => {
            const theme = (e.target as HTMLSelectElement).value;
            await setSetting('theme', theme);
            document.body.dataset.theme = theme;
            this.setState({ theme });
        });

        root.querySelector('#profile-btn-import-csv')?.addEventListener('click', async () => {
            const selected = await open({ multiple: false, filters: [{ name: 'CSV', extensions: ['csv'] }] });
            if (selected && typeof selected === 'string') {
                try {
                    const count = await importCsv(selected);
                    await customAlert("Success", `Successfully imported ${count} activity logs!`);
                } catch (e) {
                    await customAlert("Error", `Import failed: ${e}`);
                }
            }
        });

        root.querySelector('#profile-btn-export-csv')?.addEventListener('click', async () => {
            const modeData = await showExportCsvModal();
            if (!modeData) return;
            const savePath = await save({ filters: [{ name: 'CSV', extensions: ['csv'] }], defaultPath: `kechimochi_${currentProfile}_activities.csv` });
            if (savePath) {
                try {
                    const count = modeData.mode === 'range' ? await exportCsv(savePath, modeData.start, modeData.end) : await exportCsv(savePath);
                    await customAlert("Success", `Successfully exported ${count} activity logs!`);
                } catch (e) {
                    await customAlert("Error", `Export failed: ${e}`);
                }
            }
        });

        root.querySelector('#profile-btn-import-media')?.addEventListener('click', async () => {
            const selected = await open({ multiple: false, filters: [{ name: 'CSV', extensions: ['csv'] }] });
            if (selected && typeof selected === 'string') {
                try {
                    const conflicts = await analyzeMediaCsv(selected);
                    if (!conflicts || conflicts.length === 0) {
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
            }
        });

        root.querySelector('#profile-btn-export-media')?.addEventListener('click', async () => {
            const savePath = await save({ filters: [{ name: 'CSV', extensions: ['csv'] }], defaultPath: "kechimochi_media_library.csv" });
            if (savePath) {
                try {
                    const count = await exportMediaCsv(savePath);
                    await customAlert("Success", `Successfully exported ${count} media library entries!`);
                } catch (e) {
                    await customAlert("Error", `Export failed: ${e}`);
                }
            }
        });

        root.querySelector('#profile-btn-clear-activities')?.addEventListener('click', async () => {
            if (await customConfirm("Clear Activities", `Are you sure you want to delete all activity logs for '${currentProfile}'?`, "btn-danger", "Clear")) {
                await clearActivities();
                await customAlert("Success", "All activity logs removed for the current profile.");
            }
        });

        root.querySelector('#profile-btn-delete-profile')?.addEventListener('click', async () => {
            const profiles = await listProfiles();
            if (profiles.length <= 1) {
                await customAlert("Error", "Cannot delete the current profile because it is the only remaining user.");
                return;
            }
            const name = await customPrompt(`Type '${currentProfile}' to confirm profile deletion:`);
            if (name === currentProfile) {
                await deleteProfile(currentProfile);
                const updatedProfiles = await listProfiles();
                const nextProfile = updatedProfiles.length > 0 ? updatedProfiles[0] : 'default';
                localStorage.setItem('kechimochi_profile', nextProfile);
                await switchProfile(nextProfile);
                window.location.reload();
            }
        });

        root.querySelector('#profile-btn-wipe-everything')?.addEventListener('click', async () => {
            if (await customPrompt(`DANGER! Type 'WIPE_EVERYTHING' to confirm a total factory reset:`) === 'WIPE_EVERYTHING') {
                await wipeEverything();
                localStorage.removeItem('kechimochi_profile');
                const initialName = await initialProfilePrompt("User");
                localStorage.setItem('kechimochi_profile', initialName);
                await switchProfile(initialName);
                window.location.reload();
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
            } catch (e) {
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
            if (media.tracking_status !== 'Complete') continue;
            if (!stats[media.content_type || ""]) continue;

            let extraData: Record<string, string> = {};
            try { extraData = JSON.parse(media.extra_data || "{}"); } catch (e) { continue; }

            const charCount = parseInt((extraData["Character count"] || "").replace(/,/g, ''));
            if (isNaN(charCount)) continue;

            const logs = await getLogsForMedia(media.id!);
            if (logs.length === 0 || logs[0].date < cutoffStr) continue;

            const totalMinutes = logs.reduce((acc, log) => acc + log.duration_minutes, 0);
            if (totalMinutes > 0) {
                stats[media.content_type!].totalSpeed += charCount / (totalMinutes / 60);
                stats[media.content_type!].count += 1;
            }
        }

        await setSetting('stats_report_timestamp', cutoffDate.toISOString());
        for (const key of ["Novel", "Manga", "Visual Novel"]) {
            const s = stats[key];
            const avgSpeed = s.count > 0 ? Math.round(s.totalSpeed / s.count) : 0;
            const prefix = key === "Visual Novel" ? "vn" : key.toLowerCase();
            await setSetting(`stats_${prefix}_speed`, avgSpeed.toString());
            await setSetting(`stats_${prefix}_count`, s.count.toString());
        }
    }
}

import { importCsv, exportCsv, deleteProfile, clearActivities, wipeEverything, exportMediaCsv, analyzeMediaCsv, applyMediaImport, switchProfile, listProfiles } from '../api';
import { customPrompt, showExportCsvModal, customAlert, customConfirm, showMediaCsvConflictModal, initialProfilePrompt } from '../modals';
import { open, save } from '@tauri-apps/plugin-dialog';

export class ProfileView {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async render() {
    const currentProfile = localStorage.getItem('kechimochi_profile') || 'default';

    this.container.innerHTML = `
      <div class="animate-fade-in" style="display: flex; flex-direction: column; gap: 2rem; max-width: 600px; margin: 0 auto; padding-top: 1rem; padding-bottom: 2rem;">
        
        <div style="text-align: center; margin-bottom: 2rem;">
          <h2 style="margin: 0; font-size: 2rem; color: var(--text-primary);">${currentProfile}</h2>
          <p style="color: var(--text-secondary); margin-top: 0.5rem;">Manage your profile and data</p>
        </div>

        <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
          <h3>Activity Logs</h3>
          <p style="color: var(--text-secondary); font-size: 0.9rem;">Import or export chronological activity logs for the current user in CSV format.</p>
          
          <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
            <button class="btn btn-primary" id="profile-btn-import-csv" style="flex: 1;">Import Activities (CSV)</button>
            <button class="btn btn-primary" id="profile-btn-export-csv" style="flex: 1;">Export Activities (CSV)</button>
          </div>
        </div>

        <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
          <h3>Media Library</h3>
          <p style="color: var(--text-secondary); font-size: 0.9rem;">Import or export the global media library. This dataset is shared across all profiles and includes embedded cover images.</p>
          
          <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
            <button class="btn btn-primary" id="profile-btn-import-media" style="flex: 1;">Import Media Library (CSV)</button>
            <button class="btn btn-primary" id="profile-btn-export-media" style="flex: 1;">Export Media Library (CSV)</button>
          </div>
        </div>

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

      </div>
    `;

    this.setupListeners(currentProfile);
  }

  private setupListeners(currentProfile: string) {
    // Import CSV Activities
    document.getElementById('profile-btn-import-csv')?.addEventListener('click', async () => {
      try {
        const selected = await open({
          multiple: false,
          filters: [{ name: 'CSV', extensions: ['csv'] }]
        });

        if (selected && typeof selected === 'string') {
          const count = await importCsv(selected);
          await customAlert("Success", `Successfully imported ${count} activity logs!`);
        }
      } catch (e) {
        await customAlert("Error", `Import failed: ${e}`);
      }
    });

    // Export CSV Activities
    document.getElementById('profile-btn-export-csv')?.addEventListener('click', async () => {
      try {
        const modeData = await showExportCsvModal();
        if (!modeData) return;
        
        const savePath = await save({
          filters: [{ name: 'CSV', extensions: ['csv'] }],
          defaultPath: `kechimochi_${currentProfile}_activities.csv`
        });

        if (savePath) {
          let count = 0;
          if (modeData.mode === 'range') {
              count = await exportCsv(savePath, modeData.start, modeData.end);
          } else {
              count = await exportCsv(savePath);
          }
          await customAlert("Success", `Successfully exported ${count} activity logs!`);
        }
      } catch (e) {
        await customAlert("Error", `Export failed: ${e}`);
      }
    });

    // Import Media CSV
    document.getElementById('profile-btn-import-media')?.addEventListener('click', async () => {
      try {
        const selected = await open({
          multiple: false,
          filters: [{ name: 'CSV', extensions: ['csv'] }]
        });

        if (selected && typeof selected === 'string') {
          // 1. Analyze for conflicts
          const conflicts = await analyzeMediaCsv(selected);
          
          if (!conflicts || conflicts.length === 0) {
              await customAlert("Info", "No valid media rows found in the CSV.");
              return;
          }

          // 2. Present Conflict Resolution UI
          const resolvedRecords = await showMediaCsvConflictModal(conflicts);
          
          if (!resolvedRecords) {
              return; // Cancelled
          }
          
          if (resolvedRecords.length === 0) {
              await customAlert("Info", "No new media library entries selected to be imported.");
              return;
          }

          // 3. Perform Actual Import
          const count = await applyMediaImport(resolvedRecords);
          await customAlert("Success", `Successfully imported ${count} media library entries!`);
        }
      } catch (e) {
        await customAlert("Error", `Import failed: ${e}`);
      }
    });

    // Export Media CSV
    document.getElementById('profile-btn-export-media')?.addEventListener('click', async () => {
      try {
        const savePath = await save({
          filters: [{ name: 'CSV', extensions: ['csv'] }],
          defaultPath: "kechimochi_media_library.csv"
        });

        if (savePath) {
          const count = await exportMediaCsv(savePath);
          await customAlert("Success", `Successfully exported ${count} media library entries!`);
        }
      } catch (e) {
        await customAlert("Error", `Export failed: ${e}`);
      }
    });

    // Clear Activities
    document.getElementById('profile-btn-clear-activities')?.addEventListener('click', async () => {
      const yes = await customConfirm("Clear Activities", `Are you sure you want to delete all activity logs for '${currentProfile}'? This keeps your library safe.`, "btn-danger", "Clear");
      if (yes) {
          await clearActivities();
          await customAlert("Success", "All activity logs removed for the current profile.");
      }
    });

    // Delete Profile
    document.getElementById('profile-btn-delete-profile')?.addEventListener('click', async () => {
      const profiles = await listProfiles();
      if (profiles.length <= 1) {
          await customAlert("Error", "Cannot delete the current profile because it is the only remaining user. Use Factory Reset to completely wipe.");
          return;
      }

      const name = await customPrompt(`Type '${currentProfile}' to confirm profile deletion:`);
      if (name === currentProfile) {
          await deleteProfile(currentProfile);
          
          // Fallback to top profile
          const updatedProfiles = await listProfiles();
          const nextProfile = updatedProfiles.length > 0 ? updatedProfiles[0] : 'default';
          localStorage.setItem('kechimochi_profile', nextProfile);
          await switchProfile(nextProfile);
          
          window.location.reload();
      } else if (name) {
          await customAlert("Error", "Profile name did not match, aborting wipe.");
      }
    });

    // Factory Reset
    document.getElementById('profile-btn-wipe-everything')?.addEventListener('click', async () => {
      const confirm1 = await customPrompt(`DANGER! Type 'WIPE_EVERYTHING' to confirm a total factory reset:`);
      if (confirm1 === 'WIPE_EVERYTHING') {
          await wipeEverything();

          localStorage.removeItem('kechimochi_profile');
          const initialName = await initialProfilePrompt("User");
          localStorage.setItem('kechimochi_profile', initialName);
          await switchProfile(initialName);
          
          window.location.reload();
      } else if (confirm1) {
          await customAlert("Aborted", "Factory reset cancelled.");
      }
    });
  }
}

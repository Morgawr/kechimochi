import { importCsv, exportCsv, wipeProfile } from '../api';
import { customPrompt, showExportCsvModal, customAlert } from '../modals';
import { open, save } from '@tauri-apps/plugin-dialog';

export class ProfileView {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async render() {
    const currentProfile = localStorage.getItem('kechimochi_profile') || 'default';

    this.container.innerHTML = `
      <div class="animate-fade-in" style="display: flex; flex-direction: column; gap: 2rem; max-width: 600px; margin: 0 auto; padding-top: 1rem;">
        
        <div style="text-align: center; margin-bottom: 2rem;">
          <h2 style="margin: 0; font-size: 2rem; color: var(--text-primary);">${currentProfile}</h2>
          <p style="color: var(--text-secondary); margin-top: 0.5rem;">Manage your profile and data</p>
        </div>

        <div class="card" style="display: flex; flex-direction: column; gap: 1rem;">
          <h3>Data Management</h3>
          <p style="color: var(--text-secondary); font-size: 0.9rem;">Import or export your activity logs in CSV format.</p>
          
          <div style="display: flex; gap: 1rem; margin-top: 0.5rem;">
            <button class="btn btn-primary" id="profile-btn-import-csv" style="flex: 1;">Import CSV</button>
            <button class="btn btn-primary" id="profile-btn-export-csv" style="flex: 1;">Export CSV</button>
          </div>
        </div>

        <div class="card" style="display: flex; flex-direction: column; gap: 1rem; border: 1px solid #ff4757;">
          <h3 style="color: #ff4757;">Danger Zone</h3>
          <p style="color: var(--text-secondary); font-size: 0.9rem;">Permanently delete all data associated with this profile. This action cannot be undone.</p>
          
          <div style="margin-top: 0.5rem;">
            <button class="btn btn-danger" id="profile-btn-wipe-profile" style="background-color: #ff4757 !important; color: #ffffff !important; border: none; width: 100%;">Wipe All Data</button>
          </div>
        </div>

      </div>
    `;

    this.setupListeners(currentProfile);
  }

  private setupListeners(currentProfile: string) {
    // Import CSV
    const btnImportCsv = document.getElementById('profile-btn-import-csv');
    if (btnImportCsv) {
      btnImportCsv.addEventListener('click', async () => {
        try {
          const selected = await open({
            multiple: false,
            filters: [{
              name: 'CSV',
              extensions: ['csv']
            }]
          });

          if (selected && typeof selected === 'string') {
            const count = await importCsv(selected);
            await customAlert("Success", `Successfully imported ${count} logs!`);
            // Trigger a re-render of the current view to show updated data if needed
            // But we are on the profile page, so maybe just a success message is enough
          }
        } catch (e) {
          await customAlert("Error", `Import failed: ${e}`);
        }
      });
    }

    // Export CSV
    const btnExportCsv = document.getElementById('profile-btn-export-csv');
    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', async () => {
        try {
          const modeData = await showExportCsvModal();
          if (!modeData) return;
          
          const savePath = await save({
            filters: [{
              name: 'CSV',
              extensions: ['csv']
            }],
            defaultPath: "kechimochi_export.csv"
          });

          if (savePath) {
            let count = 0;
            if (modeData.mode === 'range') {
                count = await exportCsv(savePath, modeData.start, modeData.end);
            } else {
                count = await exportCsv(savePath);
            }
            await customAlert("Success", `Successfully exported ${count} logs!`);
          }
        } catch (e) {
          await customAlert("Error", `Export failed: ${e}`);
        }
      });
    }

    // Wipe Profile
    const btnWipeProfile = document.getElementById('profile-btn-wipe-profile');
    if (btnWipeProfile) {
      btnWipeProfile.addEventListener('click', async () => {
        const name = await customPrompt(`Type '${currentProfile}' to confirm WIPE ALL DATA:`);
        if (name === currentProfile) {
            await wipeProfile(currentProfile);
            await customAlert("Success", "Data wiped successfully.");
        } else if (name) {
            await customAlert("Error", "Profile name did not match, aborting wipe.");
        }
      });
    }
  }
}

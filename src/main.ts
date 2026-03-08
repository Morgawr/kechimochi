import { Dashboard } from './components/dashboard';
import { Library } from './components/library';
import { MediaView } from './components/media_view';
import { ProfileView } from './components/profile';
import { getAllMedia, addLog, switchProfile, deleteProfile, addMedia, updateMedia, listProfiles, getUsername } from './api';
import { customPrompt, customConfirm, customAlert, buildCalendar, initialProfilePrompt } from './modals';
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

document.addEventListener('DOMContentLoaded', async () => {
  // Window Controls
  document.getElementById('win-min')?.addEventListener('click', () => appWindow.minimize());
  document.getElementById('win-max')?.addEventListener('click', () => appWindow.toggleMaximize());
  document.getElementById('win-close')?.addEventListener('click', () => appWindow.close());

  const viewContainer = document.getElementById('view-container')!;
  
  const dashboard = new Dashboard(viewContainer);
  const library = new Library(viewContainer);
  const mediaView = new MediaView(viewContainer);
  const profileView = new ProfileView(viewContainer);
  
  let currentView = 'dashboard';
  let currentProfile = localStorage.getItem('kechimochi_profile') || '';
  
  const ensureProfilesList = async () => {
      const selectProfile = document.getElementById('select-profile') as HTMLSelectElement;
      let profiles = await listProfiles();
      
      if (profiles.length === 0) {
          // Force the user to create a profile
          const osUsername = await getUsername();
          const initialName = await initialProfilePrompt(osUsername);
          currentProfile = initialName;
          localStorage.setItem('kechimochi_profile', currentProfile);
          await switchProfile(currentProfile); // This creates the db on the backend
          profiles = await listProfiles();
      } else if (!profiles.includes(currentProfile)) {
          currentProfile = profiles[0];
          localStorage.setItem('kechimochi_profile', currentProfile);
      }
      
      selectProfile.innerHTML = profiles.map(p => `<option value="${p}">${p}</option>`).join('');
      selectProfile.value = currentProfile;
  };

  await ensureProfilesList();

  if (currentProfile) {
      await switchProfile(currentProfile);
  }

  const selectProfile = document.getElementById('select-profile') as HTMLSelectElement;
  selectProfile.addEventListener('change', async () => {
      currentProfile = selectProfile.value;
      localStorage.setItem('kechimochi_profile', currentProfile);
      await switchProfile(currentProfile);
      
      if (currentView === 'dashboard') dashboard.render();
      if (currentView === 'library') library.render();
      if (currentView === 'media') mediaView.render();
      if (currentView === 'profile') profileView.render();
  });

  document.getElementById('btn-add-profile')?.addEventListener('click', async () => {
    const newProfile = await customPrompt("Enter new user profile name:");
    if (newProfile && newProfile.trim() !== '') {
        currentProfile = newProfile.trim();
        localStorage.setItem('kechimochi_profile', currentProfile);
        await switchProfile(currentProfile);
        await ensureProfilesList();
        
        if (currentView === 'dashboard') dashboard.render();
        if (currentView === 'library') library.render();
        if (currentView === 'media') mediaView.render();
        if (currentView === 'profile') profileView.render();
    }
  });

  document.getElementById('btn-delete-profile')?.addEventListener('click', async () => {
      const profiles = await listProfiles();
      if (profiles.length <= 1) {
          await customAlert("Error", "Cannot delete the current profile because it is the only remaining user.");
          return;
      }
      const yes = await customConfirm("Delete User", `Are you sure you want to permanently delete the user '${currentProfile}'?`, "btn-danger", "Delete");
      if (yes) {
          await deleteProfile(currentProfile);
          
          let nextProfile = 'default';
          const profiles = await listProfiles();
          if (profiles.length > 0) {
              nextProfile = profiles[0];
          }
          currentProfile = nextProfile;
          localStorage.setItem('kechimochi_profile', currentProfile);
          await switchProfile(currentProfile);
          await ensureProfilesList();
          
          if (currentView === 'dashboard') dashboard.render();
          if (currentView === 'library') library.render();
          if (currentView === 'media') mediaView.render();
          if (currentView === 'profile') profileView.render();
      }
  });

  // Navigation
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const view = target.getAttribute('data-view');
      
      navLinks.forEach(n => n.classList.remove('active'));
      target.classList.add('active');
      
      if (view === 'dashboard') {
        currentView = 'dashboard';
        dashboard.render();
      } else if (view === 'library') {
        currentView = 'library';
        library.render();
      } else if (view === 'media') {
        currentView = 'media';
        mediaView.render();
      } else if (view === 'profile') {
        currentView = 'profile';
        profileView.render();
      }
    });
  });

  window.addEventListener('app-navigate', (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.view) {
          if (detail.view === 'media' && detail.focusMediaId !== undefined) {
              currentView = 'media';
              const navLinks = document.querySelectorAll('.nav-link');
              navLinks.forEach(n => n.classList.remove('active'));
              const targetNav = document.querySelector(`.nav-link[data-view="media"]`);
              if (targetNav) targetNav.classList.add('active');
              
              mediaView.jumpToMedia(detail.focusMediaId);
          }
      }
  });

  // Modals
  const addModal = document.getElementById('add-activity-modal')!;
  const btnAddActivity = document.getElementById('btn-add-activity')!;
  const btnCancelActivity = document.getElementById('btn-cancel-activity')!;
  const formAddActivity = document.getElementById('add-activity-form') as HTMLFormElement;
  const inputMedia = document.getElementById('activity-media') as HTMLInputElement;
  const datalistMedia = document.getElementById('media-datalist') as HTMLDataListElement;

  let activitySelectedDate = '';

  btnAddActivity.addEventListener('click', async () => {
    addModal.classList.add('active');
    // Load media options for autocomplete (excluding finished)
    const mediaList = await getAllMedia();
    const activeMedia = mediaList.filter(m => m.status !== 'Completed' && m.status !== 'Finished');
    datalistMedia.innerHTML = activeMedia.map(m => `<option value="${m.title}">`).join('');
    
    // Set default date to today
    const pad = (n: number) => n.toString().padStart(2, '0');
    const today = new Date();
    activitySelectedDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    buildCalendar('activity-cal-container', activitySelectedDate, (d) => activitySelectedDate = d);
  });

  btnCancelActivity.addEventListener('click', () => {
    addModal.classList.remove('active');
    formAddActivity.reset();
  });

  formAddActivity.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mediaTitle = inputMedia.value.trim();
    const duration = parseInt((document.getElementById('activity-duration') as HTMLInputElement).value);
    const date = activitySelectedDate;

    if (!mediaTitle || !duration || !date) return;

    const mediaList = await getAllMedia();
    const existingMedia = mediaList.find(m => m.title.toLowerCase() === mediaTitle.toLowerCase());
    
    let mediaId: number;

    if (existingMedia && existingMedia.id) {
        mediaId = existingMedia.id;
        if (existingMedia.status === 'Completed' || existingMedia.status === 'Finished') {
            existingMedia.status = 'Active';
            await updateMedia(existingMedia);
        }
    } else {
        // Prompt for new media info (using another modal so it fits)
        const typeResp = await customPrompt(`"${mediaTitle}" is new! What type of media is this? (Reading, Watching, Playing, Listening, or None)`, "Reading");
        if (!typeResp) return; // Cancelled
        
        mediaId = await addMedia({
            title: mediaTitle,
            media_type: typeResp,
            status: "Active",
            language: "Japanese",
            description: "",
            cover_image: "",
            extra_data: "{}",
            content_type: "Unknown"
        });
    }

    await addLog({ media_id: mediaId, duration_minutes: duration, date });
    
    addModal.classList.remove('active');
    formAddActivity.reset();
    
    // Refresh current view
    if (currentView === 'dashboard') dashboard.render();
    if (currentView === 'library') library.render();
    if (currentView === 'media') mediaView.render();
    if (currentView === 'profile') profileView.render();
  });

  // Initial render
  dashboard.render();
});

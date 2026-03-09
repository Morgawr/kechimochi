/**
 * CUJ: Profile Management
 * 
 * Verifies that:
 *   - Current profile name is displayed correctly
 *   - New profiles can be added
 *   - Profiles can be deleted
 *   - System reverts to previous profile after deletion
 */

import { waitForAppReady } from '../helpers/setup.js';
import {
  navigateTo,
  verifyActiveView,
} from '../helpers/interactions.js';

describe('Profile Management CUJ', () => {
  before(async () => {
    await waitForAppReady();
  });

  it('should verify the initial profile is TESTUSER', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);
    
    const profileHeading = await $('h2');
    expect(await profileHeading.getText()).toBe('TESTUSER');
  });

  it('should navigate back to dashboard', async () => {
    await navigateTo('dashboard');
    expect(await verifyActiveView('dashboard')).toBe(true);
  });

  it('should add a new profile named BESTUSER', async () => {
    const addProfileBtn = await $('#btn-add-profile');
    await addProfileBtn.click();
    
    const promptInput = await $('#prompt-input');
    await promptInput.setValue('BESTUSER');
    
    const confirmBtn = await $('#prompt-confirm');
    await confirmBtn.click();
    
    // Wait for profile switch and app to stabilize
    await browser.pause(1000);
  });

  it('should verify the new profile name in the profile tab', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);
    
    const profileHeading = await $('h2');
    expect(await profileHeading.getText()).toBe('BESTUSER');
  });

  it('should verify that TESTUSER is no longer displayed in the profile view', async () => {
    const container = await $('#view-container');
    const containerText = await container.getText();
    expect(containerText).not.toContain('TESTUSER');
  });

  it('should delete the current profile (BESTUSER)', async () => {
    const deleteProfileBtn = await $('#btn-delete-profile');
    await deleteProfileBtn.click();
    
    // Small pause for modal to appear
    await browser.pause(500);
    
    const confirmDeleteBtn = await $('#confirm-ok');
    await confirmDeleteBtn.click();
    
    // Wait for reload and switch back
    await browser.pause(2000);
    await waitForAppReady();
  });

  it('should verify that the current profile is back to TESTUSER', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);
    
    const profileHeading = await $('h2');
    expect(await profileHeading.getText()).toBe('TESTUSER');
  });
});

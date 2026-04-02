/// <reference types="@wdio/globals/types" />
import { dismissAlert, confirmAction, getTopmostVisibleOverlay, safeClick, waitForNoActiveOverlays } from './common.js';
import { navigateTo, verifyActiveView } from './navigation.js';

export async function openCloudSyncCard(): Promise<void> {
    if (!(await verifyActiveView('profile'))) {
        await navigateTo('profile');
    }

    const card = $('#profile-sync-card');
    await card.waitForDisplayed({ timeout: 10_000 });
}

export async function waitForSyncCardText(text: string, timeout = 10_000): Promise<void> {
    await browser.waitUntil(async () => {
        const card = $('#profile-sync-card');
        if (!(await card.isDisplayed().catch(() => false))) {
            return false;
        }
        return (await card.getText()).includes(text);
    }, {
        timeout,
        timeoutMsg: `Cloud Sync card never showed "${text}"`,
    });
}

export async function enableSyncByCreatingNewProfile(): Promise<void> {
    await openCloudSyncCard();
    await waitForSyncCardText('Enable Sync');
    await safeClick('#profile-btn-enable-sync');

    await waitForSyncEnablementOverlay();
    const wizard = await getTopmostVisibleOverlay('#sync-enable-create');
    await safeClick(() => wizard.$('#sync-enable-create'));

    await dismissAlert('Cloud Sync is now enabled', 90_000);
    await waitForNoActiveOverlays(10_000);
    await waitForSyncCardText('Sync Now', 15_000);
}

export async function enableSyncByAttachingExistingProfile(): Promise<void> {
    await openCloudSyncCard();
    await waitForSyncCardText('Enable Sync');
    await safeClick('#profile-btn-enable-sync');

    await waitForSyncEnablementOverlay();
    const wizard = await getTopmostVisibleOverlay('#sync-enable-attach');
    await safeClick(() => wizard.$('#sync-enable-attach'));

    const preview = await getTopmostVisibleOverlay('#sync-attach-confirm');
    await safeClick(() => preview.$('#sync-attach-confirm'));

    await dismissAlert('The profile was attached successfully', 90_000);
    await waitForNoActiveOverlays(10_000);
}

export async function runSyncNow(expectedAlertText: string): Promise<void> {
    await openCloudSyncCard();
    await safeClick('#profile-btn-run-sync');
    try {
        await dismissAlert(expectedAlertText, 90_000);
    } catch (error) {
        const lingeringAlertText = await $('#alert-body').getText().catch(() => '');
        if (!lingeringAlertText.includes('Run Sync Now to publish the merged state')) {
            throw error;
        }

        await dismissAlert('Run Sync Now to publish the merged state', 5_000);
        await waitForNoActiveOverlays(10_000);
        await safeClick('#profile-btn-run-sync');
        await dismissAlert(expectedAlertText, 90_000);
    }

    await waitForNoActiveOverlays(10_000);
}

export async function expandAdvancedRecovery(): Promise<void> {
    await openCloudSyncCard();

    const replaceButton = $('#profile-btn-replace-local-from-remote');
    if (await replaceButton.isDisplayed().catch(() => false)) {
        return;
    }

    await safeClick('#profile-btn-toggle-sync-recovery');
    await replaceButton.waitForDisplayed({ timeout: 5_000 });
}

export async function forcePublishLocal(): Promise<void> {
    await expandAdvancedRecovery();
    await safeClick('#profile-btn-force-publish-local');
    await confirmAction(true);
    await dismissAlert('published as the new cloud snapshot', 90_000);
    await waitForNoActiveOverlays(10_000);
}

export async function replaceLocalFromRemote(): Promise<void> {
    await expandAdvancedRecovery();
    await safeClick('#profile-btn-replace-local-from-remote');
    await confirmAction(true);
    await dismissAlert('latest cloud snapshot', 90_000);
    await waitForNoActiveOverlays(10_000);
}

export async function openSyncConflictsPanel(): Promise<void> {
    await openCloudSyncCard();
    const button = $('#profile-btn-toggle-sync-conflicts');
    await button.waitForDisplayed({ timeout: 10_000 });
    const label = await button.getText();
    if (!label.includes('Hide Conflicts')) {
        await safeClick(button);
    }

    const panel = $('#profile-sync-conflicts');
    await panel.waitForDisplayed({ timeout: 10_000 });
}

export async function resolveFirstExtraDataConflict(side: 'local' | 'remote'): Promise<void> {
    await openSyncConflictsPanel();
    const selector = `button[data-sync-resolution-kind="extra_data_entry"][data-sync-resolution-side="${side}"]`;
    const button = $(selector);
    await button.waitForDisplayed({ timeout: 10_000 });
    await safeClick(button);
    await dismissAlert('Run Sync Now to publish the merged state', 30_000);
    await waitForNoActiveOverlays(10_000);
}

async function waitForSyncEnablementOverlay(timeout = 30_000): Promise<void> {
    await browser.waitUntil(async () => {
        const overlayState = await browser.execute(() => {
            const overlays = Array.from(document.querySelectorAll('.modal-overlay.active')).reverse();
            const isVisible = (selector: string, overlay: Element): boolean => {
                const node = overlay.querySelector(selector);
                if (!(node instanceof HTMLElement)) {
                    return false;
                }

                const style = globalThis.getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && rect.width > 0
                    && rect.height > 0;
            };

            for (const overlay of overlays) {
                if (isVisible('#sync-enable-create', overlay)) {
                    return 'create';
                }
                if (isVisible('#sync-enable-attach', overlay)) {
                    return 'attach';
                }
                if (isVisible('#alert-ok', overlay)) {
                    return 'alert';
                }
            }

            return null;
        });

        return overlayState !== null;
    }, {
        timeout,
        interval: 200,
        timeoutMsg: 'Cloud Sync enablement did not open a wizard or error alert in time',
    });

    const alertOverlay = await getTopmostVisibleOverlay('#alert-ok').catch(() => null);
    if (alertOverlay) {
        const alertBody = alertOverlay.$('#alert-body');
        const message = await alertBody.getText().catch(() => 'Unknown Cloud Sync enablement failure');
        throw new Error(`Enable Sync failed before the wizard opened: ${message}`);
    }
}

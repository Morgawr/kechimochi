/**
 * Navigation and view state helpers.
 */
/// <reference types="@wdio/globals/types" />

export type ViewName = 'dashboard' | 'media' | 'profile';

function getRootSelector(view: ViewName): string {
  if (view === 'dashboard') return '.dashboard-root';
  if (view === 'media') return '#media-root';
  return '#profile-root';
}

/**
 * Navigate to a specific view by clicking the nav link.
 */
export async function navigateTo(view: ViewName): Promise<void> {
  const link = $(`[data-view="${view}"]`);
  await link.waitForDisplayed({ timeout: 5000 });
  const rootSelector = getRootSelector(view);
  const root = $(rootSelector);

  const isAlreadyActive = async () => {
    const classes = await link.getAttribute('class').catch(() => '');
    return (classes ?? '').includes('active');
  };

  if (await isAlreadyActive()) {
    await root.waitForDisplayed({
      timeout: 10000,
      timeoutMsg: `View ${view} (${rootSelector}) did not render in time`,
    });
    return;
  }

  try {
    await link.waitForClickable({ timeout: 5000 });
    await link.click();
  } catch {
    await browser.execute((targetView) => {
      const el = document.querySelector(`[data-view="${targetView}"]`);
      if (!el) return;
      (el as HTMLElement).click();
    }, view);
  }
  
  // Wait for active class to appear
  await browser.waitUntil(async () => {
    return await isAlreadyActive();
  }, { timeout: 10000, timeoutMsg: `Nav link for ${view} did not become active` });

  // Wait for the view-specific root to be present and displayed
  await root.waitForDisplayed({ 
    timeout: 10000, 
    timeoutMsg: `View ${view} (${rootSelector}) did not render in time` 
  });
}

/**
 * Verify that the current view is the expected one by checking the active nav link.
 */
export async function verifyActiveView(view: ViewName): Promise<boolean> {
  const link = $(`[data-view="${view}"]`);
  const classes = await link.getAttribute('class') || '';
  return classes.includes('active');
}

/**
 * Verify the current view is not in a broken state.
 * Checks that the view container has rendered content and nav links are interactive.
 */
export async function verifyViewNotBroken(): Promise<void> {
  // Check view container has content
  const container = $('#view-container');
  const html = await container.getHTML();
  expect(html.length).toBeGreaterThan(10);

  // Check all nav links are still displayed and clickable
  const navLinks = await $$('.nav-link');
  for (const link of navLinks) {
    expect(await link.isDisplayed()).toBe(true);
    expect(await link.isClickable()).toBe(true);
  }
}

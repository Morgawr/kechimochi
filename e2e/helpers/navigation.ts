/**
 * Navigation and view state helpers.
 */
/// <reference types="@wdio/globals/types" />

export type ViewName = 'dashboard' | 'media' | 'profile';

/**
 * Navigate to a specific view by clicking the nav link.
 */
export async function navigateTo(view: ViewName): Promise<void> {
  const link = $(`[data-view="${view}"]`);
  await link.waitForClickable({ timeout: 5000 });
  await link.click();
  
  // Wait for active class to appear
  await browser.waitUntil(async () => {
    const classes = await link.getAttribute('class') || '';
    return classes.includes('active');
  }, { timeout: 10000, timeoutMsg: `Nav link for ${view} did not become active` });

  // Wait for the view-specific root to be present and displayed
  let rootSelector = '#profile-root';
  if (view === 'dashboard') {
    rootSelector = '.dashboard-root';
  } else if (view === 'media') {
    rootSelector = '#media-root';
  }
  
  await $(rootSelector).waitForDisplayed({ 
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

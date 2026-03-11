/**
 * Navigation and view state helpers.
 */
/// <reference types="@wdio/globals/types" />

export type ViewName = 'dashboard' | 'media' | 'profile';

/**
 * Navigate to a specific view by clicking the nav link.
 */
export async function navigateTo(view: ViewName): Promise<void> {
  const link = await $(`[data-view="${view}"]`);
  await link.click();
  
  // Wait for the nav link to become active
  await browser.waitUntil(async () => {
    const classes = await link.getAttribute('class');
    return classes?.includes('active');
  }, { 
    timeout: 5000, 
    timeoutMsg: `Nav link for ${view} did not become active` 
  });
  
  // Wait for view transition
  await browser.pause(300);
}

/**
 * Verify that the current view is the expected one by checking the active nav link.
 */
export async function verifyActiveView(view: ViewName): Promise<boolean> {
  const link = await $(`[data-view="${view}"]`);
  const classes = await link.getAttribute('class');
  return classes?.includes('active') ?? false;
}

/**
 * Verify the current view is not in a broken state.
 * Checks that the view container has rendered content and nav links are interactive.
 */
export async function verifyViewNotBroken(): Promise<void> {
  // Check view container has content
  const container = await $('#view-container');
  const html = await container.getHTML();
  expect(html.length).toBeGreaterThan(10);

  // Check all nav links are still displayed and clickable
  const navLinks = await $$('.nav-link');
  for (const link of navLinks) {
    expect(await link.isDisplayed()).toBe(true);
    expect(await link.isClickable()).toBe(true);
  }
}

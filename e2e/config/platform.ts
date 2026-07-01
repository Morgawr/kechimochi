/**
 * Platform identity for multi-platform E2E.
 *
 * currentPlatform() reads E2E_PLATFORM (injected by each wdio.*.conf.ts); the
 * is* predicates let helpers and specs branch without touching the env directly.
 * This file is intentionally identity-only — platform-specific behaviour lives
 * with its platform (desktop/android UI ops in helpers/common.ts, android seed
 * delivery in drivers/android-driver.ts).
 */

export type Platform = 'desktop' | 'web' | 'android';

/**
 * Returns the platform this worker is executing against.
 * Defaults to 'desktop' when E2E_PLATFORM is not set (backwards compat).
 */
export function currentPlatform(): Platform {
  const value = process.env.E2E_PLATFORM;
  if (value === 'web') return 'web';
  if (value === 'android') return 'android';
  return 'desktop';
}

export function isDesktop(): boolean {
  return currentPlatform() === 'desktop';
}

export function isWeb(): boolean {
  return currentPlatform() === 'web';
}

export function isAndroid(): boolean {
  return currentPlatform() === 'android';
}
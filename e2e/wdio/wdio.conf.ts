/**
 * Back-compat re-export: wdio.conf.ts is the legacy entry-point used by
 * `npm run e2e` and `npm run e2e:test`.  Both commands now resolve to the
 * desktop configuration.
 */
export { config } from './wdio.desktop.conf.js';
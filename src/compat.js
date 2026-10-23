/* Cross-browser shim. Firefox exposes promise-based APIs on `browser`; Chromium (MV3) on `chrome`.
 * Every script uses `ext` instead of `chrome`/`browser` directly. */
var ext = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome; // eslint-disable-line no-var

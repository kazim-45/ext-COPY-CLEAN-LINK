/* Clipboard writer for any context that has a DOM (popup, Firefox background page).
 * Tries the async API first, then falls back to a hidden textarea + execCommand('copy').
 * Both need the `clipboardWrite` permission outside a user gesture. */
(function (root) {
  'use strict';
  root.Clip = {
    async write(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
      try {
        const host = document.body || document.documentElement;
        const ta = document.createElement('textarea');
        ta.value = String(text);
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        host.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return !!ok;
      } catch (e) { return false; }
    }
  };
})(self);

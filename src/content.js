/* Copy Clean Link - optional copy interceptor.
 * Registered only after the user enables "Clean links when I copy" AND grants site access.
 * It acts ONLY when the whole selection is a bare URL (or a list of bare URLs, one per line);
 * prose and rich content are never touched. Nothing is sent anywhere. */
(function () {
  'use strict';
  let opts = { customParams: [], stripFragment: false };

  function load() {
    try {
      ext.storage.local.get({ customParams: '', stripFragment: false }).then((s) => {
        opts = { customParams: CleanLink.parseCustomText(s.customParams), stripFragment: !!s.stripFragment };
      }).catch(() => {});
    } catch (e) { /* extension reloaded; page keeps working */ }
  }
  load();
  try { ext.storage.onChanged.addListener(load); } catch (e) { /* ignore */ }

  function selectedText() {
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|url|search)$/i.test(a.type))) &&
        typeof a.selectionStart === 'number') {
      return a.value.slice(a.selectionStart, a.selectionEnd);
    }
    const sel = document.getSelection();
    return sel ? String(sel) : '';
  }

  document.addEventListener('copy', (e) => {
    if (!e.isTrusted || !e.clipboardData) return;
    try {
      const text = selectedText();
      if (!text || text.length > 20000) return;
      const r = CleanLink.cleanText(text, opts);
      if (!r.changed) return;
      e.clipboardData.setData('text/plain', r.text);
      e.preventDefault(); // also drops the text/html flavour, which may carry the tracked href
    } catch (err) { /* never break the page's own copy */ }
  }, true);
})();

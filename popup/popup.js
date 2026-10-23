(async function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const writeClipboard = (t) => Clip.write(t);

  function setStatus(kind, text) {
    const el = $('status');
    el.className = 'status ' + kind;
    el.textContent = text;
  }

  // "Before" line with the removed query params struck through (built with DOM nodes, never innerHTML).
  function renderBefore(original, result) {
    const el = $('before');
    el.textContent = '';
    const removedKeys = new Set(result.removed.filter((r) => r.kind === 'param').map((r) => r.name.toLowerCase()));
    if (result.unwrapped.length || !removedKeys.size) { el.textContent = original; return; }
    const m = original.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
    if (!m || !m[2]) { el.textContent = original; return; }
    el.append(m[1], '?');
    const pieces = m[2].slice(1).split('&');
    pieces.forEach((piece, i) => {
      let key = piece.split('=')[0];
      try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch (e) { /* keep raw */ }
      if (removedKeys.has(key.toLowerCase())) {
        const span = document.createElement('span');
        span.className = 'del';
        span.textContent = piece;
        el.append(span);
      } else {
        el.append(piece);
      }
      if (i < pieces.length - 1) el.append('&');
    });
    if (m[3]) el.append(m[3]);
  }

  function renderDetails(original, r) {
    $('diff').hidden = false;
    renderBefore(original, r);
    $('after').textContent = r.url;

    const chips = $('chips');
    chips.textContent = '';
    const shown = r.removed.slice(0, 10);
    for (const item of shown) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = item.kind === 'fragment' ? 'fragment' : item.name;
      chips.append(c);
    }
    if (r.removed.length > shown.length) {
      const more = document.createElement('span');
      more.className = 'chip more';
      more.textContent = '+' + (r.removed.length - shown.length) + ' more';
      chips.append(more);
    }

    const notes = $('notes');
    notes.textContent = '';
    const note = (text, warn) => {
      const li = document.createElement('li');
      if (warn) li.className = 'warn';
      li.textContent = text;
      notes.append(li);
    };
    r.unwrapped.forEach((h) => note('Skipped the redirect through ' + h));
    r.warnings.forEach((w) => note(w.text, true));
  }

  // ---------------------------------------------------------------- state --
  const settings = await Settings.get();
  let hasHost = await Settings.hasHostAccess();
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab && tab.url ? tab.url : '';
  const result = CleanLink.clean(tabUrl, Settings.cleanOpts(settings));

  async function doCopy(auto) {
    const ok = await writeClipboard(result.url);
    if (!ok) { setStatus('bad', "Couldn't access the clipboard. Press the button to copy."); return; }
    await Settings.bump(result.removed.length);
    const n = result.removed.length;
    if (result.changed) {
      setStatus('good', 'Copied. Removed ' + n + ' tracking item' + (n === 1 ? '' : 's') + '.');
    } else {
      setStatus('neutral', 'Copied. This link was already clean.');
    }
    refreshStats();
  }

  async function refreshStats() {
    const { stats } = await Settings.get();
    $('stats').textContent = stats.removed
      ? stats.removed + ' tracker' + (stats.removed === 1 ? '' : 's') + ' removed so far'
      : 'Nothing removed yet';
  }

  if (!result.ok) {
    setStatus('neutral', 'Open a regular web page (http/https) to copy its clean link.');
  } else {
    renderDetails(tabUrl, result);
    $('copy').disabled = false;
    if (settings.autoCopyOnOpen) {
      await doCopy(true);
    } else {
      const n = result.removed.length;
      setStatus(result.changed ? 'good' : 'neutral',
        result.changed ? n + ' tracking item' + (n === 1 ? '' : 's') + ' will be removed.' : 'This link is already clean.');
    }
  }
  $('copy').addEventListener('click', () => doCopy(false));

  // ------------------------------------------------------------- toggles --
  const auto = $('t-auto');
  auto.checked = !!(settings.autoStrip && hasHost);
  function paintAuto() {
    const active = auto.checked;
    $('auto-hint').textContent = active
      ? 'Active. Tracking parameters are removed from pages you open.'
      : 'Cleans links the moment you open them. Needs site access.';
    $('pause-row').hidden = !(active && result.ok);
  }
  auto.addEventListener('change', async () => {
    if (auto.checked) {
      const granted = await Settings.enable('autoStrip', hasHost);
      hasHost = granted;
      if (!granted) { auto.checked = false; paintAuto(); return; }
    } else {
      await Settings.set({ autoStrip: false });
    }
    paintAuto();
  });

  if (result.ok) {
    const host = Settings.normalizeHost(new URL(tabUrl).hostname);
    $('pause-host').textContent = host;
    const paused = (settings.pausedHosts || []).includes(host);
    $('t-pause').checked = paused;
    $('t-pause').addEventListener('change', async (e) => {
      const cur = (await Settings.get()).pausedHosts || [];
      const next = e.target.checked ? [...new Set([...cur, host])] : cur.filter((h) => h !== host);
      await Settings.set({ pausedHosts: next });
    });
  }
  paintAuto();

  $('open-options').addEventListener('click', (e) => { e.preventDefault(); ext.runtime.openOptionsPage(); });
  refreshStats();
})();

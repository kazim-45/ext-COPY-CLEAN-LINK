(async function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  let s = await Settings.get();
  let hasHost = await Settings.hasHostAccess();

  // ---------------------------------------------------------- toggles ----
  async function paintAccess() {
    hasHost = await Settings.hasHostAccess();
    $('autoStrip').checked = !!(s.autoStrip && hasHost);
    $('cleanOnCopy').checked = !!(s.cleanOnCopy && hasHost);
    const pill = $('perm-state');
    pill.textContent = hasHost ? 'Site access: granted' : 'Site access: not granted';
    pill.className = 'pill' + (hasHost ? ' on' : '');
    $('perm-revoke').hidden = !hasHost;
  }

  for (const key of ['autoStrip', 'cleanOnCopy']) {
    $(key).addEventListener('change', async (e) => {
      if (e.target.checked) {
        const granted = await Settings.enable(key, hasHost);
        if (!granted) { e.target.checked = false; return; }
      } else {
        await Settings.set({ [key]: false });
      }
      s[key] = e.target.checked;
      await paintAccess();
    });
  }
  $('perm-revoke').addEventListener('click', async () => {
    await Settings.removeHostAccess();
    await paintAccess();
  });

  for (const key of ['autoCopyOnOpen', 'stripFragment']) {
    $(key).checked = !!s[key];
    $(key).addEventListener('change', async (e) => {
      await Settings.set({ [key]: e.target.checked });
      s[key] = e.target.checked;
      runTest();
    });
  }

  $('open-shortcuts').addEventListener('click', (e) => {
    e.preventDefault();
    if (ext.commands && ext.commands.openShortcutSettings) {
      ext.commands.openShortcutSettings();            // Firefox 137+
    } else if (/Firefox/.test(navigator.userAgent)) {
      e.target.textContent = 'Open Add-ons Manager, click the gear, then "Manage Extension Shortcuts"';
    } else {
      ext.tabs.create({ url: 'chrome://extensions/shortcuts' });
    }
  });

  // ------------------------------------------------- custom parameters ----
  $('customParams').value = s.customParams || '';
  let saveTimer;
  $('customParams').addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const cleaned = CleanLink.parseCustomText($('customParams').value).join('\n');
      await Settings.set({ customParams: cleaned });
      s.customParams = cleaned;
      $('custom-saved').textContent = 'Saved (' + (cleaned ? cleaned.split('\n').length : 0) + ' rules)';
      runTest();
    }, 500);
  });

  // ------------------------------------------------------ paused sites ----
  function renderPaused() {
    const ul = $('paused');
    ul.textContent = '';
    const hosts = s.pausedHosts || [];
    if (!hosts.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No paused sites';
      ul.append(li);
      return;
    }
    for (const h of hosts) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = h;
      const rm = document.createElement('button');
      rm.className = 'btn small';
      rm.type = 'button';
      rm.textContent = 'Remove';
      rm.setAttribute('aria-label', 'Remove ' + h);
      rm.addEventListener('click', async () => {
        s.pausedHosts = (s.pausedHosts || []).filter((x) => x !== h);
        await Settings.set({ pausedHosts: s.pausedHosts });
        renderPaused();
      });
      li.append(name, rm);
      ul.append(li);
    }
  }
  $('pause-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let raw = $('pause-input').value.trim();
    try { if (/^https?:\/\//i.test(raw)) raw = new URL(raw).hostname; } catch (err) { /* validated below */ }
    const host = Settings.normalizeHost(raw);
    if (!Settings.isValidHost(host)) { $('pause-error').textContent = 'Enter a domain like example.com'; return; }
    $('pause-error').textContent = '';
    s.pausedHosts = [...new Set([...(s.pausedHosts || []), host])];
    await Settings.set({ pausedHosts: s.pausedHosts });
    $('pause-input').value = '';
    renderPaused();
  });

  // ------------------------------------------------------------ tester ----
  function runTest() {
    const v = $('tester').value.trim();
    $('test-out').hidden = !v;
    if (!v) return;
    const r = CleanLink.clean(v, Settings.cleanOpts(s));
    const chips = $('test-chips');
    const notes = $('test-notes');
    chips.textContent = '';
    notes.textContent = '';
    if (!r.ok) { $('test-after').textContent = 'Not an http(s) URL.'; return; }
    $('test-after').textContent = r.url;
    for (const item of r.removed) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = item.kind === 'fragment' ? 'fragment' : item.name;
      chips.append(c);
    }
    const add = (t, warn) => { const li = document.createElement('li'); if (warn) li.className = 'warn'; li.textContent = t; notes.append(li); };
    if (!r.changed) add('Already clean. Nothing to remove.');
    r.unwrapped.forEach((h) => add('Skipped the redirect through ' + h));
    r.warnings.forEach((w) => add(w.text, true));
  }
  $('tester').addEventListener('input', runTest);

  // ------------------------------------------------------------- stats ----
  async function paintStats() {
    const { stats } = await Settings.get();
    $('stats').textContent = stats.copies + ' link' + (stats.copies === 1 ? '' : 's') + ' copied, ' +
      stats.removed + ' tracking item' + (stats.removed === 1 ? '' : 's') + ' removed. Stored only in this browser.';
  }
  $('reset-stats').addEventListener('click', async () => {
    await Settings.set({ stats: { copies: 0, removed: 0 } });
    paintStats();
  });

  ext.permissions.onAdded.addListener(paintAccess);
  ext.permissions.onRemoved.addListener(paintAccess);

  renderPaused();
  paintStats();
  await paintAccess();
})();

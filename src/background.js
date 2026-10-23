/* Copy Clean Link - background.
 * Chromium: runs as a service worker (importScripts below).
 * Firefox: runs as an event page; the manifest lists these scripts instead. */
if (typeof importScripts === 'function') importScripts('compat.js', 'cleaner.js', 'settings.js', 'clipboard.js');

const CONTENT_SCRIPT_ID = 'copy-clean';

// ---------------------------------------------------------------- clipboard --

let creatingOffscreen = null;

async function ensureOffscreen() {
  const existing = await ext.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length) return;
  if (!creatingOffscreen) {
    creatingOffscreen = ext.offscreen.createDocument({
      url: 'src/offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Write the cleaned URL to the clipboard.'
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function copyToClipboard(text) {
  // Firefox has no offscreen API, but its background page has a DOM, so write directly.
  if (!ext.offscreen) return Clip.write(text);
  try {
    await ensureOffscreen();
    const res = await ext.runtime.sendMessage({ target: 'offscreen', type: 'copy', text });
    return !!(res && res.ok);
  } catch (e) {
    console.warn('clipboard write failed', e);
    return false;
  }
}

// -------------------------------------------------------------------- badge --

function flash(tabId, text, color) {
  const opts = tabId != null ? { tabId } : {};
  ext.action.setBadgeBackgroundColor({ ...opts, color });
  ext.action.setBadgeText({ ...opts, text });
  setTimeout(() => ext.action.setBadgeText({ ...opts, text: '' }), 1800);
}

// --------------------------------------------------------------- core action --

async function copyCleanFor(url, tabId) {
  const s = await Settings.get();
  const r = CleanLink.clean(url, Settings.cleanOpts(s));
  if (!r.ok) { flash(tabId, '×', '#b42318'); return r; }
  const ok = await copyToClipboard(r.url);
  flash(tabId, ok ? '✓' : '×', !ok ? '#b42318' : r.changed ? '#12805c' : '#667085');
  if (ok) await Settings.bump(r.removed.length);
  return r;
}

// ------------------------------------------------------- menus & shortcut --

ext.runtime.onInstalled.addListener(async () => {
  await ext.contextMenus.removeAll();
  ext.contextMenus.create({ id: 'ccl-link', title: 'Copy clean link address', contexts: ['link'] });
  ext.contextMenus.create({ id: 'ccl-page', title: 'Copy clean page URL', contexts: ['page', 'frame'] });
  await syncAll();
});

ext.runtime.onStartup.addListener(syncAll);

ext.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.menuItemId === 'ccl-link' ? info.linkUrl : (info.frameUrl || info.pageUrl || (tab && tab.url));
  if (url) copyCleanFor(url, tab && tab.id);
});

ext.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'copy-clean-link') return;
  if (!tab || !tab.url) {
    [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  }
  if (tab && tab.url) copyCleanFor(tab.url, tab.id);
  else flash(tab && tab.id, '×', '#b42318');
});

// ------------------------------------------------- opt-in site-wide features --

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function applyProtection() {
  const s = await Settings.get();
  const hasHost = await Settings.hasHostAccess();
  const on = !!(s.autoStrip && hasHost);

  await ext.declarativeNetRequest.updateEnabledRulesets(
    on ? { enableRulesetIds: ['tracking'] } : { disableRulesetIds: ['tracking'] }
  );

  const rules = [];
  // DNR can only match exact, case-sensitive names (no wildcards), and one regex must stay small.
  const custom = CleanLink.parseCustomText(s.customParams).filter((n) => !n.endsWith('*') && /^[a-z0-9_.-]+$/.test(n));
  if (on) {
    CleanLink.chunkNames(custom).forEach((group, i) => {
      rules.push({
        id: 10 + i, priority: 1,
        action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: custom } } } },
        condition: {
          regexFilter: '^https?://[^#]*[?&](?:' + group.map(escapeRegex).join('|') + ')(?:[=&#]|$)',
          isUrlFilterCaseSensitive: true,
          resourceTypes: ['main_frame']
        }
      });
    });
  }
  const paused = (s.pausedHosts || []).filter(Settings.isValidHost);
  if (paused.length) {
    rules.push({
      id: 2, priority: 100,
      action: { type: 'allow' },
      condition: { requestDomains: paused, resourceTypes: ['main_frame'] }
    });
  }
  const old = await ext.declarativeNetRequest.getDynamicRules();
  await ext.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules: rules });
}

async function syncContentScript() {
  const s = await Settings.get();
  const hasHost = await Settings.hasHostAccess();
  const want = !!(s.cleanOnCopy && hasHost);
  const existing = await ext.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  const cfg = {
    id: CONTENT_SCRIPT_ID,
    matches: ['http://*/*', 'https://*/*'],
    js: ['src/compat.js', 'src/cleaner.js', 'src/content.js'],
    runAt: 'document_start',
    allFrames: true,
    persistAcrossSessions: true
  };
  if (want && existing.length) await ext.scripting.updateContentScripts([cfg]);
  else if (want) await ext.scripting.registerContentScripts([cfg]);
  else if (existing.length) await ext.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
}

let syncing = Promise.resolve();
function syncAll() {
  // serialise so rapid setting changes can't interleave
  syncing = syncing.then(() => Promise.all([applyProtection(), syncContentScript()])).catch((e) => console.error('sync failed', e));
  return syncing;
}

ext.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (['autoStrip', 'cleanOnCopy', 'customParams', 'pausedHosts'].some((k) => k in changes)) syncAll();
});
ext.permissions.onAdded.addListener(syncAll);
ext.permissions.onRemoved.addListener(syncAll);

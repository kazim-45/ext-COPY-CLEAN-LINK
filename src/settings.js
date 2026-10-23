/* Settings helper shared by the service worker, popup and options page.
 * Everything lives in storage.local (never synced to any account). */
(function (root) {
  'use strict';

  const DEFAULTS = {
    autoStrip: false,      // strip trackers from links as you navigate (needs site access)
    cleanOnCopy: false,    // clean URLs when you Ctrl+C them on a page (needs site access)
    stripFragment: false,  // also drop #fragments
    autoCopyOnOpen: true,  // copy the clean link the moment the popup opens
    customParams: '',      // user-defined params, one per line (suffix * = prefix match)
    pausedHosts: [],       // sites where auto-strip is paused
    stats: { copies: 0, removed: 0 }
  };

  const ORIGINS = { origins: ['<all_urls>'] };

  const Settings = {
    DEFAULTS,
    get() { return ext.storage.local.get(DEFAULTS); },
    set(patch) { return ext.storage.local.set(patch); },
    hasHostAccess() { return ext.permissions.contains(ORIGINS); },
    requestHostAccess() { return ext.permissions.request(ORIGINS); },
    removeHostAccess() { return ext.permissions.remove(ORIGINS); },
    /**
     * Turn on a feature that needs site access. permissions.request() MUST be called
     * synchronously from the click handler (Firefox is strict about this), and Firefox may
     * close the popup when its permission prompt opens, so the "intent" is saved in the same
     * tick instead of after the prompt. The background page applies it when access arrives
     * (permissions.onAdded). If the user declines and this page is still alive, we revert.
     */
    enable(key, alreadyHasAccess) {
      const req = alreadyHasAccess ? Promise.resolve(true) : Settings.requestHostAccess();
      const saved = Settings.set({ [key]: true });
      return Promise.all([req, saved]).then(async ([granted]) => {
        if (!granted) await Settings.set({ [key]: false });
        return !!granted;
      });
    },
    cleanOpts(s) {
      return { customParams: root.CleanLink.parseCustomText(s.customParams), stripFragment: !!s.stripFragment };
    },
    async bump(removed) {
      const { stats } = await ext.storage.local.get({ stats: DEFAULTS.stats });
      await ext.storage.local.set({
        stats: { copies: (stats.copies || 0) + 1, removed: (stats.removed || 0) + (removed || 0) }
      });
    },
    normalizeHost(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); },
    isValidHost(h) { return /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z0-9-]{2,}$/.test(h); }
  };

  root.Settings = Settings;
})(self);

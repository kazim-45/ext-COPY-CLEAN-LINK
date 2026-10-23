/*!
 * Copy Clean Link - cleaning engine
 *
 * Pure functions: no network, no DOM, no storage. The same file is loaded by the
 * service worker (importScripts), the popup/options pages (<script>), the content
 * script, the DNR-rule build script and the unit tests (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CleanLink = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Data: trackers that are safe to remove on ANY site (names are lowercase;
  // matching is case-insensitive).
  // ---------------------------------------------------------------------------

  const GLOBAL_EXACT = [
    // Google / DoubleClick
    'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid',
    'srsltid', '_ga', '_gl', '_gac',
    // Meta
    'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_ref', 'fb_source',
    'action_object_map', 'action_type_map', 'action_ref_map', 'mibextid',
    'igshid', 'igsh',
    // Microsoft, X, TikTok, LinkedIn, Pinterest, Snap, Reddit, Yandex, Outbrain, Taboola
    'msclkid', 'twclid', 'ttclid', 'li_fat_id', 'epik', 'sccid', 'rdt_cid',
    'yclid', 'ysclid', '_openstat', 'obclickid', 'tblci',
    // Email platforms / marketing automation
    'mc_cid', 'mc_eid', 'mkt_tok', 'vero_id', 'vero_conv', '_kx', '_ke',
    'ml_subscriber', 'ml_subscriber_hash', 'ck_subscriber_id', 'vgo_ee',
    'et_cid', 'et_rid', 'nr_email_referrer', 'ss_source', 'ss_campaign_id', 'ss_email_id',
    'trk_contact', 'trk_msg', 'trk_module', 'trk_sid', '__s', 'rb_clickid',
    // HubSpot
    '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking', 'hss_channel',
    // Oracle Eloqua / Adobe / Branch / Wicked Reports
    'elqtrackid', 'elqcampaignid', 'elq', 'elqaid', 'elqat',
    's_cid', 's_kwcid', 'ef_id', '_branch_match_id', '_branch_referrer', 'wickedid',
    'oly_enc_id', 'oly_anon_id', '_bta_tid', '_bta_c',
    // Matomo / Piwik
    'pk_campaign', 'pk_kwd', 'pk_keyword', 'pk_source', 'pk_medium', 'pk_content', 'pk_cid',
    // Affiliate click IDs
    'irclickid', 'awc', 'zanpid', 'dicbo',
    // Yahoo
    'guccounter', 'guce_referrer', 'guce_referrer_sig',
    // Misc
    'soc_src', 'soc_trk', 'ito', '__twitter_impression'
  ];

  // Whole families (case-insensitive prefix match).
  const GLOBAL_PREFIXES = ['utm_', 'hsa_', 'mtm_', 'piwik_', 'pf_rd_', 'pd_rd_'];

  // Known members of those families. Used ONLY to generate declarativeNetRequest
  // rules (which can't do wildcards). The copy-time cleaner uses the prefixes.
  const PREFIX_MEMBERS = {
    utm_: ['source', 'medium', 'campaign', 'term', 'content', 'id', 'name', 'brand', 'social',
      'social-type', 'cid', 'reader', 'referrer', 'source_platform', 'creative_format',
      'marketing_tactic', 'campaign_id'],
    hsa_: ['acc', 'cam', 'grp', 'ad', 'src', 'tgt', 'kw', 'mt', 'net', 'ver'],
    mtm_: ['campaign', 'kwd', 'keyword', 'source', 'medium', 'content', 'cid', 'group', 'placement'],
    piwik_: ['campaign', 'kwd'],
    pf_rd_: ['m', 's', 'r', 't', 'p', 'i'],
    pd_rd_: ['w', 'wg', 'r', 'i']
  };

  // DNR removeParams is case-sensitive; these params are commonly sent in camelCase.
  const CASE_VARIANTS = {
    hsctatracking: 'hsCtaTracking',
    elqtrackid: 'elqTrackId',
    elqcampaignid: 'elqCampaignId',
    sccid: 'ScCid'
  };

  // ---------------------------------------------------------------------------
  // Data: site-specific rules. Only things that are tracking on THAT site.
  //   hosts   - registrable domains (matches subdomains too) -> also usable as DNR requestDomains
  //   hostRe  - regex for hosts that can't be listed (e.g. every google TLD) -> copy-time only
  //   pathRe  - restrict to some paths -> copy-time only
  //   strip   - exact param names (lowercase, case-insensitive match)
  //   stripPrefix - prefix families
  //   rewrite - function(url, ctx) for structural changes -> copy-time only
  // ---------------------------------------------------------------------------

  const SITE_RULES = [
    { id: 'youtube', hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
      strip: ['si', 'feature', 'pp', 'ab_channel', 'app', 'source_ve_path', 'embeds_referring_euri', 'cbrd'] },
    { id: 'x-refs', hosts: ['twitter.com', 'x.com'], strip: ['ref_src', 'ref_url'] },
    { id: 'x-status-share', hosts: ['twitter.com', 'x.com'], pathRe: /\/status\/\d+/, strip: ['s', 't'] },
    { id: 'facebook', hosts: ['facebook.com', 'fb.com', 'fb.watch'],
      strip: ['ref', 'refsrc', '__tn__', '_rdc', '_rdr', 'sfnsn', 'eav', 'paipv', 'comment_tracking',
        'notif_id', 'notif_t', 'ref_notif_type', 'hc_ref', 'fref'],
      stripPrefix: ['__cft__'] },
    { id: 'reddit', hosts: ['reddit.com', 'redd.it'],
      strip: ['share_id', 'ref', 'ref_source', 'ref_campaign', '$deep_link', 'correlation_id', 'st', 'sh', 'rdt'] },
    { id: 'tiktok', hosts: ['tiktok.com'],
      strip: ['_r', '_t', 'is_from_webapp', 'sender_device', 'web_id', 'refer', 'checksum',
        'share_app_id', 'share_item_id', 'share_link_id', 'share_app_name', 'social_sharing', 'u_code', 'tt_from'] },
    { id: 'linkedin', hosts: ['linkedin.com'],
      strip: ['trk', 'trkinfo', 'trkemail', 'trackingid', 'lipi', 'licu', 'midtoken', 'midsig',
        'otptoken', 'originalsubdomain', 'refid', 'rcm'] },
    { id: 'spotify', hosts: ['spotify.com'], strip: ['si', 'nd', 'dlsi', 'pi', 'go'] },
    { id: 'medium', hosts: ['medium.com'], strip: ['source', 'gi', 'postpublishedtype'] },
    { id: 'substack', hosts: ['substack.com'], strip: ['r', 'triedredirect'] },
    { id: 'github', hosts: ['github.com'], strip: ['notification_referrer_id'] },
    { id: 'wikipedia', hosts: ['wikipedia.org', 'wikimedia.org'], strip: ['wprov', 'wpsrc'] },
    { id: 'nytimes', hosts: ['nytimes.com'], strip: ['smid', 'smtyp', 'referringsource'] },
    { id: 'etsy', hosts: ['etsy.com'],
      strip: ['ref', 'click_key', 'click_sum', 'plkey', 'sts', 'pro', 'frs', 'cns'], stripPrefix: ['ga_'] },
    { id: 'ebay', hostRe: /(^|\.)ebay\.[a-z.]{2,6}$/,
      strip: ['_trkparms', '_trksid', 'mkevt', 'mkcid', 'mkrid', 'campid', 'customid', 'toolid', 'itmmeta', 'amdata'] },
    { id: 'alibaba-family', hosts: ['aliexpress.com', 'alibaba.com', 'taobao.com', 'tmall.com', '1688.com'],
      strip: ['spm', 'scm', 'scm_id', 'pvid', 'sk', 'terminal_id', 'afsmartredirect', 'gps-id', 'scm-url',
        'utparam-url', 'curpageloguid', 'pdp_ext_f', 'pdp_npi', 'sourcetype', 'ws_ab_test', 'btsid'],
      stripPrefix: ['aff_', 'algo_'] },
    { id: 'google-search', hostRe: /(^|\.)google\.[a-z.]{2,6}$/, pathRe: /^\/search/,
      strip: ['ved', 'ei', 'sei', 'sca_esv', 'sca_upv', 'sxsrf', 'uact', 'gs_lcp', 'gs_lp', 'gs_ssp',
        'sclient', 'oq', 'iflsig', 'source', 'rlz', 'biw', 'bih', 'dpr', 'aqs', 'client', 'bvm', 'fbs'] },
    { id: 'bing-search', hosts: ['bing.com'], pathRe: /^\/search/,
      strip: ['form', 'qs', 'sp', 'sc', 'cvid', 'pq', 'ghc', 'lq', 'ghsh', 'ghacc', 'ghpl', 'pc'] },
    { id: 'amazon', hostRe: /(^|\.)amazon\.[a-z.]{2,6}$/,
      strip: ['tag', 'linkcode', 'linkid', 'ref', 'ref_', 'crid', 'sprefix', 'qid', 'sr', '_encoding',
        'ascsubtag', 'camp', 'creative', 'creativeasin', 'content-id', 'dib', 'dib_tag', 'social_share'],
      rewrite: amazonRewrite }
  ];

  // Redirect wrappers: https://wrapper/?url=<real destination>  ->  <real destination>
  const UNWRAP_RULES = [
    { hostRe: /(^|\.)google\.[a-z.]{2,6}$/, pathRe: /^\/url$/, params: ['url', 'q'] },
    { hostRe: /(^|\.)google\.[a-z.]{2,6}$/, pathRe: /^\/amp\/(s\/)?(.+)$/, amp: true },
    { hostRe: /\.cdn\.ampproject\.org$/, pathRe: /^\/[a-z]\/(s\/)?(.+)$/, amp: true },
    { hostRe: /(^|\.)facebook\.com$/, pathRe: /^\/(l\.php|flx\/warn\/?)$/, params: ['u'] },
    { hostRe: /^l\.instagram\.com$/, params: ['u'] },
    { hostRe: /^out\.reddit\.com$/, params: ['url'] },
    { hostRe: /(^|\.)youtube\.com$/, pathRe: /^\/redirect$/, params: ['q'] },
    { hostRe: /(^|\.)linkedin\.com$/, pathRe: /^\/(safety\/go|redir\/redirect)\/?$/, params: ['url'] },
    { hostRe: /^slack-redir\.net$/, params: ['url'] },
    { hostRe: /^steamcommunity\.com$/, pathRe: /^\/linkfilter\//, params: ['u', 'url'] },
    { hostRe: /^duckduckgo\.com$/, pathRe: /^\/l\/?$/, params: ['uddg'] },
    { hostRe: /(^|\.)bing\.com$/, pathRe: /^\/ck\/a$/, params: ['u'], bing: true },
    { hostRe: /(^|\.)vk\.com$/, pathRe: /^\/away\.php$/, params: ['to'] },
    { hostRe: /^href\.li$/, rest: true }
  ];

  // If the URL carries a signature, changing the query would invalidate it.
  const SIGNED_KEYS = new Set(['x-amz-signature', 'x-goog-signature', 'x-ms-signature', 'signature',
    'sig', 'hmac', 'key-pair-id', 'oauth_signature']);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const GLOBAL_SET = new Set(GLOBAL_EXACT);

  function hostMatches(host, domain) {
    return host === domain || host.endsWith('.' + domain);
  }

  function parseHttp(str) {
    let u;
    try { u = new URL(String(str).trim()); } catch (e) { return null; }
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u : null;
  }

  function safeDecode(s) {
    try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { return s; }
  }

  function ruleApplies(rule, host, path) {
    const hostOk = rule.hosts
      ? rule.hosts.some((d) => hostMatches(host, d))
      : rule.hostRe ? rule.hostRe.test(host) : false;
    return hostOk && (!rule.pathRe || rule.pathRe.test(path));
  }

  function amazonRewrite(u, ctx) {
    const m = u.pathname.match(/^(?:\/[^/]+)?\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN)\/([A-Za-z0-9]{10})(?:[/]|$)/);
    if (m) {
      const old = u.pathname;
      u.pathname = '/dp/' + m[1].toUpperCase();
      if (old !== u.pathname) ctx.pathRemoved.push({ kind: 'path', name: old, value: '' });
      ctx.keepOnly = new Set(['th', 'psc', 'language']); // variant selection only
    } else {
      const stripped = u.pathname.replace(/\/ref=[^/]*$/, '');
      if (stripped !== u.pathname) {
        ctx.pathRemoved.push({ kind: 'path', name: u.pathname.slice(stripped.length), value: '' });
        u.pathname = stripped || '/';
      }
    }
  }

  function bingDecode(v) {
    if (!/^a1/.test(v)) return null;
    try {
      let b64 = v.slice(2).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) { return null; }
  }

  function unwrapOnce(u) {
    const host = u.hostname.toLowerCase();
    for (const r of UNWRAP_RULES) {
      if (!r.hostRe.test(host)) continue;
      let m = null;
      if (r.pathRe) { m = u.pathname.match(r.pathRe); if (!m) continue; }
      let target = null;
      if (r.amp) {
        target = (m[1] ? 'https://' : 'http://') + m[2] + u.search;
      } else if (r.rest) {
        target = (u.pathname.slice(1) + u.search + u.hash) || u.search.slice(1);
      } else {
        for (const p of r.params) {
          let v = u.searchParams.get(p);
          if (v && r.bing) v = bingDecode(v);
          if (v && parseHttp(v)) { target = v; break; }
        }
      }
      const t = target && parseHttp(target);
      if (t) return t;
    }
    return null;
  }

  function normalizeCustom(list) {
    const out = [];
    for (const raw of list || []) {
      const s = String(raw).trim().toLowerCase();
      if (!s || s === '*' || /[\s#&=?]/.test(s)) continue;
      out.push(s);
    }
    return [...new Set(out)];
  }

  function parseCustomText(text) {
    return normalizeCustom(String(text || '').split(/[\n,]+/));
  }

  // ---------------------------------------------------------------------------
  // Main API
  // ---------------------------------------------------------------------------

  /**
   * clean(url, { customParams: string[], stripFragment: boolean })
   * -> { ok, original, url, changed, removed[], unwrapped[], warnings[], skipped, reason? }
   * removed[]: { kind: 'param'|'path'|'fragment', name, value, why }
   */
  function clean(input, opts) {
    const o = Object.assign({ customParams: [], stripFragment: false }, opts || {});
    const original = String(input == null ? '' : input).trim();
    const result = { ok: false, original, url: original, changed: false, removed: [], unwrapped: [], warnings: [], skipped: null };

    let u = parseHttp(original);
    if (!u) { result.reason = 'unsupported'; return result; }
    result.ok = true;

    // 1. Peel redirect wrappers (google.com/url?q=..., l.facebook.com/l.php?u=..., AMP, ...)
    for (let i = 0; i < 5; i++) {
      const t = unwrapOnce(u);
      if (!t) break;
      result.unwrapped.push(u.hostname.toLowerCase());
      u = t;
    }

    const host = u.hostname.toLowerCase();
    const path = u.pathname;
    const custom = normalizeCustom(o.customParams);
    const customExact = new Set(custom.filter((c) => !c.endsWith('*')));
    const customPrefix = custom.filter((c) => c.endsWith('*')).map((c) => c.slice(0, -1)).filter(Boolean);

    // 2. Site-specific rules
    const ctx = { keepOnly: null, pathRemoved: [] };
    const siteStrip = new Set();
    const sitePrefix = [];
    for (const rule of SITE_RULES) {
      if (!ruleApplies(rule, host, path)) continue;
      (rule.strip || []).forEach((s) => siteStrip.add(s));
      (rule.stripPrefix || []).forEach((p) => sitePrefix.push(p));
      if (rule.rewrite) rule.rewrite(u, ctx);
    }

    // 3. Parse the raw query without re-encoding anything we keep
    const rawQuery = u.search ? u.search.slice(1) : '';
    const parts = rawQuery ? rawQuery.split('&') : [];
    const keys = parts.map((p) => safeDecode(p.split('=')[0]).toLowerCase());

    // Signed URLs: touching the query would break the signature.
    const signed = keys.some((k) => SIGNED_KEYS.has(k));
    if (signed) result.skipped = 'signed-url';

    const kept = [];
    const removedParams = [];
    parts.forEach((part, idx) => {
      if (part === '') return;
      const key = keys[idx];
      let why = null;
      if (!signed) {
        if (ctx.keepOnly && !ctx.keepOnly.has(key)) why = 'not needed for this page';
        else if (GLOBAL_SET.has(key) || GLOBAL_PREFIXES.some((p) => key.startsWith(p))) why = 'tracker';
        else if (siteStrip.has(key) || sitePrefix.some((p) => key.startsWith(p))) why = 'site tracker';
        else if (customExact.has(key) || customPrefix.some((p) => key.startsWith(p))) why = 'custom rule';
      }
      if (why) {
        const eq = part.indexOf('=');
        const val = eq === -1 ? '' : safeDecode(part.slice(eq + 1));
        removedParams.push({ kind: 'param', name: safeDecode(part.split('=')[0]), value: val.length > 80 ? val.slice(0, 77) + '…' : val, why });
      } else {
        kept.push(part);
      }
    });

    const changedQuery = removedParams.length > 0;
    if (changedQuery) u.search = kept.length ? '?' + kept.join('&') : '';

    // 4. Fragment (opt-in; can break in-page anchors and SPA routes)
    const removedFragment = [];
    if (o.stripFragment && u.hash && u.hash !== '#') {
      removedFragment.push({ kind: 'fragment', name: u.hash, value: '', why: 'fragment removal enabled' });
      u.hash = '';
    }

    result.removed = [...ctx.pathRemoved, ...removedParams, ...removedFragment];
    const structural = result.unwrapped.length > 0 || ctx.pathRemoved.length > 0 || removedFragment.length > 0;
    result.changed = changedQuery || structural;
    result.url = result.changed ? u.href : original;

    // 5. Heads-up for a security-minded reader
    const finalHost = u.hostname.toLowerCase();
    if (u.protocol === 'http:') result.warnings.push({ code: 'insecure', text: 'Not encrypted (http://)' });
    if (finalHost.split('.').some((l) => l.startsWith('xn--'))) {
      result.warnings.push({ code: 'punycode', text: 'Look-alike risk: internationalized domain (' + finalHost + ')' });
    }
    if (u.username || u.password) result.warnings.push({ code: 'credentials', text: 'URL contains a username or password' });
    if (result.skipped === 'signed-url') result.warnings.push({ code: 'signed', text: 'Signed URL: left untouched so the signature stays valid' });

    return result;
  }

  /**
   * cleanText(text, opts): for copy interception. Only acts when the ENTIRE text is
   * one or more URLs (one per line); anything else is left alone.
   * -> { changed, text, count }
   */
  function cleanText(text, opts) {
    const src = String(text == null ? '' : text);
    const lines = src.split(/\r?\n/);
    const nonEmpty = lines.filter((l) => l.trim() !== '');
    if (nonEmpty.length === 0 || nonEmpty.length > 50) return { changed: false, text: src, count: 0 };
    let count = 0;
    const out = [];
    for (const line of lines) {
      if (line.trim() === '') { out.push(line); continue; }
      if (/\s/.test(line.trim())) return { changed: false, text: src, count: 0 }; // prose, not a bare URL
      const r = clean(line, opts);
      if (!r.ok) return { changed: false, text: src, count: 0 };
      if (r.changed) { count++; out.push(r.url); } else out.push(line);
    }
    return { changed: count > 0, text: out.join('\n'), count };
  }

  /** Names usable in declarativeNetRequest removeParams (exact, case-sensitive, URL-safe). */
  function dnrGlobalNames() {
    const names = new Set(GLOBAL_EXACT);
    for (const [prefix, members] of Object.entries(PREFIX_MEMBERS)) members.forEach((m) => names.add(prefix + m));
    for (const [lower, variant] of Object.entries(CASE_VARIANTS)) if (names.has(lower)) names.add(variant);
    return [...names].filter((n) => /^[A-Za-z0-9_.-]+$/.test(n)).sort();
  }

  /** Site rules expressible as DNR (domain-wide, exact names only). */
  function dnrSiteRules() {
    return SITE_RULES
      .filter((r) => r.hosts && !r.pathRe && !r.rewrite && r.strip && r.strip.length)
      .map((r) => ({ id: r.id, domains: r.hosts, names: r.strip.filter((n) => /^[A-Za-z0-9_.-]+$/.test(n)) }))
      .filter((r) => r.names.length);
  }

  /**
   * Split names into groups small enough for one DNR regexFilter. Chrome rejects regexes
   * above ~2KB of compiled memory (measured: 15 short names OK, 20 not), so stay well under.
   */
  function chunkNames(names, maxChars, maxCount) {
    const budget = maxChars || 120;
    const cap = maxCount || 10;
    const out = [];
    let cur = [];
    let len = 0;
    for (const n of names) {
      if (cur.length && (len + n.length > budget || cur.length >= cap)) { out.push(cur); cur = []; len = 0; }
      cur.push(n);
      len += n.length;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  return {
    clean, cleanText, parseCustomText, normalizeCustom, parseHttp,
    dnrGlobalNames, dnrSiteRules, chunkNames,
    data: { GLOBAL_EXACT, GLOBAL_PREFIXES, PREFIX_MEMBERS, SITE_RULES, UNWRAP_RULES }
  };
});

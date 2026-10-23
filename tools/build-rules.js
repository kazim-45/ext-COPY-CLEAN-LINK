#!/usr/bin/env node
/* Generates rules/tracking.json (declarativeNetRequest) from the data in src/cleaner.js,
 * so the copy-time cleaner and the automatic stripper can never drift apart.
 *
 * Each rule only matches when one of its params is really present (case-sensitive regex),
 * so no rule ever redirects a URL to itself. Regexes are chunked to stay under Chrome's
 * per-rule regex memory limit. */
const fs = require('fs');
const path = require('path');
const C = require('../src/cleaner.js');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regexFor = (names) => '^https?://[^#]*[?&](?:' + names.map(esc).join('|') + ')(?:[=&#]|$)';
const chunks = (arr) => C.chunkNames(arr);

const rules = [];
let id = 1;
const add = (names, removeParams, domains) => {
  rules.push({
    id: id++,
    priority: 1,
    action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams } } } },
    condition: {
      regexFilter: regexFor(names),
      isUrlFilterCaseSensitive: true,
      resourceTypes: ['main_frame'],
      ...(domains ? { requestDomains: domains } : {})
    }
  });
};

// Global trackers: any chunk that matches strips ALL global names in one redirect.
const globals = C.dnrGlobalNames();
for (const c of chunks(globals)) add(c, globals);

// Site rules: domain-scoped.
for (const site of C.dnrSiteRules()) {
  for (const c of chunks(site.names)) add(c, site.names, site.domains);
}

const out = path.join(__dirname, '..', 'rules', 'tracking.json');
fs.writeFileSync(out, JSON.stringify(rules, null, 1) + '\n');
console.log(`wrote ${rules.length} rules (${globals.length} global names) -> ${path.relative(process.cwd(), out)}`);

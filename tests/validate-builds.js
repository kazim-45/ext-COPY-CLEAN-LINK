#!/usr/bin/env node
/* Static checks on dist/chrome and dist/firefox: every file a manifest or HTML page references
 * exists, Firefox has no Chromium-only keys, scripts load in the right order. */
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const DIST = path.join(__dirname, '..', 'dist');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('PASS', name); };

function refs(dir, m) {
  const r = new Set();
  Object.values(m.icons || {}).forEach((x) => r.add(x));
  Object.values((m.action || {}).default_icon || {}).forEach((x) => r.add(x));
  if (m.action && m.action.default_popup) r.add(m.action.default_popup);
  if (m.options_ui) r.add(m.options_ui.page);
  if (m.background) { if (m.background.service_worker) r.add(m.background.service_worker); (m.background.scripts || []).forEach((x) => r.add(x)); }
  (m.declarative_net_request?.rule_resources || []).forEach((x) => r.add(x.path));
  return [...r];
}
function htmlRefs(file) {
  const html = fs.readFileSync(file, 'utf8');
  return [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => path.resolve(path.dirname(file), m[1]));
}

for (const name of ['chrome', 'firefox']) {
  const dir = path.join(DIST, name);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  ok(`${name}: all manifest-referenced files exist`, () => {
    for (const f of refs(dir, m)) assert.ok(fs.existsSync(path.join(dir, f)), f);
  });
  ok(`${name}: HTML pages reference only existing files`, () => {
    for (const page of ['popup/popup.html', 'options/options.html'].concat(name === 'chrome' ? ['src/offscreen.html'] : [])) {
      for (const f of htmlRefs(path.join(dir, page))) assert.ok(fs.existsSync(f), page + ' -> ' + f);
    }
  });
  ok(`${name}: popup/options load compat.js before other scripts`, () => {
    for (const page of ['popup/popup.html', 'options/options.html']) {
      const scripts = [...fs.readFileSync(path.join(dir, page), 'utf8').matchAll(/<script src="([^"]+)"/g)].map((x) => x[1]);
      assert.equal(scripts[0], '../src/compat.js', page);
    }
  });
  ok(`${name}: no network APIs used anywhere`, () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    for (const f of walk(dir).filter((x) => /\.(js|html)$/.test(x))) {
      const hits = fs.readFileSync(f, 'utf8').match(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts\(\s*['"]https?:/g) || [];
      assert.deepEqual(hits, [], f);
    }
  });
}

const ff = JSON.parse(fs.readFileSync(path.join(DIST, 'firefox', 'manifest.json'), 'utf8'));
const ch = JSON.parse(fs.readFileSync(path.join(DIST, 'chrome', 'manifest.json'), 'utf8'));
ok('firefox: event page scripts, no service worker, compat first', () => {
  assert.equal(ff.background.service_worker, undefined);
  assert.equal(ff.background.scripts[0], 'src/compat.js');
  assert.ok(ff.background.scripts.indexOf('src/cleaner.js') < ff.background.scripts.indexOf('src/background.js'));
});
ok('firefox: no Chromium-only keys/permissions', () => {
  assert.equal(ff.minimum_chrome_version, undefined);
  assert.ok(!ff.permissions.includes('offscreen'));
  assert.equal(ff.optional_host_permissions, undefined);
  assert.ok(!fs.existsSync(path.join(DIST, 'firefox', 'src', 'offscreen.js')));
});
ok('firefox: gecko id + min version set', () => {
  assert.match(ff.browser_specific_settings.gecko.id, /^[^@\s]+@[^@\s]+$/);
  assert.ok(parseInt(ff.browser_specific_settings.gecko.strict_min_version) >= 128);
});
ok('firefox: host access is not auto-required beyond <all_urls> opt-in, no broad content_scripts', () => {
  assert.equal(ff.content_scripts, undefined);
  assert.deepEqual(ff.host_permissions, ['<all_urls>']);
});
ok('chrome: still service worker + optional host permission', () => {
  assert.equal(ch.background.service_worker, 'src/background.js');
  assert.deepEqual(ch.optional_host_permissions, ['<all_urls>']);
  assert.equal(ch.host_permissions, undefined);
});
console.log(`\n${n} build checks passed`);

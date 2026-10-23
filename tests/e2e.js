#!/usr/bin/env node
/* End-to-end test: loads the unpacked extension into real Chromium (new headless) and
 * exercises popup, copy, context-menu path, auto-strip redirects (every rule), pause,
 * and the copy interceptor. Dev-only: needs playwright.
 *
 *   NODE_PATH=/opt/npm-tools/node_modules node tests/e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const C = require('../src/cleaner.js');

const SRC = process.env.EXT_DIR || path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// Test copy of the extension: host access granted up front (the real build asks the user at runtime).
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ccl-e2e-'));
const ext = path.join(work, 'ext');
fs.cpSync(SRC, ext, { recursive: true, filter: (p) => !/(^|\/)(node_modules|tests|dist|tools)(\/|$)|\.zip$/.test(path.relative(SRC, p)) });
const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
mf.host_permissions = mf.optional_host_permissions;
delete mf.optional_host_permissions;
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf, null, 2));

let pass = 0;
const results = [];
async function step(name, fn) {
  try { await fn(); pass++; results.push('PASS ' + name); console.log('PASS', name); }
  catch (e) { results.push('FAIL ' + name + ' :: ' + e.message); console.log('FAIL', name, '\n   ', e.message.split('\n').slice(0, 8).join(' | ')); }
}

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>t</title><body>
      <input id="u" value="https://example.org/p?utm_source=news&fbclid=abc&id=7" size="80">
      <p id="prose">see https://example.org/p?utm_source=news here</p>
      <textarea id="ta">https://a.com/?gclid=1</textarea>
      <a id="lnk" href="https://example.org/?utm_medium=x">https://example.org/?utm_medium=x</a>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const ctx = await chromium.launchPersistentContext(path.join(work, 'profile'), {
    executablePath: CHROME,
    headless: false,
    args: [
      '--headless=new', '--no-sandbox',
      `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
      `--host-resolver-rules=MAP * 127.0.0.1:${port}, EXCLUDE 127.0.0.1`
    ],
    permissions: ['clipboard-read', 'clipboard-write']
  });

  const errors = [];
  ctx.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  ctx.on('weberror', (e) => errors.push('weberror: ' + e.error().message));

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  console.log('extension id', id);
  const evalSW = (fn, arg) => sw.evaluate(fn, arg);

  // A helper page on a real origin so navigator.clipboard works.
  const page = await ctx.newPage();
  const base = `http://localhost:${port}`;
  await page.goto(base + '/');
  const readClip = () => page.evaluate(() => navigator.clipboard.readText());

  await step('manifest loads and service worker is alive', async () => {
    const m = await evalSW(() => chrome.runtime.getManifest());
    assert.equal(m.manifest_version, 3);
  });

  await step('static ruleset registered (disabled by default)', async () => {
    const en = await evalSW(() => chrome.declarativeNetRequest.getEnabledRulesets());
    assert.deepEqual(en, []);
  });

  await step('copyCleanFor writes the clean URL to the clipboard (shortcut / context-menu path)', async () => {
    await page.bringToFront();
    await evalSW(() => copyCleanFor('https://www.example.com/a?utm_source=x&id=3&fbclid=1', undefined));
    await page.waitForTimeout(300);
    assert.equal(await readClip(), 'https://www.example.com/a?id=3');
  });

  await step('copyCleanFor unwraps a Google redirect', async () => {
    await evalSW(() => copyCleanFor('https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Fz%3Futm_term%3D1&sa=D', undefined));
    await page.waitForTimeout(300);
    assert.equal(await readClip(), 'https://example.org/z');
  });

  await step('stats counter increments', async () => {
    const { stats } = await evalSW(() => Settings.get());
    assert.ok(stats.copies >= 2 && stats.removed >= 3, JSON.stringify(stats));
  });

  await step('chrome:// pages are rejected, clipboard untouched', async () => {
    const before = await readClip();
    const r = await evalSW(() => copyCleanFor('chrome://extensions', undefined));
    assert.equal(r.ok, false);
    assert.equal(await readClip(), before);
  });

  // ---------------------------------------------------------------- popup --
  async function openPopup(fakeUrl) {
    const p = await ctx.newPage();
    await p.addInitScript((u) => {
      const orig = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async (q) => (q && q.active ? [{ id: 1, url: u }] : orig(q));
    }, fakeUrl);
    await p.goto(`chrome-extension://${id}/popup/popup.html`);
    await p.waitForSelector('#status:not(:empty)');
    return p;
  }

  await step('popup: shows diff, auto-copies, counts removals', async () => {
    const p = await openPopup('https://shop.example.com/item?color=red&utm_source=mail&utm_campaign=sale&gclid=abc');
    assert.match(await p.textContent('#status'), /Copied\. Removed 3 tracking items/);
    assert.equal(await p.textContent('#after'), 'https://shop.example.com/item?color=red');
    assert.equal(await p.locator('#before .del').count(), 3);
    assert.equal(await p.locator('#chips .chip').count(), 3);
    await page.bringToFront();
    assert.equal(await readClip(), 'https://shop.example.com/item?color=red');
    await p.screenshot({ path: path.join(work, 'popup.png') });
    await p.close();
  });

  await step('popup: clipboard falls back to execCommand when the async API is unavailable (Firefox path)', async () => {
    const p = await ctx.newPage();
    await p.addInitScript((u) => {
      const orig = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async (q) => (q && q.active ? [{ id: 1, url: u }] : orig(q));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    }, 'https://fallback.example.com/x?utm_source=a&k=1');
    await p.goto(`chrome-extension://${id}/popup/popup.html`);
    await p.waitForSelector('#status:not(:empty)');
    assert.match(await p.textContent('#status'), /Copied\./);
    await p.close();
    await page.bringToFront();
    assert.equal(await readClip(), 'https://fallback.example.com/x?k=1');
  });

  await step('popup: already-clean link says so', async () => {
    const p = await openPopup('https://example.com/plain?x=1');
    assert.match(await p.textContent('#status'), /already clean/);
    await p.close();
  });

  await step('popup: unsupported page explains itself, button disabled', async () => {
    const p = await openPopup('chrome://settings');
    assert.match(await p.textContent('#status'), /regular web page/);
    assert.equal(await p.isDisabled('#copy'), true);
    await p.close();
  });

  await step('popup: warns on punycode + http', async () => {
    const p = await openPopup('http://xn--pple-43d.com/?utm_source=a');
    const notes = await p.locator('#notes li').allTextContents();
    assert.ok(notes.some((t) => /Look-alike/.test(t)) && notes.some((t) => /Not encrypted/.test(t)), notes.join('|'));
    await p.close();
  });

  await step('popup: URLs render as text, never HTML (XSS check)', async () => {
    const p = await openPopup('https://example.com/?q=<img src=x onerror=window.__pwn=1>&utm_source=a');
    assert.equal(await p.evaluate(() => window.__pwn), undefined);
    assert.equal(await p.locator('#before img').count(), 0);
    await p.close();
  });

  await step('every shipped rule regex is accepted by Chrome (size limit)', async () => {
    const rules = JSON.parse(fs.readFileSync(path.join(ext, 'rules', 'tracking.json'), 'utf8'));
    const bad = await evalSW(async (rs) => {
      const out = [];
      for (const r of rs) {
        const res = await chrome.declarativeNetRequest.isRegexSupported({ regex: r.condition.regexFilter, isCaseSensitive: true });
        if (!res.isSupported) out.push(r.id + ':' + res.reason);
      }
      return out;
    }, rules);
    assert.deepEqual(bad, []);
  });

  // ----------------------------------------------------------- auto-strip --
  await step('enable autoStrip -> ruleset enabled', async () => {
    await evalSW(() => Settings.set({ autoStrip: true }));
    await page.waitForTimeout(500);
    const en = await evalSW(() => chrome.declarativeNetRequest.getEnabledRulesets());
    assert.deepEqual(en, ['tracking']);
  });

  const landed = async (u) => {
    const p = await ctx.newPage();
    try { await p.goto(u, { waitUntil: 'domcontentloaded' }); return p.url(); } finally { await p.close(); }
  };

  await step('autoStrip: utm + fbclid removed on navigation, other params kept', async () => {
    assert.equal(await landed(`http://news.test:${port}/a?x=1&utm_source=tw&fbclid=Z&y=2`), `http://news.test:${port}/a?x=1&y=2`);
  });

  await step('autoStrip: URL with no trackers is not redirected', async () => {
    assert.equal(await landed(`http://news.test:${port}/a?x=1&utmx=2`), `http://news.test:${port}/a?x=1&utmx=2`);
  });

  await step('autoStrip: no redirect loop when tracker-looking text is only in the fragment', async () => {
    assert.equal(await landed(`http://news.test:${port}/a#?utm_source=x`), `http://news.test:${port}/a#?utm_source=x`);
  });

  await step('autoStrip: every global parameter name is stripped (all rules compile & fire)', async () => {
    const names = C.dnrGlobalNames();
    const p = await ctx.newPage();
    const bad = [];
    for (const n of names) {
      await p.goto(`http://t.test:${port}/p?keep=1&${n}=v`, { waitUntil: 'domcontentloaded' });
      if (p.url() !== `http://t.test:${port}/p?keep=1`) bad.push(n + ' -> ' + p.url());
    }
    await p.close();
    assert.deepEqual(bad, [], bad.slice(0, 5).join('\n'));
  });

  await step('autoStrip: site rule (YouTube si/feature) strips, v and t kept', async () => {
    assert.equal(await landed(`http://www.youtube.com:${port}/watch?v=abc&si=Q&t=9&feature=share`),
      `http://www.youtube.com:${port}/watch?v=abc&t=9`);
  });

  await step('autoStrip: site rule does not leak to other domains', async () => {
    assert.equal(await landed(`http://other.test:${port}/watch?v=abc&si=Q`), `http://other.test:${port}/watch?v=abc&si=Q`);
  });

  await step('paused site is left alone', async () => {
    await evalSW(() => Settings.set({ pausedHosts: ['example.net'] }));
    await page.waitForTimeout(500);
    const u = `http://www.example.net:${port}/a?utm_source=keepme`;
    assert.equal(await landed(u), u);
    assert.equal(await landed(`http://news.test:${port}/a?utm_source=x`), `http://news.test:${port}/a`);
  });

  await step('custom parameter stripped on navigation', async () => {
    await evalSW(() => Settings.set({ customParams: 'my_ref\nwild_*' }));
    await page.waitForTimeout(500);
    assert.equal(await landed(`http://news.test:${port}/a?my_ref=1&k=2`), `http://news.test:${port}/a?k=2`);
  });

  await step('large custom list is chunked into valid rules and all names strip', async () => {
    const many = Array.from({ length: 45 }, (_, i) => 'custom_tracker_number_' + i);
    await evalSW((l) => Settings.set({ customParams: l.join('\n') }), many);
    await page.waitForTimeout(600);
    const dyn = await evalSW(() => chrome.declarativeNetRequest.getDynamicRules());
    assert.ok(dyn.filter((r) => r.action.type === 'redirect').length > 1, 'expected multiple chunks');
    for (const n of [many[0], many[22], many[44]]) {
      assert.equal(await landed(`http://news.test:${port}/a?k=2&${n}=1`), `http://news.test:${port}/a?k=2`, n);
    }
  });

  await step('disable autoStrip -> ruleset off, URLs untouched', async () => {
    await evalSW(() => Settings.set({ autoStrip: false }));
    await page.waitForTimeout(500);
    const u = `http://news.test:${port}/a?utm_source=x`;
    assert.equal(await landed(u), u);
  });

  // ------------------------------------------------------ copy interceptor --
  await step('cleanOnCopy registers the content script', async () => {
    await evalSW(() => Settings.set({ cleanOnCopy: true }));
    await page.waitForTimeout(600);
    const reg = await evalSW(() => chrome.scripting.getRegisteredContentScripts());
    assert.equal(reg.length, 1);
  });

  await step('copy of a bare URL in an input is cleaned', async () => {
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${port}/`);
    await p.click('#u', { clickCount: 3 });
    await p.keyboard.press('Control+C');
    await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), 'https://example.org/p?id=7');
    await p.close();
  });

  await step('copy of a URL in a textarea is cleaned (custom wildcard honoured)', async () => {
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${port}/`);
    await p.click('#ta');
    await p.keyboard.press('Control+A');
    await p.keyboard.press('Control+C');
    await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), 'https://a.com/');
    await p.close();
  });

  await step('copy of prose containing a URL is NOT modified', async () => {
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${port}/`);
    await p.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('prose')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await p.keyboard.press('Control+C');
    await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), 'see https://example.org/p?utm_source=news here');
    await p.close();
  });

  await step('selecting a link whose text is a URL copies the clean text (no tracked href)', async () => {
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${port}/`);
    await p.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('lnk')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await p.keyboard.press('Control+C');
    await p.waitForTimeout(200);
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), 'https://example.org/');
    await p.close();
  });

  await step('disable cleanOnCopy -> content script unregistered', async () => {
    await evalSW(() => Settings.set({ cleanOnCopy: false }));
    await page.waitForTimeout(600);
    const reg = await evalSW(() => chrome.scripting.getRegisteredContentScripts());
    assert.equal(reg.length, 0);
  });

  // --------------------------------------------------------------- options --
  await step('options page renders, tester works, no CSP violations', async () => {
    const p = await ctx.newPage();
    const pageErrors = [];
    p.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
    p.on('pageerror', (e) => pageErrors.push(e.message));
    await p.goto(`chrome-extension://${id}/options/options.html`);
    await p.fill('#tester', 'https://example.com/x?utm_source=a&keep=1');
    assert.equal(await p.textContent('#test-after'), 'https://example.com/x?keep=1');
    await p.fill('#pause-input', 'not a domain');
    await p.press('#pause-input', 'Enter');
    assert.match(await p.textContent('#pause-error'), /domain/);
    await p.fill('#pause-input', 'https://www.Example.org/path');
    await p.press('#pause-input', 'Enter');
    assert.ok((await p.locator('#paused li').allTextContents()).some((t) => t.includes('example.org')));
    await p.screenshot({ path: path.join(work, 'options.png'), fullPage: true });
    await p.close();
    assert.deepEqual(pageErrors, []);
  });

  await step('no console errors anywhere', async () => {
    const real = errors.filter((e) => !/favicon|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(e));
    assert.deepEqual(real, []);
  });

  await ctx.close();
  server.close();
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`\n${pass}/${results.length} e2e steps passed. Screenshots: ${work}/popup.png, options.png`);
  fs.writeFileSync(path.join(work, 'summary.txt'), results.join('\n'));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

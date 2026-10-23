const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/cleaner.js');

const url = (s, o) => C.clean(s, o).url;

test('strips utm_* and click IDs, keeps other params in order', () => {
  assert.equal(url('https://example.com/a?x=1&utm_source=tw&fbclid=abc&y=2&gclid=z'), 'https://example.com/a?x=1&y=2');
});
test('case-insensitive names', () => {
  assert.equal(url('https://example.com/?UTM_Source=a&Id=5'), 'https://example.com/?Id=5');
});
test('unchanged URL is returned byte-for-byte', () => {
  const s = 'https://example.com/a%20b?q=hello+world&r=%E2%9C%93#frag';
  const r = C.clean(s);
  assert.equal(r.changed, false);
  assert.equal(r.url, s);
});
test('kept params are not re-encoded', () => {
  assert.equal(url('https://e.com/?q=a%20b+c&utm_medium=x'), 'https://e.com/?q=a%20b+c');
});
test('fragment preserved by default, removable by option', () => {
  assert.equal(url('https://e.com/p?utm_source=a#section'), 'https://e.com/p#section');
  assert.equal(url('https://e.com/p?utm_source=a#section', { stripFragment: true }), 'https://e.com/p');
});
test('all params removed leaves no dangling ?', () => {
  assert.equal(url('https://e.com/p?utm_source=a'), 'https://e.com/p');
});
test('non-http URLs are unsupported', () => {
  for (const s of ['chrome://extensions', 'javascript:alert(1)', 'about:blank', 'not a url', '']) {
    assert.equal(C.clean(s).ok, false, s);
  }
});
test('YouTube keeps v/t/list, drops si/feature', () => {
  assert.equal(url('https://www.youtube.com/watch?v=abc&t=42s&list=PL1&si=XYZ&feature=share'), 'https://www.youtube.com/watch?v=abc&t=42s&list=PL1');
  assert.equal(url('https://youtu.be/abc?si=XYZ&t=10'), 'https://youtu.be/abc?t=10');
});
test('X/Twitter status share params only on status pages', () => {
  assert.equal(url('https://x.com/u/status/123?s=20&t=abc'), 'https://x.com/u/status/123');
  assert.equal(url('https://x.com/search?q=a&s=typed'), 'https://x.com/search?q=a&s=typed');
  assert.equal(url('https://x.com/u?ref_src=twsrc'), 'https://x.com/u');
});
test('Amazon product URL collapses to /dp/ASIN', () => {
  const r = C.clean('https://www.amazon.com/Some-Long-Title/dp/B0ABCDEFGH/ref=sr_1_3?crid=1&keywords=x&tag=aff-20&th=1&psc=1');
  assert.equal(r.url, 'https://www.amazon.com/dp/B0ABCDEFGH?th=1&psc=1');
  assert.ok(r.removed.some((x) => x.kind === 'path'));
});
test('Amazon non-product page loses /ref= segment and tags', () => {
  assert.equal(url('https://www.amazon.com/s?k=usb&ref=nb_sb_noss&crid=9'), 'https://www.amazon.com/s?k=usb');
});
test('Google redirect is unwrapped, then target cleaned', () => {
  const r = C.clean('https://www.google.com/url?sa=t&q=&url=https%3A%2F%2Fexample.org%2Fp%3Futm_source%3Dx%26id%3D7&ved=1');
  assert.equal(r.url, 'https://example.org/p?id=7');
  assert.deepEqual(r.unwrapped, ['www.google.com']);
});
test('Facebook l.php unwrap', () => {
  assert.equal(url('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.org%2F%3Ffbclid%3D1&h=AT0'), 'https://example.org/');
});
test('Bing /ck/a base64 unwrap', () => {
  const target = 'https://example.org/x?utm_source=b&k=1';
  const b64 = Buffer.from(target).toString('base64url');
  assert.equal(url('https://www.bing.com/ck/a?!&&p=1&u=a1' + b64 + '&ntb=1'), 'https://example.org/x?k=1');
});
test('Google AMP viewer unwrap', () => {
  assert.equal(url('https://www.google.com/amp/s/example.org/story.html'), 'https://example.org/story.html');
});
test('javascript: redirect targets are never followed', () => {
  const r = C.clean('https://www.google.com/url?q=javascript%3Aalert(1)');
  assert.deepEqual(r.unwrapped, []);
});
test('signed URLs are left untouched', () => {
  const s = 'https://bucket.s3.amazonaws.com/f.png?utm_source=a&X-Amz-Signature=abc&X-Amz-Date=1';
  const r = C.clean(s);
  assert.equal(r.url, s);
  assert.equal(r.skipped, 'signed-url');
});
test('custom params: exact and wildcard', () => {
  const o = { customParams: C.parseCustomText('foo, bar_*\n\n*\n a=b') };
  assert.equal(url('https://e.com/?foo=1&bar_x=2&bar_y=3&keep=4', o), 'https://e.com/?keep=4');
});
test('Google search noise removed, query kept', () => {
  assert.equal(url('https://www.google.com/search?q=cats&ved=abc&ei=zzz&sxsrf=1&hl=en'), 'https://www.google.com/search?q=cats&hl=en');
});
test('warnings: http, punycode, credentials', () => {
  const codes = (s) => C.clean(s).warnings.map((w) => w.code);
  assert.ok(codes('http://example.com/').includes('insecure'));
  assert.ok(codes('https://xn--pple-43d.com/').includes('punycode'));
  assert.ok(codes('https://user:pw@example.com/').includes('credentials'));
  assert.deepEqual(codes('https://example.com/'), []);
});
test('cleanText only touches bare URL lists', () => {
  assert.deepEqual(C.cleanText('https://e.com/?utm_source=a'), { changed: true, text: 'https://e.com/', count: 1 });
  assert.equal(C.cleanText('look at https://e.com/?utm_source=a ok').changed, false);
  const multi = C.cleanText('https://a.com/?fbclid=1\n\nhttps://b.com/ok');
  assert.equal(multi.text, 'https://a.com/\n\nhttps://b.com/ok');
  assert.equal(multi.count, 1);
});
test('DNR names are URL-safe and include prefix members', () => {
  const n = C.dnrGlobalNames();
  assert.ok(n.includes('utm_source') && n.includes('fbclid') && n.includes('hsCtaTracking'));
  assert.ok(n.every((x) => /^[A-Za-z0-9_.-]+$/.test(x)));
});
test('every data name is lowercase (matching is lowercase)', () => {
  for (const n of C.data.GLOBAL_EXACT) assert.equal(n, n.toLowerCase(), n);
  for (const r of C.data.SITE_RULES) for (const n of r.strip || []) assert.equal(n, n.toLowerCase(), r.id + ':' + n);
});

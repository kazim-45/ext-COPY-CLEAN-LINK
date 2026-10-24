#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const COMMON = [
  'src/compat.js', 'src/cleaner.js', 'src/settings.js', 'src/clipboard.js', 'src/background.js',
  'src/content.js', 'src/ui.css',
  'popup/popup.html', 'popup/popup.css', 'popup/popup.js',
  'options/options.html', 'options/options.css', 'options/options.js',
  'rules/tracking.json',
  'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png'
];
const CHROME_ONLY = ['src/offscreen.html', 'src/offscreen.js'];

function emit(name, files, manifest) {
  const out = path.join(DIST, name);
  fs.rmSync(out, { recursive: true, force: true });
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(out, f));
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const zip = path.join(DIST, `copy-clean-link-${name}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: out });
  console.log(`built dist/${name} (${files.length + 1} files) -> ${path.relative(ROOT, zip)}`);
}

// ---- Chromium
emit('chrome', [...COMMON, ...CHROME_ONLY], base);

// ---- Firefox
const ff = JSON.parse(JSON.stringify(base));
delete ff.minimum_chrome_version;
ff.permissions = ff.permissions.filter((p) => p !== 'offscreen');
ff.background = { scripts: ['src/compat.js', 'src/cleaner.js', 'src/settings.js', 'src/clipboard.js', 'src/background.js'] };

ff.host_permissions = ff.optional_host_permissions;
delete ff.optional_host_permissions;
ff.browser_specific_settings = {
  gecko: {
    id: 'copy-clean-link@kazim-45.github.io',
    strict_min_version: '128.0',
    data_collection_permissions: { required: ['none'] }
  }
};
emit('firefox', COMMON, ff);

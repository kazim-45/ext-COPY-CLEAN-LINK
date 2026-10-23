#!/usr/bin/env node
/* Renders icons/icon.svg to PNGs. Dev-only; needs playwright + chromium. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const dir = path.join(__dirname, '..', 'icons');
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: path.join(dir, `icon-${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
  }
  await browser.close();
  console.log('icons written');
})();

# Copy Clean Link

One click (or `Alt+Shift+C`) copies the current page's URL **without trackers**. Local only: no network requests, no analytics, no accounts.

## Install

### Firefox (128+)

Use `copy-clean-link-firefox.zip` (or the `dist/firefox` folder).

* **Try it now (temporary):** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on...** and pick the zip (or `manifest.json` inside the unzipped folder). It stays until you restart Firefox.
* **Site access:** Firefox may show "Access your data for all websites" as an *optional* permission at install. Leave it off unless you want auto-strip / copy-cleaning. You can grant or revoke it later in `about:addons` → Copy Clean Link → Permissions, or from the extension's own toggles.
* **Shortcut:** `Alt+Shift+C`. Change it from `about:addons` → gear icon → *Manage Extension Shortcuts*.

### Chrome, Edge, Brave (any Chromium 116+)

Use `copy-clean-link-chrome.zip` (or `dist/chrome`): unzip, open `chrome://extensions`, enable **Developer mode**, **Load unpacked**, choose the folder. Pin the icon.

## What it does

| Action | How |
| --- | --- |
| Copy clean URL of this page | Click the icon (copies instantly, shows a before/after diff) or press `Alt+Shift+C` |
| Copy a clean link address | Right-click any link, then **Copy clean link address** |
| Strip trackers while browsing (opt-in) | Toggle in the popup or Settings |
| Clean URLs you copy with Ctrl/Cmd+C (opt-in) | Settings. Acts only when the whole selection is a bare URL |
| Your own parameters | Settings. One per line; `prefix_*` wildcards work when copying |
| Pause a site | Popup toggle or Settings |

### What gets cleaned

* ~150 tracking parameters on any site: `utm_*`, `fbclid`, `gclid`, `msclkid`, `mc_eid`, `_hsenc`, `igshid`, `srsltid`, `pf_rd_*` and more.
* Site-specific noise: YouTube `si`, X/Twitter share tokens, Amazon (`/dp/ASIN` form, `ref=`, `tag`), Google/Bing search junk, LinkedIn `trk`, Spotify `si`, Reddit, TikTok, Facebook, Medium, eBay, AliExpress and others.
* **Redirect wrappers are unwrapped**: `google.com/url?q=`, `l.facebook.com/l.php`, Bing `ck/a`, DuckDuckGo `l/`, YouTube `redirect`, LinkedIn `safety/go`, Slack, Steam, AMP viewers.
* Functional params are kept (`v`, `t`, `q`, `id`, friend-link keys like `sk` / `unlocked_article_code`).
* **Signed URLs (S3, GCS, Azure SAS...) are never modified**, so signatures stay valid.
* Warnings in the popup for `http://`, punycode/look-alike domains (`xn--`), and credentials in the URL.

## Permissions (least privilege)

Out of the box the extension has **no access to any website**.

| Permission | Why |
| --- | --- |
| `activeTab` | Read the URL of the tab only when you click the icon, use the shortcut or the menu |
| `contextMenus` | The two right-click entries |
| `clipboardWrite`, `offscreen` | Writing to the clipboard from the shortcut/menu (Chromium service workers can't; Firefox doesn't need `offscreen` and doesn't list it) |
| `storage` | Your settings, stored locally (never synced) |
| `scripting` | Registers the optional copy-cleaner |
| `declarativeNetRequestWithHostAccess` | Optional auto-strip: the browser itself rewrites tracked URLs; the extension never sees your traffic |
| Optional: all sites | Requested **only** when you switch on auto-strip or copy-cleaning. Revocable in Settings |

The extension pages run under a strict CSP (`default-src 'none'`, `connect-src 'none'`), so they cannot make network requests even if compromised.

## Dev

```bash
node --test tests/cleaner.test.js            # 23 unit tests
node tools/build-rules.js                    # regenerate rules/tracking.json from src/cleaner.js
node tools/build.js                          # build dist/chrome + dist/firefox and their zips
node tests/validate-builds.js                # static checks on both builds
NODE_PATH=<path to playwright> node tests/e2e.js   # 32 checks in real Chromium (EXT_DIR=dist/chrome to test the package)
```

One codebase, two manifests: the root `manifest.json` is the Chromium one and `tools/build.js` derives the Firefox one (event page instead of service worker, gecko id, no `offscreen`). The e2e suite runs in Chromium only; the Firefox build is covered by the static checks and a shared-code path test, and has not been run in a real Firefox yet, so smoke-test it there.

`src/cleaner.js` is the single source of truth. Add a tracker there, rebuild the rules, done.

Known limits: shortened links (`t.co`, `bit.ly`, `amzn.to`) can't be expanded without a network request, so they are left as-is by design. Automatic stripping can't use wildcards (a browser limitation); copy-time cleaning can.

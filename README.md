# Midori Privacy - Ad & Tracker Blocker

A lightweight, fast, and privacy-focused ad & tracker blocker for Chromium and Firefox browsers. Built from scratch by [Astian Inc](https://astian.org).

## Features

- **Ad blocking** using EasyList, uBlock Filters, and Peter Lowe's list
- **Tracker blocking** using EasyPrivacy and uBlock Privacy
- **Per-site toggle** — enable/disable protection on any website
- **Blocked requests list** — see what's being blocked on each tab, grouped by category
- **Privacy reports** — top tracked sites, blocking stats over 7/30/90 days, JSON export
- **Custom filter lists** — add any ABP-compatible filter list URL
- **Cosmetic filtering** — hides ad elements from pages
- **Auto-updating lists** — configurable interval (1h, 4h, 12h, 24h)
- **Dark mode** — automatic based on system preference
- **Local-only telemetry** — optional KPI metrics stay on-device and are never sent externally
- **Ultra lightweight** — < 25KB JS bundle (without filter lists)

## Supported Browsers

| Browser | Manifest | Blocking Method |
|---------|----------|-----------------|
| Chrome, Edge, Brave, Opera | MV3 | `declarativeNetRequest` (native) |
| Firefox | MV2 | `webRequest` (JS engine) |

See compatibility limits and feature viability notes in `docs/browser-compat-mv3-mv2.md`.

## Installation (Development)

```bash
git clone https://github.com/goastian/midori-privacy.git
cd midori-privacy
npm install
```

### Convert filter lists (required for Chromium)

```bash
npm run convert-lists
```

### Build

```bash
npm run build:chromium    # Build for Chrome/Edge/Brave
npm run build:firefox     # Build for Firefox
npm run dev               # Watch mode (Chromium)
npm run dev:firefox       # Watch mode (Firefox)
```

The built extension will be in the `dist/` directory.

### Load in Chrome

1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `dist/` folder

### Load in Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `dist/manifest.json`

## Project Structure

```
src/
├── manifest.chromium.json       # Manifest V3 (Chromium)
├── manifest.firefox.json        # Manifest V2 (Firefox)
├── background/
│   ├── index.js                 # Service worker (main entry)
│   ├── filter-engine.js         # ABP syntax parser & matcher
│   ├── lists-manager.js         # Filter list download & cache
│   ├── stats-collector.js       # Per-tab blocking statistics
│   ├── report-generator.js      # Privacy report generation
│   └── storage.js               # Storage abstraction
├── popup/
│   ├── popup.html / .css / .js  # Popup panel UI
├── options/
│   ├── options.html / .css / .js # Settings page UI
├── content/
│   └── cosmetic.js              # Element hiding (cosmetic rules)
├── shared/
│   └── styles.css               # Shared CSS variables & components
├── _locales/en/messages.json    # Localization
├── icons/                       # Extension icons
└── rules/                       # Generated DNR rules (Chromium only)
scripts/
├── build.js                     # esbuild-based build script
├── convert-lists.js             # ABP → DNR JSON converter
└── generate-icons.js            # PNG icon generator
```

## Filter Lists

| List | Source | Default |
|------|--------|---------|
| EasyList | easylist.to | Enabled |
| EasyPrivacy | easylist.to | Enabled |
| uBlock Filters | ublockorigin.github.io | Enabled |
| uBlock Privacy | ublockorigin.github.io | Enabled |
| Peter Lowe's | pgl.yoyo.org | Enabled |
| uBlock Annoyances (Cookies) | ublockorigin.github.io | Disabled |
| uBlock Annoyances (Other) | ublockorigin.github.io | Disabled |
| Fanboy's Social | easylist.to | Disabled |

## License

MPL-2.0 — Copyright 2024-present Astian Inc.

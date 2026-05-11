# Midori Privacy - Ad and Tracker Blocker

An ad and tracker blocker for Chromium and Firefox, focused on privacy,
performance, and user control.

Built by [Astian Inc](https://astian.org).

## Features

### Core protection

- Ad and tracker blocking with ABP-compatible lists (EasyList, EasyPrivacy,
  uBlock, Peter Lowe, and additional optional lists).
- Dual engine by browser:
  - Chromium (MV3): native rules via `declarativeNetRequest`.
  - Firefox (MV2): Ghostery engine on top of `webRequest`.
- Protection levels: `basic`, `standard`, and `strict` (setup wizard + popup).
- Per-site enable/disable protection (domain and subdomain whitelist support).
- Temporary pause for the current site with automatic resume.
- Per-category controls from popup (ads, trackers, fingerprinting).
- Entity-based blocking (owner/entity), with rollout controls.
- Vertical profiles by site type (`general`, `video`, `adult`, `ai`).

### Anti-breakage and hardening

- Safe-defaults policy to reduce false positives.
- First-party relaxation for compatible first-party CDNs.
- Critical first-party site list (mail, banking, government, etc.) where
  cosmetic/scriptlet injection is disabled to avoid breaking core features.
- Anti popup/popunder defense with burst, redirect, and gesture detection.
- Navigation URL cleaning to remove tracking parameters (`utm_*`, `fbclid`,
  `gclid`, `msclkid`, etc.) without blocking page load.

### IA Shield and anti-fingerprinting

- Optional IA Shield for AI hosts: prompt-injection pattern detection,
  suspicious payload sanitization, and local risk events.
- Configurable anti-fingerprinting with safeguards for sensitive sites.

### UI and observability

- Popup with real-time per-tab stats.
- Blocked count, estimated data savings, energy savings, and CO2 savings.
- Grouped blocked requests list (ads, trackers, other).
- Options page with:
  - Filter list management (core, annoyances, adguard, regional).
  - Custom filters and custom list URLs.
  - Whitelist and vertical-specific settings.
  - Reports and trends.
  - Experiment/rollout flags.
  - Local telemetry controls and reset.
- Privacy reports:
  - Top tracked sites.
  - 7/30/90-day stats.
  - Category distribution.
  - Hourly heatmap.
  - Weekly trend.
  - Applied-rules diagnostics.
  - JSON export.

### Telemetry and privacy

- Optional local-only telemetry (performance and quality KPIs), stored on
  device.
- Support for false-positive reporting and missed-ad reporting.
- No mandatory external data upload required to operate.

## Supported browsers

| Browser | Manifest | Blocking method |
|---------|----------|-----------------|
| Chrome, Edge, Brave, Opera | MV3 | `declarativeNetRequest` + content scripts |
| Firefox | MV2 | `webRequest` + Ghostery engine |

## Development setup

```bash
git clone https://github.com/goastian/midori-privacy.git
cd midori-privacy
npm install
```

## Commands

```bash
# Build
npm run build
npm run build:chromium
npm run build:firefox

# Watch mode
npm run dev
npm run dev:firefox

# DNR rule conversion for Chromium
npm run convert-lists

# ZIP packages in releases/
npm run package
npm run package:chromium
npm run package:firefox
```

## Load extension in browser

### Chromium

1. Go to `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked` and select `dist/`

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on`
3. Select `dist/manifest.json`

## Project structure

```text
src/
  manifest.chromium.json
  manifest.firefox.json
  _locales/
  background/
    index.js
    orchestrator.js
    ghostery-engine.js
    policy-engine.js
    popup-defense.js
    trackerdb.js
    trackerdb-dnr.js
    url-cleaner.js
    lists-manager.js
    stats-collector.js
    report-generator.js
    ia-shield.js
    telemetry.js
    messages/
  content/
    cosmetic.js
    scriptlets.js
  popup/
  options/
  setup/
  rules/
  shared/

scripts/
  build.js
  package.js
  convert-lists.js
  check-yt-rules.js
  inspect-rule.js
  generate-icons.js
```

## Filter lists

Core lists enabled by default:

- EasyList
- EasyPrivacy
- uBlock Filters
- uBlock Privacy
- uBlock Unbreak
- uBlock Quick Fixes
- Peter Lowe

Optional lists available:

- uBlock Annoyances (cookies/others)
- Fanboy Social and Fanboy Annoyance
- AdGuard (base, tracking, social, annoyances, spyware-firstparty, mobile)
- Regional (Spanish, Germany, France)
- Custom list URLs

## Additional documentation

- `docs/experiments.md`
- `docs/manual-tests-popup.md`
- `docs/improvement-plan-stability.md`

## License

MPL-2.0 - Copyright 2024-present Astian Inc.

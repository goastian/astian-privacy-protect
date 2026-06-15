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
wasm-pack --version
cargo --version
```

Run the extension build:

```sh
npm run build
```

Check the Rust core:

```sh
cd src/backend/rust
cargo check
```

Build the WASM package:

```sh
cd src/backend/rust
wasm-pack build --target web --release
```

## Rust Core Direction

The Rust crate is optimized for the extension use case:

- `adblock` `0.12.5`
- `single-thread` enabled for lower memory and faster matching
- release LTO, single codegen unit, size optimization, and aborting panics

See `docs/adblock-rust-migration.md` for the migration plan.

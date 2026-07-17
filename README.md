# Midori Privacy

Midori Privacy is Astian's browser protection extension. This repository now uses the complete [uBlock Origin](https://github.com/gorhill/uBlock) codebase and filtering engine, with Midori branding and a simpler default experience for everyday users.

The default popup keeps the primary decisions visible: protection status for the current site, blocked-request totals, reporting and settings. uBlock Origin's lists, logger, element tools, custom filters, dynamic rules and advanced settings remain available through progressive disclosure.

## Upstream base

- Repository: `gorhill/uBlock`
- Imported commit: `2ced2a67d229c7eebdba8a994f999d83a68b2f38`
- Imported on: 2026-07-17
- Upstream development version: `1.72.3.4`
- License: GPL-3.0; see [LICENSE.txt](LICENSE.txt)

Raymond Hill and the uBlock Origin contributors retain attribution for the upstream work. Midori-specific branding, packaging and UX changes are maintained by Astian, Inc.

## Product identity

| Target | Stable identity |
| --- | --- |
| Firefox MV2/MV3 | `midori-protection@astian.org` |
| Thunderbird | `midori-protection@astian.org` |
| Chromium MV2/MV3, Edge and Opera | `pimgloaejdgobcgjahbgippfilfdpcfa` |
| Safari wrapper | use bundle identifier `org.astian.midori-protection` |

Chromium-compatible browsers do not accept an email address as an extension ID. Their 32-letter ID is derived from the public key stored in the Chromium manifests. The email identifier is still present in the author/product metadata, while the committed key keeps the runtime ID stable across local and self-hosted builds. A web store can assign a different ID; if that happens, replace the manifest key with the public key issued for that store entry.

## Build

Requirements: Linux, Bash, Python 3, Node.js 22+, npm 11+, `make`, `jq` and `zip`.

### Midori and Firefox (priority target)

Midori must use the complete Firefox build. It runs the full uBlock Origin
`webRequest` engine, provides exact per-tab blocking counts and drives the
toolbar badge from those real counts.

```sh
npm run build:midori
```

The installable artifact is
`dist/build/midori-protection.firefox.xpi`. Do not use the Firefox MV3 build
for Midori: that target is kept only for experimental compatibility and its
declarative API cannot provide the same production diagnostics.

### Other full-engine targets

```sh
npm install
npm run build:chromium
npm run build:opera
npm run build:thunderbird
```

Experimental and secondary MV3 targets:

```sh
npm run build:mv3:chromium
npm run build:mv3:edge
npm run build:mv3:firefox
npm run build:mv3:safari
```

Build outputs are written under `dist/build/` with the `midori-protection` prefix. The normal Chromium/Firefox builds contain the complete uBlock Origin engine. MV3 builds use the upstream MV3 engine and declarative ruleset pipeline because those browsers impose different platform capabilities.

## Development checks

```sh
npm run lint
make chromium
make firefox
```

See [docs/MIDORI_MIGRATION.md](docs/MIDORI_MIGRATION.md) for the migration map, update workflow and packaging caveats.

## Upstream updates

The local repository keeps Astian's `origin` remote. Add or refresh the upstream remote with:

```sh
git remote add ublock-upstream https://github.com/gorhill/uBlock.git
git fetch ublock-upstream
```

Import upstream updates in a dedicated branch, then reapply and validate the Midori manifest, icon and popup changes listed in the migration document. Do not publish with uBlock Origin's official store identifiers.

## Privacy and support

The upstream engine runs locally and its Firefox manifests declare no required data collection. Review store disclosures and any Astian distribution/update services before publishing each target. For Midori product issues use the Astian repository; for upstream engine behavior, consult the [uBlock Origin documentation](https://github.com/gorhill/uBlock/wiki).

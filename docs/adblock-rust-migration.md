# adblock-rust Migration Plan

This project should become the practical successor of `goastian/midori-privacy`
with `brave/adblock-rust` as the blocking core. The migration is intentionally
incremental: keep the extension usable while Rust takes over the expensive path.

## Target

Use `adblock-rust` for:

- Network request matching.
- Cosmetic filtering.
- Resource replacements and redirect rules.
- Hosts syntax and uBlock Origin syntax extensions.
- Serialized or precompiled engine state when the extension can cache it safely.

Keep TypeScript responsible for:

- Browser extension lifecycle.
- WebRequest integration.
- Whitelist and per-site user settings.
- UI state, statistics, and diagnostics.
- List selection, updates, and policy decisions.

## Phase 1: Foundation

- Rename project metadata from the old Dot Shield identity to Midori Privacy.
- Add `adblock` as the Rust core dependency.
- Expose a minimal Rust/WASM matcher for testable network blocking.
- Make JS engine creation parallel and resilient to optional list failures.
- Document the architecture and migration contract.

## Phase 2: WASM Integration

- Build the Rust package with `wasm-pack build --target web --release`.
- Load the generated Rust package from the background thread or worker.
- Add a TypeScript adapter with this shape:

```ts
type BlockDecision = {
  matched: boolean
  redirectUrl?: string
  rewrittenUrl?: string
  filter?: string
}

type BlockingEngine = {
  name: string
  match(details: browser.webRequest.WebRequestDetails): BlockDecision
}
```

- Keep the existing JS engine behind the same interface as a fallback.
- Add small fixtures for ABP rules, exception rules, third-party rules, and
  resource types.

## Brave List Update Contract

The TypeScript layer now owns a Brave-inspired list catalog in
`src/backend/lists/catalog.ts`. The catalog keeps the required default list on
and maps existing settings toggles to explicit sources from:

- `brave/adblock-lists` for Brave-specific and unbreak rules.
- `brave/adblock-resources/filter_lists/list_catalog.json` as the source model
  for default, social, annoyances, malware and URL tracking categories.
- Community upstreams used by Brave, including EasyList, EasyPrivacy and uBlock
  Origin assets.
- Midori legacy lists only where there is no selected Brave-equivalent category
  yet, such as fake news, gambling and IP grabbers.

List text is refreshed by the engine worker through CacheStorage with a 12 hour
TTL. A failed optional list update only disables that category for the current
compile when no cached copy exists. When a cached copy exists, the worker falls
back to stale cache and reports the status to the popup. Settings exposes a
manual `Update filter lists now` action that forces a refresh.

Next Rust-facing list work:

- Consume `brave/adblock-resources/dist/resources.json` so redirect resources and
  scriptlets can be passed to `adblock-rust` instead of staying JS-only.
- Add a generated regional-list slice from Brave's catalog, enabled by locale and
  user selection.
- Cache serialized Rust engine state once the WASM adapter owns network matching.

## Phase 3: Performance

- Compile the common list once and cache the serialized engine.
- Load optional lists as separate engine shards only when the user enables them.
- Measure:
  - cold compile time,
  - warm load time,
  - median match time,
  - memory use after startup,
  - number of blocked requests per tab.
- Keep `single-thread` enabled unless a browser integration requires sharing the
  engine across threads.

## Phase 4: Strong Blocking

- Move cosmetic queries to Rust where the API supports the needed selectors.
- Add resource replacement support for scriptlets and redirect rules.
- Add dedicated coverage for YouTube and other streaming surfaces using adaptive
  scriptlets in the extension layer, not brittle fixed selectors alone.
- Add diagnostics so blocked requests can be inspected without exposing private
  browsing data.

## Phase 5: Midori Integration

- Keep the extension build as a portable release path.
- Prepare the Rust crate so Midori can embed it directly later.
- Keep browser-specific glue outside the Rust crate.
- Version the Rust API surface before deeper browser integration.

## Stability Rules

- The common ads-and-trackers list is required.
- Optional lists must fail closed for that category only, not for the whole
  blocker.
- Whitelist checks stay outside the engine so user intent wins quickly.
- Main-frame matches redirect to the blocked page; subresource matches cancel or
  redirect according to the engine decision.
- Every migration step needs a fixture or command that proves blocking still
  works.

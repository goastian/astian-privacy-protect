/// <reference types="web-ext-types"/>

import { parse } from 'psl'
import { FiltersEngine, Request, RequestType } from '@ghostery/adblocker'

import { PermStore } from './permStore'
import { Settings } from './settings'
import { sleep } from './tempPort'
import { RequestListenerArgs } from './types'
import { defineFn, initFn } from './lib/remoteFunctions'
import { BackendState } from '../constants/state'
import { getFilterListLabels } from './lists/catalog'
import initRustAdblock, {
  engine_name as getRustEngineName,
  MidoriAdblockEngine,
} from './rust/pkg/midori_privacy_adblock_core'

// let wasm = require('./rust/pkg')

// Load the engineCreator webworker
const engineCreator = new Worker(new URL('./engineCreator.js', import.meta.url))

// ================
// User settings
const settings = new Settings()

// ================
// Data collection
const adsOnTabs = {}
const blockedEventsOnTabs: Record<number, BlockedRequestEvent[]> = {}
const ltBlocked = new PermStore('longTermBlockList', {})
const BADGE_BACKGROUND_COLOR = '#0f9d7a'
const MAX_BADGE_COUNT = 999
const MAX_TAB_BLOCKED_EVENTS = 250
const BLOCKED_REQUEST_TIME_SAVED_MS = 3 * 1000
const BLOCKED_REQUEST_BANDWIDTH_SAVED_BYTES = 45 * 1024
const ADBLOCK_RUST_REV = '5d182e5fb88a71ee456a6b57be8235cc8a642bee'
const RUST_ENGINE_CACHE_NAME = 'midori-privacy-rust-engine-v1'
const RUST_ENGINE_CACHE_SCHEMA = 'v1'

// ===============
// Blocking engine
let engines: { name: string; engine: FiltersEngine }[]
let engineLoadMs = 0
let filterListStates: FilterListLoadState[] = []
let filterListsUpdatedAt = 0

type SerializedEngineResponse = {
  engines: { name: string; engine: Uint8Array }[]
  rustRules: string
  rustResourcesJson: string
  listStates: FilterListLoadState[]
  updatedAt: number
  error?: string
}

type FilterListLoadState = {
  title: string
  url: string
  source: 'network' | 'cache' | 'stale-cache' | 'error'
  listId?: string
  listName?: string
  shard?: string
  required?: boolean
  format?: string
  updatedAt: number
  ageMs?: number
  error?: string
}

type BlockedRequestReason =
  | 'network'
  | 'rust-network'
  | 'rust-cosmetic'
  | 'streaming-cosmetic'
  | 'youtube-cosmetic'
  | 'content-cosmetic'
  | 'unknown'

type BlockedRequestEvent = {
  url: string
  count: number
  reason: BlockedRequestReason
  blocker: string
  category:
    | 'ads'
    | 'trackers'
    | 'fingerprinters'
    | 'cosmetics'
    | 'pages'
    | 'other'
  requestType?: string
  blockedAt: number
  timeSavedMs: number
  bandwidthSavedBytes: number
}

type CosmeticRequestPayload = {
  url: string
  hostname: string
  domain: string
}

type RustCosmeticRequestPayload = CosmeticRequestPayload & {
  classes?: string[]
  ids?: string[]
  exceptions?: string[]
}

type RustCosmeticResources = {
  hideSelectors: string[]
  stylesheet: string
  proceduralActions: string[]
  exceptions: string[]
  injectedScript: string
  generichide: boolean
}

type RustGenericCosmeticResources = {
  hideSelectors: string[]
  stylesheet: string
}

const EMPTY_RUST_COSMETIC_RESOURCES: RustCosmeticResources = {
  hideSelectors: [],
  stylesheet: '',
  proceduralActions: [],
  exceptions: [],
  injectedScript: '',
  generichide: false,
}

const EMPTY_RUST_GENERIC_COSMETIC_RESOURCES: RustGenericCosmeticResources = {
  hideSelectors: [],
  stylesheet: '',
}

// =================
// Blocking related variable
const whitelist = new PermStore('whitelist', [])

// =================
// State code
let state = BackendState.Loading
let rustWasmReady: Promise<void> | undefined
let rustEngine: MidoriAdblockEngine | undefined
let rustEngineRuleCount = 0
let rustEngineResourceCount = 0
let rustEngineLoadError = ''
let rustEngineName = 'adblock-rust'

type RustNetworkDecision = {
  matched: boolean
  redirect?: string
  rewrittenUrl?: string
  filter?: string
}

type BlockingDecision = {
  matched: boolean
  redirectUrl?: string
  rewrittenUrl?: string
  filter?: string
  source: 'rust' | 'ghostery'
  engineName: string
}

type BlockingEngineAdapter = {
  name: string
  source: BlockingDecision['source']
  match: (details: RequestListenerArgs) => BlockingDecision | undefined
}

type RustEngineCacheStatus =
  | 'disabled'
  | 'hit'
  | 'miss'
  | 'stored'
  | 'error'
  | 'empty'

type CosmeticStats = {
  hiddenSelectors: number
  proceduralActions: number
  scriptlets: number
  rejectedStyleActions: number
  cappedProceduralFilters: number
}

const EMPTY_COSMETIC_STATS: CosmeticStats = {
  hiddenSelectors: 0,
  proceduralActions: 0,
  scriptlets: 0,
  rejectedStyleActions: 0,
  cappedProceduralFilters: 0,
}

let rustEngineCacheStatus: RustEngineCacheStatus = 'empty'
let rustEngineCacheKey = ''
let rustEngineCacheHits = 0
let rustEngineCacheMisses = 0
let rustEngineSerializedBytes = 0
let rustEngineBuildMs = 0
let requestDecisionCount = 0
let requestDecisionTotalMs = 0
let requestDecisionMaxMs = 0
let cosmeticStats = { ...EMPTY_COSMETIC_STATS }

// =================
// Blocking code
const getHostname = (url = '') => {
  try {
    return new URL(url).hostname
  } catch {
    return url.replace('https://', '').replace('http://', '').split('/')[0]
  }
}

const getDomain = (url = '') => {
  const hostname = getHostname(url)
  if (!hostname) return ''
  const parsed = parse(hostname)
  return 'domain' in parsed ? parsed.domain || hostname : hostname
}

const getSourceUrl = (details: RequestListenerArgs) =>
  details.originUrl || details.documentUrl || details.initiator || details.url

const getWhitelistDomain = (details: RequestListenerArgs) =>
  details.type === 'main_frame'
    ? getDomain(details.url)
    : getDomain(getSourceUrl(details))

// First-party Astian ad infrastructure. Requests to these domains (the ad
// feed, creatives, click/impression endpoints served from astian.org) must
// never be blocked so the ads shown in midori-tab / astiango always reach the
// user, regardless of which wallpaper source the user picked.
const TRUSTED_AD_DOMAINS = ['astian.org']

const isTrustedAdHost = (hostname: string): boolean => {
  if (!hostname) return false
  const host = hostname.toLowerCase()
  return TRUSTED_AD_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  )
}

const initRustWasm = async () => {
  if (!rustWasmReady) {
    rustWasmReady = initRustAdblock().then(() => {
      rustEngineName = getRustEngineName()
    })
  }

  await rustWasmReady
}

const supportsCacheApi = () => typeof caches !== 'undefined'

const cacheUrlForRustEngine = (key: string) =>
  `https://midori.local/rust-engine/${encodeURIComponent(key)}.bin`

const hashText = async (value: string) => {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const countRustRules = (rules: string) =>
  rules
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('!')).length

const buildRustEngineCacheKey = async (
  rules: string,
  resourcesJson: string,
  listStates: FilterListLoadState[]
) => {
  const version = browser.runtime.getManifest().version
  const sourceState = listStates.map(({ url, updatedAt, source }) => ({
    url,
    updatedAt,
    source,
  }))
  const hash = await hashText(
    JSON.stringify({
      schema: RUST_ENGINE_CACHE_SCHEMA,
      adblockRustRev: ADBLOCK_RUST_REV,
      version,
      sourceState,
      rules,
      resourcesJson,
    })
  )

  return `${RUST_ENGINE_CACHE_SCHEMA}-${ADBLOCK_RUST_REV.slice(
    0,
    12
  )}-${version}-${hash}`
}

const readCachedRustEngine = async (key: string) => {
  if (!supportsCacheApi()) return undefined

  const cache = await caches.open(RUST_ENGINE_CACHE_NAME)
  const response = await cache.match(cacheUrlForRustEngine(key))
  if (!response) return undefined

  return new Uint8Array(await response.arrayBuffer())
}

const writeCachedRustEngine = async (key: string, serialized: Uint8Array) => {
  if (!supportsCacheApi()) return

  const cache = await caches.open(RUST_ENGINE_CACHE_NAME)
  const body = new ArrayBuffer(serialized.byteLength)
  new Uint8Array(body).set(serialized)
  await cache.put(
    cacheUrlForRustEngine(key),
    new Response(body, {
      headers: {
        'content-type': 'application/octet-stream',
        'x-midori-adblock-rust-rev': ADBLOCK_RUST_REV,
        'x-midori-cache-schema': RUST_ENGINE_CACHE_SCHEMA,
        'x-midori-created-at': String(Date.now()),
      },
    })
  )
}

const rebuildRustEngine = async (
  rules: string,
  resourcesJson: string,
  listStates: FilterListLoadState[] = [],
  forceRefresh = false
) => {
  if (rustEngine) {
    rustEngine.free()
    rustEngine = undefined
  }

  rustEngineRuleCount = 0
  rustEngineResourceCount = 0
  rustEngineLoadError = ''
  rustEngineCacheStatus = supportsCacheApi() ? 'empty' : 'disabled'
  rustEngineCacheKey = ''
  rustEngineSerializedBytes = 0
  rustEngineBuildMs = 0

  if (!rules.trim()) return

  try {
    await initRustWasm()
    const buildStart = performance.now()
    const ruleCount = countRustRules(rules)
    const cacheKey = await buildRustEngineCacheKey(
      rules,
      resourcesJson || '[]',
      listStates
    )
    rustEngineCacheKey = cacheKey

    const cached =
      forceRefresh || !supportsCacheApi()
        ? undefined
        : await readCachedRustEngine(cacheKey)

    if (cached?.length) {
      rustEngine = MidoriAdblockEngine.from_serialized(
        cached,
        resourcesJson || '[]',
        ruleCount
      )
      rustEngineCacheHits += 1
      rustEngineCacheStatus = 'hit'
      rustEngineSerializedBytes = cached.length
    } else {
      rustEngineCacheMisses += 1
      rustEngineCacheStatus = supportsCacheApi() ? 'miss' : 'disabled'
      rustEngine = new MidoriAdblockEngine(rules, resourcesJson || '[]')
      const serialized = rustEngine.serialize()
      rustEngineSerializedBytes = serialized.length
      await writeCachedRustEngine(cacheKey, serialized)
      if (supportsCacheApi()) rustEngineCacheStatus = 'stored'
    }

    rustEngineRuleCount = rustEngine.rule_count()
    rustEngineResourceCount = rustEngine.resource_count()
    rustEngineBuildMs = Math.round(performance.now() - buildStart)
  } catch (error) {
    rustEngineLoadError = error instanceof Error ? error.message : String(error)
    rustEngineCacheStatus = 'error'
  }
}

const getRustDecision = (
  details: RequestListenerArgs
): RustNetworkDecision | undefined => {
  if (!rustEngine) return undefined

  try {
    return JSON.parse(
      rustEngine.network_decision_json(
        details.url,
        getSourceUrl(details),
        details.type
      )
    ) as RustNetworkDecision
  } catch {
    return undefined
  }
}

const rustBlockingEngine: BlockingEngineAdapter = {
  name: rustEngineName,
  source: 'rust',
  match: (details) => {
    const rustDecision = getRustDecision(details)
    if (!rustDecision) return undefined

    return {
      matched: Boolean(rustDecision.matched),
      redirectUrl: rustDecision.redirect,
      rewrittenUrl:
        rustDecision.rewrittenUrl && rustDecision.rewrittenUrl !== details.url
          ? rustDecision.rewrittenUrl
          : undefined,
      filter: rustDecision.filter,
      source: 'rust',
      engineName: rustEngineName,
    }
  },
}

const createGhosteryBlockingEngine = (
  name: string,
  engine: FiltersEngine
): BlockingEngineAdapter => ({
  name,
  source: 'ghostery',
  match: (details) => {
    const request = Request.fromRawDetails({
      requestId: details.requestId,
      tabId: details.tabId,
      url: details.url,
      sourceUrl: getSourceUrl(details),
      type: details.type as RequestType,
      _originalRequestDetails: details,
    })
    const { match } = engine.match(request)

    if (!match) return undefined

    return {
      matched: true,
      source: 'ghostery',
      engineName: name,
    }
  },
})

const matchBlockingEngines = (
  details: RequestListenerArgs
): BlockingDecision | undefined => {
  const rustDecision = rustBlockingEngine.match(details)
  if (rustDecision?.matched || rustDecision?.rewrittenUrl) return rustDecision

  for (let i = 0; i < engines.length; i++) {
    const decision = createGhosteryBlockingEngine(
      engines[i].name,
      engines[i].engine
    ).match(details)
    if (decision?.matched) return decision
  }

  return rustDecision
}

const recordRequestDecisionTiming = (startedAt: number) => {
  const elapsed = performance.now() - startedAt
  requestDecisionCount += 1
  requestDecisionTotalMs += elapsed
  requestDecisionMaxMs = Math.max(requestDecisionMaxMs, elapsed)
}

const classifyBlockedRequest = (
  url: string,
  reason: BlockedRequestReason,
  requestType?: string
): BlockedRequestEvent['category'] => {
  if (requestType === 'main_frame') return 'pages'
  if (reason.includes('cosmetic')) return 'cosmetics'

  const haystack = `${url} ${reason}`.toLowerCase()
  if (
    haystack.includes('fingerprint') ||
    haystack.includes('fingerprinting') ||
    haystack.includes('canvas')
  ) {
    return 'fingerprinters'
  }

  if (
    haystack.includes('track') ||
    haystack.includes('analytics') ||
    haystack.includes('telemetry') ||
    haystack.includes('beacon') ||
    haystack.includes('pixel')
  ) {
    return 'trackers'
  }

  if (
    haystack.includes('ad') ||
    haystack.includes('ads') ||
    haystack.includes('doubleclick') ||
    haystack.includes('googlesyndication') ||
    haystack.includes('imasdk')
  ) {
    return 'ads'
  }

  return 'other'
}

const getBlockerName = (reason: BlockedRequestReason, engineMatch = '') => {
  if (engineMatch) return engineMatch
  if (reason === 'youtube-cosmetic') return 'YouTube cosmetic blocker'
  if (reason === 'streaming-cosmetic') return 'Streaming cosmetic blocker'
  if (reason === 'rust-cosmetic') return 'adblock-rust cosmetics'
  if (reason === 'content-cosmetic') return 'Content cosmetic blocker'
  if (reason === 'rust-network') return rustEngineName
  return 'Ghostery fallback'
}

const recordBlockedRequest = (
  tabId: number,
  url: string,
  count = 1,
  metadata: {
    reason?: BlockedRequestReason
    blocker?: string
    requestType?: string
  } = {}
) => {
  if (tabId < 0 || count <= 0) return

  if (typeof adsOnTabs[tabId] === 'undefined') {
    adsOnTabs[tabId] = []
  }

  if (typeof blockedEventsOnTabs[tabId] === 'undefined') {
    blockedEventsOnTabs[tabId] = []
  }

  for (let i = 0; i < count; i++) {
    adsOnTabs[tabId].push(url)
  }

  const reason = metadata.reason || 'unknown'
  blockedEventsOnTabs[tabId].push({
    url,
    count,
    reason,
    blocker: metadata.blocker || getBlockerName(reason),
    category: classifyBlockedRequest(url, reason, metadata.requestType),
    requestType: metadata.requestType,
    blockedAt: Date.now(),
    timeSavedMs: count * BLOCKED_REQUEST_TIME_SAVED_MS,
    bandwidthSavedBytes: count * BLOCKED_REQUEST_BANDWIDTH_SAVED_BYTES,
  })

  if (blockedEventsOnTabs[tabId].length > MAX_TAB_BLOCKED_EVENTS) {
    blockedEventsOnTabs[tabId] = blockedEventsOnTabs[tabId].slice(
      -MAX_TAB_BLOCKED_EVENTS
    )
  }

  const currentDate = new Date().toISOString().slice(0, 10)

  if (typeof ltBlocked.data[currentDate] == 'undefined') {
    ltBlocked.data[currentDate] = 0
  }
  ltBlocked.data[currentDate] += count
  ltBlocked.storeData()
  updateBlockedBadge(tabId)
}

const formatBadgeCount = (count: number) => {
  if (count <= 0) return ''
  if (count > MAX_BADGE_COUNT) return `${MAX_BADGE_COUNT}+`
  return String(count)
}

const getTabBlockedCount = (tabId: number) => adsOnTabs[tabId]?.length || 0

const updateBlockedBadge = (tabId: number) => {
  if (tabId < 0 || !browser.browserAction) return

  try {
    browser.browserAction.setBadgeText({
      tabId,
      text: formatBadgeCount(getTabBlockedCount(tabId)),
    })
  } catch {
    // Ignore stale tab races while the browser is closing or navigating.
  }
}

const clearBlockedBadge = (tabId: number) => {
  if (tabId < 0 || !browser.browserAction) return

  try {
    browser.browserAction.setBadgeText({ tabId, text: '' })
  } catch {
    // Ignore stale tab races while the browser is closing or navigating.
  }
}

const initBadge = () => {
  if (!browser.browserAction) return

  try {
    browser.browserAction.setBadgeBackgroundColor({
      color: BADGE_BACKGROUND_COLOR,
    })
  } catch {
    // Badge APIs can be unavailable in constrained extension contexts.
  }
}

const createEngine: (
  forceRefresh?: boolean
) => Promise<SerializedEngineResponse> = (forceRefresh = false) =>
  // eslint-disable-next-line no-async-promise-executor
  new Promise(async (resolve) => {
    await settings.checkLoad()

    engineCreator.onmessage = (engine) =>
      resolve(engine.data as SerializedEngineResponse)
    engineCreator.postMessage({ settings: settings.data, forceRefresh })
  })

/**
 * The listener for webRequests. Blocks matching requests and records stats.
 * @param details The request info, provided by the requestHandler
 */
const requestHandler = (details: RequestListenerArgs) => {
  const decisionStart = performance.now()

  // Never block first-party Astian ad infrastructure. Ads delivered through
  // midori-tab / astiango must always reach the user.
  if (isTrustedAdHost(getHostname(details.url))) {
    recordRequestDecisionTiming(decisionStart)
    return
  }

  // Check if the site is contained in the whitelist.
  const whitelistDomain = getWhitelistDomain(details)
  if (whitelistDomain && whitelist.data.indexOf(whitelistDomain) !== -1) {
    recordRequestDecisionTiming(decisionStart)
    return
  }

  const decision = matchBlockingEngines(details)
  const hasMatch = Boolean(decision?.matched)
  let redirectUrl = decision?.redirectUrl || ''
  const rewrittenUrl = decision?.rewrittenUrl || ''

  if (!hasMatch && rewrittenUrl) {
    recordRequestDecisionTiming(decisionStart)
    return { redirectUrl: rewrittenUrl }
  }

  // Return if it hasn't got a match
  if (!hasMatch) {
    recordRequestDecisionTiming(decisionStart)
    return
  }

  if (details.type !== 'main_frame') {
    // Subresource replacements from adblock-rust keep brittle sites working:
    // redirect rules replace a bad resource with a safe noop instead of
    // cancelling the request outright.
    if (redirectUrl) {
      recordBlockedRequest(details.tabId, details.url, 1, {
        reason: decision?.source === 'rust' ? 'rust-network' : 'network',
        blocker: decision?.engineName,
        requestType: details.type,
      })
      recordRequestDecisionTiming(decisionStart)
      return { redirectUrl }
    }
  } else {
    // Otherwise it should use a regular URL
    const domain = getDomain(details.url)
    if (whitelist.data.indexOf(domain) !== -1) {
      recordRequestDecisionTiming(decisionStart)
      return
    }

    // If it hasn't returned, this is a webpage that has been navigated to by the
    // user and we should show a blocked screen
    redirectUrl = `${browser.runtime.getURL('blocked.html')}?url=${
      details.url
    }&list=${decision?.engineName || ''}`
  }

  recordBlockedRequest(details.tabId, details.url, 1, {
    reason: decision?.source === 'rust' ? 'rust-network' : 'network',
    blocker: decision?.engineName,
    requestType: details.type,
  })

  recordRequestDecisionTiming(decisionStart)
  if (redirectUrl) {
    return { redirectUrl }
  } else if (rewrittenUrl) {
    return { redirectUrl: rewrittenUrl }
  } else {
    return { cancel: true }
  }
}

/**
 * Adds the event listener for blocking requests
 */
const init = async () => {
  // Set the state to loading
  state = BackendState.Loading

  // Wait for storage objects to load
  await whitelist.load()
  await settings.load()

  await rebuildEngines(false)
}

const rebuildEngines = async (forceRefresh = false) => {
  close()

  // Disable if enabled isn't set properly
  if (!settings.data.enabled) {
    engines = []
    filterListStates = []
    filterListsUpdatedAt = 0
    await rebuildRustEngine('', '[]')
    state = BackendState.Idle
    return
  }

  const engineLoadStart = performance.now()
  const engineResponse = await createEngine(forceRefresh)
  const serializeEngine = engineResponse.engines || []
  filterListStates = engineResponse.listStates || []
  filterListsUpdatedAt = engineResponse.updatedAt || Date.now()

  engines = serializeEngine.map((engine) => ({
    name: engine.name,
    engine: FiltersEngine.deserialize(engine.engine),
  }))
  await rebuildRustEngine(
    engineResponse.rustRules || '',
    engineResponse.rustResourcesJson || '[]',
    filterListStates,
    forceRefresh
  )
  engineLoadMs = Math.round(performance.now() - engineLoadStart)

  browser.webRequest.onBeforeRequest.addListener(
    requestHandler,
    { urls: ['<all_urls>'] },
    ['blocking']
  )

  // Set state to idle
  state = BackendState.Idle
}

/**
 * Removes the event listener for blocking requests
 */
const close = () => {
  browser.webRequest.onBeforeRequest.removeListener(requestHandler)
}

// =================
// External interactions

// Removes an entry from the whitelist. Used by the popup
defineFn('removeFromWhitelist', async (site: string) => {
  whitelist.data = whitelist.data.filter((value) => value != site)
  // The whitelist is sent back to update the UI
  return whitelist.data
})

// Adds an entry to the whitelist. Used by the popup
defineFn('addToWhitelist', async (site: string) => {
  whitelist.data.push(site)
  // The whitelist is sent back to update the UI
  return whitelist.data
})

// Returns the whitelist for a UI (like the popup to use)
defineFn('getWhitelist', async () => whitelist.data)

// Gets all of the ads on active tabs so that a UI (like the popup) can render them
defineFn('getAds', async () => adsOnTabs)

// Restart the backend. Used by the settings ui when changes are made to settings
defineFn('reloadBackend', async () => {
  close()
  init()
})

defineFn('refreshFilterLists', async () => {
  state = BackendState.Loading
  await whitelist.load()
  await settings.load()
  await rebuildEngines(true)

  return getProtectionSummaryData()
})

// Define a function that can be used to pull the long term statistics for displaying
// in the statistics page
defineFn('getLongTermStats', async () => ltBlocked.data)

defineFn('getRustCosmeticResources', async (payload) => {
  if (!rustEngine) return EMPTY_RUST_COSMETIC_RESOURCES

  const { url } = payload as RustCosmeticRequestPayload
  if (!url) return EMPTY_RUST_COSMETIC_RESOURCES

  try {
    return JSON.parse(rustEngine.cosmetic_resources_json(url))
  } catch {
    return EMPTY_RUST_COSMETIC_RESOURCES
  }
})

defineFn('getRustGenericCosmetics', async (payload) => {
  if (!rustEngine) return EMPTY_RUST_GENERIC_COSMETIC_RESOURCES

  const {
    classes = [],
    ids = [],
    exceptions = [],
  } = payload as RustCosmeticRequestPayload

  if (!classes.length && !ids.length)
    return EMPTY_RUST_GENERIC_COSMETIC_RESOURCES

  try {
    return JSON.parse(
      rustEngine.generic_selectors_json(
        JSON.stringify(classes),
        JSON.stringify(ids),
        JSON.stringify(exceptions)
      )
    )
  } catch {
    return EMPTY_RUST_GENERIC_COSMETIC_RESOURCES
  }
})

// Function for getting the current state
// Can be used in the UI to show when the addon is loading
defineFn('getState', async () => state)

// Get the total number of trackers blocked
defineFn('getAllTrackersBlocked', async () => {
  let totalBlocked = 0

  for (const key in ltBlocked.data) {
    const blocked = ltBlocked.data[key]
    totalBlocked += blocked
  }

  return totalBlocked
})

defineFn('getProtectionSummary', async () => {
  if (typeof engines === 'undefined') {
    await waitForDynamic(() => (state === BackendState.Idle ? true : undefined))
  }

  return getProtectionSummaryData()
})

defineFn('getStatsSummary', async (payload) =>
  getStatsSummaryData(
    typeof payload === 'object' && payload !== null
      ? (payload as { days?: number })
      : {}
  )
)

function getProtectionSummaryData() {
  return {
    state,
    engineLoadMs,
    engineCount: engines?.length || 0,
    engineNames: engines?.map((engine) => engine.name) || [],
    enabled: settings.data.enabled,
    lists: getFilterListLabels(settings.data.lists),
    filterListStates,
    filterListsUpdatedAt,
    rustEngineRuleCount,
    rustEngineResourceCount,
    rustEngineLoadError,
    rustEngineCache: {
      status: rustEngineCacheStatus,
      key: rustEngineCacheKey,
      hits: rustEngineCacheHits,
      misses: rustEngineCacheMisses,
      serializedBytes: rustEngineSerializedBytes,
      buildMs: rustEngineBuildMs,
      adblockRustRev: ADBLOCK_RUST_REV,
    },
    requestPath: {
      decisions: requestDecisionCount,
      averageMs:
        requestDecisionCount > 0
          ? Number((requestDecisionTotalMs / requestDecisionCount).toFixed(3))
          : 0,
      maxMs: Number(requestDecisionMaxMs.toFixed(3)),
    },
    listHealth: summarizeListHealth(filterListStates),
    cosmeticStats,
    core: rustEngine
      ? `${rustEngineName} primary + Ghostery network fallback`
      : 'Ghostery fallback; adblock-rust unavailable',
  }
}

function summarizeListHealth(states: FilterListLoadState[]) {
  const summary = {
    total: states.length,
    network: 0,
    cache: 0,
    staleCache: 0,
    error: 0,
    byShard: {} as Record<
      string,
      {
        total: number
        network: number
        cache: number
        staleCache: number
        error: number
      }
    >,
  }

  states.forEach((state) => {
    if (state.source === 'network') summary.network += 1
    if (state.source === 'cache') summary.cache += 1
    if (state.source === 'stale-cache') summary.staleCache += 1
    if (state.source === 'error') summary.error += 1

    const shard =
      typeof (state as FilterListLoadState & { shard?: string }).shard ===
      'string'
        ? (state as FilterListLoadState & { shard: string }).shard
        : 'unassigned'

    summary.byShard[shard] ||= {
      total: 0,
      network: 0,
      cache: 0,
      staleCache: 0,
      error: 0,
    }
    summary.byShard[shard].total += 1
    if (state.source === 'network') summary.byShard[shard].network += 1
    if (state.source === 'cache') summary.byShard[shard].cache += 1
    if (state.source === 'stale-cache') summary.byShard[shard].staleCache += 1
    if (state.source === 'error') summary.byShard[shard].error += 1
  })

  return summary
}

function recordCosmeticStats(next: Partial<CosmeticStats>) {
  cosmeticStats = {
    hiddenSelectors:
      cosmeticStats.hiddenSelectors + Number(next.hiddenSelectors || 0),
    proceduralActions:
      cosmeticStats.proceduralActions + Number(next.proceduralActions || 0),
    scriptlets: cosmeticStats.scriptlets + Number(next.scriptlets || 0),
    rejectedStyleActions:
      cosmeticStats.rejectedStyleActions +
      Number(next.rejectedStyleActions || 0),
    cappedProceduralFilters:
      cosmeticStats.cappedProceduralFilters +
      Number(next.cappedProceduralFilters || 0),
  }
}

function sumLongTermBlocked(days = 7) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - Math.max(days - 1, 0))
  cutoff.setHours(0, 0, 0, 0)

  let totalBlocked = 0
  let todayBlocked = 0
  const today = new Date().toISOString().slice(0, 10)

  for (const key in ltBlocked.data) {
    const value = Number(ltBlocked.data[key]) || 0
    if (key === today) todayBlocked += value
    if (new Date(`${key}T00:00:00`).getTime() >= cutoff.getTime()) {
      totalBlocked += value
    }
  }

  return { totalBlocked, todayBlocked }
}

function summarizeEvents(events: BlockedRequestEvent[]) {
  const categories = {
    ads: 0,
    trackers: 0,
    fingerprinters: 0,
    cosmetics: 0,
    pages: 0,
    other: 0,
  }
  const blockers: Record<string, number> = {}

  events.forEach((event) => {
    categories[event.category] += event.count
    blockers[event.blocker] = (blockers[event.blocker] || 0) + event.count
  })

  return {
    categories,
    blockers: Object.entries(blockers)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  }
}

async function getActiveTabId() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true })
    return tabs[0]?.id
  } catch {
    return undefined
  }
}

async function getStatsSummaryData(payload: { days?: number } = {}) {
  if (typeof engines === 'undefined') {
    await waitForDynamic(() => (state === BackendState.Idle ? true : undefined))
  }

  const protectionSummary = getProtectionSummaryData()
  const days = Number(payload.days) || 7
  const { totalBlocked, todayBlocked } = sumLongTermBlocked(days)
  const activeTabId = await getActiveTabId()
  const tabEvents =
    typeof activeTabId === 'number'
      ? blockedEventsOnTabs[activeTabId] || []
      : []
  const allSessionEvents = Object.values(blockedEventsOnTabs).flat()
  const eventSummary = summarizeEvents(
    tabEvents.length ? tabEvents : allSessionEvents
  )
  const blockerCounts = new Map(
    eventSummary.blockers.map((blocker) => [blocker.name, blocker.count])
  )
  const activeBlockerNames = [
    rustEngine ? rustEngineName : '',
    ...protectionSummary.engineNames,
    rustEngineResourceCount ? 'adblock-rust resources' : '',
  ].filter(Boolean)
  const blockers = Array.from(new Set(activeBlockerNames)).map((name) => ({
    name,
    count: blockerCounts.get(name) || 0,
  }))

  return {
    ...protectionSummary,
    available: true,
    days,
    totalBlocked,
    todayBlocked,
    tabBlocked: tabEvents.reduce((total, event) => total + event.count, 0),
    sessionBlocked: allSessionEvents.reduce(
      (total, event) => total + event.count,
      0
    ),
    categories: eventSummary.categories,
    blockers: blockers.length ? blockers : eventSummary.blockers,
    timeSavedMs: totalBlocked * BLOCKED_REQUEST_TIME_SAVED_MS,
    bandwidthSavedBytes: totalBlocked * BLOCKED_REQUEST_BANDWIDTH_SAVED_BYTES,
    privacyGrade: settings.data.enabled ? 'A+' : 'Off',
    recent: allSessionEvents
      .slice(-8)
      .reverse()
      .map(({ url, blocker, category, count, blockedAt }) => ({
        url,
        blocker,
        category,
        count,
        blockedAt,
      })),
  }
}

// Start listening for function calls defined by defineFn. Note that these function
// calls are intended to be used from a separate thread, hence why they are
// more complicated to define
initFn()

// Code to clean up the adsOnTabs variable. This will discard tabs that have been
// deleted or have changed their url
const resetTabBlockedState = (tabId: number) => {
  if (typeof adsOnTabs[tabId] !== 'undefined') {
    delete adsOnTabs[tabId]
  }
  if (typeof blockedEventsOnTabs[tabId] !== 'undefined') {
    delete blockedEventsOnTabs[tabId]
  }
  clearBlockedBadge(tabId)
}

const tabRemoved = (tabId: number) => {
  resetTabBlockedState(tabId)
}

const tabUpdated = (params: { tabId: number; frameId?: number }) => {
  if (params.frameId !== 0) return

  const { tabId } = params
  resetTabBlockedState(tabId)
}

browser.tabs.onRemoved.addListener(tabRemoved)
browser.webNavigation.onBeforeNavigate.addListener(tabUpdated)
const handleRuntimeMessage = (message, sender) => {
  if (message?.action === 'get-stats-summary') {
    return getStatsSummaryData({ days: message.days })
  }

  if (message?.type !== 'midori.contentBlock') return false

  const tabId = sender.tab?.id
  if (typeof tabId !== 'number') return false

  if (message.cosmeticStats && typeof message.cosmeticStats === 'object') {
    recordCosmeticStats(message.cosmeticStats as Partial<CosmeticStats>)
  }

  recordBlockedRequest(
    tabId,
    typeof message.url === 'string' ? message.url : sender.tab?.url || '',
    typeof message.count === 'number' ? message.count : 1,
    {
      reason:
        typeof message.reason === 'string'
          ? (message.reason as BlockedRequestReason)
          : 'content-cosmetic',
    }
  )

  return false
}

browser.runtime.onMessage.addListener(handleRuntimeMessage)
browser.runtime.onMessageExternal?.addListener(handleRuntimeMessage)
;(async () => {
  // Wait for the rust code to load
  // wasm = await wasm

  // Call the init function, so the blocker starts by default
  initBadge()
  init()
})()

// =============================================================================
// Util functions

async function waitForDynamic<DynamicType>(
  fn: () => DynamicType | undefined
): Promise<DynamicType> {
  // Wait for the dynamic to stop being undefined
  while (typeof fn() === 'undefined') {
    await sleep(100)
  }

  // Return dynamic for convenience
  return fn()
}

/**
 * Waits for the engine to start then returns
 */
const waitForEngine = async () => {
  // Wait for the engine to spawn
  return await waitForDynamic(() => engines)
}

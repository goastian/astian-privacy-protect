/// <reference types="web-ext-types"/>

import { parse } from 'psl'
import { FiltersEngine, Request, RequestType } from '@ghostery/adblocker'

import { PermStore } from './permStore'
import { Settings } from './settings'
import { sleep } from './tempPort'
import { RequestListenerArgs } from './types'
import { defineFn, initFn } from './lib/remoteFunctions'
import { BackendState } from '../constants/state'
import { createStylesheetFromRules } from './lib/cosmeticFuncs'
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

// ===============
// Blocking engine
let engines: { name: string; engine: FiltersEngine }[]
let globalCosmetics: string
let engineLoadMs = 0
let globalCosmeticRuleCount = 0
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
  category: 'ads' | 'trackers' | 'fingerprinters' | 'cosmetics' | 'pages' | 'other'
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

const initRustWasm = async () => {
  if (!rustWasmReady) {
    rustWasmReady = initRustAdblock().then(() => {
      rustEngineName = getRustEngineName()
    })
  }

  await rustWasmReady
}

const rebuildRustEngine = async (rules: string, resourcesJson: string) => {
  if (rustEngine) {
    rustEngine.free()
    rustEngine = undefined
  }

  rustEngineRuleCount = 0
  rustEngineResourceCount = 0
  rustEngineLoadError = ''

  if (!rules.trim()) return

  try {
    await initRustWasm()
    rustEngine = new MidoriAdblockEngine(rules, resourcesJson || '[]')
    rustEngineRuleCount = rustEngine.rule_count()
    rustEngineResourceCount = rustEngine.resource_count()
  } catch (error) {
    rustEngineLoadError = error instanceof Error ? error.message : String(error)
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
 * The listener for webRequests. Blocks all that it receives and adds them to logger
 * @param details The request info, provided by the requestHandler
 */
const requestHandler = (details: RequestListenerArgs) => {
  // Check if the site is contained in the whitelist.
  const whitelistDomain = getWhitelistDomain(details)
  if (whitelistDomain && whitelist.data.indexOf(whitelistDomain) !== -1) return

  // Check if the condition is in the blocklist
  let hasMatch = false
  let engineMatch = ''
  let redirectUrl = ''
  let rewrittenUrl = ''

  const rustDecision = getRustDecision(details)
  if (rustDecision?.redirect) {
    redirectUrl = rustDecision.redirect
  }

  if (rustDecision?.rewrittenUrl && rustDecision.rewrittenUrl !== details.url) {
    rewrittenUrl = rustDecision.rewrittenUrl
  }

  if (rustDecision?.matched) {
    engineMatch = rustEngineName
    hasMatch = true
  } else {
    const request = Request.fromRawDetails({
      requestId: details.requestId,
      tabId: details.tabId,
      url: details.url,
      sourceUrl: getSourceUrl(details),
      type: details.type as RequestType,
      _originalRequestDetails: details,
    })
    for (let i = 0; i < engines.length; i++) {
      const { match } = engines[i].engine.match(request)

      if (match) {
        engineMatch = engines[i].name
        hasMatch = true
      }
    }
  }

  if (!hasMatch && rewrittenUrl) {
    return { redirectUrl: rewrittenUrl }
  }

  // Return if it hasn't got a match
  if (!hasMatch) return

  if (details.type !== 'main_frame') {
    // Subresource replacements from adblock-rust keep brittle sites working:
    // redirect rules replace a bad resource with a safe noop instead of
    // cancelling the request outright.
    if (redirectUrl) {
      recordBlockedRequest(details.tabId, details.url, 1, {
        reason: rustDecision?.matched ? 'rust-network' : 'network',
        blocker: engineMatch,
        requestType: details.type,
      })
      return { redirectUrl }
    }
  } else {
    // Otherwise it should use a regular URL
    const domain = getDomain(details.url)
    if (whitelist.data.indexOf(domain) !== -1) return

    // If it hasn't returned, this is a webpage that has been navigated to by the
    // user and we should show a blocked screen
    redirectUrl = `${browser.runtime.getURL('blocked.html')}?url=${
      details.url
    }&list=${engineMatch}`
  }

  recordBlockedRequest(details.tabId, details.url, 1, {
    reason: rustDecision?.matched ? 'rust-network' : 'network',
    blocker: engineMatch,
    requestType: details.type,
  })

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
    globalCosmetics = ''
    globalCosmeticRuleCount = 0
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
    engineResponse.rustResourcesJson || '[]'
  )
  engineLoadMs = Math.round(performance.now() - engineLoadStart)

  browser.webRequest.onBeforeRequest.addListener(
    requestHandler,
    { urls: ['<all_urls>'] },
    ['blocking']
  )

  let domainless = []

  for (let i = 0; i < engines.length; i++) {
    const engine = engines[i].engine

    const domainlessLocal = engine.cosmetics
      .getFilters()
      .filter(({ domains }) => typeof domains === 'undefined')
      .filter(({ selector }) => typeof selector === 'string')

    domainless = [...domainless, ...domainlessLocal]
  }

  globalCosmetics = createStylesheetFromRules(domainless)
  globalCosmeticRuleCount = domainless.length

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

// Define a function for getting cosmetic filters for each site
defineFn('getCosmeticsFilters', async (payload) => {
  // Wait for the engine to spawn
  const definedEngies = await waitForEngine()

  // Create a variable to store the cosmetics filters in
  let cosmetics = ''

  definedEngies.forEach((engine) => {
    cosmetics += engine.engine.getCosmeticsFilters(
      payload as CosmeticRequestPayload
    ).styles
  })

  // Lets return the final cosmetics
  return cosmetics
})

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

// Defines a function to collet the base stylesheet from the engine to be applied
// to a website on a separate thread.
defineFn('getGlobalCosmetics', async () => {
  // Wait for the global cosmetics to be generated
  return await waitForDynamic(() => globalCosmetics)
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
    globalCosmeticRuleCount,
    core: rustEngine
      ? `${rustEngineName} primary + Ghostery cosmetics/fallback`
      : 'Ghostery fallback; adblock-rust unavailable',
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
    typeof activeTabId === 'number' ? blockedEventsOnTabs[activeTabId] || [] : []
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
    protectionSummary.globalCosmeticRuleCount ? 'Ghostery cosmetics' : '',
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

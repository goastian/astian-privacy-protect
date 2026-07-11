// This performs cosmetic filtering on each website

import { parse } from 'psl'
import { remoteFn } from '../lib/remoteFunctions'
import {
  applyProceduralFiltersWithStats,
  parseProceduralFilter,
  ProceduralFilter,
  ProceduralFilterStats,
} from './proceduralCosmetics'
import { getStreamingAdStyles, hideStreamingAdContainers } from './streamingAds'
import { getYoutubeAdStyles, hideYoutubeAdContainers } from './youtubeAds'

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

const RUST_SPECIFIC_STYLE_ID = 'midori-rust-specific-cosmetics'
const RUST_GENERIC_STYLE_ID = 'midori-rust-generic-cosmetics'
const STREAMING_AD_STYLE_ID = 'midori-streaming-ad-cosmetics'
const YOUTUBE_AD_STYLE_ID = 'midori-youtube-ad-cosmetics'
const CONTENT_BLOCK_MESSAGE = 'midori.contentBlock'
const MAX_SELECTOR_BATCH_SIZE = 600
const MAX_SCRIPTLET_LENGTH = 512 * 1024
const PROCEDURAL_BATCH_DELAY_MS = 50

const getHostname = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return url.replace('https://', '').replace('http://', '').split('/')[0]
  }
}

const getDomain = (url: string) => {
  const hostname = getHostname(url)
  const parsed = parse(hostname)
  return 'domain' in parsed ? parsed.domain || hostname : hostname
}

// Get all of the variables needed to request the cosmetics for this page
const url = window.location.href
const hostname = window.location.hostname
const domain = getDomain(url)
const isYoutubeHost =
  hostname === 'youtube.com' || hostname.endsWith('.youtube.com')
const seenClasses = new Set<string>()
const seenIds = new Set<string>()
const pendingClasses = new Set<string>()
const pendingIds = new Set<string>()
const rustExceptions = new Set<string>()
let rustGenerichide = false
let genericFlushTimer: number | undefined
let proceduralActions: ProceduralFilter[] = []
let pendingReportedBlocks = 0
let reportTimer: number | undefined
let pendingCosmeticStats = {
  hiddenSelectors: 0,
  proceduralActions: 0,
  scriptlets: 0,
  rejectedStyleActions: 0,
  cappedProceduralFilters: 0,
}
let statsTimer: number | undefined
let proceduralFlushTimer: number | undefined
const pendingProceduralRoots = new Set<ParentNode>()
const processedProceduralRoots = new WeakSet<Element>()

const getAppendTarget = () =>
  document.head || document.documentElement || document.body

const appendStyle = (id: string, css: string) => {
  if (!css.trim()) return

  const target = getAppendTarget()
  if (!target) return

  let style = document.getElementById(id) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = id
    target.append(style)
  }

  style.append(document.createTextNode(`\n${css}`))
}

const injectPageScriptlet = (script: string) => {
  if (!script.trim() || script.length > MAX_SCRIPTLET_LENGTH) return

  const target = document.documentElement || document.head || document.body
  if (!target) return

  const scriptEl = document.createElement('script')
  scriptEl.textContent = script
  target.append(scriptEl)
  scriptEl.remove()
  pendingCosmeticStats.scriptlets += 1
  scheduleCosmeticStatsReport()
}

const reportContentBlocks = (count: number, reason = 'rust-cosmetic') => {
  if (count <= 0) return

  pendingReportedBlocks += count

  if (typeof reportTimer !== 'undefined') return

  reportTimer = window.setTimeout(() => {
    const blocked = pendingReportedBlocks
    pendingReportedBlocks = 0
    reportTimer = undefined

    browser.runtime
      .sendMessage({
        type: CONTENT_BLOCK_MESSAGE,
        url: window.location.href,
        reason,
        count: blocked,
      })
      .catch(() => undefined)
  }, 250)
}

const rememberProceduralStats = (stats: ProceduralFilterStats) => {
  if (
    stats.affected <= 0 &&
    stats.cappedFilters <= 0 &&
    stats.rejectedStyleActions <= 0
  ) {
    return
  }

  pendingCosmeticStats.proceduralActions += stats.affected
  pendingCosmeticStats.cappedProceduralFilters += stats.cappedFilters
  pendingCosmeticStats.rejectedStyleActions += stats.rejectedStyleActions
  scheduleCosmeticStatsReport()
}

const scheduleCosmeticStatsReport = () => {
  if (typeof statsTimer !== 'undefined') return

  statsTimer = window.setTimeout(() => {
    const stats = pendingCosmeticStats
    pendingCosmeticStats = {
      hiddenSelectors: 0,
      proceduralActions: 0,
      scriptlets: 0,
      rejectedStyleActions: 0,
      cappedProceduralFilters: 0,
    }
    statsTimer = undefined

    browser.runtime
      .sendMessage({
        type: CONTENT_BLOCK_MESSAGE,
        url: window.location.href,
        reason: 'rust-cosmetic',
        count: 0,
        cosmeticStats: stats,
      })
      .catch(() => undefined)
  }, 500)
}

const applyProceduralActions = (root: ParentNode = document) => {
  if (root instanceof Element) {
    if (processedProceduralRoots.has(root)) return
    processedProceduralRoots.add(root)
  }

  const stats = applyProceduralFiltersWithStats(proceduralActions, root)
  rememberProceduralStats(stats)
  reportContentBlocks(stats.affected)
}

const pruneStreamingAds = (root: ParentNode = document) => {
  reportContentBlocks(
    hideStreamingAdContainers(root, window.location.hostname),
    'streaming-cosmetic'
  )
}

const pruneYoutubeAds = (root: ParentNode = document) => {
  if (!isYoutubeHost) return

  reportContentBlocks(hideYoutubeAdContainers(root), 'youtube-cosmetic')
}

const skipYoutubeAd = () => {
  if (!isYoutubeHost) return

  const skipButton = document.querySelector<HTMLElement>(
    '.ytp-ad-text.ytp-ad-skip-button-text, .ytp-skip-ad-button, .ytp-ad-skip-button-modern'
  )
  if (!skipButton) return

  skipButton.click()
  reportContentBlocks(1, 'youtube-cosmetic')
}

const rememberClass = (className: string) => {
  if (!className || seenClasses.has(className)) return

  seenClasses.add(className)
  pendingClasses.add(className)
}

const rememberId = (id: string) => {
  if (!id || seenIds.has(id)) return

  seenIds.add(id)
  pendingIds.add(id)
}

const collectElementTokens = (element: Element) => {
  if (element.id) rememberId(element.id)
  element.classList.forEach(rememberClass)
}

const collectTreeTokens = (root: ParentNode) => {
  if (root instanceof Element) collectElementTokens(root)

  root.querySelectorAll?.('[id], [class]').forEach(collectElementTokens)
}

const takeTokenBatch = (tokens: Set<string>) => {
  const batch: string[] = []
  for (const token of tokens) {
    batch.push(token)
    tokens.delete(token)
    if (batch.length >= MAX_SELECTOR_BATCH_SIZE) break
  }
  return batch
}

const flushGenericSelectors = async () => {
  if (rustGenerichide || (!pendingClasses.size && !pendingIds.size)) return

  const classes = takeTokenBatch(pendingClasses)
  const ids = takeTokenBatch(pendingIds)

  const response = (await remoteFn('getRustGenericCosmetics', {
    url: window.location.href,
    hostname: window.location.hostname,
    domain: getDomain(window.location.href),
    classes,
    ids,
    exceptions: Array.from(rustExceptions),
  })) as RustGenericCosmeticResources

  appendStyle(RUST_GENERIC_STYLE_ID, response.stylesheet || '')
  if (pendingClasses.size || pendingIds.size) scheduleGenericFlush()
}

const scheduleGenericFlush = () => {
  if (typeof genericFlushTimer !== 'undefined') return

  genericFlushTimer = window.setTimeout(() => {
    genericFlushTimer = undefined
    flushGenericSelectors()
  }, 100)
}

const queueProceduralRoot = (root: ParentNode) => {
  pendingProceduralRoots.add(root)

  if (typeof proceduralFlushTimer !== 'undefined') return

  proceduralFlushTimer = window.setTimeout(() => {
    const roots = Array.from(pendingProceduralRoots)
    pendingProceduralRoots.clear()
    proceduralFlushTimer = undefined

    roots.forEach((root) => {
      applyProceduralActions(root)
      pruneStreamingAds(root)
      pruneYoutubeAds(root)
      skipYoutubeAd()
    })
  }, PROCEDURAL_BATCH_DELAY_MS)
}

const installCosmeticObserver = () => {
  collectTreeTokens(document.documentElement)
  scheduleGenericFlush()

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (
        mutation.type === 'attributes' &&
        mutation.target instanceof Element
      ) {
        collectElementTokens(mutation.target)
        queueProceduralRoot(mutation.target)
      }

      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return

        collectTreeTokens(node)
        queueProceduralRoot(node)
      })
    })
    scheduleGenericFlush()
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'id'],
  })
}

;(async () => {
  const whitelist = (await remoteFn('getWhitelist')) as string[]
  if (whitelist.includes(domain)) return

  const sharedConfig = {
    url,
    hostname,
    domain,
  }

  appendStyle(
    STREAMING_AD_STYLE_ID,
    getStreamingAdStyles(window.location.hostname)
  )
  pruneStreamingAds()
  if (isYoutubeHost) {
    appendStyle(YOUTUBE_AD_STYLE_ID, getYoutubeAdStyles())
    pruneYoutubeAds()
    skipYoutubeAd()
  }

  const rustResources = (await remoteFn(
    'getRustCosmeticResources',
    sharedConfig
  )) as RustCosmeticResources

  rustResources.exceptions?.forEach((exception) =>
    rustExceptions.add(exception)
  )
  rustGenerichide = Boolean(rustResources.generichide)
  appendStyle(RUST_SPECIFIC_STYLE_ID, rustResources.stylesheet || '')
  pendingCosmeticStats.hiddenSelectors +=
    rustResources.hideSelectors?.length || 0
  injectPageScriptlet(rustResources.injectedScript || '')
  proceduralActions = (rustResources.proceduralActions || [])
    .map(parseProceduralFilter)
    .filter(Boolean) as ProceduralFilter[]
  applyProceduralActions()
  installCosmeticObserver()
})()

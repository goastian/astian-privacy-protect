/**
 * Midori Privacy Blocker
 * Main background service worker
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

import { getOptions, setOptions, isWhitelisted, toggleWhitelist, addDailyStat, recordHourlyBlock, applyPhaseCSafeDefaults, applyV223Cleanup } from './storage.js';
import { extractDomain, categorizeRequest } from './filter-utils.js';
import { GhosteryEngine, wipeEngineCache } from './ghostery-engine.js';
import { downloadAllListsWithStatus } from './lists-manager.js';
import { initTab, recordBlock, removeTab, getTab, ensureTab, getGroupedRequests, getGroupedRequestsEnriched, getRecentRequests, getBlockedCount, getBlockedByCategory, getDataSaved, updateBadge, getEcoStats } from './stats-collector.js';
import { getTopTrackedSites, getBlockingStats, getCategoryDistribution, getHourlyHeatmap, getWeeklyTrend, getPrivacySummary, getAppliedRulesDiagnostics, exportReport } from './report-generator.js';
import {
  evaluateRequestPolicy,
  evaluateRequestPolicyCached,
  getPopupDefenseConfig,
  resolveSiteProfile,
  invalidateSiteProfileCache,
  FIRST_PARTY_CDN_MAP,
  isCriticalFirstPartySite,
  CRITICAL_FIRST_PARTY_SITES,
  getAntiFingerprintMode,
} from './policy-engine.js';
import {
  fetchAndUpdateTrackerDb,
  handleTrackerDbAlarm,
  rollbackTrackerDb,
  getTrackerDbMeta,
  getTrackerEntityMetadata,
  TRACKERDB_ALARM_NAME,
} from './trackerdb.js';
import {
  buildIaShieldConfig,
  normalizeIaRiskEvent,
  appendIaRiskEvent,
  summarizeIaRiskEvents,
} from './ia-shield.js';
import { createTelemetryController } from './telemetry.js';
import { CONFIRMED_POPUNDER_DOMAINS, createPopupDefenseController } from './popup-defense.js';
import { createTrackerDbDnrController } from './trackerdb-dnr.js';
import { createBackgroundOrchestrator } from './orchestrator.js';
import { createMessageDispatcher } from './messages/index.js';
import { cleanUrlWithMetadata, buildCleanerDnrRules } from './url-cleaner.js';
import {
  loadLocalReputation,
  flushLocalReputation,
  recordTrackerObservation,
  recordUrlCleanerRemoval,
} from './local-reputation.js';

// ── Single engine: Ghostery (primary and only runtime engine) ──
const ghosteryEngine = new GhosteryEngine();
let engine = ghosteryEngine;
let isEnabled = true;
const IS_CHROMIUM = __PLATFORM__ === 'chromium';

// ── Hourly block debounce buffer ────────────────────────────────────────────
let _hourlyBlockBuffer = 0;
let _hourlyFlushTimer = null;
const HOURLY_FLUSH_INTERVAL = 60000; // 60s
let runtimeOptionsCache = null;

const telemetry = createTelemetryController();

// ── Popup update notification debounce (8.1 optimization) ───────────────────
const popupUpdateTimers = new Map();
const POPUP_UPDATE_DEBOUNCE_MS = 200; // Batch updates every 200ms

// Chromium popup stats in chrome.storage.session (read directly by popup)
const pendingSessionStats = new Map();
let sessionStatsFlushTimer = null;
const SESSION_STATS_FLUSH_MS = 500; // max 2 writes/s

function isHostnameWhitelisted(hostname, whitelist = whitelistCache) {
  const host = String(hostname || '').toLowerCase();
  if (!host || !whitelist || typeof whitelist !== 'object') return false;
  if (whitelist[host]) return true;

  const parts = host.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (whitelist[parent]) return true;
  }

  return false;
}

function isProtectionBypassedForHost(hostname, options = getRuntimeOptions()) {
  if (options?.enabled === false) return true;
  return isHostnameWhitelisted(hostname, options?.whitelist || {});
}

function isConfirmedPopunderDomain(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  for (const domain of CONFIRMED_POPUNDER_DOMAINS) {
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

function isPopupAllowedForHost(hostname, options = getRuntimeOptions()) {
  const host = String(hostname || '').toLowerCase();
  const allowlist = options?.popupAllowlist || {};
  if (!host || !allowlist || typeof allowlist !== 'object') return false;
  const now = Date.now();
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts.slice(i).join('.');
    const entry = allowlist[key];
    if (!entry) continue;
    if (entry === true || entry.permanent === true) return true;
    const expiresAt = Number(entry.expiresAt || 0);
    if (!expiresAt || expiresAt > now) return true;
  }
  return false;
}

function queueSessionStatsWrite(tabId, statsData) {
  if (!IS_CHROMIUM) return;
  if (!Number.isInteger(tabId) || tabId < 0) return;
  if (!chrome.storage?.session?.set) return;

  pendingSessionStats.set(`tab_${tabId}`, statsData);
  if (!sessionStatsFlushTimer) {
    sessionStatsFlushTimer = setTimeout(() => {
      flushSessionStatsWrites().catch(() => {});
    }, SESSION_STATS_FLUSH_MS);
  }
}

async function flushSessionStatsWrites() {
  if (sessionStatsFlushTimer) {
    clearTimeout(sessionStatsFlushTimer);
    sessionStatsFlushTimer = null;
  }
  if (!IS_CHROMIUM || !chrome.storage?.session?.set || pendingSessionStats.size === 0) return;

  const payload = Object.fromEntries(pendingSessionStats.entries());
  pendingSessionStats.clear();

  try {
    await chrome.storage.session.set(payload);
  } catch (e) {
    // Ignore transient storage.session failures in hot path.
  }
}

// ── Notify popup of stats changes (8.1 optimization: event-driven) ──────────
async function notifyPopupStatsChange(tabId) {
  if (!tabId) return;

  // Clear existing timer for this tab
  clearPopupUpdateTimer(tabId);

  // Schedule debounced notification
  const timer = setTimeout(async () => {
    popupUpdateTimers.delete(tabId);
    
    try {
      let statsData;
      
      if (IS_CHROMIUM) {
        const stats = await getChromiumTabStats(tabId);
        const eco = getEcoStats(tabId);
        statsData = { ...stats, ...eco };
        queueSessionStatsWrite(tabId, statsData);
      } else {
        const tab = getTab(tabId);
        const groups = getGroupedRequests(tabId);
        const eco = getEcoStats(tabId);
        statsData = {
          hostname: tab?.hostname || '',
          blocked: tab?.blocked || 0,
          dataSaved: getDataSaved(tabId),
          groups,
          recentRequests: getRecentRequests(tabId, 5),
          ...eco
        };
      }
      
      // Send to popup if it's listening.
      // Phase D: use runtime.sendMessage — the popup page is NOT a content
      // script of `tabId`; tabs.sendMessage delivered the event into the page
      // (where nothing handled it) and never reached the popup. runtime.sendMessage
      // delivers to the extension page (popup) when it is open.
      try {
        const sendRuntime = (typeof browser !== 'undefined' && browser.runtime?.sendMessage)
          ? browser.runtime.sendMessage.bind(browser.runtime)
          : chrome.runtime.sendMessage.bind(chrome.runtime);
        const result = sendRuntime({
          action: 'popup-stats-update',
          tabId,
          data: statsData,
        });
        if (result && typeof result.then === 'function') result.catch(() => {});
      } catch (e) {
        // Popup not open or no listeners — ignore silently.
      }
    } catch (e) {
      // Silently ignore errors (popup not open, etc.)
    }
  }, POPUP_UPDATE_DEBOUNCE_MS);

  popupUpdateTimers.set(tabId, timer);
}

function clearPopupUpdateTimer(tabId) {
  const timer = popupUpdateTimers.get(tabId);
  if (timer) {
    clearTimeout(timer);
    popupUpdateTimers.delete(tabId);
  }
}

function bufferHourlyBlock(count) {
  _hourlyBlockBuffer += count;
  if (!_hourlyFlushTimer) {
    _hourlyFlushTimer = setTimeout(flushHourlyBuffer, HOURLY_FLUSH_INTERVAL);
  }
}

async function flushHourlyBuffer() {
  _hourlyFlushTimer = null;
  const count = _hourlyBlockBuffer;
  _hourlyBlockBuffer = 0;
  if (count > 0) {
    try {
      await recordHourlyBlock(count);
    } catch (e) {
      console.warn('[midori] Failed to flush hourly stats:', e);
    }
  }
}

async function flushTelemetry() {
  await telemetry.flush();
}

function recordStartupLatency(ms) {
  telemetry.recordStartupLatency(ms);
}

function recordMatchingLatency(ms) {
  telemetry.recordMatchingLatency(ms);
}

function recordBlockedCategory(category) {
  telemetry.recordBlockedCategory(category);
}

// ── Phase D: defer non-critical bookkeeping out of the sync hot path ───────
// Firefox's webRequest.onBeforeRequest runs synchronously and any work here
// adds to per-request network latency. We batch telemetry/heatmap/save work
// and flush it via a microtask + setTimeout(0) so the network decision can
// return immediately.
const _deferredQueue = [];
let _deferredScheduled = false;

function _flushDeferred() {
  _deferredScheduled = false;
  const jobs = _deferredQueue.splice(0, _deferredQueue.length);
  for (let i = 0; i < jobs.length; i++) {
    try { jobs[i](); } catch (e) { /* swallow — deferred work must not crash hot path */ }
  }
}

function deferHotPathWork(fn) {
  _deferredQueue.push(fn);
  if (_deferredScheduled) return;
  _deferredScheduled = true;
  // Prefer microtask for low-latency flush; fall back to setTimeout(0) so we
  // never re-enter the same event loop tick that produced the request.
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(_flushDeferred);
  } else {
    setTimeout(_flushDeferred, 0);
  }
}

function recordContentScriptCost(script, hostname, durationMs) {
  telemetry.recordContentScriptCost(script, hostname, durationMs);
}

function recordFalsePositive(hostname, category) {
  telemetry.recordFalsePositive(hostname, category);
}

function observeTrackerPolicy(policy, url, pageHostname, resourceType) {
  if (!policy || !url || !pageHostname) return;
  const requestDomain = extractDomain(url);
  if (!requestDomain) return;
  recordTrackerObservation({
    requestDomain,
    pageHostname,
    isThirdParty: requestDomain !== pageHostname &&
      !requestDomain.endsWith(`.${pageHostname}`) &&
      !pageHostname.endsWith(`.${requestDomain}`),
    trackerCategory: policy.trackerCategory || policy.category,
    taxonomy: policy.taxonomy,
    wasBlocked: policy.shouldBlock === true,
    resourceType,
    isCriticalSite: isCriticalFirstPartySite(pageHostname),
  });
}

function recordGlobalCssFalsePositive(hostname, hits) {
  telemetry.recordGlobalCssFalsePositive(hostname, hits);
}

function recordIaShieldRiskEvent(event) {
  telemetry.recordIaShieldRiskEvent(event);
}

function recordAppliedRulesEvent(msg, sender) {
  telemetry.recordAppliedRulesEvent(msg, sender);
}

function refreshRuntimeOptions(options) {
  runtimeOptionsCache = options || runtimeOptionsCache;
  if (!runtimeOptionsCache) return;
  invalidateSiteProfileCache();
  isEnabled = runtimeOptionsCache.enabled !== false;
  whitelistCache = runtimeOptionsCache.whitelist || {};
  whitelistCacheTime = Date.now();
  isTrackerDbAssistedEnabled = shouldEnableTrackerDbAssisted(runtimeOptionsCache);
}

function getRuntimeOptions() {
  return runtimeOptionsCache || { protectionLevel: 'standard', experiments: {}, whitelist: {} };
}

function getEffectiveRolloutFlags(options) {
  const experiments = options?.experiments || {};
  const transparency = experiments.rolloutTransparency !== false;
  const entityBlocking = transparency && experiments.rolloutEntityBlocking === true;
  const verticalProfiles = entityBlocking && experiments.rolloutVerticalProfiles === true;
  const cosmeticAudit = verticalProfiles && experiments.rolloutCosmeticAudit === true;
  return { transparency, entityBlocking, verticalProfiles, cosmeticAudit };
}

function getBlockedEntitiesMap(options) {
  return options?.blockedEntities && typeof options.blockedEntities === 'object'
    ? options.blockedEntities
    : {};
}

function getEntityControlForGroups(groups, options) {
  if (!getEffectiveRolloutFlags(options).entityBlocking) return null;

  const blockedEntities = getBlockedEntitiesMap(options);
  const scoreByOwnerId = new Map();
  const items = [
    ...(groups?.trackers || []),
    ...(groups?.ads || []),
    ...(groups?.other || []),
  ];

  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== 'object') continue;

    const ownerId = String(rawItem.ownerId || rawItem.domain || '').trim();
    if (!ownerId) continue;

    const owner = String(rawItem.owner || rawItem.domain || ownerId).trim() || ownerId;
    const domain = String(rawItem.domain || '').trim();
    const confidence = Number(rawItem.confidence) || 0;
    const nextScore = (scoreByOwnerId.get(ownerId)?.score || 0) + 1 + confidence;

    scoreByOwnerId.set(ownerId, {
      ownerId,
      owner,
      domain,
      score: nextScore,
      blocked: blockedEntities[ownerId] === true,
    });
  }

  const ranked = [...scoreByOwnerId.values()].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const rightNamed = right.owner !== right.domain ? 1 : 0;
    const leftNamed = left.owner !== left.domain ? 1 : 0;
    if (rightNamed !== leftNamed) return rightNamed - leftNamed;
    return left.owner.localeCompare(right.owner);
  });

  if (!ranked.length) return null;

  const top = ranked[0];
  const entity = getTrackerEntityMetadata(top.ownerId);
  return {
    ownerId: top.ownerId,
    owner: top.owner,
    blocked: top.blocked,
    domainCount: Array.isArray(entity?.domains) ? entity.domains.length : (top.domain ? 1 : 0),
  };
}

// Broadcast options changes to any open options/popup page
function broadcastOptionsChanged(changedFields) {
  try {
    const msg = { action: 'options-changed', changed: changedFields };
    if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
      browser.runtime.sendMessage(msg).catch(() => {});
    } else if (chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(msg).catch?.(() => {});
    }
  } catch (e) {
    // No listeners open, ignore
  }
}

const popupDefense = createPopupDefenseController({
  extractDomain,
  getTab,
  getPopupDefenseConfig,
  getRuntimeOptions,
});

function recordUserGesture(tabId, payload = {}) {
  popupDefense.recordUserGesture(tabId, payload);
}

function recordWindowSignal(tabId, payload = {}) {
  popupDefense.recordWindowSignal(tabId, payload);
}

function clearPopupTracking(tabId) {
  popupDefense.clearPopupTracking(tabId);
}

function registerPopupCandidate(tab) {
  popupDefense.registerPopupCandidate(tab, recordPopupBlocked);
}

function trackPopupRedirect(tabId, url) {
  popupDefense.trackPopupRedirect(tabId, url);
}

// ── Protection level presets ─────────────────────────────────────────────────
const PROTECTION_LEVELS = {
  basic: {
    label: 'Basic',
    antiFingerprint: false,
      trackerDbAssisted: false,
    lists: {
      'easylist': true, 'easyprivacy': true, 'ublock-filters': true,
      'ublock-privacy': true, 'peter-lowe': true, 'ublock-quick-fixes': true,
      'ublock-unbreak': true,
      'ublock-annoyances-cookies': false, 'ublock-annoyances-others': false,
      'fanboy-social': false, 'fanboy-annoyance': false,
      'adguard-base': false, 'adguard-tracking': false, 'adguard-social': false,
      'adguard-annoyances': false, 'adguard-mobile': false,
      'adguard-spyware-firstparty': false,
      'easylist-spanish': false, 'easylist-germany': false, 'easylist-france': false,
    },
  },
  standard: {
    label: 'Standard',
    antiFingerprint: true,
      trackerDbAssisted: false,
    lists: {
      'easylist': true, 'easyprivacy': true, 'ublock-filters': true,
      'ublock-privacy': true, 'peter-lowe': true, 'ublock-quick-fixes': true,
      'ublock-unbreak': true, 'ublock-annoyances-cookies': true, 'fanboy-social': true,
      'ublock-annoyances-others': false, 'fanboy-annoyance': false,
      'adguard-base': false, 'adguard-tracking': false, 'adguard-social': false,
      'adguard-annoyances': false, 'adguard-mobile': false,
      'adguard-spyware-firstparty': false,
      'easylist-spanish': false, 'easylist-germany': false, 'easylist-france': false,
    },
  },
  strict: {
    label: 'Strict',
      trackerDbAssisted: true,
    antiFingerprint: true,
    lists: {
      'easylist': true, 'easyprivacy': true, 'ublock-filters': true,
      'ublock-privacy': true, 'peter-lowe': true, 'ublock-quick-fixes': true,
      'ublock-unbreak': true, 'ublock-annoyances-cookies': true,
      'ublock-annoyances-others': true, 'fanboy-social': true, 'fanboy-annoyance': true,
      'adguard-base': true, 'adguard-tracking': true, 'adguard-social': true,
      'adguard-annoyances': true, 'adguard-spyware-firstparty': true,
      'adguard-mobile': false,
      'easylist-spanish': false, 'easylist-germany': false, 'easylist-france': false,
    },
  },
};

// Cross-browser helpers
const webRequestAPI = (typeof browser !== 'undefined' && browser.webRequest) ? browser.webRequest : chrome.webRequest;

const trackerDbDnr = createTrackerDbDnrController({
  isChromium: IS_CHROMIUM,
  protectionLevels: PROTECTION_LEVELS,
  getEffectiveRolloutFlags,
});

const {
  shouldEnableTrackerDbAssisted,
  applyTrackerDbDynamicRules,
  updateDnrEntityBlockRules,
} = trackerDbDnr;

function safeSendMessage(tabId, msg) {
  try {
    if (typeof browser !== 'undefined' && browser.tabs?.sendMessage) {
      browser.tabs.sendMessage(tabId, msg).catch(() => {});
    } else if (chrome.tabs?.sendMessage) {
      const result = chrome.tabs.sendMessage(tabId, msg);
      if (result && typeof result.then === 'function') result.catch(() => {});
    }
  } catch (e) {}
}

const orchestrator = createBackgroundOrchestrator({
  isChromium: IS_CHROMIUM,
  ghosteryEngine,
  getEngine: () => engine,
  setEngine: (nextEngine) => {
    engine = nextEngine;
  },
  getOptions,
  refreshRuntimeOptions,
  telemetry,
  applyTrackerDbDynamicRules,
  updateDnrEntityBlockRules,
  applyFirstPartyCdnAllowRules,
  installDnrUrlCleanerRule,
  installPopunderDnrRules,
  isTrackerDbAssistedEnabled: () => isTrackerDbAssistedEnabled,
});

const { initialize, loadEngine, reloadFirefoxEngineForOptions } = orchestrator;

// ── Firefox: webRequest blocking ────────────────────────────────────────────

// Sync whitelist check (cached in memory for performance)
let whitelistCache = {};
let whitelistCacheTime = 0;

// Cached experiment flag for TrackerDB assisted blocking (sync access in webRequest)
let isTrackerDbAssistedEnabled = false;

function isWhitelistedSync(hostname) {
  // Phase 6 perf: Lazy refresh whitelist cache (non-blocking)
  if (Date.now() - whitelistCacheTime > 30000) {
    whitelistCacheTime = Date.now(); // Prevent concurrent refreshes
    getOptions().then(opts => {
      whitelistCache = opts.whitelist || {};
    });
  }
  return isHostnameWhitelisted(hostname, whitelistCache);
}

const pendingSaveTabsFirefox = new Set();
let firefoxSaveTimer = null;

// Phase 6 perf: Pre-allocated response objects for the webRequest hot path
// Avoids GC pressure from creating new { cancel: false } on every request
const WR_PASS = Object.freeze({ cancel: false });
const WR_BLOCK = Object.freeze({ cancel: true });

function setupWebRequestBlocking() {
  console.log('[midori] Setting up webRequest blocking, engine rules:', engine.rulesCount);
  webRequestAPI.onBeforeRequest.addListener(
    (details) => {
      if (!isEnabled) return WR_PASS;
      if (details.tabId < 0) return WR_PASS;

      const url = details.url;
      if (!url.startsWith('http')) return WR_PASS;

      // Ghostery-style URL cleaner: strip tracking params on top-level
      // navigations only. Sub-frames are excluded because embeds and OAuth
      // flows legitimately reuse the same parameter names as state tokens,
      // and a redirect there typically breaks iframe loading.
      if (details.type === 'main_frame') {
        try {
          const u = new URL(url);
          const host = u.hostname;
          if (!host || !isWhitelistedSync(host)) {
            const cleaned = cleanUrlWithMetadata(url);
            if (cleaned?.url && cleaned.url !== url) {
              deferHotPathWork(() => recordUrlCleanerRemoval(cleaned.hostname || host, cleaned.removed || []));
              return { redirectUrl: cleaned.url };
            }
          }
        } catch { /* malformed URL, skip */ }
      }

      if (details.type === 'main_frame') return WR_PASS;

      const tab = getTab(details.tabId) || ensureTab(details.tabId);
      const pageHostname = tab.hostname || '';

      if (pageHostname && isWhitelistedSync(pageHostname)) return WR_PASS;

      const requestHostname = extractDomain(url);
      if (requestHostname && isConfirmedPopunderDomain(requestHostname) && !isPopupAllowedForHost(pageHostname)) {
        recordBlock(details.tabId, url, {
          category: 'popups',
          reason: 'popunder-network',
          ownerId: 'popup-defense',
          confidence: 1,
        });
        updateBadge(details.tabId);
        deferHotPathWork(() => {
          recordBlockedCategory('popups');
          notifyPopupStatsChange(details.tabId);
          bufferHourlyBlock(1);
          pendingSaveTabsFirefox.add(details.tabId);
          if (!firefoxSaveTimer) {
            firefoxSaveTimer = setTimeout(flushFirefoxStats, 5000);
          }
        });
        return WR_BLOCK;
      }

      const tMatchStart = performance.now();
      const policy = evaluateRequestPolicyCached({
        url,
        pageHostname,
        resourceType: details.type,
        options: getRuntimeOptions(),
        engine,
      });
      const matchElapsed = performance.now() - tMatchStart;

      if (policy.shouldBlock) {
        recordBlock(details.tabId, url, {
          category: policy.category,
          reason: policy.reason,
          ownerId: policy.ownerId,
          confidence: policy.trackerConfidence,
          fingerprinting: policy.taxonomy === 'fingerprinting' || policy.trackerCategory === 'fingerprinting',
        });
        updateBadge(details.tabId);

        // Phase D: defer non-blocking telemetry/heatmap/save bookkeeping
        // so the sync webRequest decision returns ASAP.
        const blockedTabId = details.tabId;
        const blockedCategory = policy.category || categorizeRequest(url);
        deferHotPathWork(() => {
          observeTrackerPolicy(policy, url, pageHostname, details.type);
          recordMatchingLatency(matchElapsed);
          recordBlockedCategory(blockedCategory);
          notifyPopupStatsChange(blockedTabId);
          bufferHourlyBlock(1);
          pendingSaveTabsFirefox.add(blockedTabId);
          if (!firefoxSaveTimer) {
            firefoxSaveTimer = setTimeout(flushFirefoxStats, 5000);
          }
        });

        return WR_BLOCK;
      }

      // Pass-through: still record matching latency, but lazily.
      deferHotPathWork(() => {
        observeTrackerPolicy(policy, url, pageHostname, details.type);
        recordMatchingLatency(matchElapsed);
      });
      return WR_PASS;
    },
    { urls: ['<all_urls>'] },
    ['blocking']
  );
  console.log('[midori] webRequest listener registered successfully');
}

async function flushFirefoxStats() {
  firefoxSaveTimer = null;
  const tabIds = [...pendingSaveTabsFirefox];
  pendingSaveTabsFirefox.clear();

  for (const tabId of tabIds) {
    const tab = getTab(tabId);
    if (!tab || !tab.hostname || tab.blocked <= 0) continue;

    const alreadySaved = tab._savedBlocked || 0;
    const newBlocked = tab.blocked - alreadySaved;
    if (newBlocked <= 0) continue;

    const newRequests = tab.requests.slice(tab._savedRequestIdx || 0);
    const trackerDomains = [...new Set(newRequests.map(r => r.domain))];

    try {
      await addDailyStat(tab.hostname, newBlocked, trackerDomains);
      tab._savedBlocked = tab.blocked;
      tab._savedRequestIdx = tab.requests.length;
    } catch (e) {
      console.error('[midori] Failed to save stats:', e);
    }
  }
}

// ── Chromium: lightweight tracker domain capture via onRuleMatchedDebug ──────

// Per-tab tracker domain buffer (lightweight, capped)
const chromiumTabTrackers = new Map(); // tabId -> { hostname, domains: Set, blocked: number }

// Phase D: throttle per-tab recordBlock/updateBadge/notifyPopupStatsChange so
// high-traffic pages can't drown the background in O(N) work. The DNR badge
// is already kept fresh by the platform; we just cap our diagnostic capture.
const DNR_RECORD_RATE_LIMIT_PER_TAB = 30; // events / sec / tab
const dnrRateState = new Map(); // tabId -> { windowStart, count }
const recentChromiumBlockedUrls = new Map(); // tabId -> Map(url -> timestamp)
const CHROMIUM_BLOCK_DEDUPE_TTL_MS = 1500;
const MAX_COSMETIC_BLOCKS_PER_REPORT = 50;

function dnrRateLimited(tabId) {
  const now = Date.now();
  let s = dnrRateState.get(tabId);
  if (!s || now - s.windowStart >= 1000) {
    s = { windowStart: now, count: 0 };
    dnrRateState.set(tabId, s);
  }
  s.count++;
  return s.count > DNR_RECORD_RATE_LIMIT_PER_TAB;
}

function shouldRecordChromiumBlockedUrl(tabId, url) {
  const now = Date.now();
  let recent = recentChromiumBlockedUrls.get(tabId);
  if (!recent) {
    recent = new Map();
    recentChromiumBlockedUrls.set(tabId, recent);
  }

  for (const [key, timestamp] of recent) {
    if (now - timestamp > CHROMIUM_BLOCK_DEDUPE_TTL_MS) recent.delete(key);
  }

  const key = String(url || '');
  const previous = recent.get(key) || 0;
  if (previous && now - previous <= CHROMIUM_BLOCK_DEDUPE_TTL_MS) return false;
  recent.set(key, now);
  return true;
}

function recordChromiumBlockedRequest(tabId, url, metadata = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) return false;
  if (!url || !url.startsWith('http')) return false;
  if (!shouldRecordChromiumBlockedUrl(tabId, url)) return false;

  const tab = getTab(tabId) || ensureTab(tabId);
  const blockedHost = extractDomain(url);
  const isPopunderNetwork = blockedHost && isConfirmedPopunderDomain(blockedHost);
  const category = metadata.category || (isPopunderNetwork ? 'popups' : categorizeRequest(url));
  const reason = metadata.reason || (isPopunderNetwork ? 'popunder-network' : 'rule-match');
  recordBlockedCategory(category);
  recordBlock(tabId, url, { ...metadata, category, reason });
  if (blockedHost && tab.hostname) {
    deferHotPathWork(() => recordTrackerObservation({
      requestDomain: blockedHost,
      pageHostname: tab.hostname,
      isThirdParty: blockedHost !== tab.hostname &&
        !blockedHost.endsWith(`.${tab.hostname}`) &&
        !tab.hostname.endsWith(`.${blockedHost}`),
      trackerCategory: category,
      taxonomy: metadata.taxonomy,
      wasBlocked: true,
      resourceType: metadata.resourceType || 'other',
      isCriticalSite: isCriticalFirstPartySite(tab.hostname),
    }));
  }
  updateBadge(tabId);
  notifyPopupStatsChange(tabId);

  return !!tab;
}

function recordPopupBlocked(tabId, rawUrl) {
  if (!Number.isInteger(tabId) || tabId < 0) return false;
  const url = String(rawUrl || '');
  const safeUrl = url.startsWith('http') ? url : 'https://popup-blocked.midori.invalid/';
  return recordChromiumBlockedRequest(tabId, safeUrl, {
    category: 'popups',
    reason: 'popup-defense',
    owner: 'Popup defense',
    ownerId: 'popup-defense',
  });
}

function recordCosmeticBlocks(tabId, payload = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) return false;
  const hostname = String(payload.hostname || '').toLowerCase() || 'current-site';
  const source = String(payload.source || 'cosmetic').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'cosmetic';
  const count = Math.max(0, Math.min(MAX_COSMETIC_BLOCKS_PER_REPORT, Number(payload.count) || 0));
  if (count <= 0) return false;

  let recorded = 0;
  for (let i = 0; i < count; i++) {
    const ok = recordChromiumBlockedRequest(
      tabId,
      `https://cosmetic-block.midori.invalid/${encodeURIComponent(hostname)}/${source}/${Date.now()}-${i}`,
      {
        category: 'ads',
        reason: 'cosmetic-filter',
        domain: `cosmetic:${hostname}`,
        owner: 'Cosmetic filtering',
        ownerId: 'cosmetic-filtering',
      },
    );
    if (ok) recorded++;
  }
  return recorded > 0;
}

if (IS_CHROMIUM && chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    const tabId = info.request?.tabId;
    if (!tabId || tabId < 0) return;
    const actionType = info.rule?.action?.type || '';
    const matchedRuleId = info.rule?.ruleId ?? info.rule?.id;
    if (actionType === 'redirect' && matchedRuleId === 950001) {
      const rawUrl = info.request?.url || '';
      try {
        const cleaned = cleanUrlWithMetadata(rawUrl);
        if (cleaned?.removed?.length) {
          deferHotPathWork(() => recordUrlCleanerRemoval(cleaned.hostname, cleaned.removed));
        }
      } catch {}
      return;
    }
    if (actionType && actionType !== 'block') return;

    let entry = chromiumTabTrackers.get(tabId);
    if (!entry) {
      entry = { hostname: '', domains: new Set(), blocked: 0 };
      chromiumTabTrackers.set(tabId, entry);
    }

    entry.blocked++;

    const url = info.request?.url;
    const limited = dnrRateLimited(tabId);

    // Phase D: defer telemetry; rate-limit the heavier per-event work.
    if (url && !limited) {
      deferHotPathWork(() => {
        const host = extractDomain(url);
        recordBlockedCategory(host && isConfirmedPopunderDomain(host) ? 'popups' : categorizeRequest(url));
      });
    }
    if (!limited && entry.domains.size < 200 && url) {
      const d = extractDomain(url);
      if (d && !entry.domains.has(d)) {
        entry.domains.add(d);
        recordChromiumBlockedRequest(tabId, url, { reason: 'rule-match' });
        deferHotPathWork(() => notifyPopupStatsChange(tabId));
      }
    }

    // Hourly stats are already debounced internally; defer the call itself.
    if (!limited) {
      deferHotPathWork(() => bufferHourlyBlock(1));
    }

    // Resolve tab hostname lazily
    if (!entry.hostname) {
      chrome.tabs.get(tabId, (t) => {
        if (chrome.runtime.lastError || !t?.url) return;
        const hn = extractDomain(t.url);
        if (hn) {
          entry.hostname = hn;
          // Ensure stats-collector has this tab
          const existing = getTab(tabId);
          if (!existing || !existing.hostname) {
            initTab(tabId, hn);
          }
        }
      });
    }
  });
}

// Track last collection timestamp per tab to avoid double-counting
const lastCollectTime = new Map();

async function collectChromiumStats() {
  if (!IS_CHROMIUM) return;

  try {
    const tabs = await chrome.tabs.query({});
    for (const browserTab of tabs) {
      if (!browserTab.id || !browserTab.url || !browserTab.url.startsWith('http')) continue;

      const hostname = extractDomain(browserTab.url);
      if (!hostname) continue;

      const minTimeStamp = lastCollectTime.get(browserTab.id) || (Date.now() - 120000);

      let matchedRules;
      try {
        matchedRules = await chrome.declarativeNetRequest.getMatchedRules({
          tabId: browserTab.id,
          minTimeStamp,
        });
      } catch (e) {
        continue;
      }

      const rules = matchedRules?.rulesMatchedInfo || [];
      if (rules.length === 0) continue;

      const blockedCount = rules.length;

      // Get tracker domains from stats-collector (primary) or debug buffer (fallback)
      const groups = getGroupedRequests(browserTab.id);
      const allGroupDomains = [...(groups.trackers || []), ...(groups.ads || []), ...(groups.other || [])];
      let trackerDomains = allGroupDomains.length > 0 ? allGroupDomains : [];

      // Fallback to debug buffer if stats-collector has nothing
      if (trackerDomains.length === 0) {
        const entry = chromiumTabTrackers.get(browserTab.id);
        if (entry) trackerDomains = [...entry.domains];
      }

      try {
        await addDailyStat(hostname, blockedCount, trackerDomains);
      } catch (e) {
        console.error('[midori] Failed to save Chromium stats:', e);
      }

      lastCollectTime.set(browserTab.id, Date.now());
    }
  } catch (e) {
    console.error('[midori] collectChromiumStats error:', e);
  }
}

/**
 * Get tab stats for Chromium popup (on-demand)
 */
async function getChromiumTabStats(tabId) {
  let hostname = '';
  let blocked = 0;

  try {
    const browserTab = await chrome.tabs.get(tabId);
    if (browserTab?.url) {
      hostname = extractDomain(browserTab.url) || '';
    }
  } catch (e) {
    console.log('[midori] getChromiumTabStats: tabs.get failed', e.message);
    return { hostname, blocked, groups: { trackers: [], ads: [], other: [] } };
  }

  // Get count from getMatchedRules
  try {
    const matchedRules = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
    blocked = matchedRules?.rulesMatchedInfo?.length || 0;
  } catch (e) {
    console.log('[midori] getChromiumTabStats: getMatchedRules failed', e.message);
  }
  blocked = Math.max(blocked, getBlockedCount(tabId));

  // Use stats-collector groups as primary source (properly categorized)
  let groups = getGroupedRequestsEnriched(tabId);

  // Fallback: if stats-collector is empty but debug buffer has domains, use those
  const hasGroups = groups.trackers.length + groups.ads.length + groups.other.length > 0;
  if (!hasGroups) {
    const entry = chromiumTabTrackers.get(tabId);
    if (entry && entry.domains.size > 0) {
      groups = { trackers: [], ads: [], other: [] };
      for (const domain of entry.domains) {
        const category = categorizeRequest('https://' + domain + '/');
        if (groups[category]) {
          groups[category].push(domain);
        } else {
          groups.other.push(domain);
        }
      }
    }
  }

  // Also calculate dataSaved
  const dataSaved = getDataSaved(tabId);
  const blockedByCategory = getBlockedByCategory(tabId);

  return { hostname, blocked, groups, blockedByCategory, dataSaved, recentRequests: getRecentRequests(tabId, 10) };
}

// ── Tab lifecycle ───────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    trackPopupRedirect(tabId, changeInfo.url);
  }

  if (changeInfo.status === 'loading' && tab.url) {
    const hostname = extractDomain(tab.url);

    // Reset tracker buffer on navigation
    if (IS_CHROMIUM) {
      chromiumTabTrackers.delete(tabId);
    }

    // Init tab tracking for BOTH platforms
    initTab(tabId, hostname);
    if (!IS_CHROMIUM) {
      updateBadge(tabId);
    }

    // Phase A4: a fresh top-level navigation in this tab is a strong "user is
    // active" signal. Record a synthetic gesture so child tabs spawned right
    // after (e.g. by a click that triggers both navigation and window.open)
    // are not mistaken for popunders.
    if (tab.url.startsWith('http')) {
      recordUserGesture(tabId, { type: 'tab-loading' });
    }
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  registerPopupCandidate(tab);
});

// Phase A5: prime a synthetic user gesture whenever the user actively switches
// to a tab. This avoids the race where the very first click of a session opens
// a child tab before our content-script gesture bridge has reported anything.
chrome.tabs.onActivated.addListener((info) => {
  if (!info || !Number.isInteger(info.tabId) || info.tabId < 0) return;
  recordUserGesture(info.tabId, { type: 'tab-activated' });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Firefox: flush pending stats
  if (!IS_CHROMIUM) {
    const tab = getTab(tabId);
    if (tab && tab.hostname && tab.blocked > 0) {
      const alreadySaved = tab._savedBlocked || 0;
      const newBlocked = tab.blocked - alreadySaved;
      if (newBlocked > 0) {
        const newRequests = tab.requests.slice(tab._savedRequestIdx || 0);
        const trackerDomains = [...new Set(newRequests.map(r => r.domain))];
        try {
          await addDailyStat(tab.hostname, newBlocked, trackerDomains);
        } catch (e) {}
      }
    }
    pendingSaveTabsFirefox.delete(tabId);
  }

  // Chromium: clean up tracking
  pendingSaveTabsFirefox.delete(tabId);
  removeTab(tabId);
  chromiumTabTrackers.delete(tabId);
  recentChromiumBlockedUrls.delete(tabId);
  lastCollectTime.delete(tabId);
  clearPopupUpdateTimer(tabId);
  clearPopupTracking(tabId);

  if (IS_CHROMIUM && chrome.storage?.session?.remove) {
    try {
      await chrome.storage.session.remove(`tab_${tabId}`);
    } catch (e) {
      // Ignore storage cleanup errors.
    }
  }
});

// ── Alarm handler ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'update-lists') {
    console.log('[midori] Updating filter lists...');
    try {
      const { lists, changedCount } = await downloadAllListsWithStatus();
      if (Object.keys(lists).length > 0 && (engine.rulesCount === 0 || changedCount > 0)) {
        await loadEngine(lists);
        console.log(`[midori] Lists updated. ${engine.rulesCount} rules.`);
      } else {
        console.log('[midori] Lists unchanged. Engine rebuild skipped.');
      }
    } catch (e) {
      console.error('[midori] Update failed:', e);
    }
  }

  if (alarm.name === 'collect-stats') {
    await collectChromiumStats();
  }

  // TrackerDB update alarm
  if (alarm.name === TRACKERDB_ALARM_NAME) {
    const options = await getOptions();
    const result = await handleTrackerDbAlarm(alarm.name, {
      primaryUrl: options.trackerDbUrl || undefined,
    });
    // Re-apply dynamic rules if assisted blocking is on and we got new data
    if (result === 'updated' && shouldEnableTrackerDbAssisted(options) && IS_CHROMIUM) {
      applyTrackerDbDynamicRules(true).catch(e =>
        console.warn('[midori] TrackerDB dynamic rules update:', e)
      );
    }
    if (result === 'updated' && IS_CHROMIUM) {
      updateDnrEntityBlockRules(options).catch(e =>
        console.warn('[midori] Entity session rules update:', e)
      );
    }
  }

  if (alarm.name === 'resume-protection') {
    console.log('[midori] Auto-resuming protection after pause');
    const opts = await getOptions();
    const whitelist = { ...(opts.whitelist || {}) };
    const pausedHost = opts.pausedHostname;
    if (pausedHost) delete whitelist[pausedHost];
    await setOptions({ whitelist, pauseUntil: 0, pausedHostname: '' });
    if (IS_CHROMIUM) await updateDnrWhitelist();
  }

  if (telemetry.isDirty()) {
    await flushTelemetry().catch(() => {});
  }

});

// ── Message handler (popup & options communication) ─────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(e => {
    console.error('[midori] Message error:', e);
    sendResponse({ error: e.message });
  });
  return true; // async response
});

// ── External message handler (New Tab extension / external consumers) ───────
// Only expose read-only stats actions for security
const EXTERNAL_ALLOWED_ACTIONS = new Set([
  'get-stats-summary', 'get-report-stats', 'get-report-categories',
  'get-weekly-trend', 'get-privacy-summary', 'get-hourly-heatmap',
]);

if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
    if (!msg?.action || !EXTERNAL_ALLOWED_ACTIONS.has(msg.action)) {
      sendResponse({ error: 'Action not allowed' });
      return false;
    }
    handleMessage(msg, sender).then(sendResponse).catch(e => {
      sendResponse({ error: e.message });
    });
    return true;
  });
}

const dispatchMessage = createMessageDispatcher({
  IS_CHROMIUM,
  PROTECTION_LEVELS,
  telemetry,
  ghosteryEngine,
  extractDomain,
  getPopupDefenseConfig,
  getRuntimeOptions,
  isProtectionBypassedForHost,
  isHostnameWhitelisted,
  recordUserGesture,
  recordWindowSignal,
  getEffectiveRolloutFlags,
  getChromiumTabStats,
  getEcoStats,
  getGroupedRequestsEnriched,
  getEntityControlForGroups,
  getBlockedByCategory,
  getTab,
  getDataSaved,
  getRecentRequests,
  recordPopupBlocked,
  recordCosmeticBlocks,
  resolveSiteProfile,
  isCriticalFirstPartySite,
  getAntiFingerprintMode,
  buildIaShieldConfig,
  normalizeIaRiskEvent,
  appendIaRiskEvent,
  summarizeIaRiskEvents,
  getOptions,
  setOptions,
  refreshRuntimeOptions,
  recordIaShieldRiskEvent,
  toggleWhitelist,
  updateDnrWhitelist,
  getBlockedEntitiesMap,
  updateDnrEntityBlockRules,
  setEnabled: (enabled) => {
    isEnabled = enabled;
  },
  getEngine: () => engine,
  reloadFirefoxEngineForOptions,
  shouldEnableTrackerDbAssisted,
  setTrackerDbAssistedEnabled: (enabled) => {
    isTrackerDbAssistedEnabled = enabled;
  },
  isTrackerDbAssistedEnabled: () => isTrackerDbAssistedEnabled,
  applyTrackerDbDynamicRules,
  installPopunderDnrRules,
  broadcastOptionsChanged,
  recordContentScriptCost,
  recordAppliedRulesEvent,
  recordFalsePositive,
  recordGlobalCssFalsePositive,
  getTopTrackedSites,
  getBlockingStats,
  getCategoryDistribution,
  getHourlyHeatmap,
  getWeeklyTrend,
  getPrivacySummary,
  getAppliedRulesDiagnostics,
  exportReport,
  downloadAllListsWithStatus,
  loadEngine,
  fetchAndUpdateTrackerDb,
  getTrackerDbMeta,
  rollbackTrackerDb,
});

async function handleMessage(msg, sender) {
  return dispatchMessage(msg, sender);
}

// ── Chromium: DNR whitelist management ──────────────────────────────────────

async function updateDnrWhitelist() {
  if (!IS_CHROMIUM) return;

  const options = await getOptions();
  const whitelist = options.whitelist || {};
  const domains = Object.keys(whitelist).filter(d => whitelist[d]);

  const existingRules = await chrome.declarativeNetRequest.getSessionRules();
  const removeIds = existingRules
    .filter(r => r.id >= 900000 && r.id < 910000)
    .map(r => r.id);

  const addRules = domains.map((domain, i) => ({
    id: 900000 + i,
    priority: 10,
    action: { type: 'allow' },
    condition: {
      initiatorDomains: [domain],
      resourceTypes: [
        'sub_frame', 'stylesheet', 'script', 'image',
        'font', 'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other'
      ],
    },
  }));

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: removeIds,
    addRules,
  });
}

// ── Chromium: URL cleaner via dynamic DNR ───────────────────────────────────
// Ghostery-style: strips known tracking query parameters from main_frame /
// sub_frame navigations using a single redirect rule with queryTransform.
// Idempotent: re-installing replaces the prior rule(s).
async function installDnrUrlCleanerRule() {
  if (!IS_CHROMIUM) return;
  const CLEANER_RULE_ID = 950001;
  try {
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const removeIds = existing
      .filter(r => r.id >= 950000 && r.id < 950100)
      .map(r => r.id);
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: removeIds,
      addRules: buildCleanerDnrRules(CLEANER_RULE_ID),
    });
  } catch (e) {
    console.warn('[midori] Failed to install URL cleaner DNR rule:', e?.message || e);
  }
}

// ── Chromium: confirmed popunder network block rules ───────────────────────
// These are high-confidence pop/tabunder networks that are better blocked at
// the browser network layer than cleaned up after a tab has already opened.
async function installPopunderDnrRules() {
  if (!IS_CHROMIUM) return;
  try {
    const options = await getOptions();
    const now = Date.now();
    const popupAllowlist = options.popupAllowlist || {};
    const allowedInitiators = Object.entries(popupAllowlist)
      .filter(([, entry]) => entry === true || !Number(entry?.expiresAt || 0) || Number(entry.expiresAt || 0) > now)
      .map(([hostname]) => hostname)
      .filter(Boolean)
      .slice(0, 30);

    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const removeIds = existing
      .filter(r => r.id >= 960000 && r.id < 960300)
      .map(r => r.id);

    const addRules = CONFIRMED_POPUNDER_DOMAINS.slice(0, 190).map((domain, index) => ({
      id: 960000 + index,
      priority: 35,
      action: { type: 'block' },
      condition: {
        requestDomains: [domain],
        resourceTypes: [
          'main_frame', 'sub_frame', 'script', 'xmlhttprequest',
          'ping', 'other',
        ],
      },
    }));
    if (allowedInitiators.length > 0) {
      addRules.push({
        id: 960250,
        priority: 45,
        action: { type: 'allow' },
        condition: {
          requestDomains: CONFIRMED_POPUNDER_DOMAINS.slice(0, 190),
          initiatorDomains: allowedInitiators,
          resourceTypes: [
            'main_frame', 'sub_frame', 'script', 'xmlhttprequest',
            'ping', 'other',
          ],
        },
      });
    }

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: removeIds,
      addRules,
    });
  } catch (e) {
    console.warn('[midori] Failed to install popunder DNR rules:', e?.message || e);
  }
}

// ── Chromium: first-party CDN allow rules ───────────────────────────────────
// Static DNR rulesets (EasyPrivacy, uBlock Privacy) match generic third-party
// trackers and end up blocking legitimate same-owner CDNs (e.g.
// `redditstatic.com` while the user is on `reddit.com`). We mirror the
// curated `FIRST_PARTY_CDN_MAP` from policy-engine into session allow rules
// with high priority so first-party bundles are never shadow-blocked by
// the static rulesets. Mirrors the Firefox webRequest relaxation path.
async function applyFirstPartyCdnAllowRules() {
  if (!IS_CHROMIUM) return;

  try {
    const existingRules = await chrome.declarativeNetRequest.getSessionRules();
    const removeIds = existingRules
      .filter(r => r.id >= 920000 && r.id < 930000)
      .map(r => r.id);

    const addRules = [];
    let nextId = 920000;

    for (const [cdn, owners] of Object.entries(FIRST_PARTY_CDN_MAP)) {
      if (!Array.isArray(owners) || owners.length === 0) continue;
      addRules.push({
        id: nextId++,
        priority: 20,
        action: { type: 'allow' },
        condition: {
          requestDomains: [cdn],
          initiatorDomains: owners,
          resourceTypes: [
            'sub_frame', 'stylesheet', 'script', 'image',
            'font', 'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other',
          ],
        },
      });
    }

    // Phase E (2026-05-07): critical-first-party self-allow rules.
    // For each curated critical site (Gmail, Outlook, iCloud, banking, etc.)
    // emit a `firstParty` allow rule scoped to its initiators. This guarantees
    // that static DNR rulesets (EasyPrivacy, uBlock Privacy, etc.) cannot block
    // first-party requests on these high-impact apps. Third-party trackers
    // are still blocked normally.
    const criticalInitiators = Array.from(CRITICAL_FIRST_PARTY_SITES);
    if (criticalInitiators.length > 0 && nextId < 929900) {
      addRules.push({
        id: nextId++,
        priority: 25,
        action: { type: 'allow' },
        condition: {
          initiatorDomains: criticalInitiators,
          domainType: 'firstParty',
          resourceTypes: [
            'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
            'font', 'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other',
          ],
        },
      });
    }

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: removeIds,
      addRules,
    });
  } catch (e) {
    console.warn('[midori] First-party CDN allow rules update failed:', e);
  }
}

// ── Handle install/update ────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (IS_CHROMIUM) {
    chrome.declarativeNetRequest.setExtensionActionOptions({
      displayActionCountAsBadgeText: true,
    }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' }).catch(() => {});
  }

  // Open setup wizard on first install (delayed to let the browser
  // finish showing the search engine change prompt from chrome_settings_overrides)
  if (details.reason === 'install') {
    const opts = await getOptions();
    if (!opts.setupCompleted) {
      const setupUrl = chrome.runtime.getURL('setup/setup.html');
      setTimeout(() => {
        chrome.tabs.create({ url: setupUrl });
      }, 1500);
    }
  }

  // Phase C (2026-05-06): apply safe-default migration on update.
  // Only resets experiments still on the OLD bulk-enabled defaults.
  if (details.reason === 'update') {
    try {
      const result = await applyPhaseCSafeDefaults();
      if (result.applied && result.changed.length > 0) {
        console.log('[midori] Phase C safe defaults applied:', result.changed.join(', '));
      }
    } catch (e) {
      console.warn('[midori] Phase C migration failed:', e);
    }

    // v2.2.3 (2026-05-07): purge obsolete `ddg-tds` list + caches and wipe
    // the serialized engine snapshot so blocking is rebuilt from fresh
    // EasyList/EasyPrivacy/uBlock rules. Also reasserts the Phase E
    // critical-first-party set (google.com no longer relaxes doubleclick.net).
    try {
      const cleanup = await applyV223Cleanup();
      if (cleanup.applied) {
        console.log('[midori] v2.2.3 cleanup applied:', cleanup);
        await wipeEngineCache();
      }
    } catch (e) {
      console.warn('[midori] v2.2.3 cleanup failed:', e);
    }
  }
});

// ── Firefox: register webRequest listener synchronously at load time ────────
// Must be registered at top level before any async work, otherwise Firefox
// may miss early requests.
if (!IS_CHROMIUM) {
  console.log('[midori] Firefox: registering webRequest listener');
  setupWebRequestBlocking();
}

// ── Chromium: observe blocked requests via onErrorOccurred ──────────────────
// When declarativeNetRequest blocks a request, it fires onErrorOccurred with
// error "net::ERR_BLOCKED_BY_CLIENT". We use this to capture blocked URLs
// and categorize them in the stats-collector.
if (IS_CHROMIUM && webRequestAPI?.onErrorOccurred) {
  webRequestAPI.onErrorOccurred.addListener(
    (details) => {
      if (!isEnabled) return;
      if (details.tabId < 0) return;
      if (details.error !== 'net::ERR_BLOCKED_BY_CLIENT') return;
      if (!details.url || !details.url.startsWith('http')) return;

      const tab = getTab(details.tabId);
      if (tab) recordChromiumBlockedRequest(details.tabId, details.url, { reason: 'rule-match' });
    },
    { urls: ['<all_urls>'] }
  );
}

if (chrome.runtime?.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    flushLocalReputation().catch(() => {});
    flushTelemetry().catch(() => {});
  });
}

// ── Start ───────────────────────────────────────────────────────────────────

loadLocalReputation()
  .catch((e) => console.warn('[midori] Local reputation startup failed:', e))
  .finally(() => initialize());

/**
 * Midori Privacy Blocker
 * Main background service worker
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

import { getOptions, setOptions, isWhitelisted, toggleWhitelist, addDailyStat, recordHourlyBlock } from './storage.js';
import { extractDomain, categorizeRequest } from './filter-utils.js';
import { GhosteryEngine } from './ghostery-engine.js';
import { downloadAllLists, getCachedLists, scheduleUpdates } from './lists-manager.js';
import { initTab, recordBlock, removeTab, getTab, ensureTab, getGroupedRequests, getGroupedRequestsEnriched, getRecentRequests, getBlockedCount, getBlockedByCategory, getDataSaved, updateBadge, getEcoStats } from './stats-collector.js';
import { getTopTrackedSites, getBlockingStats, getCategoryDistribution, getHourlyHeatmap, getWeeklyTrend, getPrivacySummary, getAppliedRulesDiagnostics, exportReport } from './report-generator.js';
import {
  evaluateRequestPolicy,
  getPopupDefenseConfig,
  resolveSiteProfile,
  invalidateSiteProfileCache,
} from './policy-engine.js';
import {
  loadTrackerDbFromCache,
  fetchAndUpdateTrackerDb,
  scheduleTrackerDbUpdates,
  handleTrackerDbAlarm,
  rollbackTrackerDb,
  getTrackerDbMeta,
  collectHighConfidenceDomains,
  getTrackerEntityMetadata,
  TRACKERDB_ALARM_NAME,
} from './trackerdb.js';
import {
  buildIaShieldConfig,
  normalizeIaRiskEvent,
  appendIaRiskEvent,
  summarizeIaRiskEvents,
} from './ia-shield.js';
import {
  handleAutoConsentRequest,
  handleAutoConsentPageMessage,
} from './autoconsent.js';

// ── Single engine: Ghostery (primary and only runtime engine) ──
const ghosteryEngine = new GhosteryEngine();
let engine = ghosteryEngine;
let isEnabled = true;
const IS_CHROMIUM = __PLATFORM__ === 'chromium';

// ── Hourly block debounce buffer ────────────────────────────────────────────
let _hourlyBlockBuffer = 0;
let _hourlyFlushTimer = null;
const HOURLY_FLUSH_INTERVAL = 60000; // 60s
const TELEMETRY_FLUSH_INTERVAL = 15000; // 15s

let telemetryState = null;
let telemetryFlushTimer = null;
let telemetryDirty = false;
let runtimeOptionsCache = null;

const popupGestureState = new Map();
const popupCandidates = new Map();
const popupBurstState = new Map();

// Phase 6: popupCandidates memory leak fix — cap size + TTL eviction
const MAX_POPUP_CANDIDATES = 50;
const POPUP_CANDIDATE_TTL_MS = 60000; // 60s

const ADULT_POPUNDER_DOMAINS = [
  'trafficjunky.net', 'trafficjunky.com', 'juicyads.com', 'exoclick.com',
  'ero-advertising.com', 'plugrush.com', 'exdynsrv.com', 'popads.net',
  'popcash.net', 'onclickads.net', 'hilltopads.net', 'adcash.com',
];

// ── Popup update notification debounce (8.1 optimization) ───────────────────
const popupUpdateTimers = new Map();
const POPUP_UPDATE_DEBOUNCE_MS = 200; // Batch updates every 200ms

function hostnameMatches(hostname, pattern) {
  return hostname === pattern || hostname.endsWith(`.${pattern}`);
}

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

// ── Notify popup of stats changes (8.1 optimization: event-driven) ──────────
async function notifyPopupStatsChange(tabId) {
  if (!tabId) return;

  // Clear existing timer for this tab
  if (popupUpdateTimers.has(tabId)) {
    clearTimeout(popupUpdateTimers.get(tabId));
  }

  // Schedule debounced notification
  const timer = setTimeout(async () => {
    popupUpdateTimers.delete(tabId);
    
    try {
      let statsData;
      
      if (IS_CHROMIUM) {
        const stats = await getChromiumTabStats(tabId);
        const eco = getEcoStats(tabId);
        statsData = { ...stats, ...eco };
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
      
      // Send to popup if it's listening
      chrome.tabs.sendMessage(tabId, {
        action: 'popup-stats-update',
        tabId,
        data: statsData,
      }).catch(() => {
        // Popup not listening or tab closed, ignore silently
      });
    } catch (e) {
      // Silently ignore errors (popup not open, etc.)
    }
  }, POPUP_UPDATE_DEBOUNCE_MS);

  popupUpdateTimers.set(tabId, timer);
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

function createMetricBucket() {
  return { count: 0, avg: 0, min: 0, max: 0, last: 0 };
}

function normalizeTelemetry(raw) {
  const t = raw || {};
  const contentScriptCostMs = t.contentScriptCostMs || {};
  const falsePositiveReports = t.falsePositiveReports || {};
  const iaShield = t.iaShield || {};
  const appliedRulesDiagnostics = t.appliedRulesDiagnostics || {};
  return {
    enabled: t.enabled !== false,
    version: 1,
    updatedAt: t.updatedAt || 0,
    startupLatencyMs: { ...createMetricBucket(), ...(t.startupLatencyMs || {}) },
    matchingLatencyMs: { ...createMetricBucket(), ...(t.matchingLatencyMs || {}) },
    contentScriptCostMs: {
      cosmetic: { ...createMetricBucket(), ...(contentScriptCostMs.cosmetic || {}) },
      scriptlets: { ...createMetricBucket(), ...(contentScriptCostMs.scriptlets || {}) },
      perPage: { ...(contentScriptCostMs.perPage || {}) },
    },
    blockedByCategory: {
      total: 0,
      ads: 0,
      trackers: 0,
      other: 0,
      unknown: 0,
      ...(t.blockedByCategory || {}),
    },
    falsePositiveReports: {
      total: 0,
      byCategory: { ads: 0, trackers: 0, other: 0, unknown: 0, ...(falsePositiveReports.byCategory || {}) },
      byHostname: { ...(falsePositiveReports.byHostname || {}) },
    },
    iaShield: {
      totalEvents: 0,
      bySeverity: { low: 0, medium: 0, high: 0, critical: 0, ...(iaShield.bySeverity || {}) },
      byType: { ...(iaShield.byType || {}) },
      byHostname: { ...(iaShield.byHostname || {}) },
      lastEventAt: iaShield.lastEventAt || 0,
    },
    appliedRulesDiagnostics: {
      totalEvents: 0,
      updatedAt: 0,
      byTabHost: {
        ...(appliedRulesDiagnostics.byTabHost || {}),
      },
    },
  };
}

function updateMetricBucket(bucket, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return;

  bucket.count = (bucket.count || 0) + 1;
  bucket.last = numeric;
  bucket.avg = bucket.count === 1 ? numeric : ((bucket.avg || 0) * (bucket.count - 1) + numeric) / bucket.count;
  bucket.min = bucket.count === 1 ? numeric : Math.min(bucket.min, numeric);
  bucket.max = bucket.count === 1 ? numeric : Math.max(bucket.max, numeric);
}

function markTelemetryDirty() {
  if (!telemetryState?.enabled) return;
  telemetryDirty = true;
  if (!telemetryFlushTimer) {
    telemetryFlushTimer = setTimeout(() => {
      flushTelemetry().catch((e) => {
        console.warn('[midori] Failed to flush local telemetry:', e);
      });
    }, TELEMETRY_FLUSH_INTERVAL);
  }
}

async function flushTelemetry() {
  if (telemetryFlushTimer) {
    clearTimeout(telemetryFlushTimer);
    telemetryFlushTimer = null;
  }
  if (!telemetryDirty || !telemetryState) return;
  telemetryDirty = false;
  telemetryState.updatedAt = Date.now();
  await setOptions({ localTelemetry: telemetryState });
}

function initTelemetryFromOptions(options) {
  telemetryState = normalizeTelemetry(options?.localTelemetry);
}

function recordStartupLatency(ms) {
  if (!telemetryState?.enabled) return;
  updateMetricBucket(telemetryState.startupLatencyMs, ms);
  markTelemetryDirty();
}

function recordMatchingLatency(ms) {
  if (!telemetryState?.enabled) return;
  updateMetricBucket(telemetryState.matchingLatencyMs, ms);
  markTelemetryDirty();
}

function recordBlockedCategory(category) {
  if (!telemetryState?.enabled) return;
  const cat = (category === 'ads' || category === 'trackers' || category === 'other') ? category : 'unknown';
  telemetryState.blockedByCategory.total = (telemetryState.blockedByCategory.total || 0) + 1;
  telemetryState.blockedByCategory[cat] = (telemetryState.blockedByCategory[cat] || 0) + 1;
  markTelemetryDirty();
}

function recordContentScriptCost(script, hostname, durationMs) {
  if (!telemetryState?.enabled) return;
  const key = script === 'scriptlets' ? 'scriptlets' : 'cosmetic';
  updateMetricBucket(telemetryState.contentScriptCostMs[key], durationMs);

  const host = (hostname || '').toLowerCase();
  if (host) {
    const perPage = telemetryState.contentScriptCostMs.perPage;
    const current = perPage[host] || { count: 0, avg: 0, last: 0, total: 0 };
    current.count += 1;
    current.total += Number(durationMs) || 0;
    current.last = Number(durationMs) || 0;
    current.avg = current.total / current.count;
    perPage[host] = current;

    const keys = Object.keys(perPage);
    if (keys.length > 250) {
      const oldest = keys.slice(0, keys.length - 250);
      for (const k of oldest) {
        delete perPage[k];
      }
    }
  }

  markTelemetryDirty();
}

function recordFalsePositive(hostname, category) {
  if (!telemetryState?.enabled) return;
  const cat = (category === 'ads' || category === 'trackers' || category === 'other') ? category : 'unknown';
  const fp = telemetryState.falsePositiveReports;
  fp.total = (fp.total || 0) + 1;
  fp.byCategory[cat] = (fp.byCategory[cat] || 0) + 1;

  const host = (hostname || '').toLowerCase();
  if (host) {
    fp.byHostname[host] = (fp.byHostname[host] || 0) + 1;
    const keys = Object.keys(fp.byHostname);
    if (keys.length > 250) {
      const oldest = keys.slice(0, keys.length - 250);
      for (const k of oldest) {
        delete fp.byHostname[k];
      }
    }
  }

  markTelemetryDirty();
}

function recordIaShieldRiskEvent(event) {
  if (!telemetryState?.enabled || !event) return;

  const bucket = telemetryState.iaShield || {
    totalEvents: 0,
    bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
    byType: {},
    byHostname: {},
    lastEventAt: 0,
  };

  const severity = String(event.severity || 'medium');
  const type = String(event.type || 'unknown').slice(0, 64);
  const hostname = String(event.hostname || '').toLowerCase();

  bucket.totalEvents = (bucket.totalEvents || 0) + 1;
  bucket.bySeverity[severity] = (bucket.bySeverity[severity] || 0) + 1;
  bucket.byType[type] = (bucket.byType[type] || 0) + 1;
  if (hostname) {
    bucket.byHostname[hostname] = (bucket.byHostname[hostname] || 0) + 1;
    const keys = Object.keys(bucket.byHostname);
    if (keys.length > 250) {
      const oldest = keys.slice(0, keys.length - 250);
      for (const k of oldest) {
        delete bucket.byHostname[k];
      }
    }
  }

  bucket.lastEventAt = Number(event.timestamp) || Date.now();
  telemetryState.iaShield = bucket;
  markTelemetryDirty();
}

function pushUniqueSamples(target, incoming, maxItems) {
  if (!Array.isArray(target) || !Array.isArray(incoming)) return;
  const seen = new Set(target);
  for (const raw of incoming) {
    const value = String(raw || '').trim().slice(0, 120);
    if (!value || seen.has(value)) continue;
    target.push(value);
    seen.add(value);
    if (target.length >= maxItems) break;
  }
}

function recordAppliedRulesEvent(msg, sender) {
  if (!telemetryState?.enabled) return;

  const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : -1;
  const hostname = String(msg?.hostname || '').trim().toLowerCase().slice(0, 255);
  if (!hostname) return;

  const selectorCount = Math.max(0, Number(msg?.selectorCount) || 0);
  const scriptletCount = Math.max(0, Number(msg?.scriptletCount) || 0);
  if (selectorCount === 0 && scriptletCount === 0) return;

  const diag = telemetryState.appliedRulesDiagnostics || {
    totalEvents: 0,
    updatedAt: 0,
    byTabHost: {},
  };

  const byTabHost = diag.byTabHost || {};
  const key = `${tabId}|${hostname}`;
  const entry = byTabHost[key] || {
    tabId,
    hostname,
    eventCount: 0,
    selectorCount: 0,
    scriptletCount: 0,
    selectorsSample: [],
    scriptletsSample: [],
    sources: {},
    firstSeenAt: Date.now(),
    lastSeenAt: 0,
  };

  entry.eventCount += 1;
  entry.selectorCount += selectorCount;
  entry.scriptletCount += scriptletCount;
  entry.lastSeenAt = Date.now();

  pushUniqueSamples(entry.selectorsSample, msg?.selectorsSample || [], 24);
  pushUniqueSamples(entry.scriptletsSample, msg?.scriptletsSample || [], 24);

  const sources = msg?.sources && typeof msg.sources === 'object' ? msg.sources : {};
  for (const [source, value] of Object.entries(sources)) {
    const n = Math.max(0, Number(value) || 0);
    if (!n) continue;
    entry.sources[source] = (entry.sources[source] || 0) + n;
  }

  byTabHost[key] = entry;

  const keys = Object.keys(byTabHost);
  if (keys.length > 180) {
    keys
      .sort((left, right) => (byTabHost[left]?.lastSeenAt || 0) - (byTabHost[right]?.lastSeenAt || 0))
      .slice(0, keys.length - 180)
      .forEach((oldKey) => {
        delete byTabHost[oldKey];
      });
  }

  diag.totalEvents = (diag.totalEvents || 0) + 1;
  diag.updatedAt = Date.now();
  diag.byTabHost = byTabHost;
  telemetryState.appliedRulesDiagnostics = diag;

  markTelemetryDirty();
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

function recordUserGesture(tabId, payload = {}) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  popupGestureState.set(tabId, {
    at: Date.now(),
    type: payload.type || 'unknown',
    targetTag: payload.targetTag || '',
    href: payload.href || '',
  });
}

function hasRecentUserGesture(tabId, windowMs) {
  const gesture = popupGestureState.get(tabId);
  return !!(gesture && (Date.now() - gesture.at) <= windowMs);
}

function clearPopupTracking(tabId) {
  popupCandidates.delete(tabId);
  popupGestureState.delete(tabId);
}

function trackPopupBurst(openerTabId, config) {
  const now = Date.now();
  const entry = popupBurstState.get(openerTabId) || { timestamps: [] };
  entry.timestamps = entry.timestamps.filter(ts => now - ts <= config.burstWindowMs);
  entry.timestamps.push(now);
  popupBurstState.set(openerTabId, entry);
  return entry.timestamps.length > config.maxBurstWithoutGesture;
}

function maybeClosePopupTab(tabId, reason) {
  if (!popupCandidates.has(tabId)) return;
  popupCandidates.delete(tabId);
  try {
    const result = chrome.tabs.remove(tabId);
    if (result && typeof result.then === 'function') result.catch(() => {});
  } catch (e) {
    try { chrome.tabs.remove(tabId, () => {}); } catch (_) {}
  }
  console.log(`[midori] Closed popup candidate ${tabId}: ${reason}`);
}

function registerPopupCandidate(tab) {
  if (!tab?.id || tab.openerTabId === undefined || tab.openerTabId === null) return;

  // Phase 6: Evict expired candidates before adding new ones
  const now = Date.now();
  if (popupCandidates.size >= MAX_POPUP_CANDIDATES) {
    for (const [id, c] of popupCandidates) {
      if (now - c.createdAt > POPUP_CANDIDATE_TTL_MS) popupCandidates.delete(id);
    }
    // If still at capacity after TTL eviction, drop oldest
    if (popupCandidates.size >= MAX_POPUP_CANDIDATES) {
      const oldest = popupCandidates.keys().next().value;
      popupCandidates.delete(oldest);
    }
  }

  const openerTab = getTab(tab.openerTabId);
  const openerHostname = openerTab?.hostname || '';
  const config = getPopupDefenseConfig(openerHostname, getRuntimeOptions());
  if (!config.enabled) return;

  const allowedByGesture = hasRecentUserGesture(tab.openerTabId, config.gestureWindowMs);
  const burstExceeded = trackPopupBurst(tab.openerTabId, config) && !allowedByGesture;

  popupCandidates.set(tab.id, {
    openerTabId: tab.openerTabId,
    createdAt: Date.now(),
    allowedByGesture,
    config,
    hostHistory: [],
  });

  if (burstExceeded) {
    maybeClosePopupTab(tab.id, 'popup-burst');
    return;
  }

  if (!allowedByGesture && config.closeTabsWithoutGesture) {
    setTimeout(() => {
      if (popupCandidates.has(tab.id)) {
        maybeClosePopupTab(tab.id, 'popup-no-gesture');
      }
    }, config.evaluationDelayMs);
  }
}

function trackPopupRedirect(tabId, url) {
  const candidate = popupCandidates.get(tabId);
  if (!candidate || !url || !url.startsWith('http')) return;

  const host = extractDomain(url);
  if (!host) return;
  const lastHost = candidate.hostHistory[candidate.hostHistory.length - 1];
  if (lastHost !== host) {
    candidate.hostHistory.push(host);
  }

  if (!candidate.allowedByGesture && candidate.hostHistory.length > candidate.config.redirectHopThreshold) {
    maybeClosePopupTab(tabId, 'popup-redirect-burst');
    return;
  }

  if (candidate.config.vertical === 'adult') {
    for (const pattern of ADULT_POPUNDER_DOMAINS) {
      if (hostnameMatches(host, pattern)) {
        maybeClosePopupTab(tabId, 'adult-popunder-network');
        return;
      }
    }
  }
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

// ── TrackerDB assisted blocking — Chromium dynamic rules ────────────────────
// Rule IDs 800001–800500 are reserved for TrackerDB-assisted dynamic rules.
const TRACKERDB_RULE_ID_MIN = 800001;
const TRACKERDB_RULE_ID_MAX = 800500;
const TRACKERDB_MAX_RULES = TRACKERDB_RULE_ID_MAX - TRACKERDB_RULE_ID_MIN + 1;

function shouldEnableTrackerDbAssisted(options) {
  const rollout = getEffectiveRolloutFlags(options);
  if (!rollout.entityBlocking) return false;

  // TrackerDB assisted blocking follows the protection level — no separate experiment flag.
  // strict → block high-confidence trackers not caught by filter lists.
  // standard / basic → classification only, no extra blocking.
  const level = options?.protectionLevel || 'standard';
  return (
    options?.trackerDbEnabled !== false &&
    PROTECTION_LEVELS[level]?.trackerDbAssisted === true
  );
}

/**
 * Apply or remove dynamic DNR rules generated from high-confidence TrackerDB entries.
 * Only has effect on Chromium (MV3) where declarativeNetRequest is available.
 *
 * @param {boolean} enabled - true to add rules, false to clear them
 */
async function applyTrackerDbDynamicRules(enabled) {
  if (!IS_CHROMIUM) return;

  // Remove existing TrackerDB dynamic rules first
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existing
    .filter(r => r.id >= TRACKERDB_RULE_ID_MIN && r.id <= TRACKERDB_RULE_ID_MAX)
    .map(r => r.id);

  if (!enabled) {
    if (removeIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds });
      console.log(`[trackerdb] Cleared ${removeIds.length} TrackerDB dynamic rules`);
    }
    return;
  }

  const meta = getTrackerDbMeta();
  if (!meta.ready) {
    if (removeIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds });
      console.log(`[trackerdb] Cleared ${removeIds.length} TrackerDB dynamic rules (index not ready)`);
    }
    console.log('[trackerdb] Index not ready — skipping dynamic rule generation');
    return;
  }

  const options = await getOptions();
  const whitelist = options.whitelist || {};

  const candidates = collectHighConfidenceDomains(TRACKERDB_MAX_RULES);

  let ruleId = TRACKERDB_RULE_ID_MIN;
  const addRules = [];
  for (const domain of candidates) {
    if (whitelist[domain]) continue; // Never block whitelisted sites
    if (ruleId > TRACKERDB_RULE_ID_MAX) break;
    addRules.push({
      id: ruleId++,
      priority: 1,
      action: { type: 'block' },
      condition: {
        requestDomains: [domain],
        resourceTypes: [
          'script', 'xmlhttprequest', 'image', 'sub_frame',
          'font', 'object', 'ping', 'media', 'websocket', 'other',
        ],
      },
    });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: removeIds,
    addRules,
  });
  console.log(`[trackerdb] Applied ${addRules.length} dynamic rules (assisted blocking)`);
}

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

// ── Initialization ──────────────────────────────────────────────────────────

async function initialize() {
  console.log('[midori] Initializing...');
  const t0 = Date.now();

  const options = await getOptions();
  initTelemetryFromOptions(options);
  refreshRuntimeOptions(options);

  // Chromium: enable native badge counter (zero overhead)
  if (IS_CHROMIUM) {
    try {
      await chrome.declarativeNetRequest.setExtensionActionOptions({
        displayActionCountAsBadgeText: true,
      });
      await chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
      console.log('[midori] Native badge counter enabled');
    } catch (e) {
      console.warn('[midori] Could not enable native badge:', e);
    }
  }

  // ── Step 1: Try to restore Ghostery engine from IndexedDB (instant startup) ──
  let ghosteryRestored = false;
  const t1 = Date.now();
  try {
    ghosteryRestored = await ghosteryEngine.restoreFromCache();
    if (ghosteryRestored) {
      engine = ghosteryEngine;
      console.log(`[midori] Ghostery engine restored from cache in ${Date.now() - t1}ms (${engine.rulesCount} rules)`);
    }
  } catch (e) {
    console.warn('[midori] Ghostery cache restore failed:', e);
  }

  // ── Step 2: Load from filter list text cache (fallback if no serialized engine) ──
  if (!ghosteryRestored) {
    const cached = await getCachedLists();
    if (Object.keys(cached).length > 0) {
      await loadEngine(cached);
      console.log(`[midori] Loaded from list cache in ${Date.now() - t0}ms`);
    }
  }

  // ── Step 3: Queue fresh list download for later (8.4 optimization: incremental warmup) ──
  // Don't block startup on download — schedule for after 3 seconds
  setTimeout(() => {
    downloadAllLists().then(lists => {
      if (Object.keys(lists).length > 0) {
        loadEngine(lists).catch(e => console.error('[midori] Warmup load failed:', e));
      }
    }).catch(e => console.warn('[midori] Warmup download failed:', e));
  }, 3000);

  // Schedule periodic updates
  scheduleUpdates();

  // ── Step 4: Load TrackerDB from cache (instant) then schedule background refresh ──
  try {
    const trackerDbCached = await loadTrackerDbFromCache();
    // Apply DNR rules only when cache is loaded AND level demands it.
    // No auto-fetch here — large remote feeds can crash the service worker.
    // The alarm (first fire: 2 h after startup) handles background updates.
    if (trackerDbCached && IS_CHROMIUM && isTrackerDbAssistedEnabled) {
      applyTrackerDbDynamicRules(true).catch(e =>
        console.warn('[midori] TrackerDB dynamic rules (startup):', e)
      );
    }
    if (IS_CHROMIUM) {
      updateDnrEntityBlockRules(options).catch(e =>
        console.warn('[midori] Entity session rules (startup):', e)
      );
    }
    scheduleTrackerDbUpdates(options.trackerDbUpdateIntervalHours || 24);
  } catch (e) {
    console.warn('[midori] TrackerDB startup failed (non-fatal):', e);
  }

  // Chromium: schedule periodic stats collection via alarm
  if (IS_CHROMIUM) {
    chrome.alarms.create('collect-stats', { periodInMinutes: 2 });
  }

  const bootMs = Date.now() - t0;
  console.log(`[midori] Ready in ${bootMs}ms. Engine: Ghostery, ${engine.rulesCount} rules.`);
  recordStartupLatency(bootMs);

}

async function loadEngine(lists) {
  // ── Ghostery engine (single engine path) ──
  try {
    ghosteryEngine.loadLists(lists);
    engine = ghosteryEngine;
    console.log(`[midori] Ghostery engine loaded: ${ghosteryEngine.rulesCount} rules`);

    // Load user custom filters into Ghostery engine
    const options = await getOptions();
    const userFilters = options.userFilters || '';
    if (userFilters.trim()) {
      ghosteryEngine.addUserRules(userFilters);
      console.log('[midori] Loaded user custom filters (Ghostery)');
    }

    // Persist serialized engine to IndexedDB for next startup (async, non-blocking)
    ghosteryEngine.persistToCache().catch(e => {
      console.warn('[midori] Failed to persist Ghostery engine:', e);
    });

    return;
  } catch (e) {
    console.error('[midori] Ghostery engine failed to load lists:', e);
  }
}

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
      if (details.type === 'main_frame') return WR_PASS;

      const url = details.url;
      if (!url.startsWith('http')) return WR_PASS;

      const tab = getTab(details.tabId) || ensureTab(details.tabId);
      const pageHostname = tab.hostname || '';

      if (pageHostname && isWhitelistedSync(pageHostname)) return WR_PASS;

      const tMatchStart = performance.now();
      const matchResult = engine.matchRequest
        ? engine.matchRequest(url, pageHostname, details.type)
        : null;
      const policy = evaluateRequestPolicy({
        url,
        pageHostname,
        resourceType: details.type,
        options: getRuntimeOptions(),
        engine,
        matchResult,
      });
      recordMatchingLatency(performance.now() - tMatchStart);

      if (policy.shouldBlock) {
        recordBlockedCategory(policy.category || categorizeRequest(url));
        recordBlock(details.tabId, url, {
          category: policy.category,
          reason: policy.reason,
          ownerId: policy.ownerId,
          confidence: policy.trackerConfidence,
          fingerprinting: policy.taxonomy === 'fingerprinting' || policy.trackerCategory === 'fingerprinting',
        });
        updateBadge(details.tabId);
        
        // Notify popup of stats changes (8.1 optimization: event-driven)
        notifyPopupStatsChange(details.tabId);

        // Record hourly stats for heatmap (debounced)
        bufferHourlyBlock(1);

        // Debounced save for Firefox — Phase 6: reduced from 30s to 5s
        pendingSaveTabsFirefox.add(details.tabId);
        if (!firefoxSaveTimer) {
          firefoxSaveTimer = setTimeout(flushFirefoxStats, 5000);
        }

        return WR_BLOCK;
      }

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

if (IS_CHROMIUM && chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    const tabId = info.request?.tabId;
    if (!tabId || tabId < 0) return;

    let entry = chromiumTabTrackers.get(tabId);
    if (!entry) {
      entry = { hostname: '', domains: new Set(), blocked: 0 };
      chromiumTabTrackers.set(tabId, entry);
    }

    entry.blocked++;

    // Capture tracker domain (cap at 200 unique domains per tab)
    const url = info.request?.url;
    if (url) {
      recordBlockedCategory(categorizeRequest(url));
    }
    if (entry.domains.size < 200 && url) {
      const d = extractDomain(url);
      if (d) {
        entry.domains.add(d);
        // Also record in stats-collector for proper categorization
        recordBlock(tabId, url, { reason: 'rule-match' });
        updateBadge(tabId);
        
        // Notify popup of stats changes (8.1 optimization: event-driven)
        notifyPopupStatsChange(tabId);
      }
    }

    // Record hourly stats (debounced)
    bufferHourlyBlock(1);

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

  // Use stats-collector groups as primary source (properly categorized)
  let groups = getGroupedRequests(tabId);

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

  return { hostname, blocked, groups, dataSaved, recentRequests: getRecentRequests(tabId, 10) };
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
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  registerPopupCandidate(tab);
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
    removeTab(tabId);
  }

  // Chromium: clean up tracking
  chromiumTabTrackers.delete(tabId);
  lastCollectTime.delete(tabId);
  clearPopupTracking(tabId);
  popupBurstState.delete(tabId);
});

// ── Alarm handler ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'update-lists') {
    console.log('[midori] Updating filter lists...');
    try {
      const lists = await downloadAllLists();
      if (Object.keys(lists).length > 0) {
        await loadEngine(lists);
        console.log(`[midori] Lists updated. ${engine.rulesCount} rules.`);
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

  if (telemetryDirty) {
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

async function handleMessage(msg, sender) {
  switch (msg.action) {
    case 'get-popup-defense-config': {
      const tabHostname = sender?.tab?.url ? extractDomain(sender.tab.url) : '';
      const hostname = String(msg.hostname || tabHostname || '').toLowerCase();
      const runtime = getRuntimeOptions();
      if (isProtectionBypassedForHost(hostname, runtime)) {
        return {
          config: {
            enabled: false,
            defense: 'relaxed',
            gestureWindowMs: 0,
            evaluationDelayMs: 0,
            burstWindowMs: 5000,
            maxBurstWithoutGesture: 99,
            redirectHopThreshold: 99,
            closeTabsWithoutGesture: false,
            vertical: 'general',
          },
        };
      }
      return { config: getPopupDefenseConfig(hostname, runtime) };
    }

    case 'get-site-protection-state': {
      const tabHostname = sender?.tab?.url ? extractDomain(sender.tab.url) : '';
      const hostname = String(msg.hostname || tabHostname || '').toLowerCase();
      const runtime = getRuntimeOptions();
      const globalEnabled = runtime?.enabled !== false;
      const whitelisted = isHostnameWhitelisted(hostname, runtime?.whitelist || {});
      return {
        hostname,
        globalEnabled,
        whitelisted,
        enabled: globalEnabled && !whitelisted,
      };
    }

    case 'popup-guard-user-gesture': {
      const tabId = sender?.tab?.id ?? msg.tabId;
      if (Number.isInteger(tabId) && tabId >= 0) {
        recordUserGesture(tabId, msg);
      }
      return { success: true };
    }

    case 'popup-guard-blocked':
      return { success: true };

    case 'get-tab-stats': {
      const runtimeOptions = getRuntimeOptions();
      const rollout = getEffectiveRolloutFlags(runtimeOptions);

      // Chromium: use getMatchedRules for real-time data
      if (IS_CHROMIUM) {
        const stats = await getChromiumTabStats(msg.tabId);
        const eco = getEcoStats(msg.tabId);
        // Phase 8: Use enriched groups with owner information
        stats.groups = getGroupedRequestsEnriched(msg.tabId);
        stats.entityControl = rollout.entityBlocking
          ? getEntityControlForGroups(stats.groups, runtimeOptions)
          : null;
        stats.blockedByCategory = getBlockedByCategory(msg.tabId);
        return { ...stats, ...eco };
      }
      // Firefox: use in-memory data with enriched owner information (Phase 8)
      const tab = getTab(msg.tabId);
      const groups = getGroupedRequestsEnriched(msg.tabId);
      const eco = getEcoStats(msg.tabId);
      return {
        hostname: tab?.hostname || '',
        blocked: tab?.blocked || 0,
        blockedByCategory: getBlockedByCategory(msg.tabId),
        dataSaved: getDataSaved(msg.tabId),
        groups,
        entityControl: rollout.entityBlocking
          ? getEntityControlForGroups(groups, runtimeOptions)
          : null,
        recentRequests: getRecentRequests(msg.tabId, 10),
        ...eco
      };
    }

    case 'get-rollout-flags': {
      const runtime = getRuntimeOptions();
      return getEffectiveRolloutFlags(runtime);
    }

    case 'get-options':
      return await getOptions();

    case 'get-site-profile': {
      const tabHostname = sender?.tab?.url ? extractDomain(sender.tab.url) : '';
      const host = String(msg.hostname || tabHostname || '').toLowerCase();
      if (!host) return { vertical: 'general', profile: null };
      const siteContext = resolveSiteProfile(host, getRuntimeOptions());
      return {
        hostname: siteContext.hostname,
        vertical: siteContext.vertical,
        profile: siteContext.profile,
      };
    }

    case 'get-ia-shield-config': {
      const tabHostname = sender?.tab?.url ? extractDomain(sender.tab.url) : '';
      const hostname = String(msg.hostname || tabHostname || '').toLowerCase();
      const opts = await getOptions();
      if (isProtectionBypassedForHost(hostname, opts)) {
        return {
          config: {
            enabled: false,
            strict: false,
            sanitizeOnPaste: false,
            monitor: { paste: false, input: false, dom: false },
            isolate: { enabled: false, mode: 'warn' },
            vertical: 'general',
            matchedOverrideDomain: '',
            reason: opts?.enabled === false ? 'disabled' : 'site-whitelisted',
          },
        };
      }
      return { config: buildIaShieldConfig(opts, hostname) };
    }

    case 'ia-shield-risk-event': {
      const opts = await getOptions();
      const tabHostname = sender?.tab?.url ? extractDomain(sender.tab.url) : '';
      const event = normalizeIaRiskEvent(msg.event || null, msg.hostname || tabHostname || '');
      if (!event) {
        return { success: false, error: 'invalid-event' };
      }

      const iaRiskEvents = appendIaRiskEvent(opts.iaRiskEvents, event, 300);
      await setOptions({ iaRiskEvents });
      refreshRuntimeOptions({ ...opts, iaRiskEvents });
      recordIaShieldRiskEvent(event);
      return { success: true };
    }

    case 'get-ia-risk-events': {
      const opts = await getOptions();
      const days = Math.max(1, Math.min(365, Number(msg.days) || 30));
      const limit = Math.max(1, Math.min(500, Number(msg.limit) || 100));
      return summarizeIaRiskEvents(opts.iaRiskEvents || [], days, limit);
    }

    case 'toggle-site': {
      const nowWhitelisted = await toggleWhitelist(msg.hostname);
      refreshRuntimeOptions(await getOptions());
      if (IS_CHROMIUM) {
        await updateDnrWhitelist();
      }
      return { whitelisted: nowWhitelisted };
    }

    case 'toggle-entity-block': {
      const runtime = getRuntimeOptions();
      if (!getEffectiveRolloutFlags(runtime).entityBlocking) {
        return { success: false, error: 'entity-blocking-rollout-disabled' };
      }

      const ownerId = String(msg.ownerId || '').trim();
      if (!ownerId) return { success: false, error: 'ownerId-required' };

      const opts = await getOptions();
      const blockedEntities = { ...getBlockedEntitiesMap(opts) };
      const nextBlocked = msg.blocked !== false;

      if (nextBlocked) blockedEntities[ownerId] = true;
      else delete blockedEntities[ownerId];

      const updatedOptions = await setOptions({ blockedEntities });
      refreshRuntimeOptions(updatedOptions);

      if (IS_CHROMIUM) {
        await updateDnrEntityBlockRules(updatedOptions);
      }

      return { success: true, blocked: nextBlocked, ownerId };
    }

    case 'toggle-enabled': {
      const options = await getOptions();
      isEnabled = !options.enabled;
      await setOptions({ enabled: isEnabled });
      refreshRuntimeOptions({ ...options, enabled: isEnabled });

      if (IS_CHROMIUM) {
        const rulesetIds = ['easylist', 'easyprivacy', 'ublock-filters', 'ublock-privacy', 'peter-lowe', 'ddg-tds'];
        if (isEnabled) {
          await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: rulesetIds });
        } else {
          await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: rulesetIds });
        }
      }

      return { enabled: isEnabled };
    }

    case 'get-report-top-sites':
      return await getTopTrackedSites(msg.days || 30, msg.limit || 10);

    case 'get-report-stats':
      return await getBlockingStats(msg.days || 30);

    case 'get-report-categories':
      return await getCategoryDistribution(msg.days || 30);

    case 'get-hourly-heatmap':
      return await getHourlyHeatmap(msg.days || 7);

    case 'get-weekly-trend':
      return await getWeeklyTrend();

    case 'get-privacy-summary':
      return await getPrivacySummary(msg.days || 30);

    case 'get-applied-rules-diagnostics':
      return await getAppliedRulesDiagnostics(msg.limit || 20);

    case 'export-report':
      return await exportReport();

    case 'update-lists': {
      const lists = await downloadAllLists();
      if (Object.keys(lists).length > 0) {
        await loadEngine(lists);
      }
      return { rulesCount: engine.rulesCount, updatedAt: Date.now() };
    }

    case 'force-update-all': {
      const results = { lists: false, trackerDb: false, errors: [] };
      // Force re-download all filter lists (ignore ETag cache)
      try {
        const lists = await downloadAllLists(true);
        if (Object.keys(lists).length > 0) {
          await loadEngine(lists);
          results.lists = true;
        }
      } catch (e) {
        results.errors.push(`Lists: ${e.message}`);
      }
      // Force re-fetch TrackerDB
      try {
        const opts = await getOptions();
        const tdResult = await fetchAndUpdateTrackerDb({
          primaryUrl: opts.trackerDbUrl || undefined,
        });
        results.trackerDb = tdResult === 'updated';
        if (tdResult === 'unchanged') results.trackerDb = true; // Already up to date counts as success
      } catch (e) {
        results.errors.push(`TrackerDB: ${e.message}`);
      }
      results.updatedAt = Date.now();
      results.rulesCount = engine.rulesCount;
      return results;
    }

    case 'get-cosmetics': {
      const hostname = msg.hostname || '';
      const runtime = getRuntimeOptions();
      if (isProtectionBypassedForHost(hostname, runtime)) {
        return { enabled: false, selectors: [], styles: '', compiledScripts: [] };
      }
      const siteContext = resolveSiteProfile(hostname, getRuntimeOptions());
      const cosmeticsEnabled = siteContext.profile?.cosmeticsEnabled !== false;
      if (!cosmeticsEnabled) {
        return { enabled: false, selectors: [], styles: '', compiledScripts: [] };
      }

      const cosmetics = ghosteryEngine.getFullCosmetics(hostname);
      return {
        enabled: true,
        selectors: [],
        styles: cosmetics.styles || '',
        compiledScripts: (cosmetics.scripts || []).slice(0, 100),
      };
    }

    case 'get-scriptlets': {
      const hostname = msg.hostname || '';
      const runtime = getRuntimeOptions();
      if (isProtectionBypassedForHost(hostname, runtime)) {
        return { enabled: false, scriptlets: [] };
      }
      return {
        enabled: true,
        scriptlets: engine.getScriptletRules(hostname).slice(0, 100),
      };
    }

    case 'get-anti-fingerprint': {
      const tabHostname = sender?.tab?.url ? extractDomain(sender.tab.url) : '';
      const runtime = getRuntimeOptions();
      if (isProtectionBypassedForHost(tabHostname, runtime)) {
        return { enabled: false };
      }
      const afOpts = await getOptions();
      return { enabled: afOpts.antiFingerprint !== false };
    }

    case 'handle-autoconsent': {
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId) || tabId < 0) {
        return { success: false, reason: 'invalid_tab' };
      }
      const tabHostname = sender?.tab?.url ? extractDomain(sender.tab.url) : '';
      if (isProtectionBypassedForHost(tabHostname, getRuntimeOptions())) {
        return { success: false, reason: 'disabled' };
      }
      return await handleAutoConsentRequest(tabId);
    }

    case 'autoconsent-bg-message': {
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId) || tabId < 0) {
        return { result: null };
      }
      return handleAutoConsentPageMessage(tabId, msg.payload);
    }

    case 'get-user-filters': {
      const opts = await getOptions();
      return { userFilters: opts.userFilters || '' };
    }

    case 'save-user-filters': {
      await setOptions({ userFilters: msg.userFilters || '' });
      // Reload engine with user filters
      const cached = await getCachedLists();
      if (Object.keys(cached).length > 0) {
        await loadEngine(cached);
      }
      return { success: true, rulesCount: engine.rulesCount };
    }

    case 'change-protection-level': {
      const level = msg.level;
      const preset = PROTECTION_LEVELS[level];
      if (!preset) return { error: 'Invalid protection level' };

      const opts = await getOptions();
      const lists = opts.lists || {};

      // Update list enabled states from preset
      for (const [listId, enabled] of Object.entries(preset.lists)) {
        if (lists[listId]) {
          lists[listId].enabled = enabled;
        }
      }

      await setOptions({
        protectionLevel: level,
        antiFingerprint: preset.antiFingerprint,
        lists,
      });
      refreshRuntimeOptions({
        ...opts,
        protectionLevel: level,
        antiFingerprint: preset.antiFingerprint,
        lists,
      });

      isTrackerDbAssistedEnabled = shouldEnableTrackerDbAssisted({
        ...opts,
        protectionLevel: level,
      });

      // Chromium: update DNR rulesets
      if (IS_CHROMIUM) {
        try {
          const enableIds = [];
          const disableIds = [];
          const dnrRulesets = ['easylist', 'easyprivacy', 'ublock-filters', 'ublock-privacy', 'peter-lowe', 'ddg-tds'];
          for (const id of dnrRulesets) {
            if (preset.lists[id]) {
              enableIds.push(id);
            } else {
              disableIds.push(id);
            }
          }
          await chrome.declarativeNetRequest.updateEnabledRulesets({
            enableRulesetIds: enableIds,
            disableRulesetIds: disableIds,
          });
          await applyTrackerDbDynamicRules(isTrackerDbAssistedEnabled);
        } catch (e) {
          console.warn('[midori] Failed to update DNR rulesets:', e);
        }
      }

      // Firefox: reload engine
      if (!IS_CHROMIUM) {
        try {
          const freshLists = await getCachedLists();
          if (Object.keys(freshLists).length > 0) {
            await loadEngine(freshLists);
          }
        } catch (e) {
          console.warn('[midori] Failed to reload engine:', e);
        }
      }

      return { success: true, level, label: preset.label };
    }

    case 'save-setup': {
      const config = msg.config || {};
      const nextOptions = await setOptions(config);
      refreshRuntimeOptions(nextOptions);
      isTrackerDbAssistedEnabled = shouldEnableTrackerDbAssisted(nextOptions);

      // Update global enabled state
      if (config.enabled !== undefined) {
        isEnabled = config.enabled;
      }

      // For Chromium: update DNR rulesets based on enabled lists
      if (IS_CHROMIUM && config.lists) {
        try {
          const enableIds = [];
          const disableIds = [];
          const dnrRulesets = ['easylist', 'easyprivacy', 'ublock-filters', 'ublock-privacy', 'peter-lowe', 'ddg-tds'];
          for (const id of dnrRulesets) {
            if (config.lists[id]?.enabled) {
              enableIds.push(id);
            } else {
              disableIds.push(id);
            }
          }
          await chrome.declarativeNetRequest.updateEnabledRulesets({
            enableRulesetIds: enableIds,
            disableRulesetIds: disableIds,
          });
          await applyTrackerDbDynamicRules(isTrackerDbAssistedEnabled);
        } catch (e) {
          console.warn('[midori] Failed to update DNR rulesets from setup:', e);
        }
      }

      // Reload engine for Firefox
      if (!IS_CHROMIUM) {
        try {
          const freshLists = await getCachedLists();
          if (Object.keys(freshLists).length > 0) {
            await loadEngine(freshLists);
          }
        } catch (e) {
          console.warn('[midori] Failed to reload engine from setup:', e);
        }
      }

      return { success: true };
    }

    // ── Pause / Resume protection (temporary whitelist) ──
    case 'pause-protection': {
      const opts = await getOptions();
      const whitelist = { ...(opts.whitelist || {}), [msg.hostname]: true };
      await setOptions({ whitelist, pauseUntil: msg.pauseUntil, pausedHostname: msg.hostname });
      refreshRuntimeOptions({ ...opts, whitelist, pauseUntil: msg.pauseUntil, pausedHostname: msg.hostname });
      if (IS_CHROMIUM) await updateDnrWhitelist();
      // Schedule auto-resume alarm
      const mins = msg.minutes || 5;
      chrome.alarms.create('resume-protection', { delayInMinutes: mins });
      return { success: true };
    }

    case 'resume-protection': {
      const opts = await getOptions();
      const whitelist = { ...(opts.whitelist || {}) };
      if (msg.hostname) delete whitelist[msg.hostname];
      // Also clear pausedHostname
      const pausedHost = opts.pausedHostname;
      if (pausedHost && !msg.hostname) delete whitelist[pausedHost];
      await setOptions({ whitelist, pauseUntil: 0, pausedHostname: '' });
      refreshRuntimeOptions({ ...opts, whitelist, pauseUntil: 0, pausedHostname: '' });
      if (IS_CHROMIUM) await updateDnrWhitelist();
      chrome.alarms.clear('resume-protection');
      return { success: true };
    }

    // ── Quick category toggle from popup ──
    case 'toggle-category': {
      const opts = await getOptions();
      const lists = { ...(opts.lists || {}) };
      const updates = msg.listUpdates || {};
      for (const [listId, enabled] of Object.entries(updates)) {
        if (lists[listId]) {
          lists[listId] = { ...lists[listId], enabled };
        }
      }
      // Merge any extra options (e.g. antiFingerprint) atomically
      const extra = msg.extraOptions || {};
      const savePayload = { lists, categoryState: msg.categoryState || {}, ...extra };
      await setOptions(savePayload);
      refreshRuntimeOptions({ ...opts, ...savePayload });

      // Notify options page about list changes
      broadcastOptionsChanged({ lists, categoryState: msg.categoryState || {} });

      // Chromium: update DNR rulesets
      if (IS_CHROMIUM) {
        try {
          const enableIds = [];
          const disableIds = [];
          const dnrRulesets = ['easylist', 'easyprivacy', 'ublock-filters', 'ublock-privacy', 'peter-lowe', 'ddg-tds'];
          for (const id of dnrRulesets) {
            if (lists[id]?.enabled) enableIds.push(id);
            else disableIds.push(id);
          }
          await chrome.declarativeNetRequest.updateEnabledRulesets({
            enableRulesetIds: enableIds,
            disableRulesetIds: disableIds,
          });
        } catch (e) {
          console.warn('[midori] Failed to update DNR rulesets:', e);
        }
      }

      // Firefox: reload engine
      if (!IS_CHROMIUM) {
        try {
          const freshLists = await getCachedLists();
          if (Object.keys(freshLists).length > 0) await loadEngine(freshLists);
        } catch (e) {}
      }

      return { success: true };
    }

    // ── Partial options save (from popup quick actions) ──
    case 'save-options-partial': {
      if (msg.options) {
        const updatedOptions = await setOptions(msg.options);
        refreshRuntimeOptions(updatedOptions);
        broadcastOptionsChanged(msg.options);
        if (Object.prototype.hasOwnProperty.call(msg.options, 'localTelemetry')) {
          telemetryState = normalizeTelemetry(msg.options.localTelemetry);
        }
        if (
          msg.options.experiments?.trackerDbAssisted !== undefined ||
          msg.options.protectionLevel !== undefined ||
          msg.options.trackerDbEnabled !== undefined
        ) {
          isTrackerDbAssistedEnabled = shouldEnableTrackerDbAssisted(updatedOptions);
          if (IS_CHROMIUM) {
            await applyTrackerDbDynamicRules(isTrackerDbAssistedEnabled).catch(e =>
              console.warn('[midori] applyTrackerDbDynamicRules:', e)
            );
          }
        }
      }
      return { success: true };
    }

    case 'record-content-script-kpi': {
      recordContentScriptCost(msg.script, msg.hostname, msg.durationMs);
      return { success: true };
    }

    case 'record-applied-rules-event': {
      const runtime = getRuntimeOptions();
      if (getEffectiveRolloutFlags(runtime).cosmeticAudit) {
        recordAppliedRulesEvent(msg, sender);
      }
      return { success: true };
    }

    case 'report-false-positive': {
      recordFalsePositive(msg.hostname, msg.category);
      return { success: true, total: telemetryState?.falsePositiveReports?.total || 0 };
    }

    case 'report-site-ad-issue': {
      const hostname = String(msg.hostname || '').trim().toLowerCase();
      if (!hostname) return { success: false, error: 'hostname-required' };

      const issue = String(msg.issue || 'ad-visible').trim().toLowerCase();
      const note = String(msg.note || '').trim().slice(0, 240);
      const evidence = msg.evidence && typeof msg.evidence === 'object' ? msg.evidence : {};

      const opts = await getOptions();
      const reports = Array.isArray(opts.siteAdReports) ? [...opts.siteAdReports] : [];
      reports.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: Date.now(),
        hostname,
        issue,
        note,
        evidence: {
          blocked: Number(evidence.blocked) || 0,
          trackerCount: Number(evidence.trackerCount) || 0,
          score: Number(evidence.score) || 0,
          protectionLevel: String(evidence.protectionLevel || opts.protectionLevel || 'standard'),
          aggressiveVerticalRules: evidence.aggressiveVerticalRules === true,
          quickFixesEnabled: evidence.quickFixesEnabled !== false,
          antiAdblockEnabled: evidence.antiAdblockEnabled !== false,
        },
      });

      const capped = reports.slice(-100);
      await setOptions({ siteAdReports: capped });
      refreshRuntimeOptions({ ...opts, siteAdReports: capped });
      return { success: true, total: capped.length };
    }

    case 'get-site-ad-reports': {
      const opts = await getOptions();
      const limit = Math.max(1, Math.min(50, Number(msg.limit) || 10));
      const hostname = String(msg.hostname || '').trim().toLowerCase();
      let reports = Array.isArray(opts.siteAdReports) ? opts.siteAdReports : [];
      if (hostname) {
        reports = reports.filter(r => r.hostname === hostname);
      }
      return reports.slice(-limit).reverse();
    }

    case 'set-telemetry-enabled': {
      const enabled = msg.enabled !== false;
      telemetryState = telemetryState || normalizeTelemetry(null);
      telemetryState.enabled = enabled;
      telemetryState.updatedAt = Date.now();
      await setOptions({ localTelemetry: telemetryState });
      telemetryDirty = false;
      return { success: true, enabled };
    }

    case 'reset-local-telemetry': {
      telemetryState = normalizeTelemetry(null);
      await setOptions({ localTelemetry: telemetryState });
      telemetryDirty = false;
      return { success: true };
    }

    // ── TrackerDB data layer ─────────────────────────────────────────────────

    case 'get-trackerdb-meta': {
      return getTrackerDbMeta();
    }

    case 'update-trackerdb': {
      const opts = await getOptions();
      const result = await fetchAndUpdateTrackerDb({
        primaryUrl: opts.trackerDbUrl || undefined,
      });
      if (result === 'updated' && shouldEnableTrackerDbAssisted(opts) && IS_CHROMIUM) {
        applyTrackerDbDynamicRules(true).catch(() => {});
      }
      return { result, meta: getTrackerDbMeta() };
    }

    case 'rollback-trackerdb': {
      const ok = await rollbackTrackerDb();
      return { success: ok, meta: getTrackerDbMeta() };
    }

    case 'set-trackerdb-assisted': {
      // Enable / disable TrackerDB assisted blocking at runtime
      const opts = await getOptions();
      const rollout = getEffectiveRolloutFlags(opts);
      const enable = rollout.entityBlocking && msg.enabled !== false;
      const experiments = { ...(opts.experiments || {}), trackerDbAssisted: enable };
      const updatedOptions = await setOptions({ experiments });
      refreshRuntimeOptions(updatedOptions);
      isTrackerDbAssistedEnabled = shouldEnableTrackerDbAssisted(updatedOptions);
      if (IS_CHROMIUM) {
        await applyTrackerDbDynamicRules(isTrackerDbAssistedEnabled).catch(e =>
          console.warn('[midori] applyTrackerDbDynamicRules:', e)
        );
      }
      return { success: true, enabled: isTrackerDbAssistedEnabled };
    }

    // ── API: Stats summary for external consumers (New Tab extension) ──
    case 'get-stats-summary': {
      const days = msg.days || 7;
      const [stats, categories, topSites, summary, trend] = await Promise.all([
        getBlockingStats(days),
        getCategoryDistribution(days),
        getTopTrackedSites(days, msg.limit || 5),
        getPrivacySummary(days),
        getWeeklyTrend(),
      ]);
      const totalBlocked = (stats || []).reduce((sum, d) => sum + d.blocked, 0);
      return {
        totalBlocked,
        categories: categories || { trackers: 0, ads: 0, fingerprinters: 0, other: 0 },
        topSites: topSites || [],
        privacyScore: summary?.avgScore || 100,
        privacyGrade: summary?.avgGrade || 'A+',
        sitesAnalyzed: summary?.sitesAnalyzed || 0,
        trend: trend || { thisWeek: 0, lastWeek: 0, change: 0 },
        dailyStats: stats || [],
      };
    }

    default:
      return { error: 'Unknown action' };
  }
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

async function updateDnrEntityBlockRules(options) {
  if (!IS_CHROMIUM) return;

  const rollout = getEffectiveRolloutFlags(options);

  const blockedEntitiesMap = getBlockedEntitiesMap(options);
  const blockedOwnerIds = rollout.entityBlocking
    ? Object.keys(blockedEntitiesMap).filter(ownerId => blockedEntitiesMap[ownerId] === true)
    : [];

  const existingRules = await chrome.declarativeNetRequest.getSessionRules();
  const removeIds = existingRules
    .filter(r => r.id >= 910000 && r.id < 920000)
    .map(r => r.id);

  const addRules = [];
  let nextRuleId = 910000;

  for (const ownerId of blockedOwnerIds) {
    const entity = getTrackerEntityMetadata(ownerId);
    const domains = Array.isArray(entity?.domains) && entity.domains.length
      ? entity.domains
      : (ownerId.includes('.') ? [ownerId] : []);

    if (!domains.length) continue;

    addRules.push({
      id: nextRuleId++,
      priority: 3,
      action: { type: 'allow' },
      condition: {
        initiatorDomains: domains,
        requestDomains: domains,
        resourceTypes: ['image', 'stylesheet', 'font', 'other'],
      },
    });

    addRules.push({
      id: nextRuleId++,
      priority: 2,
      action: { type: 'block' },
      condition: {
        requestDomains: domains,
        resourceTypes: [
          'sub_frame', 'stylesheet', 'script', 'image',
          'font', 'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other'
        ],
      },
    });
  }

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: removeIds,
    addRules,
  });
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
      if (tab) {
        recordBlockedCategory(categorizeRequest(details.url));
        recordBlock(details.tabId, details.url, { reason: 'rule-match' });
        
        // Notify popup of stats changes (8.1 optimization: event-driven)
        notifyPopupStatsChange(details.tabId);
      }
    },
    { urls: ['<all_urls>'] }
  );
}

if (chrome.runtime?.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    flushTelemetry().catch(() => {});
  });
}

// ── Start ───────────────────────────────────────────────────────────────────

initialize();

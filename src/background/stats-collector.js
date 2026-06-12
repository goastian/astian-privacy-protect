/**
 * Midori Privacy Blocker
 * Per-tab statistics collector
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

import { categorizeRequest, extractDomain } from './filter-utils.js';
import { enrichTrackerWithOwner } from './trackerdb.js';

// In-memory per-tab stats (fast access, no async)
const tabData = new Map();

// Average bytes saved per blocked request (industry estimate, blended across
// ad scripts ~45KB, tracking pixels ~8KB and general resources ~25KB)
const AVG_BYTES_PER_BLOCK = 26000;

// Eco-savings constants (conservative estimates)
const ENERGY_SAVED_PER_BLOCK_KWH = 0.0005; // 0.5 Wh per block
const CO2_SAVED_PER_BLOCK_G = 0.2;         // 0.2g CO2 per block

// Badge update debounce — leading edge paints immediately (no perceived
// delay), trailing edge coalesces bursts so high-traffic pages still only
// repaint a handful of times per second.
const badgeTimers = new Map();
const lastBadgePaint = new Map(); // tabId -> { at, count }
const BADGE_TRAILING_MS = 250;
const BADGE_MIN_PAINT_GAP_MS = 120;

// Resolved once — avoids re-detecting the browser API on every badge update.
let cachedBadgeAPI;
function getBadgeAPI() {
  if (cachedBadgeAPI !== undefined) return cachedBadgeAPI;
  cachedBadgeAPI = (typeof browser !== 'undefined' && browser.browserAction)
    ? browser.browserAction
    : (chrome.action || chrome.browserAction || null);
  return cachedBadgeAPI;
}

export function initTab(tabId, hostname) {
  tabData.set(tabId, {
    hostname,
    blocked: 0,
    blockedByCategory: { ads: 0, trackers: 0, popups: 0, other: 0 },
    observedByCategory: { ads: 0, trackers: 0, other: 0 },
    dataSaved: 0,
    energySaved: 0, // In kWh
    co2Saved: 0,    // In grams
    requests: [],
    _savedBlocked: 0,
    _savedRequestIdx: 0,
  });
  // Navigation reset: clear any stale badge count right away so the badge
  // never shows the previous page's total on the new page.
  paintBadge(tabId);
}

export function getTab(tabId) {
  return tabData.get(tabId) || null;
}

export function ensureTab(tabId) {
  let tab = tabData.get(tabId);
  if (!tab) {
    tab = { 
      hostname: '', 
      blocked: 0, 
      blockedByCategory: { ads: 0, trackers: 0, popups: 0, other: 0 },
      observedByCategory: { ads: 0, trackers: 0, other: 0 },
      dataSaved: 0, 
      energySaved: 0, 
      co2Saved: 0, 
      requests: [], 
      _savedBlocked: 0, 
      _savedRequestIdx: 0 
    };
    tabData.set(tabId, tab);
  }
  if (!tab.blockedByCategory) tab.blockedByCategory = { ads: 0, trackers: 0, popups: 0, other: 0 };
  if (!Object.prototype.hasOwnProperty.call(tab.blockedByCategory, 'popups')) tab.blockedByCategory.popups = 0;
  if (!tab.observedByCategory) tab.observedByCategory = { ads: 0, trackers: 0, other: 0 };
  return tab;
}

export function recordObservation(tabId, url, metadata = {}) {
  const tab = ensureTab(tabId);

  const domain = metadata.domain || extractDomain(url);
  if (!domain) return tab;

  const category = metadata.category || categorizeRequest(url);
  const cat = (category === 'ads' || category === 'trackers') ? category : 'other';

  if (!tab.observedByCategory) tab.observedByCategory = { ads: 0, trackers: 0, other: 0 };
  tab.observedByCategory[cat] = (tab.observedByCategory[cat] || 0) + 1;

  if (tab.requests.length < 150) {
    // Owner enrichment is only needed when we actually store the entry,
    // so skip the lookup entirely once the per-tab cap is reached.
    const tracker = enrichTrackerWithOwner(domain) || {
      domain,
      owner: domain,
      category: 'unknown',
      confidence: 0,
      fingerprintScore: 0,
    };
    const confidence = Number(metadata.confidence ?? tracker.confidence) || 0;
    const fingerprinting = metadata.fingerprinting === true || Number(metadata.fingerprintScore ?? tracker.fingerprintScore) > 0;
    const owner = metadata.owner || tracker.owner || domain;
    const ownerId = metadata.ownerId || tracker.ownerId || domain;
    tab.requests.push({
      domain,
      category: cat,
      owner,
      ownerId,
      confidence,
      fingerprinting,
      reason: metadata.reason || 'observed-tracker',
      observed: true,
    });
  }

  return tab;
}

/**
 * Record a blocked request with enriched owner information.
 * Optimization: batched eco-calculations + owner lookup via LRU cache.
 * 
 * @param {string} tabId
 * @param {string} url
 * @param {object} metadata
 * @returns {object} updated tab
 */
export function recordBlock(tabId, url, metadata = {}) {
  const tab = ensureTab(tabId);

  tab.blocked++;

  const category = metadata.category || categorizeRequest(url);

  // Track per-category blocked count (always accurate, regardless of requests cap)
  if (!tab.blockedByCategory) tab.blockedByCategory = { ads: 0, trackers: 0, popups: 0, other: 0 };
  if (!Object.prototype.hasOwnProperty.call(tab.blockedByCategory, 'popups')) tab.blockedByCategory.popups = 0;
  const cat = (category === 'ads' || category === 'trackers' || category === 'popups') ? category : 'other';
  tab.blockedByCategory[cat]++;

  // Only store details for the first 100 requests (saves memory). Domain
  // extraction + owner enrichment are deferred behind the cap check so the
  // hot path does no string/lookup work once the cap is reached.
  if (tab.requests.length < 100) {
    const domain = metadata.domain || extractDomain(url);
    const tracker = enrichTrackerWithOwner(domain) || {
      domain,
      owner: domain,
      category: 'unknown',
      confidence: 0,
      fingerprintScore: 0,
    };
    tab.requests.push({
      domain,
      category: cat,
      owner: metadata.owner || tracker.owner || domain,
      ownerId: metadata.ownerId || tracker.ownerId || domain,
      confidence: Number(metadata.confidence ?? tracker.confidence) || 0,
      fingerprinting: metadata.fingerprinting === true || Number(metadata.fingerprintScore ?? tracker.fingerprintScore) > 0,
      reason: metadata.reason || 'rule-match',
    });
  }

  return tab;
}

export function removeTab(tabId) {
  tabData.delete(tabId);
  lastBadgePaint.delete(tabId);
  if (badgeTimers.has(tabId)) {
    clearTimeout(badgeTimers.get(tabId));
    badgeTimers.delete(tabId);
  }
}

export function getBlockedCount(tabId) {
  const tab = tabData.get(tabId);
  return tab ? tab.blocked : 0;
}

export function getBlockedByCategory(tabId) {
  const tab = tabData.get(tabId);
  return tab?.blockedByCategory
    ? { ads: 0, trackers: 0, popups: 0, other: 0, ...tab.blockedByCategory }
    : { ads: 0, trackers: 0, popups: 0, other: 0 };
}

export function getObservedByCategory(tabId) {
  const tab = tabData.get(tabId);
  return tab?.observedByCategory
    ? { ads: 0, trackers: 0, other: 0, ...tab.observedByCategory }
    : { ads: 0, trackers: 0, other: 0 };
}

export function getDataSaved(tabId) {
  const tab = tabData.get(tabId);
  if (!tab) return 0;

  // Calculated on demand from the always-accurate blocked counter.
  return tab.blocked * AVG_BYTES_PER_BLOCK;
}

export function getEcoStats(tabId) {
  const tab = tabData.get(tabId);
  if (!tab) return { energySaved: 0, co2Saved: 0 };
  
  // Optimization 8.3: Calculate final stats on demand with full precision
  const totalBlocks = tab.blocked;
  const finalEnergy = totalBlocks * ENERGY_SAVED_PER_BLOCK_KWH;
  const finalCo2 = totalBlocks * CO2_SAVED_PER_BLOCK_G;
  
  return {
    energySaved: finalEnergy,
    co2Saved: finalCo2
  };
}

export function getRecentRequests(tabId, count) {
  const tab = tabData.get(tabId);
  if (!tab || !tab.requests.length) return [];
  const n = count || 10;
  return tab.requests.slice(-n).map(r => ({
    domain: r.domain,
    type: r.category === 'trackers' ? 'tracker' : r.category,
    owner: r.owner || r.domain,
    ownerId: r.ownerId || r.domain,
    reason: r.reason || 'rule-match',
    confidence: Number(r.confidence) || 0,
    fingerprinting: r.fingerprinting === true,
  }));
}

export function getGroupedRequests(tabId) {
  const tab = tabData.get(tabId);
  if (!tab) return { trackers: [], ads: [], other: [] };

  const groups = { trackers: [], ads: [], other: [] };
  const byDomain = new Map();

  for (const req of tab.requests) {
    const existing = byDomain.get(req.domain);
    if (!existing) {
      byDomain.set(req.domain, req);
      continue;
    }
    if (existing.observed === true && req.observed !== true) {
      byDomain.set(req.domain, req);
    }
  }

  for (const req of byDomain.values()) {
    const cat = req.category;
    if (groups[cat]) {
      groups[cat].push(req.domain);
    } else {
      groups.other.push(req.domain);
    }
  }

  return groups;
}

/**
 * Get grouped requests with enriched owner information (Phase 8).
 * Returns objects {domain, owner, category} instead of plain domain strings.
 * Suitable for popup display with owner names (e.g., "Alphabet Inc.").
 * 
 * @param {string} tabId
 * @returns {object} groups with enriched tracker data {trackers, ads, other}
 */
export function getGroupedRequestsEnriched(tabId) {
  const tab = tabData.get(tabId);
  if (!tab) return { trackers: [], ads: [], other: [] };

  const groups = { trackers: [], ads: [], other: [] };
  const byDomain = new Map();

  for (const req of tab.requests) {
    const existing = byDomain.get(req.domain);
    if (!existing) {
      byDomain.set(req.domain, req);
      continue;
    }
    if (existing.observed === true && req.observed !== true) {
      byDomain.set(req.domain, req);
    }
  }

  for (const req of byDomain.values()) {
    const cat = req.category;
    const enriched = {
      domain: req.domain,
      owner: req.owner || req.domain,
      ownerId: req.ownerId || req.domain,
      category: cat,
      reason: req.reason || 'rule-match',
      confidence: Number(req.confidence) || 0,
      fingerprinting: req.fingerprinting === true,
      observed: req.observed === true,
    };
    if (groups[cat]) {
      groups[cat].push(enriched);
    } else {
      groups.other.push(enriched);
    }
  }

  return groups;
}

/**
 * Paint the badge for a tab right now. Skips the API call when the count
 * has not changed since the last paint for that tab.
 */
function paintBadge(tabId) {
  const count = getBlockedCount(tabId);
  const prev = lastBadgePaint.get(tabId);
  if (prev && prev.count === count) {
    prev.at = Date.now();
    return;
  }

  try {
    const badgeAPI = getBadgeAPI();
    if (badgeAPI?.setBadgeText) {
      const text = count > 0 ? String(count) : '';
      const r1 = badgeAPI.setBadgeText({ text, tabId });
      if (r1 && typeof r1.then === 'function') r1.catch(() => {});
      if (count > 0 && (!prev || prev.count === 0)) {
        const r2 = badgeAPI.setBadgeBackgroundColor({ color: '#e74c3c', tabId });
        if (r2 && typeof r2.then === 'function') r2.catch(() => {});
      }
    }
    lastBadgePaint.set(tabId, { at: Date.now(), count });
  } catch (e) {
    // Tab may have been closed
  }
}

/**
 * Update badge text for a tab.
 * Leading edge: the first event after an idle window paints immediately so
 * the user never perceives a counting delay. Trailing edge: a short timer
 * coalesces bursts and guarantees the final value lands on the badge.
 */
export function updateBadge(tabId) {
  if (badgeTimers.has(tabId)) return; // Trailing repaint already scheduled

  const last = lastBadgePaint.get(tabId);
  if (!last || Date.now() - last.at >= BADGE_MIN_PAINT_GAP_MS) {
    paintBadge(tabId);
  }

  badgeTimers.set(tabId, setTimeout(() => {
    badgeTimers.delete(tabId);
    paintBadge(tabId);
  }, BADGE_TRAILING_MS));
}

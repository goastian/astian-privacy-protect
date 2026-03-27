/**
 * Midori Privacy Blocker
 * Per-tab statistics collector
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

import { categorizeRequest, extractDomain } from './filter-engine.js';

// In-memory per-tab stats (fast access, no async)
const tabData = new Map();

// Average bytes saved per resource type (industry estimates)
const AVG_BYTES_BY_CATEGORY = {
  ads: 45000,       // Ad scripts/iframes ~45KB
  trackers: 8000,   // Tracking pixels/beacons ~8KB
  other: 25000,     // General blocked resources ~25KB
};

// Eco-savings constants (conservative estimates)
const ENERGY_SAVED_PER_BLOCK_KWH = 0.0005; // 0.5 Wh per block
const CO2_SAVED_PER_BLOCK_G = 0.2;         // 0.2g CO2 per block

// Badge update debounce — one timer per tab
const badgeTimers = new Map();
const BADGE_DEBOUNCE_MS = 1000; // Increased from 500ms to 1000ms for 8.3 optimization

// Cache for last calculated eco stats (to avoid recalculating frequently)
const lastEcoCache = new Map();

export function initTab(tabId, hostname) {
  tabData.set(tabId, {
    hostname,
    blocked: 0,
    dataSaved: 0,
    energySaved: 0, // In kWh
    co2Saved: 0,    // In grams
    requests: [],
    _savedBlocked: 0,
    _savedRequestIdx: 0,
  });
  lastEcoCache.delete(tabId); // Clear cache when tab is initialized
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
      dataSaved: 0, 
      energySaved: 0, 
      co2Saved: 0, 
      requests: [], 
      _savedBlocked: 0, 
      _savedRequestIdx: 0 
    };
    tabData.set(tabId, tab);
  }
  return tab;
}

export function recordBlock(tabId, url) {
  const tab = ensureTab(tabId);

  tab.blocked++;

  const domain = extractDomain(url);
  const category = categorizeRequest(url);

  // Optimization 8.3: Batch eco-calculations — only recalculate every 10 blocks
  if (tab.blocked % 10 === 0) {
    tab.dataSaved += (AVG_BYTES_BY_CATEGORY[category] || AVG_BYTES_BY_CATEGORY.other) * 10;
    tab.energySaved += ENERGY_SAVED_PER_BLOCK_KWH * 10;
    tab.co2Saved += CO2_SAVED_PER_BLOCK_G * 10;
    lastEcoCache.delete(tabId); // Invalidate cache
  }

  // Only store details for the first 100 unique domains (saves memory)
  // Optimization 8.3: Skip storing if already have 100 requests
  if (tab.requests.length < 100) {
    tab.requests.push({ domain, category });
  }

  return tab;
}

export function removeTab(tabId) {
  tabData.delete(tabId);
  lastEcoCache.delete(tabId); // Clear eco cache on tab removal
  if (badgeTimers.has(tabId)) {
    clearTimeout(badgeTimers.get(tabId));
    badgeTimers.delete(tabId);
  }
}

export function getBlockedCount(tabId) {
  const tab = tabData.get(tabId);
  return tab ? tab.blocked : 0;
}

export function getDataSaved(tabId) {
  const tab = tabData.get(tabId);
  if (!tab) return 0;
  
  // Optimization 8.3: Calculate on demand with estimated average
  // Balance between batching in recordBlock and accuracy on retrieve
  return tab.blocked * 26000; // Average across all categories ≈ (45K + 8K + 25K) / 3
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
  }));
}

export function getGroupedRequests(tabId) {
  const tab = tabData.get(tabId);
  if (!tab) return { trackers: [], ads: [], other: [] };

  const groups = { trackers: [], ads: [], other: [] };
  const seen = new Set();

  for (const req of tab.requests) {
    if (seen.has(req.domain)) continue;
    seen.add(req.domain);
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
 * Update badge text for a tab (debounced to avoid excessive API calls)
 */
export function updateBadge(tabId) {
  if (badgeTimers.has(tabId)) return; // Already scheduled

  badgeTimers.set(tabId, setTimeout(() => {
    badgeTimers.delete(tabId);
    const count = getBlockedCount(tabId);
    const text = count > 0 ? String(count) : '';

    try {
      // Firefox: use browser.browserAction (native Promise API) or chrome.browserAction (callback)
      // Chromium: use chrome.action (Promise API)
      const badgeAPI = (typeof browser !== 'undefined' && browser.browserAction)
        ? browser.browserAction
        : (chrome.action || chrome.browserAction);

      if (badgeAPI?.setBadgeText) {
        const r1 = badgeAPI.setBadgeText({ text, tabId });
        if (r1 && typeof r1.then === 'function') r1.catch(() => {});
        if (count > 0) {
          const r2 = badgeAPI.setBadgeBackgroundColor({ color: '#e74c3c', tabId });
          if (r2 && typeof r2.then === 'function') r2.catch(() => {});
        }
      }
    } catch (e) {
      // Tab may have been closed
    }
  }, BADGE_DEBOUNCE_MS));
}

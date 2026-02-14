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

// Badge update debounce — one timer per tab
const badgeTimers = new Map();
const BADGE_DEBOUNCE_MS = 500;

export function initTab(tabId, hostname) {
  tabData.set(tabId, {
    hostname,
    blocked: 0,
    dataSaved: 0,
    requests: [],
    _savedBlocked: 0,
    _savedRequestIdx: 0,
  });
}

export function getTab(tabId) {
  return tabData.get(tabId) || null;
}

export function ensureTab(tabId) {
  let tab = tabData.get(tabId);
  if (!tab) {
    tab = { hostname: '', blocked: 0, dataSaved: 0, requests: [], _savedBlocked: 0, _savedRequestIdx: 0 };
    tabData.set(tabId, tab);
  }
  return tab;
}

export function recordBlock(tabId, url) {
  const tab = ensureTab(tabId);

  tab.blocked++;

  const domain = extractDomain(url);
  const category = categorizeRequest(url);

  // Estimate bandwidth saved based on category
  tab.dataSaved += (AVG_BYTES_BY_CATEGORY[category] || AVG_BYTES_BY_CATEGORY.other);

  // Only store details for the first 100 unique domains (saves memory)
  if (tab.requests.length < 100) {
    tab.requests.push({ domain, category });
  }

  return tab;
}

export function removeTab(tabId) {
  tabData.delete(tabId);
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
  return tab ? tab.dataSaved : 0;
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

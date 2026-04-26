/**
 * Midori Privacy Blocker
 * Filter lists download & update manager
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

import { getOptions, setOptions, storageLocal } from './storage.js';

const LIST_CACHE_KEY = 'filter_lists_cache';
const FETCH_TIMEOUT_MS = 30000;
const RETRY_DELAYS = [5000, 15000, 30000]; // 3 retries with backoff

/**
 * Convert DuckDuckGo TDS JSON object to ABP filter text.
 * Only trackers with default:'block' are converted so the ABP filter engine
 * (Firefox) gets the same tracker set that the DNR ruleset provides on Chromium.
 */
function convertTDStoABP(tds) {
  const lines = ['! DuckDuckGo Tracker Blocklist (auto-converted from TDS JSON)'];
  for (const [domain, tracker] of Object.entries(tds.trackers || {})) {
    if (tracker.default === 'block') {
      lines.push(`||${domain}^$third-party`);
    }
  }
  return lines.join('\n');
}

/**
 * Fetch with AbortController timeout
 */
function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/**
 * Wait for the specified delay (used between retries)
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Download a filter list from URL with ETag caching, timeout, and retry with backoff
 */
async function fetchList(id, url) {
  const cacheData = await storageLocal.get(LIST_CACHE_KEY);
  const cache = cacheData[LIST_CACHE_KEY] || {};
  const cached = cache[id];

  const headers = {};
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  let lastError = null;

  // Try original request + RETRY_DELAYS.length retries
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      const waitMs = RETRY_DELAYS[attempt - 1];
      console.log(`[lists] ${id}: retry ${attempt}/${RETRY_DELAYS.length} in ${waitMs / 1000}s`);
      await delay(waitMs);
    }

    try {
      const response = await fetchWithTimeout(url, { headers, cache: 'no-cache' });

      if (response.status === 304 && cached?.text) {
        console.log(`[lists] ${id}: not modified (ETag match)`);
        return cached.text;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      const etag = response.headers.get('ETag') || '';

      // If server returned 200 but no ETag, check if content actually changed
      if (!etag && cached?.text && text === cached.text) {
        console.log(`[lists] ${id}: content unchanged (no ETag support)`);
        return cached.text;
      }

      // Save to cache
      cache[id] = { etag, text, fetchedAt: Date.now() };
      await storageLocal.set({ [LIST_CACHE_KEY]: cache });

      console.log(`[lists] ${id}: downloaded (${text.split('\n').length} lines)`);
      return text;
    } catch (e) {
      lastError = e;
      const isTimeout = e.name === 'AbortError';
      console.warn(`[lists] ${id}: attempt ${attempt + 1} failed — ${isTimeout ? 'timeout' : e.message}`);
    }
  }

  console.error(`[lists] Failed to fetch ${id} after ${RETRY_DELAYS.length + 1} attempts:`, lastError?.message);
  // Return cached version if available
  if (cached?.text) {
    console.log(`[lists] ${id}: using cached version from ${new Date(cached.fetchedAt || 0).toISOString()}`);
    return cached.text;
  }
  return null;
}

/**
 * Status-aware variant of fetchList().
 * Returns both text and whether content changed vs cache.
 */
async function fetchListWithStatus(id, url) {
  const cacheData = await storageLocal.get(LIST_CACHE_KEY);
  const cache = cacheData[LIST_CACHE_KEY] || {};
  const cached = cache[id];

  const headers = {};
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      const waitMs = RETRY_DELAYS[attempt - 1];
      await delay(waitMs);
    }

    try {
      const response = await fetchWithTimeout(url, { headers, cache: 'no-cache' });

      if (response.status === 304 && cached?.text) {
        return { text: cached.text, changed: false };
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      const etag = response.headers.get('ETag') || '';

      // Server without ETag: treat identical payload as unchanged.
      if (!etag && cached?.text && text === cached.text) {
        return { text: cached.text, changed: false };
      }

      cache[id] = { etag, text, fetchedAt: Date.now() };
      await storageLocal.set({ [LIST_CACHE_KEY]: cache });
      return { text, changed: true };
    } catch (e) {
      lastError = e;
    }
  }

  if (cached?.text) {
    return { text: cached.text, changed: false };
  }

  console.error(`[lists] Failed to fetch ${id} after ${RETRY_DELAYS.length + 1} attempts:`, lastError?.message);
  return { text: null, changed: false };
}

/**
 * Download a TDS JSON list, convert to ABP filter text, and cache it.
 * Used for lists with format:'tds' (e.g. DuckDuckGo tracker-blocklists).
 */
async function fetchTDSList(id, url) {
  const cacheData = await storageLocal.get(LIST_CACHE_KEY);
  const cache = cacheData[LIST_CACHE_KEY] || {};
  const cached = cache[id];

  const headers = {};
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      await delay(RETRY_DELAYS[attempt - 1]);
    }

    try {
      const response = await fetchWithTimeout(url, { headers, cache: 'no-cache' });

      if (response.status === 304 && cached?.text) {
        console.log(`[lists] ${id}: not modified (ETag match)`);
        return cached.text;
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const tds = await response.json();
      const text = convertTDStoABP(tds);
      const etag = response.headers.get('ETag') || '';

      cache[id] = { etag, text, fetchedAt: Date.now() };
      await storageLocal.set({ [LIST_CACHE_KEY]: cache });

      const trackerCount = Object.keys(tds.trackers || {}).length;
      console.log(`[lists] ${id}: downloaded TDS (${trackerCount} trackers → ${text.split('\n').length} rules)`);
      return text;
    } catch (e) {
      lastError = e;
      const isTimeout = e.name === 'AbortError';
      console.warn(`[lists] ${id}: attempt ${attempt + 1} failed — ${isTimeout ? 'timeout' : e.message}`);
    }
  }

  console.error(`[lists] Failed to fetch TDS ${id} after ${RETRY_DELAYS.length + 1} attempts:`, lastError?.message);
  if (cached?.text) {
    console.log(`[lists] ${id}: using cached TDS version from ${new Date(cached.fetchedAt || 0).toISOString()}`);
    return cached.text;
  }
  return null;
}

/**
 * Status-aware variant of fetchTDSList().
 * Returns both converted ABP text and whether content changed vs cache.
 */
async function fetchTDSListWithStatus(id, url) {
  const cacheData = await storageLocal.get(LIST_CACHE_KEY);
  const cache = cacheData[LIST_CACHE_KEY] || {};
  const cached = cache[id];

  const headers = {};
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      await delay(RETRY_DELAYS[attempt - 1]);
    }

    try {
      const response = await fetchWithTimeout(url, { headers, cache: 'no-cache' });

      if (response.status === 304 && cached?.text) {
        return { text: cached.text, changed: false };
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const tds = await response.json();
      const text = convertTDStoABP(tds);
      const etag = response.headers.get('ETag') || '';

      if (!etag && cached?.text && text === cached.text) {
        return { text: cached.text, changed: false };
      }

      cache[id] = { etag, text, fetchedAt: Date.now() };
      await storageLocal.set({ [LIST_CACHE_KEY]: cache });
      return { text, changed: true };
    } catch (e) {
      lastError = e;
    }
  }

  if (cached?.text) {
    return { text: cached.text, changed: false };
  }

  console.error(`[lists] Failed to fetch TDS ${id} after ${RETRY_DELAYS.length + 1} attempts:`, lastError?.message);
  return { text: null, changed: false };
}

/**
 * Download all enabled filter lists and report change status.
 * Useful for engine-first flows to skip unnecessary reparsing.
 *
 * @param {boolean} [force=false]
 * @returns {{ lists: Object<string,string>, changedCount: number, changedIds: string[] }}
 */
export async function downloadAllListsWithStatus(force = false) {
  if (force) {
    console.log('[lists] Force update: clearing ETag cache');
    const cacheData = await storageLocal.get(LIST_CACHE_KEY);
    const cache = cacheData[LIST_CACHE_KEY] || {};
    for (const id of Object.keys(cache)) {
      if (cache[id]) cache[id].etag = '';
    }
    await storageLocal.set({ [LIST_CACHE_KEY]: cache });
  }

  const options = await getOptions();
  const lists = {};
  const changedIds = [];

  const enabledLists = Object.entries(options.lists)
    .filter(([, config]) => config.enabled);

  const customLists = (options.customLists || [])
    .map((url, i) => [`custom-${i}`, { enabled: true, url }]);

  const allLists = [...enabledLists, ...customLists];

  await Promise.all(allLists.map(async ([id, config]) => {
    const out = config.format === 'tds'
      ? await fetchTDSListWithStatus(id, config.url)
      : await fetchListWithStatus(id, config.url);

    if (out.text) {
      lists[id] = out.text;
      if (out.changed) changedIds.push(id);
    }
  }));

  await setOptions({ lastUpdated: Date.now() });

  return {
    lists,
    changedCount: changedIds.length,
    changedIds,
  };
}

/**
 * Download all enabled filter lists
 * @param {boolean} [force=false] - If true, ignore ETag cache and re-download everything
 * @returns {Object} map of listId → raw text
 */
export async function downloadAllLists(force = false) {
  // If force, clear ETag cache so all lists are re-downloaded
  if (force) {
    console.log('[lists] Force update: clearing ETag cache');
    const cacheData = await storageLocal.get(LIST_CACHE_KEY);
    const cache = cacheData[LIST_CACHE_KEY] || {};
    for (const id of Object.keys(cache)) {
      if (cache[id]) cache[id].etag = '';
    }
    await storageLocal.set({ [LIST_CACHE_KEY]: cache });
  }

  const options = await getOptions();
  const results = {};

  // Built-in lists
  const enabledLists = Object.entries(options.lists)
    .filter(([, config]) => config.enabled);

  // Custom lists
  const customLists = (options.customLists || [])
    .map((url, i) => [`custom-${i}`, { enabled: true, url }]);

  const allLists = [...enabledLists, ...customLists];

  const promises = allLists.map(async ([id, config]) => {
    const text = config.format === 'tds'
      ? await fetchTDSList(id, config.url)
      : await fetchList(id, config.url);
    if (text) results[id] = text;
  });

  await Promise.all(promises);

  await setOptions({ lastUpdated: Date.now() });

  console.log(`[lists] Downloaded ${Object.keys(results).length} lists`);
  return results;
}

/**
 * Get cached lists without downloading
 */
export async function getCachedLists() {
  const cacheData = await storageLocal.get(LIST_CACHE_KEY);
  const cache = cacheData[LIST_CACHE_KEY] || {};
  const results = {};

  for (const [id, entry] of Object.entries(cache)) {
    if (entry.text) results[id] = entry.text;
  }

  return results;
}

/**
 * Get the count of rules for a specific list from cache
 */
export async function getListRulesCount(id) {
  const cacheData = await storageLocal.get(LIST_CACHE_KEY);
  const cache = cacheData[LIST_CACHE_KEY] || {};
  const entry = cache[id];
  if (!entry?.text) return 0;

  return entry.text.split('\n').filter(l => {
    const line = l.trim();
    return line && !line.startsWith('!') && !line.startsWith('[');
  }).length;
}

/**
 * Schedule periodic list updates using chrome.alarms
 */
export function scheduleUpdates() {
  chrome.alarms.create('update-lists', {
    delayInMinutes: 1,
    periodInMinutes: 240, // 4 hours
  });
}

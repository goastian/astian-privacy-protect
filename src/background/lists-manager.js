/**
 * Midori Privacy Blocker
 * Filter lists download & update manager
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

import { FiltersEngine } from '@ghostery/adblocker-webextension';
import { getOptions, setOptions, storageLocal } from './storage.js';

const LIST_CACHE_KEY = 'filter_lists_cache';
const LIST_STATS_KEY = 'filter_lists_stats';
const FETCH_TIMEOUT_MS = 30000;
const RETRY_DELAYS = [5000, 15000, 30000]; // 3 retries with backoff
const MAX_INCREMENTAL_ENGINE_CACHE = 16;

export const ENGINE_PARSE_OPTIONS = Object.freeze({
  enableCompression: false,
  enableOptimizations: true,
  loadCosmeticFilters: true,
  loadNetworkFilters: true,
});

const parsedListEngineCache = new Map();

function fastHash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function rememberParsedListEngine(id, fingerprint, engine) {
  if (parsedListEngineCache.has(id)) parsedListEngineCache.delete(id);
  parsedListEngineCache.set(id, { fingerprint, engine, lastUsedAt: Date.now() });
  if (parsedListEngineCache.size <= MAX_INCREMENTAL_ENGINE_CACHE) return;

  const overflow = [...parsedListEngineCache.entries()]
    .sort((left, right) => (left[1].lastUsedAt || 0) - (right[1].lastUsedAt || 0))
    .slice(0, parsedListEngineCache.size - MAX_INCREMENTAL_ENGINE_CACHE);
  for (const [oldId] of overflow) parsedListEngineCache.delete(oldId);
}

function getParsedListEngine(id, text) {
  const fingerprint = `${text.length}:${fastHash(text)}`;
  const cached = parsedListEngineCache.get(id);
  if (cached?.fingerprint === fingerprint && cached.engine) {
    cached.lastUsedAt = Date.now();
    return cached.engine;
  }

  const engine = FiltersEngine.parse(text, ENGINE_PARSE_OPTIONS);
  rememberParsedListEngine(id, fingerprint, engine);
  return engine;
}

export function buildIncrementalMergedEngine(lists) {
  const entries = Object.entries(lists || {}).filter(([, text]) => typeof text === 'string' && text.length > 0);
  if (entries.length === 0) {
    return FiltersEngine.parse('', ENGINE_PARSE_OPTIONS);
  }

  if (entries.length === 1) {
    const [id, text] = entries[0];
    return getParsedListEngine(id, text);
  }

  try {
    const perListEngines = entries.map(([id, text]) => getParsedListEngine(id, text));
    return FiltersEngine.merge(perListEngines, { useBinaryMerge: true });
  } catch (e) {
    console.warn('[lists] Incremental binary merge failed, falling back to single parse:', e);
    const combinedText = entries.map(([, text]) => text).join('\n');
    return FiltersEngine.parse(combinedText, ENGINE_PARSE_OPTIONS);
  }
}

export function clearIncrementalEngineCache() {
  parsedListEngineCache.clear();
}

function countLinesFast(text) {
  if (!text) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++;
  }
  return lines;
}

function countRulesFast(text) {
  if (!text) return 0;
  let count = 0;
  let start = 0;

  for (let i = 0; i <= text.length; i++) {
    const isEnd = i === text.length;
    if (!isEnd && text.charCodeAt(i) !== 10) continue;

    const line = text.slice(start, i).trim();
    if (line && !line.startsWith('!') && !line.startsWith('[')) count++;
    start = i + 1;
  }

  return count;
}

async function writeListStats(id, text, meta = {}) {
  try {
    const statsData = await storageLocal.get(LIST_STATS_KEY);
    const stats = statsData[LIST_STATS_KEY] || {};
    stats[id] = {
      bytes: text?.length || 0,
      lines: countLinesFast(text),
      rulesCount: countRulesFast(text),
      fetchedAt: meta.fetchedAt || Date.now(),
      etag: meta.etag || '',
      format: meta.format || 'abp',
      changedAt: meta.changedAt || Date.now(),
    };
    await storageLocal.set({ [LIST_STATS_KEY]: stats });
  } catch (e) {
    console.warn(`[lists] Failed to write stats for ${id}:`, e?.message || e);
  }
}

/**
 * Convert TDS-style JSON object to ABP filter text.
 * Only trackers with default:'block' are converted so the ABP filter engine
 * (Firefox) gets the same tracker set that the DNR ruleset provides on Chromium.
 */
function convertTDStoABP(tds) {
  const lines = ['! Tracker Detection Schema (auto-converted from TDS JSON)'];
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
      const fetchedAt = Date.now();
      cache[id] = { etag, text, fetchedAt };
      await storageLocal.set({ [LIST_CACHE_KEY]: cache });
      await writeListStats(id, text, { etag, fetchedAt, format: 'abp', changedAt: fetchedAt });

      console.log(`[lists] ${id}: downloaded (${countLinesFast(text)} lines)`);
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

      const fetchedAt = Date.now();
      cache[id] = { etag, text, fetchedAt };
      await storageLocal.set({ [LIST_CACHE_KEY]: cache });
      await writeListStats(id, text, { etag, fetchedAt, format: 'abp', changedAt: fetchedAt });
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
 * Used for lists with format:'tds' (TDS-style tracker JSON).
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

      const fetchedAt = Date.now();
      cache[id] = { etag, text, fetchedAt };
      await storageLocal.set({ [LIST_CACHE_KEY]: cache });
      await writeListStats(id, text, { etag, fetchedAt, format: 'tds', changedAt: fetchedAt });

      const trackerCount = Object.keys(tds.trackers || {}).length;
      console.log(`[lists] ${id}: downloaded TDS (${trackerCount} trackers → ${countLinesFast(text)} rules)`);
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

      const fetchedAt = Date.now();
      cache[id] = { etag, text, fetchedAt };
      await storageLocal.set({ [LIST_CACHE_KEY]: cache });
      await writeListStats(id, text, { etag, fetchedAt, format: 'tds', changedAt: fetchedAt });
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
export async function getCachedLists(optionsOverride = null) {
  const options = optionsOverride || await getOptions();
  const cacheData = await storageLocal.get(LIST_CACHE_KEY);
  const cache = cacheData[LIST_CACHE_KEY] || {};
  const results = {};

  const enabledBuiltInIds = Object.entries(options?.lists || {})
    .filter(([, config]) => config?.enabled)
    .map(([id]) => id);

  for (const id of enabledBuiltInIds) {
    const entry = cache[id];
    if (entry?.text) results[id] = entry.text;
  }

  const customLists = Array.isArray(options?.customLists) ? options.customLists : [];
  for (let i = 0; i < customLists.length; i++) {
    const customId = `custom-${i}`;
    const entry = cache[customId];
    if (entry?.text) results[customId] = entry.text;
  }

  return results;
}

/**
 * Get the count of rules for a specific list from cache
 */
export async function getListRulesCount(id) {
  const statsData = await storageLocal.get(LIST_STATS_KEY);
  const stats = statsData[LIST_STATS_KEY] || {};
  const stat = stats[id];
  if (typeof stat?.rulesCount === 'number') return stat.rulesCount;

  const cacheData = await storageLocal.get(LIST_CACHE_KEY);
  const cache = cacheData[LIST_CACHE_KEY] || {};
  const entry = cache[id];
  if (!entry?.text) return 0;

  const computed = countRulesFast(entry.text);
  await writeListStats(id, entry.text, {
    etag: entry.etag || '',
    fetchedAt: entry.fetchedAt || Date.now(),
    format: 'abp',
    changedAt: entry.fetchedAt || Date.now(),
  });
  return computed;
}

/**
 * Build a compact fingerprint for the enabled-list set + list versions.
 * Used by Firefox engine-first profile snapshots to avoid raw-text reparsing
 * across configuration switches when nothing changed semantically.
 */
export async function getEnabledListsFingerprint(optionsOverride = null) {
  const options = optionsOverride || await getOptions();
  const data = await storageLocal.get([LIST_CACHE_KEY, LIST_STATS_KEY]);
  const cache = data[LIST_CACHE_KEY] || {};
  const stats = data[LIST_STATS_KEY] || {};

  const enabledLists = Object.entries(options.lists || {})
    .filter(([, cfg]) => cfg?.enabled)
    .map(([id]) => id)
    .sort();

  const parts = [];
  for (const id of enabledLists) {
    const cached = cache[id];
    const stat = stats[id];
    const version = cached?.etag || String(cached?.fetchedAt || 0);
    const bytes = stat?.bytes ?? cached?.text?.length ?? 0;
    const rulesCount = stat?.rulesCount ?? 0;
    parts.push(`${id}:${version}:${bytes}:${rulesCount}`);
  }

  const customLists = (options.customLists || []).map(url => String(url || '').trim()).sort();
  for (const url of customLists) {
    parts.push(`custom:${fastHash(url)}`);
  }

  const userFiltersHash = fastHash(String(options.userFilters || ''));
  const payload = `${parts.join('|')}|uf:${userFiltersHash}`;
  return `v1_${fastHash(payload)}`;
}

/**
 * Remove compact stats entries for list IDs that are no longer enabled.
 * Call this after a config change or after a full list download to keep
 * storage clean. enabledIds is an iterable of currently-enabled list IDs.
 */
export async function cleanupOrphanedListStats(enabledIds) {
  try {
    const statsData = await storageLocal.get(LIST_STATS_KEY);
    const stats = statsData[LIST_STATS_KEY];
    if (!stats || typeof stats !== 'object') return 0;

    const enabledSet = new Set(enabledIds);
    const orphans = Object.keys(stats).filter(id => !enabledSet.has(id));
    if (orphans.length === 0) return 0;

    for (const id of orphans) delete stats[id];
    await storageLocal.set({ [LIST_STATS_KEY]: stats });
    console.log(`[midori] Cleaned up ${orphans.length} orphaned list stats:`, orphans);
    return orphans.length;
  } catch (e) {
    console.warn('[midori] cleanupOrphanedListStats error:', e);
    return 0;
  }
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

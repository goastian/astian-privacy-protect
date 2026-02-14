/**
 * Midori Privacy Blocker
 * Filter lists download & update manager
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

import { getOptions, setOptions, storageLocal } from './storage.js';

const LIST_CACHE_KEY = 'filter_lists_cache';

/**
 * Download a filter list from URL with ETag caching
 */
async function fetchList(id, url) {
  const cacheData = await storageLocal.get(LIST_CACHE_KEY);
  const cache = cacheData[LIST_CACHE_KEY] || {};
  const cached = cache[id];

  const headers = {};
  if (cached?.etag) {
    headers['If-None-Match'] = cached.etag;
  }

  try {
    const response = await fetch(url, { headers, cache: 'no-cache' });

    if (response.status === 304 && cached?.text) {
      console.log(`[lists] ${id}: not modified (ETag match)`);
      return cached.text;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const etag = response.headers.get('ETag') || '';

    // Save to cache
    cache[id] = { etag, text, fetchedAt: Date.now() };
    await storageLocal.set({ [LIST_CACHE_KEY]: cache });

    console.log(`[lists] ${id}: downloaded (${text.split('\n').length} lines)`);
    return text;
  } catch (e) {
    console.error(`[lists] Failed to fetch ${id}:`, e.message);
    // Return cached version if available
    if (cached?.text) return cached.text;
    return null;
  }
}

/**
 * Download all enabled filter lists
 * @returns {Object} map of listId → raw text
 */
export async function downloadAllLists() {
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
    const text = await fetchList(id, config.url);
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

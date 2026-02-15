/**
 * Midori Privacy Blocker
 * Storage abstraction layer
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

// Cross-browser storage wrapper:
// Firefox MV2 chrome.* APIs use callbacks; browser.* APIs return Promises.
// Chromium MV3 chrome.* APIs return Promises natively.
const storageLocal = {
  get(keys) {
    // Prefer browser.storage.local (Firefox Promise-based API)
    if (typeof browser !== 'undefined' && browser.storage?.local?.get) {
      return browser.storage.local.get(keys);
    }
    // Chromium MV3: chrome.storage.local.get returns a Promise
    if (chrome.storage?.local?.get) {
      const result = chrome.storage.local.get(keys);
      if (result && typeof result.then === 'function') return result;
      // Fallback: promisify callback-based API
      return new Promise((resolve, reject) => {
        chrome.storage.local.get(keys, (data) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(data || {});
        });
      });
    }
    return Promise.resolve({});
  },
  set(items) {
    if (typeof browser !== 'undefined' && browser.storage?.local?.set) {
      return browser.storage.local.set(items);
    }
    if (chrome.storage?.local?.set) {
      const result = chrome.storage.local.set(items);
      if (result && typeof result.then === 'function') return result;
      return new Promise((resolve, reject) => {
        chrome.storage.local.set(items, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        });
      });
    }
    return Promise.resolve();
  },
  remove(keys) {
    if (typeof browser !== 'undefined' && browser.storage?.local?.remove) {
      return browser.storage.local.remove(keys);
    }
    if (chrome.storage?.local?.remove) {
      const result = chrome.storage.local.remove(keys);
      if (result && typeof result.then === 'function') return result;
      return new Promise((resolve, reject) => {
        chrome.storage.local.remove(keys, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        });
      });
    }
    return Promise.resolve();
  },
};

const DEFAULTS = {
  enabled: true,
  whitelist: {},
  lists: {
    // ── Core lists (enabled by default) ──
    'easylist': { enabled: true, url: 'https://easylist.to/easylist/easylist.txt' },
    'easyprivacy': { enabled: true, url: 'https://easylist.to/easylist/easyprivacy.txt' },
    'ublock-filters': { enabled: true, url: 'https://ublockorigin.github.io/uAssets/filters/filters.txt' },
    'ublock-privacy': { enabled: true, url: 'https://ublockorigin.github.io/uAssets/filters/privacy.txt' },
    'ublock-unbreak': { enabled: true, url: 'https://ublockorigin.github.io/uAssets/filters/unbreak.txt' },
    'peter-lowe': { enabled: true, url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext' },
    // ── Annoyances ──
    'ublock-annoyances-cookies': { enabled: false, url: 'https://ublockorigin.github.io/uAssets/filters/annoyances-cookies.txt' },
    'ublock-annoyances-others': { enabled: false, url: 'https://ublockorigin.github.io/uAssets/filters/annoyances-others.txt' },
    'fanboy-social': { enabled: false, url: 'https://easylist.to/easylist/fanboy-social.txt' },
    'fanboy-annoyance': { enabled: false, url: 'https://secure.fanboy.co.nz/fanboy-annoyance.txt' },
    // ── AdGuard lists ──
    'adguard-base': { enabled: false, url: 'https://filters.adtidy.org/extension/ublock/filters/2.txt' },
    'adguard-tracking': { enabled: false, url: 'https://filters.adtidy.org/extension/ublock/filters/3.txt' },
    'adguard-social': { enabled: false, url: 'https://filters.adtidy.org/extension/ublock/filters/4.txt' },
    'adguard-annoyances': { enabled: false, url: 'https://filters.adtidy.org/extension/ublock/filters/14.txt' },
    'adguard-mobile': { enabled: false, url: 'https://filters.adtidy.org/extension/ublock/filters/11.txt' },
    // ── Regional / Language ──
    'easylist-spanish': { enabled: false, url: 'https://easylist-downloads.adblockplus.org/easylistspanish.txt' },
    'easylist-germany': { enabled: false, url: 'https://easylist.to/easylistgermany/easylistgermany.txt' },
    'easylist-france': { enabled: false, url: 'https://easylist-downloads.adblockplus.org/liste_fr.txt' },
    // ── Anti-adblock / Scriptlets ──
    'ublock-quick-fixes': { enabled: true, url: 'https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt' },
    'adguard-spyware-firstparty': { enabled: false, url: 'https://filters.adtidy.org/extension/ublock/filters/24.txt' },
  },
  setupCompleted: false,
  protectionLevel: 'standard',
  installMode: 'both',
  customLists: [],
  userFilters: '',
  antiFingerprint: true,
  updateInterval: 4,
  lastUpdated: 0,
  stats: {},
  dailyStats: [],
  hourlyStats: {},
  totalBlocked: 0,
};

export async function getOptions() {
  const data = await storageLocal.get('options');
  return { ...DEFAULTS, ...(data?.options || {}) };
}

export async function setOptions(partial) {
  const current = await getOptions();
  const merged = { ...current, ...partial };
  await storageLocal.set({ options: merged });
  return merged;
}

export async function getWhitelist() {
  const options = await getOptions();
  return options.whitelist || {};
}

export async function isWhitelisted(hostname) {
  const whitelist = await getWhitelist();
  return !!whitelist[hostname];
}

export async function toggleWhitelist(hostname) {
  const options = await getOptions();
  const whitelist = { ...options.whitelist };
  if (whitelist[hostname]) {
    delete whitelist[hostname];
  } else {
    whitelist[hostname] = true;
  }
  await setOptions({ whitelist });
  return !!whitelist[hostname];
}

export async function getTabStats(tabId) {
  try {
    if (chrome.storage.session?.get) {
      const data = await chrome.storage.session.get(`tab_${tabId}`);
      if (data && data[`tab_${tabId}`]) return data[`tab_${tabId}`];
    }
  } catch (e) {}
  return { blocked: 0, requests: [] };
}

export async function setTabStats(tabId, stats) {
  try {
    if (chrome.storage.session?.set) {
      await chrome.storage.session.set({ [`tab_${tabId}`]: stats });
    }
  } catch (e) {}
}

export async function clearTabStats(tabId) {
  try {
    if (chrome.storage.session?.remove) {
      await chrome.storage.session.remove(`tab_${tabId}`);
    }
  } catch (e) {}
}

export async function recordBlocked(tabId, domain, category, url) {
  const stats = await getTabStats(tabId);
  stats.blocked++;
  if (stats.requests.length < 200) {
    stats.requests.push({ domain, category, url, time: Date.now() });
  }
  await setTabStats(tabId, stats);
  return stats;
}

export async function addDailyStat(hostname, blockedCount, trackerDomains) {
  const options = await getOptions();
  const today = new Date().toISOString().slice(0, 10);
  let dailyStats = options.dailyStats || [];

  let todayEntry = dailyStats.find(d => d.date === today);
  if (!todayEntry) {
    todayEntry = { date: today, totalBlocked: 0, sites: {} };
    dailyStats.push(todayEntry);
  }

  todayEntry.totalBlocked += blockedCount;
  if (!todayEntry.sites[hostname]) {
    todayEntry.sites[hostname] = { blocked: 0, trackers: [] };
  }
  todayEntry.sites[hostname].blocked += blockedCount;
  for (const t of trackerDomains) {
    if (!todayEntry.sites[hostname].trackers.includes(t)) {
      todayEntry.sites[hostname].trackers.push(t);
    }
  }

  // Keep only last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  dailyStats = dailyStats.filter(d => d.date >= cutoffStr);

  await setOptions({
    dailyStats,
    totalBlocked: (options.totalBlocked || 0) + blockedCount,
  });
}

export async function recordHourlyBlock(count = 1) {
  const options = await getOptions();
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const hour = now.getHours();

  const hourlyStats = { ...(options.hourlyStats || {}) };
  if (!hourlyStats[dateKey]) hourlyStats[dateKey] = {};
  hourlyStats[dateKey][hour] = (hourlyStats[dateKey][hour] || 0) + count;

  // Keep only last 30 days of hourly data
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (const key of Object.keys(hourlyStats)) {
    if (key < cutoffStr) delete hourlyStats[key];
  }

  await setOptions({ hourlyStats });
}

export { DEFAULTS, storageLocal };

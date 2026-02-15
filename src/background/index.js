/**
 * Midori Privacy Blocker
 * Main background service worker
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

import { getOptions, setOptions, isWhitelisted, toggleWhitelist, addDailyStat, recordHourlyBlock } from './storage.js';
import { FilterEngine, extractDomain, categorizeRequest } from './filter-engine.js';
import { downloadAllLists, getCachedLists, scheduleUpdates } from './lists-manager.js';
import { initTab, recordBlock, removeTab, getTab, ensureTab, getGroupedRequests, getBlockedCount, getDataSaved, updateBadge } from './stats-collector.js';
import { getTopTrackedSites, getBlockingStats, getCategoryDistribution, getHourlyHeatmap, getWeeklyTrend, getPrivacySummary, exportReport } from './report-generator.js';

let engine = new FilterEngine();
let isEnabled = true;
const IS_CHROMIUM = __PLATFORM__ === 'chromium';

// ── Protection level presets ─────────────────────────────────────────────────
const PROTECTION_LEVELS = {
  basic: {
    label: 'Basic',
    antiFingerprint: false,
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

  const options = await getOptions();
  isEnabled = options.enabled !== false;

  // Chromium: enable native badge counter (zero overhead)
  if (IS_CHROMIUM) {
    try {
      await chrome.declarativeNetRequest.setExtensionActionOptions({
        displayActionCountAsBadgeText: true,
      });
      // Set badge background color globally
      await chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
      console.log('[midori] Native badge counter enabled');
    } catch (e) {
      console.warn('[midori] Could not enable native badge:', e);
    }
  }

  // Load filter lists (cached first, then update)
  const cached = await getCachedLists();
  if (Object.keys(cached).length > 0) {
    await loadEngine(cached);
    console.log('[midori] Loaded from cache');
  }

  // Download fresh lists in background
  try {
    const lists = await downloadAllLists();
    if (Object.keys(lists).length > 0) {
      await loadEngine(lists);
      console.log('[midori] Loaded fresh lists');
    }
  } catch (e) {
    console.error('[midori] Failed to download lists:', e);
  }

  // Schedule periodic updates
  scheduleUpdates();

  // Chromium: schedule periodic stats collection via alarm
  if (IS_CHROMIUM) {
    chrome.alarms.create('collect-stats', { periodInMinutes: 2 });
  }

  console.log(`[midori] Ready. Engine has ${engine.rulesCount} rules.`);

  // Diagnostic: verify engine can block known ad domains
  if (!IS_CHROMIUM) {
    const testDomains = ['doubleclick.net', 'googlesyndication.com', 'google-analytics.com', 'facebook.net', 'adnxs.com'];
    console.log(`[midori] Engine stats: ${engine.blockedDomains.size} blocked domains, ${engine.exceptionDomains.size} exceptions, ${engine.domainRulesWithOptions.length} domain rules w/opts, ${engine.blockRules.length} pattern rules, ${engine.exceptionRulesWithOptions.length} exception rules w/opts, ${engine.exceptionPatternRules.length} exception patterns`);
    for (const d of testDomains) {
      const inBlocked = engine.blockedDomains.has(d);
      const inException = engine.exceptionDomains.has(d);
      const result = engine.shouldBlock('https://' + d + '/test', 'yahoo.com', 'script');
      console.log(`[midori] TEST ${d}: blocked=${inBlocked} exception=${inException} shouldBlock=${result}`);
    }
  }
}

async function loadEngine(lists) {
  const newEngine = new FilterEngine();
  for (const [id, text] of Object.entries(lists)) {
    newEngine.addList(text);
  }
  console.log(`[midori] loadEngine: parsed ${newEngine.rulesCount} rules, ${newEngine.blockedDomains.size} domains, ${newEngine.domainRulesWithOptions.length} domain+opts, ${newEngine.blockRules.length} patterns`);
  // Assign engine immediately so it's available even if user filters fail
  engine = newEngine;
  // Load user custom filters
  try {
    const options = await getOptions();
    const userFilters = options.userFilters || '';
    if (userFilters.trim()) {
      newEngine.addUserRules(userFilters);
      console.log('[midori] Loaded user custom filters');
    }
  } catch (e) {
    console.error('[midori] Failed to load user filters:', e);
  }
}

// ── Firefox: webRequest blocking ────────────────────────────────────────────

// Sync whitelist check (cached in memory for performance)
let whitelistCache = {};
let whitelistCacheTime = 0;

function isWhitelistedSync(hostname) {
  if (Date.now() - whitelistCacheTime > 5000) {
    getOptions().then(opts => {
      whitelistCache = opts.whitelist || {};
      whitelistCacheTime = Date.now();
    });
  }
  return !!whitelistCache[hostname];
}

const pendingSaveTabsFirefox = new Set();
let firefoxSaveTimer = null;

let _debugReqCount = 0;

function setupWebRequestBlocking() {
  console.log('[midori] Setting up webRequest blocking, engine rules:', engine.rulesCount);
  console.log('[midori] webRequestAPI:', webRequestAPI ? 'available' : 'missing');
  webRequestAPI.onBeforeRequest.addListener(
    (details) => {
      _debugReqCount++;
      if (_debugReqCount <= 5) {
        console.log(`[midori] webRequest #${_debugReqCount}: type=${details.type} url=${details.url.substring(0, 80)} tabId=${details.tabId} engineRules=${engine.rulesCount} blockedDomains=${engine.blockedDomains.size}`);
      } else if (_debugReqCount === 50) {
        console.log(`[midori] 50 requests processed, engine has ${engine.rulesCount} rules, ${engine.blockedDomains.size} blocked domains, ${engine.blockRules.length} pattern rules`);
      }

      if (!isEnabled) return { cancel: false };
      if (details.tabId < 0) return { cancel: false };
      if (details.type === 'main_frame') return { cancel: false };

      const url = details.url;
      if (!url.startsWith('http')) return { cancel: false };

      const tab = getTab(details.tabId) || ensureTab(details.tabId);
      const pageHostname = tab.hostname || '';

      if (pageHostname && isWhitelistedSync(pageHostname)) return { cancel: false };

      const blocked = engine.shouldBlock(url, pageHostname, details.type);
      if (_debugReqCount <= 20) {
        console.log(`[midori] shouldBlock(${extractDomain(url)}, ${pageHostname}, ${details.type}) = ${blocked}`);
      }

      if (blocked) {
        console.log(`[midori] BLOCKED: ${extractDomain(url)} on ${pageHostname}`);
        recordBlock(details.tabId, url);
        updateBadge(details.tabId);

        // Record hourly stats for heatmap (fire-and-forget)
        recordHourlyBlock(1).catch(() => {});

        // Debounced save for Firefox
        pendingSaveTabsFirefox.add(details.tabId);
        if (!firefoxSaveTimer) {
          firefoxSaveTimer = setTimeout(flushFirefoxStats, 30000);
        }

        return { cancel: true };
      }

      return { cancel: false };
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
    if (entry.domains.size < 200 && url) {
      const d = extractDomain(url);
      if (d) {
        entry.domains.add(d);
        // Also record in stats-collector for proper categorization
        recordBlock(tabId, url);
        updateBadge(tabId);
      }
    }

    // Record hourly stats (fire-and-forget)
    recordHourlyBlock(1).catch(() => {});

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

  return { hostname, blocked, groups, dataSaved };
}

// ── Tab lifecycle ───────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
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

    // Send cosmetic rules to content script
    if (hostname && isEnabled) {
      const selectors = engine.getCosmeticSelectors(hostname);
      if (selectors.length > 0) {
        safeSendMessage(tabId, {
          action: 'apply-cosmetics',
          selectors: selectors.slice(0, 500),
        });
      }

      // Send scriptlet rules to content script
      const scriptlets = engine.getScriptletRules(hostname);
      if (scriptlets.length > 0) {
        safeSendMessage(tabId, {
          action: 'apply-scriptlets',
          scriptlets: scriptlets.slice(0, 100),
        });
        console.log(`[midori] Sent ${scriptlets.length} scriptlets to ${hostname}`);
      }
    }
  }
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

});

// ── Message handler (popup & options communication) ─────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(e => {
    console.error('[midori] Message error:', e);
    sendResponse({ error: e.message });
  });
  return true; // async response
});

async function handleMessage(msg) {
  switch (msg.action) {
    case 'get-tab-stats': {
      // Chromium: use getMatchedRules for real-time data
      if (IS_CHROMIUM) {
        return await getChromiumTabStats(msg.tabId);
      }
      // Firefox: use in-memory data
      const tab = getTab(msg.tabId);
      const groups = getGroupedRequests(msg.tabId);
      return {
        hostname: tab?.hostname || '',
        blocked: tab?.blocked || 0,
        dataSaved: getDataSaved(msg.tabId),
        groups,
      };
    }

    case 'get-options':
      return await getOptions();

    case 'toggle-site': {
      const nowWhitelisted = await toggleWhitelist(msg.hostname);
      if (IS_CHROMIUM) {
        await updateDnrWhitelist();
      }
      return { whitelisted: nowWhitelisted };
    }

    case 'toggle-enabled': {
      const options = await getOptions();
      isEnabled = !options.enabled;
      await setOptions({ enabled: isEnabled });

      if (IS_CHROMIUM) {
        const rulesetIds = ['easylist', 'easyprivacy', 'ublock-filters', 'ublock-privacy', 'peter-lowe'];
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

    case 'export-report':
      return await exportReport();

    case 'update-lists': {
      const lists = await downloadAllLists();
      if (Object.keys(lists).length > 0) {
        await loadEngine(lists);
      }
      return { rulesCount: engine.rulesCount, updatedAt: Date.now() };
    }

    case 'get-cosmetics': {
      return { selectors: engine.getCosmeticSelectors(msg.hostname).slice(0, 500) };
    }

    case 'get-scriptlets': {
      return { scriptlets: engine.getScriptletRules(msg.hostname).slice(0, 100) };
    }

    case 'get-anti-fingerprint': {
      const afOpts = await getOptions();
      return { enabled: afOpts.antiFingerprint !== false };
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

      // Chromium: update DNR rulesets
      if (IS_CHROMIUM) {
        try {
          const enableIds = [];
          const disableIds = [];
          const dnrRulesets = ['easylist', 'easyprivacy', 'ublock-filters', 'ublock-privacy', 'peter-lowe'];
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
      await setOptions(config);

      // Update global enabled state
      if (config.enabled !== undefined) {
        isEnabled = config.enabled;
      }

      // For Chromium: update DNR rulesets based on enabled lists
      if (IS_CHROMIUM && config.lists) {
        try {
          const enableIds = [];
          const disableIds = [];
          const dnrRulesets = ['easylist', 'easyprivacy', 'ublock-filters', 'ublock-privacy', 'peter-lowe'];
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
    .filter(r => r.id >= 900000)
    .map(r => r.id);

  const addRules = domains.map((domain, i) => ({
    id: 900000 + i,
    priority: 1,
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
        recordBlock(details.tabId, details.url);
      }
    },
    { urls: ['<all_urls>'] }
  );
}

// ── Start ───────────────────────────────────────────────────────────────────

initialize();

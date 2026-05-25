import {
  downloadAllListsWithStatus,
  getCachedLists,
  getEnabledListsFingerprint,
  cleanupOrphanedListStats,
  scheduleUpdates,
} from './lists-manager.js';
import {
  loadTrackerDbFromCache,
  scheduleTrackerDbUpdates,
} from './trackerdb.js';
import { applyV223Cleanup, applyV227AdblockerUpgrade } from './storage.js';
import { wipeEngineCache } from './ghostery-engine.js';

export function createBackgroundOrchestrator({
  isChromium,
  ghosteryEngine,
  getEngine,
  setEngine,
  getOptions,
  refreshRuntimeOptions,
  telemetry,
  applyTrackerDbDynamicRules,
  updateDnrEntityBlockRules,
  applyFirstPartyCdnAllowRules,
  installDnrUrlCleanerRule,
  installPopunderDnrRules,
  syncChromiumDnrForOptions,
  isTrackerDbAssistedEnabled,
}) {
  async function loadEngine(lists) {
    try {
      ghosteryEngine.loadLists(lists);
      setEngine(ghosteryEngine);
      console.log(`[midori] Ghostery engine loaded: ${ghosteryEngine.rulesCount} rules`);

      const options = await getOptions();
      const userFilters = options.userFilters || '';
      if (userFilters.trim()) {
        ghosteryEngine.addUserRules(userFilters);
        console.log('[midori] Loaded user custom filters (Ghostery)');
      }

      ghosteryEngine.persistToCache().catch((e) => {
        console.warn('[midori] Failed to persist Ghostery engine:', e);
      });

      if (!isChromium) {
        try {
          const profileKey = await getEnabledListsFingerprint(options);
          await ghosteryEngine.persistProfileToCache(profileKey);
        } catch (e) {
          console.warn('[midori] Failed to persist Firefox profile snapshot:', e);
        }
      }
    } catch (e) {
      console.error('[midori] Ghostery engine failed to load lists:', e);
    }
  }

  async function tryRestoreFirefoxEngineProfile(options, reason = 'runtime') {
    if (isChromium) return false;
    try {
      const profileKey = await getEnabledListsFingerprint(options);
      const restored = await ghosteryEngine.restoreProfileFromCache(profileKey);
      if (restored) {
        setEngine(ghosteryEngine);
        console.log(`[midori] Firefox profile restored (${reason}): ${getEngine().rulesCount} rules`);
        telemetry.incrementFirefoxSnapshotHit();
        return true;
      }
    } catch (e) {
      console.warn(`[midori] Firefox profile restore failed (${reason}):`, e);
    }
    return false;
  }

  async function reloadFirefoxEngineForOptions(options, reason = 'config-change') {
    if (isChromium) return true;

    if (await tryRestoreFirefoxEngineProfile(options, reason)) {
      return true;
    }

    const freshLists = await getCachedLists(options);
    if (Object.keys(freshLists).length > 0) {
      await loadEngine(freshLists);
      telemetry.incrementFirefoxRawParseCount();
      return true;
    }

    return false;
  }

  async function initialize() {
    console.log('[midori] Initializing...');
    const t0 = Date.now();

    // v2.2.3 cleanup: idempotent (no-op once flag is set). Runs on every
    // startup so existing installs that updated BEFORE this code shipped
    // also get the obsolete ddg-tds artifacts purged and the engine cache
    // wiped exactly once.
    try {
      const cleanup = await applyV223Cleanup();
      if (cleanup.applied) {
        console.log('[midori] v2.2.3 cleanup applied at startup:', cleanup);
        await wipeEngineCache();
      }
    } catch (e) {
      console.warn('[midori] v2.2.3 cleanup at startup failed:', e);
    }

    // v2.2.7 (2026-05-25): @ghostery/adblocker 2.14.1 -> 2.17.3 upgrade.
    // The engine cache key was bumped, so stale snapshots are ignored
    // automatically; this also drops legacy v1 IDB entries so users do not
    // carry two snapshots side by side after the upgrade.
    try {
      const upgrade = await applyV227AdblockerUpgrade();
      if (upgrade.applied) {
        console.log('[midori] v2.2.7 adblocker upgrade migration applied');
        await wipeEngineCache();
      }
    } catch (e) {
      console.warn('[midori] v2.2.7 adblocker upgrade migration failed:', e);
    }

    const options = await getOptions();
    telemetry.initFromOptions(options);
    refreshRuntimeOptions(options);

    if (isChromium) {
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

    let ghosteryRestored = false;
    const t1 = Date.now();
    try {
      ghosteryRestored = await ghosteryEngine.restoreFromCache();
      if (ghosteryRestored) {
        setEngine(ghosteryEngine);
        console.log(`[midori] Ghostery engine restored from cache in ${Date.now() - t1}ms (${getEngine().rulesCount} rules)`);
      }
    } catch (e) {
      console.warn('[midori] Ghostery cache restore failed:', e);
    }

    if (!ghosteryRestored) {
      if (!isChromium) {
        ghosteryRestored = await tryRestoreFirefoxEngineProfile(options, 'startup-profile');
      }

      if (!ghosteryRestored) {
        const cached = await getCachedLists(options);
        if (Object.keys(cached).length > 0) {
          if (isChromium) {
            setTimeout(() => {
              loadEngine(cached)
                .then(() => console.log(`[midori] Deferred cache rebuild complete in ${Date.now() - t0}ms`))
                .catch((e) => console.warn('[midori] Deferred cache rebuild failed:', e));
            }, 500);
          } else {
            await loadEngine(cached);
            console.log(`[midori] Loaded from list cache in ${Date.now() - t0}ms`);
          }
        }
      }
    }

    setTimeout(() => {
      downloadAllListsWithStatus().then(({ lists, changedCount }) => {
        if (Object.keys(lists).length === 0) return;

        if (getEngine().rulesCount === 0 || changedCount > 0) {
          loadEngine(lists).catch((e) => console.error('[midori] Warmup load failed:', e));
        } else {
          console.log('[midori] Warmup skipped: serialized engine is current');
        }

        const enabledIds = Object.keys(lists);
        cleanupOrphanedListStats(enabledIds).catch((e) =>
          console.warn('[midori] Orphaned stats cleanup failed:', e)
        );
      }).catch((e) => console.warn('[midori] Warmup download failed:', e));
    }, 3000);

    scheduleUpdates();

    try {
      const trackerDbCached = await loadTrackerDbFromCache();
      if (trackerDbCached && isChromium && options.enabled !== false && isTrackerDbAssistedEnabled()) {
        applyTrackerDbDynamicRules(true).catch((e) =>
          console.warn('[midori] TrackerDB dynamic rules (startup):', e)
        );
      }
      if (isChromium) {
        if (typeof syncChromiumDnrForOptions === 'function') {
          syncChromiumDnrForOptions(options, 'startup').catch((e) =>
            console.warn('[midori] Chromium DNR sync (startup):', e)
          );
        } else {
          updateDnrEntityBlockRules(options).catch((e) =>
            console.warn('[midori] Entity session rules (startup):', e)
          );
          if (typeof applyFirstPartyCdnAllowRules === 'function') {
            applyFirstPartyCdnAllowRules().catch((e) =>
              console.warn('[midori] First-party CDN allow rules (startup):', e)
            );
          }
          if (typeof installDnrUrlCleanerRule === 'function') {
            installDnrUrlCleanerRule().catch((e) =>
              console.warn('[midori] URL cleaner DNR rule (startup):', e)
            );
          }
          if (typeof installPopunderDnrRules === 'function') {
            installPopunderDnrRules().catch((e) =>
              console.warn('[midori] Popunder DNR rules (startup):', e)
            );
          }
        }
      }
      scheduleTrackerDbUpdates(options.trackerDbUpdateIntervalHours || 24);
    } catch (e) {
      console.warn('[midori] TrackerDB startup failed (non-fatal):', e);
    }

    if (isChromium) {
      chrome.alarms.create('collect-stats', { periodInMinutes: 2 });
    }

    const bootMs = Date.now() - t0;
    console.log(`[midori] Ready in ${bootMs}ms. Engine: Ghostery, ${getEngine().rulesCount} rules.`);
    telemetry.recordStartupLatency(bootMs);
  }

  return {
    initialize,
    loadEngine,
    reloadFirefoxEngineForOptions,
  };
}

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
      if (trackerDbCached && isChromium && isTrackerDbAssistedEnabled()) {
        applyTrackerDbDynamicRules(true).catch((e) =>
          console.warn('[midori] TrackerDB dynamic rules (startup):', e)
        );
      }
      if (isChromium) {
        updateDnrEntityBlockRules(options).catch((e) =>
          console.warn('[midori] Entity session rules (startup):', e)
        );
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

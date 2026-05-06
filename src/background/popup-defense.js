const MAX_POPUP_CANDIDATES = 50;
const POPUP_CANDIDATE_TTL_MS = 60000;

const ADULT_POPUNDER_DOMAINS = [
  'trafficjunky.net', 'trafficjunky.com', 'juicyads.com', 'exoclick.com',
  'ero-advertising.com', 'plugrush.com', 'exdynsrv.com', 'popads.net',
  'popcash.net', 'onclickads.net', 'hilltopads.net', 'adcash.com',
];

function hostnameMatches(hostname, pattern) {
  return hostname === pattern || hostname.endsWith(`.${pattern}`);
}

function isHostnameInWhitelist(hostname, whitelist) {
  const host = String(hostname || '').toLowerCase();
  if (!host || !whitelist || typeof whitelist !== 'object') return false;
  if (whitelist[host]) return true;
  const parts = host.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (whitelist[parent]) return true;
  }
  return false;
}

function isCandidateUrlEligible(url) {
  // Phase A: only http(s) navigations can be popups/popunders. Extension pages,
  // chrome://, about:, file:, data:, javascript:, etc. must never be auto-closed.
  if (!url) return true; // empty url => give it a chance (will be evaluated on redirect)
  const lowered = String(url).toLowerCase();
  return lowered.startsWith('http://') || lowered.startsWith('https://') || lowered === 'about:blank';
}

export function createPopupDefenseController({ extractDomain, getTab, getPopupDefenseConfig, getRuntimeOptions }) {
  const popupGestureState = new Map();
  const popupCandidates = new Map();
  const popupBurstState = new Map();

  function hasRecentUserGesture(tabId, windowMs) {
    const gesture = popupGestureState.get(tabId);
    return !!(gesture && (Date.now() - gesture.at) <= windowMs);
  }

  function trackPopupBurst(openerTabId, config) {
    const now = Date.now();
    const entry = popupBurstState.get(openerTabId) || { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((ts) => now - ts <= config.burstWindowMs);
    entry.timestamps.push(now);
    popupBurstState.set(openerTabId, entry);
    return entry.timestamps.length > config.maxBurstWithoutGesture;
  }

  function maybeClosePopupTab(tabId, reason) {
    if (!popupCandidates.has(tabId)) return;
    popupCandidates.delete(tabId);
    try {
      const result = chrome.tabs.remove(tabId);
      if (result && typeof result.then === 'function') result.catch(() => {});
    } catch (e) {
      try { chrome.tabs.remove(tabId, () => {}); } catch (_) {}
    }
    console.log(`[midori] Closed popup candidate ${tabId}: ${reason}`);
  }

  return {
    recordUserGesture(tabId, payload = {}) {
      if (!Number.isInteger(tabId) || tabId < 0) return;
      popupGestureState.set(tabId, {
        at: Date.now(),
        type: payload.type || 'unknown',
        targetTag: payload.targetTag || '',
        href: payload.href || '',
      });
    },

    clearPopupTracking(tabId) {
      popupCandidates.delete(tabId);
      popupGestureState.delete(tabId);
      popupBurstState.delete(tabId);
    },

    registerPopupCandidate(tab) {
      if (!tab?.id || tab.openerTabId === undefined || tab.openerTabId === null) return;

      // Phase A6: ignore tabs that aren't http(s) navigations (extension pages,
      // chrome://, about:, file://, data:, javascript:). These are never popups
      // we should auto-close.
      const candidateUrl = tab.url || tab.pendingUrl || '';
      if (!isCandidateUrlEligible(candidateUrl)) return;

      const now = Date.now();
      if (popupCandidates.size >= MAX_POPUP_CANDIDATES) {
        for (const [id, candidate] of popupCandidates) {
          if (now - candidate.createdAt > POPUP_CANDIDATE_TTL_MS) popupCandidates.delete(id);
        }
        if (popupCandidates.size >= MAX_POPUP_CANDIDATES) {
          const oldest = popupCandidates.keys().next().value;
          popupCandidates.delete(oldest);
        }
      }

      const openerTab = getTab(tab.openerTabId);
      const openerHostname = openerTab?.hostname || '';

      // Phase A7: never act on candidates whose opener is whitelisted by the user.
      const runtime = getRuntimeOptions();
      if (runtime?.enabled === false) return;
      if (openerHostname && isHostnameInWhitelist(openerHostname, runtime?.whitelist || {})) return;

      const config = getPopupDefenseConfig(openerHostname, runtime);
      if (!config.enabled) return;

      const allowedByGesture = hasRecentUserGesture(tab.openerTabId, config.gestureWindowMs);
      const burstExceeded = trackPopupBurst(tab.openerTabId, config) && !allowedByGesture;

      popupCandidates.set(tab.id, {
        openerTabId: tab.openerTabId,
        createdAt: Date.now(),
        allowedByGesture,
        config,
        hostHistory: [],
      });

      if (burstExceeded) {
        maybeClosePopupTab(tab.id, 'popup-burst');
        return;
      }

      if (!allowedByGesture && config.closeTabsWithoutGesture) {
        setTimeout(() => {
          if (popupCandidates.has(tab.id)) {
            maybeClosePopupTab(tab.id, 'popup-no-gesture');
          }
        }, config.evaluationDelayMs);
      }
    },

    trackPopupRedirect(tabId, url) {
      const candidate = popupCandidates.get(tabId);
      if (!candidate || !url || !url.startsWith('http')) return;

      const host = extractDomain(url);
      if (!host) return;
      const lastHost = candidate.hostHistory[candidate.hostHistory.length - 1];
      if (lastHost !== host) {
        candidate.hostHistory.push(host);
      }

      if (!candidate.allowedByGesture && candidate.hostHistory.length > candidate.config.redirectHopThreshold) {
        maybeClosePopupTab(tabId, 'popup-redirect-burst');
        return;
      }

      if (candidate.config.vertical === 'adult') {
        for (const pattern of ADULT_POPUNDER_DOMAINS) {
          if (hostnameMatches(host, pattern)) {
            maybeClosePopupTab(tabId, 'adult-popunder-network');
            return;
          }
        }
      }
    },
  };
}

const MAX_POPUP_CANDIDATES = 50;
const POPUP_CANDIDATE_TTL_MS = 60000;
const POPUP_SIGNAL_TTL_MS = 10000;
const POPUP_CLOSE_SCORE_THRESHOLD = 75;

export const CONFIRMED_POPUNDER_DOMAINS = [
  'trafficjunky.net', 'trafficjunky.com', 'juicyads.com', 'exoclick.com',
  'ero-advertising.com', 'plugrush.com', 'exdynsrv.com', 'popads.net',
  'popcash.net', 'onclickads.net', 'hilltopads.net', 'adcash.com',
  'trafficfactory.biz', 'adxpansion.com', 'popmyads.com', 'popunder.net',
  'propellerads.com', 'propeller-tracking.com', 'onclickalgo.com',
  'zeroredirect.com', 'adsterra.com', 'ad-maven.com', 'adnium.com',
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

function isHostnameAllowedForPopups(hostname, allowlist) {
  const host = String(hostname || '').toLowerCase();
  if (!host || !allowlist || typeof allowlist !== 'object') return false;
  const now = Date.now();
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts.slice(i).join('.');
    const entry = allowlist[key];
    if (!entry) continue;
    if (entry === true) return true;
    const expiresAt = Number(entry.expiresAt || 0);
    if (!expiresAt || expiresAt > now) return true;
  }
  return false;
}

function isConfirmedPopunderHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  for (const pattern of CONFIRMED_POPUNDER_DOMAINS) {
    if (hostnameMatches(host, pattern)) return true;
  }
  return false;
}

function cleanupOldSignals(map) {
  const now = Date.now();
  for (const [tabId, signal] of map) {
    if (!signal || now - signal.at > POPUP_SIGNAL_TTL_MS) map.delete(tabId);
  }
}

export function createPopupDefenseController({ extractDomain, getTab, getPopupDefenseConfig, getRuntimeOptions }) {
  const popupGestureState = new Map();
  const popupCandidates = new Map();
  const popupBurstState = new Map();
  const popupWindowSignals = new Map();

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

  function maybeClosePopupTab(tabId, reason, candidate = popupCandidates.get(tabId)) {
    if (!candidate) return;
    popupCandidates.delete(tabId);
    if (typeof candidate.onBlocked === 'function') {
      try {
        candidate.onBlocked(candidate.openerTabId, candidate.lastUrl || candidate.initialUrl || '', {
          reason,
          score: candidate.score || 0,
        });
      } catch (_) {}
    }
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

    recordWindowSignal(tabId, payload = {}) {
      if (!Number.isInteger(tabId) || tabId < 0) return;
      const type = String(payload.type || '');
      if (type !== 'blur' && type !== 'focus') return;
      const now = Date.now();
      popupWindowSignals.set(tabId, { at: now, type });
      if (popupWindowSignals.size > MAX_POPUP_CANDIDATES * 2) cleanupOldSignals(popupWindowSignals);
      if (type === 'focus') {
        for (const [candidateTabId, candidate] of popupCandidates) {
          if (candidate.openerTabId !== tabId || candidate.allowedByGesture) continue;
          if (now - candidate.createdAt > 1500) continue;
          candidate.score += 10;
          if (candidate.config?.closeTabsWithoutGesture && candidate.score >= POPUP_CLOSE_SCORE_THRESHOLD) {
            maybeClosePopupTab(candidateTabId, 'high-score-focus-return', candidate);
          }
        }
      }
    },

    clearPopupTracking(tabId) {
      popupCandidates.delete(tabId);
      popupGestureState.delete(tabId);
      popupBurstState.delete(tabId);
      popupWindowSignals.delete(tabId);
    },

    registerPopupCandidate(tab, onBlocked) {
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
      if (openerHostname && isHostnameAllowedForPopups(openerHostname, runtime?.popupAllowlist || {})) return;

      const config = getPopupDefenseConfig(openerHostname, runtime);
      if (!config.enabled) return;

      const allowedByGesture = hasRecentUserGesture(tab.openerTabId, config.gestureWindowMs);
      const canAutoClose = config.closeTabsWithoutGesture === true;
      const burstExceeded = trackPopupBurst(tab.openerTabId, config) && !allowedByGesture;
      const openerSignal = popupWindowSignals.get(tab.openerTabId);
      const recentBlur = openerSignal?.type === 'blur' && now - openerSignal.at <= 1500;
      const initialAboutBlank = String(candidateUrl || '').toLowerCase() === 'about:blank';
      const initialHost = extractDomain(candidateUrl || '');
      const confirmedInitialHost = isConfirmedPopunderHost(initialHost);
      let score = 0;
      if (!allowedByGesture) score += 35;
      if (burstExceeded) score += 25;
      if (initialAboutBlank) score += 10;
      if (recentBlur) score += 15;
      if (confirmedInitialHost) score += 100;

      const candidate = {
        openerTabId: tab.openerTabId,
        createdAt: now,
        initialUrl: candidateUrl,
        lastUrl: candidateUrl,
        allowedByGesture,
        burstExceeded,
        recentBlur,
        score,
        config,
        hostHistory: [],
        onBlocked,
      };
      if (initialHost) candidate.hostHistory.push(initialHost);
      popupCandidates.set(tab.id, candidate);

      if (confirmedInitialHost) {
        maybeClosePopupTab(tab.id, 'confirmed-popunder-network', candidate);
        return;
      }

      if (canAutoClose && score >= POPUP_CLOSE_SCORE_THRESHOLD) {
        maybeClosePopupTab(tab.id, 'high-score-popunder', candidate);
        return;
      }

      if (canAutoClose && !allowedByGesture) {
        setTimeout(() => {
          const current = popupCandidates.get(tab.id);
          if (current && current.score >= POPUP_CLOSE_SCORE_THRESHOLD) {
            maybeClosePopupTab(tab.id, 'high-score-delayed', current);
          }
        }, config.evaluationDelayMs);
      }
    },

    trackPopupRedirect(tabId, url) {
      const candidate = popupCandidates.get(tabId);
      if (!candidate || !url || !url.startsWith('http')) return;

      const host = extractDomain(url);
      if (!host) return;
      candidate.lastUrl = url;
      const lastHost = candidate.hostHistory[candidate.hostHistory.length - 1];
      if (lastHost !== host) {
        candidate.hostHistory.push(host);
        if (candidate.hostHistory.length > 1) candidate.score += 10;
      }

      if (!candidate.allowedByGesture && candidate.hostHistory.length > candidate.config.redirectHopThreshold) {
        candidate.score += 25;
      }

      if (isConfirmedPopunderHost(host)) {
        maybeClosePopupTab(tabId, 'confirmed-popunder-network', candidate);
        return;
      }

      if (candidate.config.closeTabsWithoutGesture && candidate.score >= POPUP_CLOSE_SCORE_THRESHOLD) {
        maybeClosePopupTab(tabId, 'high-score-redirect', candidate);
      }
    },
  };
}

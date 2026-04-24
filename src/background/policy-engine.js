/**
 * Midori Privacy Blocker
 * Policy Engine — unifies blocking decisions across ABP/Ghostery,
 * TrackerDB signals, site context, and user-selected protection level.
 */

import { extractDomain, classifyRequestDetails } from './filter-engine.js';
import { getTrackerCategory, getTrackerConfidence, isHighConfidenceTracker, getTrackerOwnerId } from './trackerdb.js';

// ── Phase 8: First-Party Relaxation (entity matching) ──────────────────────
/**
 * Determine if the request is eligible for first-party relaxation.
 * First-party relaxation allows specific request types (images, stylesheets, fonts)
 * from first-party or same-entity domains to pass through.
 * 
 * @param {string} requestDomain
 * @param {string} pageHostname
 * @param {string} resourceType
 * @returns {boolean} true if eligible for relaxation
 */
function isFirstPartyRelaxable(requestDomain, pageHostname, resourceType) {
  if (!requestDomain || !pageHostname) return false;

  // Essential resource types that can safely pass through
  const relaxableTypes = new Set(['image', 'stylesheet', 'font', 'manifest']);
  if (!relaxableTypes.has(resourceType)) return false;

  // Extract registry-level domains for comparison
  const req_reg = requestDomain.split('.').slice(-2).join('.');
  const page_reg = pageHostname.split('.').slice(-2).join('.');

  // Same registry (e.g., google.com owns analytics.google.com)
  return req_reg === page_reg;
}

/**
 * Check if the request domain is owned by the same entity as the page hostname.
 * Uses TrackerDB entity information to match across different legal entities.
 * Example: analytics.google.com and doubleclick.net are both owned by "Alphabet Inc."
 * 
 * Performance: ~O(1) with LRU caching in trackerdb.js
 * 
 * @param {string} requestDomain
 * @param {string} pageHostname
 * @returns {boolean} true if owned by same entity
 */
function isOwnedByPageHost(requestDomain, pageHostname) {
  if (!requestDomain || !pageHostname) return false;

  const pageId = getTrackerOwnerId(pageHostname);
  const reqId = getTrackerOwnerId(requestDomain);

  // If both have IDs and they match, same owner
  if (pageId && reqId && pageId === reqId) return true;

  // Fallback: exact domain match
  return requestDomain === pageHostname;
}

export const VERTICALS = {
  GENERAL: 'general',
  VIDEO: 'video',
  ADULT: 'adult',
  AI: 'ai',
};

const AI_HOST_PATTERNS = [
  'openai.com', 'chatgpt.com', 'claude.ai', 'anthropic.com', 'gemini.google.com',
  'copilot.microsoft.com', 'perplexity.ai', 'poe.com',
  'character.ai', 'deepseek.com', 'huggingface.co',
];

const VIDEO_HOST_PATTERNS = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'ytimg.com',
  'googlevideo.com', 'vimeo.com', 'dailymotion.com', 'twitch.tv', 'kick.com',
  'netflix.com', 'primevideo.com', 'hulu.com', 'max.com', 'disneyplus.com',
];

const ADULT_HOST_PATTERNS = [
  'pornhub.com', 'redtube.com', 'youporn.com', 'xnxx.com', 'xvideos.com',
  'xhamster.com', 'tube8.com', 'spankbang.com', 'hqporner.com', 'eporner.com',
  'brazzers.com', 'digitalplayground.com', 'realitykings.com',
  'porntrex.com', 'thumbzilla.com', 'beeg.com', 'sunporno.com', 'drtuber.com',
  'sexvid.xxx',
];

const AGGRESSIVE_THREAT_EXACT_HOSTS = new Set([
  'adtago.s3.amazonaws.com',
  'analyticsengine.s3.amazonaws.com',
  'analytics.s3.amazonaws.com',
  'advice-ads.s3.amazonaws.com',
  'ads-api.tiktok.com',
  'analytics.tiktok.com',
  'ads-sg.tiktok.com',
  'analytics-sg.tiktok.com',
  'business-api.tiktok.com',
  'ads.tiktok.com',
  'log.byteoversea.com',
  'udcm.yahoo.com',
  'analytics.query.yahoo.com',
  'log.fc.yahoo.com',
  'gemini.yahoo.com',
  'adtech.yahooinc.com',
  'appmetrica.yandex.ru',
  'adfstat.yandex.ru',
  'metrika.yandex.ru',
  'iot-eu-logser.realme.com',
  'iot-logser.realme.com',
  'bdapi-ads.realmemobile.com',
  'bdapi-in-ads.realmemobile.com',
  'adsfs.oppomobile.com',
  'adx.ads.oppomobile.com',
  'ck.ads.oppomobile.com',
  'data.ads.oppomobile.com',
  'api.ad.xiaomi.com',
  'data.mistat.xiaomi.com',
  'data.mistat.india.xiaomi.com',
  'data.mistat.rus.xiaomi.com',
  'sdkconfig.ad.xiaomi.com',
  'sdkconfig.ad.intl.xiaomi.com',
  'tracking.rus.miui.com',
  'metrics.data.hicloud.com',
  'metrics2.data.hicloud.com',
  'grs.hicloud.com',
  'logservice.hicloud.com',
  'logservice1.hicloud.com',
  'logbak.hicloud.com',
  'samsungads.com',
  'smetrics.samsung.com',
  'nmetrics.samsung.com',
  'analytics-api.samsunghealthcn.com',
  'iadsdk.apple.com',
  'api-adservices.apple.com',
  'books-analytics-events.apple.com',
  'weather-analytics-events.apple.com',
  'notes-analytics-events.apple.com',
  'auction.unityads.unity3d.com',
  'webview.unityads.unity3d.com',
  'config.unityads.unity3d.com',
  'adserver.unityads.unity3d.com',
]);

const AGGRESSIVE_THREAT_SUFFIX_HOSTS = [
  'unityads.unity3d.com',
  'amazon-adsystem.com',
];

const PROTECTION_CONFIG = {
  basic: {
    trackerSignalMode: 'off',
    popupBase: 'relaxed',
    popupBurstLimit: 2,
    popupRedirectHopThreshold: 4,
    popupGestureWindowMs: 1000,
    popupEvalDelayMs: 1200,
    signalThreshold: 1,
  },
  standard: {
    trackerSignalMode: 'observe',
    popupBase: 'balanced',
    popupBurstLimit: 1,
    popupRedirectHopThreshold: 3,
    popupGestureWindowMs: 1400,
    popupEvalDelayMs: 900,
    signalThreshold: 1,
  },
  strict: {
    trackerSignalMode: 'strict',
    popupBase: 'strict',
    popupBurstLimit: 1,
    popupRedirectHopThreshold: 2,
    popupGestureWindowMs: 1800,
    popupEvalDelayMs: 700,
    signalThreshold: 0.2,
  },
};

export const DEFAULT_SITE_POLICY = {
  verticalProfiles: {
    general: {
      popupDefense: 'balanced',
      trackerSensitivity: 0,
      adSensitivity: 0,
      popupBurstLimit: null,
      redirectHopThreshold: null,
    },
    video: {
      popupDefense: 'balanced',
      trackerSensitivity: 0.03,
      adSensitivity: 0.08,
      popupBurstLimit: 1,
      redirectHopThreshold: 3,
    },
    adult: {
      popupDefense: 'strict',
      trackerSensitivity: 0.12,
      adSensitivity: 0.2,
      popupBurstLimit: 0,
      redirectHopThreshold: 1,
    },
    ai: {
      popupDefense: 'balanced',
      trackerSensitivity: 0.08,
      adSensitivity: 0.03,
      popupBurstLimit: 1,
      redirectHopThreshold: 2,
    },
  },
  domainOverrides: {},
};

function normalizeProtectionLevel(level) {
  return PROTECTION_CONFIG[level] ? level : 'standard';
}

function domainMatches(hostname, pattern) {
  return hostname === pattern || hostname.endsWith(`.${pattern}`);
}

function matchesAggressiveThreatHost(hostname) {
  if (!hostname) return false;
  if (AGGRESSIVE_THREAT_EXACT_HOSTS.has(hostname)) return true;

  for (const suffix of AGGRESSIVE_THREAT_SUFFIX_HOSTS) {
    if (domainMatches(hostname, suffix)) return true;
  }

  return false;
}

export function inferSiteVertical(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return VERTICALS.GENERAL;

  for (const pattern of ADULT_HOST_PATTERNS) {
    if (domainMatches(host, pattern)) return VERTICALS.ADULT;
  }
  for (const pattern of AI_HOST_PATTERNS) {
    if (domainMatches(host, pattern)) return VERTICALS.AI;
  }
  for (const pattern of VIDEO_HOST_PATTERNS) {
    if (domainMatches(host, pattern)) return VERTICALS.VIDEO;
  }
  return VERTICALS.GENERAL;
}

export function getSitePolicyOptions(options) {
  const sitePolicy = options?.sitePolicy || {};
  return {
    verticalProfiles: {
      ...DEFAULT_SITE_POLICY.verticalProfiles,
      ...(sitePolicy.verticalProfiles || {}),
    },
    domainOverrides: {
      ...(sitePolicy.domainOverrides || {}),
    },
  };
}

export function resolveSiteProfile(pageHostname, options) {
  const host = String(pageHostname || '').toLowerCase();
  const sitePolicy = getSitePolicyOptions(options);
  const override = host ? (sitePolicy.domainOverrides[host] || null) : null;
  const vertical = override?.vertical || inferSiteVertical(host);
  const profile = {
    ...(DEFAULT_SITE_POLICY.verticalProfiles[vertical] || DEFAULT_SITE_POLICY.verticalProfiles.general),
    ...(sitePolicy.verticalProfiles[vertical] || {}),
    ...(override || {}),
    vertical,
  };

  return {
    hostname: host,
    vertical,
    profile,
    override,
  };
}

function computeTrackerSignalScore({
  trackerConfidence,
  trackerCategory,
  classification,
  isThirdParty,
  resourceType,
  siteProfile,
  aggressiveVerticalRules,
}) {
  if (!trackerCategory || trackerCategory === 'other') return 0;

  let score = Number(trackerConfidence) || 0;
  score += trackerCategory === 'ads'
    ? (siteProfile.adSensitivity || 0)
    : (siteProfile.trackerSensitivity || 0);

  if (isThirdParty) score += 0.08;
  if (resourceType === 'script' || resourceType === 'xmlhttprequest') score += 0.06;
  if (classification.taxonomy === 'fingerprinting' || classification.taxonomy === 'session-replay') score += 0.1;
  if (classification.taxonomy === 'adult-ad-network') score += 0.16;
  if (classification.taxonomy === 'popup' || classification.taxonomy === 'redirect-tracker') score += 0.12;
  if (classification.vertical === 'adult' && classification.taxonomy === 'popup') score += 0.1;
  if (classification.vertical === 'adult' && classification.taxonomy === 'redirect-tracker') score += 0.08;
  if (classification.vertical === 'adult') score += 0.08;
  if (classification.vertical === 'video') score += 0.04;
  if (classification.vertical === 'ai') score += 0.03;
  if (aggressiveVerticalRules && classification.vertical !== 'general') score += 0.08;

  return Math.min(1, score);
}

export function evaluateRequestPolicy({
  url,
  pageHostname,
  resourceType,
  options,
  engine,
  matchResult,
}) {
  const protectionLevel = normalizeProtectionLevel(options?.protectionLevel);
  const protectionConfig = PROTECTION_CONFIG[protectionLevel];
  const siteContext = resolveSiteProfile(pageHostname, options);
  const requestDomain = extractDomain(url);
  const trackerCategory = requestDomain ? getTrackerCategory(requestDomain) : null;
  const trackerConfidence = requestDomain ? getTrackerConfidence(requestDomain) : 0;
  const classification = classifyRequestDetails(url, pageHostname, resourceType);
  const isThirdParty = !!(
    requestDomain &&
    pageHostname &&
    requestDomain !== pageHostname &&
    !requestDomain.endsWith(`.${pageHostname}`) &&
    !pageHostname.endsWith(`.${requestDomain}`)
  );

  let engineBlocked = false;
  let engineReason = 'rule-match';

  if (matchResult) {
    engineBlocked = !!(matchResult.match && !matchResult.redirect && !matchResult.exception);
    if (matchResult.redirect) engineReason = 'rule-match';
  } else if (engine?.matchRequest) {
    const nextMatch = engine.matchRequest(url, pageHostname, resourceType);
    engineBlocked = !!(nextMatch.match && !nextMatch.redirect && !nextMatch.exception);
    if (nextMatch.redirect) engineReason = 'rule-match';
  } else {
    engineBlocked = !!engine?.shouldBlock?.(url, pageHostname, resourceType);
  }

  const aggressiveVerticalRules = options?.experiments?.aggressiveVerticalRules === true;
  const signalScore = computeTrackerSignalScore({
    trackerConfidence,
    trackerCategory,
    classification,
    isThirdParty,
    resourceType,
    siteProfile: siteContext.profile,
    aggressiveVerticalRules,
  });

  const trackerSignalEligible = (
    protectionConfig.trackerSignalMode === 'strict' &&
    options?.trackerDbEnabled !== false &&
    options?.experiments?.trackerDbAssisted === true &&
    requestDomain &&
    isHighConfidenceTracker(requestDomain) &&
    signalScore >= protectionConfig.signalThreshold
  );

  const aggressiveThreatBlockingEnabled = options?.experiments?.aggressiveThreatBlocking !== false;
  const hardThreatBlocked = (
    aggressiveThreatBlockingEnabled &&
    requestDomain &&
    matchesAggressiveThreatHost(requestDomain) &&
    (isThirdParty || resourceType === 'script' || resourceType === 'xmlhttprequest' || resourceType === 'ping' || resourceType === 'beacon')
  );

  // ── Phase 8: First-Party Relaxation ──────────────────────────────────────
  // Allow first-party or same-entity resources to pass through for non-blocking content types.
  // This improves UX by reducing false-positive blocks on legitimate same-org resources.
  const firstPartyRelaxation = !engineBlocked && (
    !isThirdParty ||
    isFirstPartyRelaxable(requestDomain, pageHostname, resourceType) ||
    (isOwnedByPageHost(requestDomain, pageHostname) && resourceType !== 'script' && resourceType !== 'xmlhttprequest')
  );

  const shouldBlock = (engineBlocked || hardThreatBlocked || trackerSignalEligible) && !firstPartyRelaxation;
  const reason = firstPartyRelaxation ? 'first-party-relaxed'
    : engineBlocked
    ? engineReason
    : (hardThreatBlocked
      ? 'entity-block'
      : (trackerSignalEligible ? 'entity-block' : 'allow'));

  return {
    shouldBlock,
    reason,
    category: classification.category,
    taxonomy: classification.taxonomy,
    vertical: siteContext.vertical,
    profile: siteContext.profile,
    trackerCategory,
    trackerConfidence,
    signalScore,
    sources: {
      engine: engineBlocked,
      threatDomain: hardThreatBlocked,
      trackerDb: trackerSignalEligible,
    },
  };
}

export function getPopupDefenseConfig(pageHostname, options) {
  const protectionLevel = normalizeProtectionLevel(options?.protectionLevel);
  const protectionConfig = PROTECTION_CONFIG[protectionLevel];
  const siteContext = resolveSiteProfile(pageHostname, options);
  const popupDefense = protectionLevel === 'basic'
    ? (siteContext.override?.popupDefense || 'relaxed')
    : (siteContext.profile.popupDefense || protectionConfig.popupBase);

  const levelWeight = popupDefense === 'strict' ? -1 : (popupDefense === 'relaxed' ? 1 : 0);
  const burstLimit = siteContext.profile.popupBurstLimit ?? Math.max(0, protectionConfig.popupBurstLimit + levelWeight);
  const redirectHopThreshold = siteContext.profile.redirectHopThreshold ?? Math.max(2, protectionConfig.popupRedirectHopThreshold + levelWeight);

  return {
    enabled: protectionLevel !== 'basic' || popupDefense !== 'relaxed',
    defense: popupDefense,
    gestureWindowMs: protectionConfig.popupGestureWindowMs,
    evaluationDelayMs: protectionConfig.popupEvalDelayMs,
    burstWindowMs: 5000,
    maxBurstWithoutGesture: burstLimit,
    redirectHopThreshold,
    closeTabsWithoutGesture: popupDefense !== 'relaxed',
    vertical: siteContext.vertical,
  };
}
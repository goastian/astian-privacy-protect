/**
 * Midori Privacy Blocker
 * Policy Engine — unifies blocking decisions across ABP/Ghostery,
 * TrackerDB signals, site context, and user-selected protection level.
 */

import { extractDomain, classifyRequestDetails } from './filter-engine.js';
import { getTrackerCategory, getTrackerConfidence, isHighConfidenceTracker } from './trackerdb.js';

export const VERTICALS = {
  GENERAL: 'general',
  VIDEO: 'video',
  ADULT: 'adult',
  AI: 'ai',
};

const AI_HOST_PATTERNS = [
  'openai.com', 'chatgpt.com', 'claude.ai', 'anthropic.com', 'gemini.google.com',
  'bard.google.com', 'copilot.microsoft.com', 'perplexity.ai', 'poe.com',
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
  let engineReason = 'engine';

  if (matchResult) {
    engineBlocked = !!(matchResult.match && !matchResult.redirect && !matchResult.exception);
    if (matchResult.redirect) engineReason = 'engine-redirect';
  } else if (engine?.matchRequest) {
    const nextMatch = engine.matchRequest(url, pageHostname, resourceType);
    engineBlocked = !!(nextMatch.match && !nextMatch.redirect && !nextMatch.exception);
    if (nextMatch.redirect) engineReason = 'engine-redirect';
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

  const shouldBlock = engineBlocked || trackerSignalEligible;
  const reason = engineBlocked ? engineReason : (trackerSignalEligible ? 'trackerdb-policy' : 'allow');

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
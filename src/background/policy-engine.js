/**
 * Midori Privacy Blocker
 * Policy Engine — unifies blocking decisions across ABP/Ghostery,
 * TrackerDB signals, site context, and user-selected protection level.
 */

import { extractDomain, classifyRequestDetails } from './filter-utils.js';
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
 * Curated map of CDN/static-asset domains to the first-party sites that own them.
 * Used as a deterministic fallback when TrackerDB does not assign a shared
 * `ownerId` to a CDN and its parent site (e.g. `redditstatic.com` ↔ `reddit.com`).
 * Without this map, third-party blocklists (EasyPrivacy, uBlock Privacy) can incorrectly
 * block legitimate first-party bundles served from a sibling CDN domain, breaking
 * SPAs that import ES modules from the CDN.
 *
 * Keys and values are eTLD+1 (registry-level) domains, lowercase.
 * Conservative by design: only well-known site→CDN pairs that ship the site's
 * own bundles/assets, not third-party widgets.
 */
export const FIRST_PARTY_CDN_MAP = {
  'redditstatic.com': ['reddit.com'],
  'redditmedia.com': ['reddit.com'],
  'redd.it': ['reddit.com'],
  'twimg.com': ['twitter.com', 'x.com'],
  'fbcdn.net': ['facebook.com', 'instagram.com', 'messenger.com'],
  'cdninstagram.com': ['instagram.com'],
  'licdn.com': ['linkedin.com'],
  'ytimg.com': ['youtube.com', 'youtu.be'],
  'googlevideo.com': ['youtube.com', 'youtu.be'],
  'ggpht.com': ['youtube.com', 'youtu.be'],
  'ttwstatic.com': ['twitch.tv'],
  'jtvnw.net': ['twitch.tv'],
  'ttvnw.net': ['twitch.tv'],
  'tiktokcdn.com': ['tiktok.com'],
  'tiktokcdn-us.com': ['tiktok.com'],
  'pinimg.com': ['pinterest.com'],
  'discordapp.net': ['discord.com'],
  'discord-cdn.com': ['discord.com'],
  'discordapp.com': ['discord.com'],
  'githubusercontent.com': ['github.com'],
  'githubassets.com': ['github.com'],
  'wp.com': ['wordpress.com'],
  'gravatar.com': ['wordpress.com'],
  'imgur.com': ['imgur.com'],
  'twitchcdn.net': ['twitch.tv'],
  'redditinc.com': ['reddit.com'],
  'wikimedia.org': ['wikipedia.org'],
  'spotifycdn.com': ['spotify.com'],
  'scdn.co': ['spotify.com'],
  'sndcdn.com': ['soundcloud.com'],
  'mzstatic.com': ['apple.com'],
  'apple-mapkit.com': ['apple.com'],
  'msecnd.net': ['microsoft.com'],
  'live.com': ['microsoft.com'],
  'bing.net': ['bing.com'],
  'gitlab-static.net': ['gitlab.com'],
  'shopifycdn.com': ['shopify.com', 'myshopify.com'],
  'amazon-adsystem.com': [],
  'media-amazon.com': ['amazon.com'],
  'ssl-images-amazon.com': ['amazon.com'],
  'paypalobjects.com': ['paypal.com'],
  // Google ecosystem — Gmail, Drive, Docs, Meet, Calendar, etc. all rely
  // on these CDNs/APIs as first-party. Without this, EasyList / EasyPrivacy
  // generic third-party rules can break message rendering and bundle
  // loading on `mail.google.com`, `docs.google.com`, etc.
  'gstatic.com': ['google.com', 'gmail.com', 'googlemail.com', 'youtube.com', 'blogger.com'],
  'googleusercontent.com': ['google.com', 'gmail.com', 'googlemail.com', 'youtube.com', 'blogger.com'],
  'googleapis.com': ['google.com', 'gmail.com', 'googlemail.com', 'youtube.com', 'blogger.com'],
  'withgoogle.com': ['google.com', 'gmail.com'],
  // Microsoft 365 / Outlook / Teams
  'office.com': ['microsoft.com', 'live.com', 'outlook.com'],
  'office.net': ['microsoft.com', 'office.com', 'outlook.com', 'live.com'],
  'officeapps.live.com': ['microsoft.com', 'office.com', 'outlook.com'],
  'sharepoint.com': ['microsoft.com', 'office.com', 'outlook.com'],
  'office365.com': ['microsoft.com', 'office.com', 'outlook.com'],
  'outlook.com': ['microsoft.com', 'live.com', 'office.com'],
  'live.net': ['microsoft.com', 'live.com', 'outlook.com'],
  'aadcdn.msftauth.net': ['microsoft.com', 'live.com', 'outlook.com', 'office.com'],
  'msauth.net': ['microsoft.com', 'live.com', 'outlook.com', 'office.com'],
  'msftauth.net': ['microsoft.com', 'live.com', 'outlook.com', 'office.com'],
  'msftauthimages.net': ['microsoft.com', 'live.com', 'outlook.com', 'office.com'],
  'msocdn.com': ['microsoft.com', 'office.com', 'outlook.com'],
  'msftidentity.com': ['microsoft.com', 'live.com', 'outlook.com'],
  'msidentity.com': ['microsoft.com', 'live.com', 'outlook.com'],
  'sfx.ms': ['microsoft.com', 'live.com', 'outlook.com'],
  'akadns.net': [],
  // Apple iCloud / Apple ID
  'icloud-content.com': ['icloud.com', 'apple.com'],
  'cdn-apple.com': ['apple.com', 'icloud.com'],
  'apple.news': ['apple.com'],
  // Yahoo Mail
  'yimg.com': ['yahoo.com', 'aol.com'],
  // Proton ecosystem
  'protonmail.ch': ['proton.me', 'protonmail.com'],
  'protonmail.com': ['proton.me'],
};

/**
 * Critical first-party sites where cosmetic filters, scriptlets and
 * heuristic ad-CSS injection are KNOWN to cause false positives that break
 * core functionality (e.g. Gmail message body, Outlook reading pane,
 * banking dashboards). On these hosts:
 *   - cosmetic injection (Ghostery + global heuristic CSS) is suppressed
 *   - scriptlet rules are suppressed
 *   - same-registry & curated-CDN requests get strong first-party relaxation
 *
 * Entries are eTLD+1 (registry-level) domains, lowercase. Subdomains are
 * matched by suffix.
 */
export const CRITICAL_FIRST_PARTY_SITES = new Set([
  // Google productivity & auth
  'google.com', 'gmail.com', 'googlemail.com',
  // Microsoft / Outlook / 365
  'microsoft.com', 'live.com', 'office.com', 'office365.com',
  'outlook.com', 'sharepoint.com', 'msn.com', 'bing.com',
  // Apple iCloud / Apple ID
  'icloud.com', 'apple.com',
  // Other major mail providers
  'yahoo.com', 'aol.com', 'proton.me', 'protonmail.com', 'tutanota.com',
  'fastmail.com', 'zoho.com', 'gmx.com', 'mail.ru',
  // Dev / collaboration
  'github.com', 'gitlab.com', 'bitbucket.org', 'atlassian.com',
  'slack.com', 'notion.so', 'linear.app', 'figma.com',
  // Banking / finance (broad protection — these MUST never break)
  'paypal.com', 'stripe.com', 'wise.com', 'revolut.com',
  // Payments / commerce critical
  'shopify.com',
  // ── Global banking & fintech ──────────────────────────────────────────────
  // Anti-fingerprint scriptlets override canvas/WebGL/AudioContext/navigator
  // which triggers fraud-detection on banking sites and can break
  // camera/mic/geolocation permission flows used in onboarding & auth.
  'bankofamerica.com', 'chase.com', 'wellsfargo.com', 'citibank.com',
  'usbank.com', 'capitalone.com', 'ally.com', 'schwab.com',
  'tdbank.com', 'pnc.com', 'regions.com', 'suntrust.com', 'truist.com',
  'barclays.co.uk', 'hsbc.com', 'hsbc.co.uk', 'lloydsbank.com',
  'natwest.com', 'rbs.co.uk', 'santander.com', 'santander.co.uk',
  'ingdirect.com', 'ing.com', 'deutschebank.com', 'db.com',
  'bnpparibas.com', 'societegenerale.fr', 'creditagricole.fr',
  'ubswealthmanagement.com', 'ubs.com', 'credit-suisse.com',
  'commerzbank.de', 'dkb.de', 'sparkasse.de', 'volksbank.de',
  'raiffeisen.at', 'raiffeisen.com',
  // ── Latin America banking ─────────────────────────────────────────────────
  'bancolombia.com', 'bangerio', 'empresarial.banregio.com', 'davivienda.com', 'bbva.com.co', 'bbvanet.com',
  'bogota.com', 'bancooccidente.com.co', 'bancoagrario.gov.co',
  'banistmo.com', 'bgeneral.com', 'bancopanama.com',
  'bancochile.cl', 'bci.cl', 'santander.cl', 'scotiabank.cl',
  'itau.cl', 'falabella.com', 'ripley.cl',
  'bbva.com.mx', 'banamex.com', 'banorte.com', 'bancomer.com',
  'hsbc.com.mx', 'santander.com.mx', 'scotiabank.com.mx',
  'aztecabank.com', 'bancobajio.com.mx', 'inbursa.com', 'banbajio.com.mx',
  'sat.gob.mx', 'imss.gob.mx', 'issste.gob.mx',
  'itau.com.br', 'bradesco.com.br', 'bb.com.br', 'caixa.gov.br',
  'nubank.com.br', 'santander.com.br', 'inter.co', 'c6bank.com.br',
  'bcp.com.pe', 'bbva.pe', 'interbank.com.pe', 'scotiabank.com.pe',
  'bcp.com.bo', 'bnb.com.bo', 'bancounion.com.bo',
  'pichincha.com', 'produbanco.com', 'guayaquil.com', 'internacional.fin.ec',
  'banreservas.com', 'popular.com', 'bhdleon.com.do',
  'bncr.fi.cr', 'bccr.fi.cr', 'bcr.fi.cr', 'scotiabank.com.cr',
  'bac.net', 'lafise.com', 'credomatic.com',
  'brou.com.uy', 'scotiabank.com.uy', 'itau.com.uy', 'santander.com.uy',
  'bnv.com.ve', 'mercantilbanco.com', 'venezolano.com',
  'bna.com.ar', 'santander.com.ar', 'bbva.com.ar', 'galicia.com.ar',
  'macro.com.ar', 'hsbc.com.ar', 'itau.com.ar', 'icbc.com.ar',
  'mercadopago.com', 'mercadolibre.com', 'mercadolibre.com.ar',
  'mercadolibre.com.mx', 'mercadolibre.com.co', 'mercadolibre.com.br',
  // ── Video calls / WebRTC (require camera/mic/geolocation permissions) ────
  'zoom.us', 'zoomgov.com', 'zoom.com',
  'teams.microsoft.com', 'teams.live.com',
  'meet.google.com', 'hangouts.google.com',
  'webex.com', 'cisco.com',
  'whereby.com', 'daily.co', 'jitsi.org', 'meet.jit.si',
  'skype.com', 'lync.com',
  'gotomeeting.com', 'gotowebinar.com', 'logmein.com',
  'bluejeans.com', 'ringcentral.com',
  // ── Government / public services (location/ID verification) ─────────────
  'irs.gov', 'ssa.gov', 'healthcare.gov', 'usa.gov',
  'gov.co', 'gov.mx', 'gob.mx', 'gov.br', 'gov.ar', 'gob.cl',
  'gob.pe', 'gob.bo', 'gob.ec', 'gob.ve', 'gob.uy',
  'gov.uk', 'service.gov.uk', 'hmrc.gov.uk',
  'bund.de', 'bundesregierung.de',
  // ── Healthcare / telemedicine (camera/mic permissions) ───────────────────
  'doxy.me', 'teladoc.com', 'mdlive.com', 'amwell.com',
  'mychart.com', 'epic.com',
]);

/**
 * Returns true when the page hostname matches a curated critical first-party
 * site (registry-level suffix match). Used to suppress cosmetic injection
 * and force strong same-registry relaxation.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isCriticalFirstPartySite(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  if (CRITICAL_FIRST_PARTY_SITES.has(host)) return true;
  for (const reg of CRITICAL_FIRST_PARTY_SITES) {
    if (host.endsWith('.' + reg)) return true;
  }
  return false;
}

function getRegistryDomain(hostname) {
  if (!hostname) return '';
  const parts = String(hostname).toLowerCase().split('.');
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

/**
 * Check if the request domain is owned by the same entity as the page hostname.
 * Uses TrackerDB entity information to match across different legal entities,
 * and falls back to a curated CDN→site map for well-known first-party CDNs
 * that TrackerDB may not link to their parent site.
 *
 * Example: analytics.google.com and doubleclick.net are both owned by "Alphabet Inc."
 * Example: redditstatic.com is the first-party CDN for reddit.com (curated map).
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
  if (requestDomain === pageHostname) return true;

  // Curated CDN→site map fallback (registry-level comparison)
  const reqReg = getRegistryDomain(requestDomain);
  const pageReg = getRegistryDomain(pageHostname);
  if (reqReg && pageReg) {
    if (reqReg === pageReg) return true;
    const owners = FIRST_PARTY_CDN_MAP[reqReg];
    if (owners && owners.includes(pageReg)) return true;
  }

  return false;
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

const VIDEO_STRICT_ALLOWLIST = [
  'googlevideo.com',
  'ytimg.com',
  'i.ytimg.com',
  'youtube-nocookie.com',
  'vimeocdn.com',
  'ttvnw.net',
  'hls.ttvnw.net',
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
    popupGestureWindowMs: 4000,
    popupEvalDelayMs: 900,
    signalThreshold: 1,
  },
  strict: {
    trackerSignalMode: 'strict',
    popupBase: 'strict',
    popupBurstLimit: 1,
    popupRedirectHopThreshold: 2,
    popupGestureWindowMs: 4000,
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
      scriptSensitivity: 0.06,
      xhrSensitivity: 0.06,
      fingerprintSensitivity: 0.1,
      cosmeticsEnabled: true,
      popupBurstLimit: null,
      redirectHopThreshold: null,
    },
    video: {
      popupDefense: 'balanced',
      trackerSensitivity: 0.03,
      adSensitivity: 0.08,
      scriptSensitivity: 0.04,
      xhrSensitivity: 0.04,
      fingerprintSensitivity: 0.08,
      cosmeticsEnabled: true,
      popupBurstLimit: 1,
      redirectHopThreshold: 3,
    },
    adult: {
      popupDefense: 'strict',
      trackerSensitivity: 0.12,
      adSensitivity: 0.2,
      scriptSensitivity: 0.08,
      xhrSensitivity: 0.08,
      fingerprintSensitivity: 0.14,
      cosmeticsEnabled: true,
      popupBurstLimit: 0,
      redirectHopThreshold: 1,
    },
    ai: {
      popupDefense: 'balanced',
      trackerSensitivity: 0.08,
      adSensitivity: 0.03,
      scriptSensitivity: 0.07,
      xhrSensitivity: 0.07,
      fingerprintSensitivity: 0.16,
      cosmeticsEnabled: true,
      popupBurstLimit: 1,
      redirectHopThreshold: 2,
    },
  },
  domainOverrides: {},
};

const SITE_PROFILE_CACHE_LIMIT = 256;
const siteProfileCache = new Map();

function cacheGetSiteProfile(hostname) {
  const key = String(hostname || '').toLowerCase();
  if (!key || !siteProfileCache.has(key)) return null;
  const value = siteProfileCache.get(key);
  siteProfileCache.delete(key);
  siteProfileCache.set(key, value);
  return value;
}

function cacheSetSiteProfile(hostname, value) {
  const key = String(hostname || '').toLowerCase();
  if (!key) return;
  if (siteProfileCache.has(key)) {
    siteProfileCache.delete(key);
  } else if (siteProfileCache.size >= SITE_PROFILE_CACHE_LIMIT) {
    siteProfileCache.delete(siteProfileCache.keys().next().value);
  }
  siteProfileCache.set(key, value);
}

export function invalidateSiteProfileCache() {
  siteProfileCache.clear();
  invalidatePolicyCache();
}

// ── Phase D: short-lived LRU cache for evaluateRequestPolicy ───────────────
// Pages typically request the same asset multiple times in <1s. Caching the
// (engine match + policy decision) for a brief window slashes work in the
// hot path. Cache is invalidated whenever options/whitelist change.
const POLICY_CACHE_LIMIT = 256;
const POLICY_CACHE_TTL_MS = 1500;
const policyCache = new Map(); // key -> { value, expires }

export function invalidatePolicyCache() {
  policyCache.clear();
}

function policyCacheGet(key) {
  const entry = policyCache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    policyCache.delete(key);
    return null;
  }
  // LRU touch
  policyCache.delete(key);
  policyCache.set(key, entry);
  return entry.value;
}

function policyCacheSet(key, value) {
  if (policyCache.has(key)) {
    policyCache.delete(key);
  } else if (policyCache.size >= POLICY_CACHE_LIMIT) {
    // Evict oldest
    policyCache.delete(policyCache.keys().next().value);
  }
  policyCache.set(key, { value, expires: Date.now() + POLICY_CACHE_TTL_MS });
}

/**
 * Cached variant of evaluateRequestPolicy keyed by (url|page|type).
 * The caller should NOT pre-compute matchResult — this helper handles the
 * engine match call lazily and caches the full decision for ~1.5s.
 */
export function evaluateRequestPolicyCached({ url, pageHostname, resourceType, options, engine }) {
  const key = `${resourceType}|${pageHostname}|${url}`;
  const cached = policyCacheGet(key);
  if (cached) return cached;

  const matchResult = engine?.matchRequest
    ? engine.matchRequest(url, pageHostname, resourceType)
    : null;
  const policy = evaluateRequestPolicy({
    url,
    pageHostname,
    resourceType,
    options,
    engine,
    matchResult,
  });
  policyCacheSet(key, policy);
  return policy;
}

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

function resolveSiteProfileUncached(pageHostname, options) {
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

export function resolveSiteProfile(pageHostname, options) {
  const host = String(pageHostname || '').toLowerCase();
  const cached = cacheGetSiteProfile(host);
  if (cached) return cached;

  const resolved = resolveSiteProfileUncached(host, options);
  cacheSetSiteProfile(host, resolved);
  return resolved;
}

function asSensitivity(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function isVideoStrictAllowlistedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  for (const pattern of VIDEO_STRICT_ALLOWLIST) {
    if (domainMatches(host, pattern)) return true;
  }
  return false;
}

function getEffectiveRolloutFlags(options) {
  const experiments = options?.experiments || {};
  const transparency = experiments.rolloutTransparency !== false;
  const entityBlocking = transparency && experiments.rolloutEntityBlocking === true;
  const verticalProfiles = entityBlocking && experiments.rolloutVerticalProfiles === true;
  const cosmeticAudit = verticalProfiles && experiments.rolloutCosmeticAudit === true;
  return { transparency, entityBlocking, verticalProfiles, cosmeticAudit };
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
  if (resourceType === 'script') {
    score += asSensitivity(siteProfile.scriptSensitivity, 0.06);
  } else if (resourceType === 'xmlhttprequest') {
    score += asSensitivity(siteProfile.xhrSensitivity, 0.06);
  }
  if (classification.taxonomy === 'fingerprinting') {
    score += asSensitivity(siteProfile.fingerprintSensitivity, 0.1);
  }
  if (classification.taxonomy === 'session-replay') score += 0.1;
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
  const rollout = getEffectiveRolloutFlags(options);
  const protectionLevel = normalizeProtectionLevel(options?.protectionLevel);
  const protectionConfig = PROTECTION_CONFIG[protectionLevel];
  const siteContext = rollout.verticalProfiles
    ? resolveSiteProfile(pageHostname, options)
    : {
        hostname: String(pageHostname || '').toLowerCase(),
        vertical: VERTICALS.GENERAL,
        profile: DEFAULT_SITE_POLICY.verticalProfiles.general,
        override: null,
      };
  const requestDomain = extractDomain(url);
  const requestOwnerId = requestDomain ? getTrackerOwnerId(requestDomain) : '';
  const blockedEntities = options?.blockedEntities || {};
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

  const aggressiveVerticalRules = rollout.verticalProfiles && options?.experiments?.aggressiveVerticalRules === true;
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
    rollout.entityBlocking &&
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

  const entityBlocked = !!(
    rollout.entityBlocking &&
    requestDomain &&
    requestOwnerId &&
    blockedEntities[requestOwnerId] === true
  );

  const videoStrictGuardrail = (
    siteContext.vertical === VERTICALS.VIDEO &&
    siteContext.profile?.popupDefense === 'strict' &&
    isVideoStrictAllowlistedHost(requestDomain)
  );

  const effectiveEngineBlocked = videoStrictGuardrail ? false : engineBlocked;
  const effectiveHardThreatBlocked = videoStrictGuardrail ? false : hardThreatBlocked;
  const effectiveTrackerSignalEligible = videoStrictGuardrail ? false : trackerSignalEligible;

  // ── Phase 8: First-Party Relaxation ──────────────────────────────────────
  // Allow first-party or same-entity resources to pass through for non-blocking content types.
  // This improves UX by reducing false-positive blocks on legitimate same-org resources.
  // Phase C (2026-05-06): also relax script/xmlhttprequest when same-entity AND
  // the request domain is NOT classified as 'ads' in TrackerDB. This unblocks
  // SPAs like Reddit (own bundles served from sibling owned domains) without
  // opening the door to ad-tagged endpoints.
  // Phase C2 (2026-05-06): same-entity non-ads requests also override engine
  // matches (e.g. third-party blocklists treating `redditstatic.com` as a generic third-party
  // tracker). Without this, Reddit's own bundle CDN is blocked even though the
  // user is browsing reddit.com. Curated CDN→site map in `FIRST_PARTY_CDN_MAP`
  // is the source of truth for which third-party domains are allowed to
  // shadow engine blocks.
  const ownedByPage = isOwnedByPageHost(requestDomain, pageHostname);
  const isSensitiveType = resourceType === 'script' || resourceType === 'xmlhttprequest';
  const sameEntityNonAds = ownedByPage && (
    !isSensitiveType ||
    getTrackerCategory(requestDomain) !== 'ads'
  );

  // Critical-first-party relaxation: when the page is a known productivity /
  // mail / banking site (Gmail, Outlook, iCloud, banking, etc.), any request
  // that is same-registry OR owned-by-same-entity OR matches a curated
  // first-party CDN (FIRST_PARTY_CDN_MAP) is force-relaxed regardless of
  // its TrackerDB category. These hosts have a long history of legitimate
  // first-party assets being mis-classified by generic third-party rules,
  // and breakage there is high-impact (lost emails, broken banking flows).
  const criticalFirstParty = isCriticalFirstPartySite(pageHostname) && (
    ownedByPage ||
    requestDomain === pageHostname
  );

  // Strong relaxation: overrides engine + heuristic blocks (but not user
  // entity blocks). Reserved for verified first-party / same-owner contexts.
  const firstPartyStrongRelaxation = sameEntityNonAds || criticalFirstParty;

  // Soft relaxation: only applied when no engine block is in effect.
  const firstPartyRelaxation = firstPartyStrongRelaxation || (!effectiveEngineBlocked && (
    !isThirdParty ||
    isFirstPartyRelaxable(requestDomain, pageHostname, resourceType)
  ));

  const shouldBlock = (
    entityBlocked ||
    (effectiveEngineBlocked && !firstPartyStrongRelaxation) ||
    (effectiveHardThreatBlocked && !firstPartyStrongRelaxation) ||
    (effectiveTrackerSignalEligible && !firstPartyStrongRelaxation)
  ) && !firstPartyRelaxation;
  const reason = firstPartyRelaxation ? 'first-party-relaxed'
    : entityBlocked
    ? 'entity-block'
    : effectiveEngineBlocked
    ? engineReason
    : (effectiveHardThreatBlocked
      ? 'entity-block'
      : (effectiveTrackerSignalEligible
        ? 'entity-block'
        : (videoStrictGuardrail ? 'video-strict-guardrail' : 'allow')));

  return {
    shouldBlock,
    reason,
    category: classification.category,
    taxonomy: classification.taxonomy,
    vertical: siteContext.vertical,
    profile: siteContext.profile,
    trackerCategory,
    trackerConfidence,
    ownerId: requestOwnerId,
    signalScore,
    sources: {
      entity: entityBlocked,
      engine: effectiveEngineBlocked,
      threatDomain: effectiveHardThreatBlocked,
      trackerDb: effectiveTrackerSignalEligible,
      videoGuardrail: videoStrictGuardrail,
    },
  };
}

export function getPopupDefenseConfig(pageHostname, options) {
  const rollout = getEffectiveRolloutFlags(options);
  const protectionLevel = normalizeProtectionLevel(options?.protectionLevel);
  const protectionConfig = PROTECTION_CONFIG[protectionLevel];
  const siteContext = rollout.verticalProfiles
    ? resolveSiteProfile(pageHostname, options)
    : {
        hostname: String(pageHostname || '').toLowerCase(),
        vertical: VERTICALS.GENERAL,
        profile: DEFAULT_SITE_POLICY.verticalProfiles.general,
        override: null,
      };
  const popupDefense = protectionLevel === 'basic'
    ? (siteContext.override?.popupDefense || 'relaxed')
    : (siteContext.profile.popupDefense || protectionConfig.popupBase);

  const levelWeight = popupDefense === 'strict' ? -1 : (popupDefense === 'relaxed' ? 1 : 0);
  const burstLimit = siteContext.profile.popupBurstLimit ?? Math.max(0, protectionConfig.popupBurstLimit + levelWeight);
  const redirectHopThreshold = siteContext.profile.redirectHopThreshold ?? Math.max(2, protectionConfig.popupRedirectHopThreshold + levelWeight);

  // Phase A: only auto-close tabs in adult vertical or when user picks 'strict' explicitly.
  // For 'general'/'video'/'ai' on standard we no longer cierran pestañas legítimas;
  // the in-page window.open guard and burst limit still mitigate true popunders.
  const closeTabsWithoutGesture = (
    siteContext.vertical === VERTICALS.ADULT ||
    popupDefense === 'strict'
  );

  return {
    enabled: protectionLevel !== 'basic' || popupDefense !== 'relaxed',
    defense: popupDefense,
    gestureWindowMs: protectionConfig.popupGestureWindowMs,
    evaluationDelayMs: protectionConfig.popupEvalDelayMs,
    burstWindowMs: 5000,
    maxBurstWithoutGesture: burstLimit,
    redirectHopThreshold,
    closeTabsWithoutGesture,
    vertical: siteContext.vertical,
  };
}
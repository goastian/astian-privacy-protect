/**
 * Midori Privacy Blocker
 * ABP filter syntax parser & matching engine (for Firefox webRequest)
 * Full support for $domain=, $third-party, resource types, $important
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

import { getTrackerCategory } from './trackerdb.js';

// ── Bloom Filter & LRU Cache for performance ────────────────────────────────

/**
 * Probabilistic data structure for ultra-fast set membership tests.
 * Zero false negatives, low false positives.
 */
class BloomFilter {
  constructor(size = 1000000, hashCount = 3) {
    this.size = size;
    this.hashCount = hashCount;
    this.bits = new Uint32Array(Math.ceil(size / 32));
  }

  add(str) {
    for (let i = 0; i < this.hashCount; i++) {
      const hash = this._hash(str, i);
      this.bits[Math.floor(hash / 32)] |= (1 << (hash % 32));
    }
  }

  has(str) {
    for (let i = 0; i < this.hashCount; i++) {
      const hash = this._hash(str, i);
      if (!(this.bits[Math.floor(hash / 32)] & (1 << (hash % 32)))) {
        return false;
      }
    }
    return true;
  }

  _hash(str, seed) {
    let h1 = 0x811c9dc5 ^ seed;
    for (let i = 0; i < str.length; i++) {
      h1 ^= str.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193);
    }
    return (h1 >>> 0) % this.size;
  }
}

/**
 * Least Recently Used cache to store results of blocking decisions.
 */
class LRUCache {
  constructor(capacity = 5000) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    const val = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, value);
  }

  clear() {
    this.cache.clear();
  }
}

// ── Tracker / Ad categorization ─────────────────────────────────────────────
// Comprehensive domain→category mapping for accurate classification

const TRACKER_DOMAINS = new Map([
  // Analytics & tracking
  ['google-analytics.com', 'trackers'], ['googletagmanager.com', 'trackers'],
  ['analytics.google.com', 'trackers'], ['tagmanager.google.com', 'trackers'],
  ['hotjar.com', 'trackers'], ['mixpanel.com', 'trackers'],
  ['segment.io', 'trackers'], ['segment.com', 'trackers'],
  ['amplitude.com', 'trackers'], ['heap.io', 'trackers'],
  ['heapanalytics.com', 'trackers'], ['fullstory.com', 'trackers'],
  ['mouseflow.com', 'trackers'], ['luckyorange.com', 'trackers'],
  ['crazyegg.com', 'trackers'], ['optimizely.com', 'trackers'],
  ['newrelic.com', 'trackers'], ['nr-data.net', 'trackers'],
  ['sentry.io', 'trackers'], ['bugsnag.com', 'trackers'],
  ['clarity.ms', 'trackers'], ['bat.bing.com', 'trackers'],
  ['snap.licdn.com', 'trackers'], ['linkedin.com/px', 'trackers'],
  ['connect.facebook.net', 'trackers'], ['facebook.com/tr', 'trackers'],
  ['pixel.facebook.com', 'trackers'], ['facebook.net', 'trackers'],
  ['twitter.com/i/', 'trackers'], ['t.co', 'trackers'],
  ['analytics.twitter.com', 'trackers'], ['tiktok.com/i/', 'trackers'],
  ['analytics.tiktok.com', 'trackers'], ['scorecardresearch.com', 'trackers'],
  ['quantserve.com', 'trackers'], ['quantcount.com', 'trackers'],
  ['chartbeat.com', 'trackers'], ['chartbeat.net', 'trackers'],
  ['parsely.com', 'trackers'], ['parse.ly', 'trackers'],
  ['omtrdc.net', 'trackers'], ['demdex.net', 'trackers'],
  ['omniture.com', 'trackers'], ['2o7.net', 'trackers'],
  ['adobedtm.com', 'trackers'], ['everesttech.net', 'trackers'],
  ['krxd.net', 'trackers'], ['bluekai.com', 'trackers'],
  ['exelator.com', 'trackers'], ['rlcdn.com', 'trackers'],
  ['crwdcntrl.net', 'trackers'], ['tapad.com', 'trackers'],
  ['adsymptotic.com', 'trackers'], ['agkn.com', 'trackers'],
  ['mathtag.com', 'trackers'], ['mookie1.com', 'trackers'],
  ['eyeota.net', 'trackers'], ['intentiq.com', 'trackers'],
  ['permutive.com', 'trackers'], ['permutive.app', 'trackers'],
  ['branch.io', 'trackers'], ['app.link', 'trackers'],
  ['adjust.com', 'trackers'], ['appsflyer.com', 'trackers'],
  ['kochava.com', 'trackers'], ['singular.net', 'trackers'],
  // Fingerprinting
  ['fingerprintjs.com', 'trackers'], ['fpjs.io', 'trackers'],
]);

const AD_DOMAINS = new Map([
  // Major ad networks
  ['doubleclick.net', 'ads'], ['googlesyndication.com', 'ads'],
  ['googleadservices.com', 'ads'], ['googleads.g.doubleclick.net', 'ads'],
  ['pagead2.googlesyndication.com', 'ads'], ['adservice.google.com', 'ads'],
  ['amazon-adsystem.com', 'ads'], ['aax.amazon-adsystem.com', 'ads'],
  ['adnxs.com', 'ads'], ['adsrvr.org', 'ads'],
  ['criteo.com', 'ads'], ['criteo.net', 'ads'],
  ['outbrain.com', 'ads'], ['taboola.com', 'ads'],
  ['ads-twitter.com', 'ads'], ['moatads.com', 'ads'],
  ['rubiconproject.com', 'ads'], ['pubmatic.com', 'ads'],
  ['openx.net', 'ads'], ['casalemedia.com', 'ads'],
  ['indexww.com', 'ads'], ['sharethrough.com', 'ads'],
  ['bidswitch.net', 'ads'], ['smartadserver.com', 'ads'],
  ['33across.com', 'ads'], ['triplelift.com', 'ads'],
  ['sovrn.com', 'ads'], ['lijit.com', 'ads'],
  ['media.net', 'ads'], ['revcontent.com', 'ads'],
  ['mgid.com', 'ads'], ['zergnet.com', 'ads'],
  ['teads.tv', 'ads'], ['yieldmo.com', 'ads'],
  ['spotxchange.com', 'ads'], ['spotx.tv', 'ads'],
  ['smaato.net', 'ads'], ['inmobi.com', 'ads'],
  ['mopub.com', 'ads'], ['unity3d.com/ads', 'ads'],
  ['unityads.unity3d.com', 'ads'], ['vungle.com', 'ads'],
  ['applovin.com', 'ads'], ['ironsrc.com', 'ads'],
  ['adcolony.com', 'ads'], ['chartboost.com', 'ads'],
  ['imasdk.googleapis.com', 'ads'], ['securepubads.g.doubleclick.net', 'ads'],
  ['tpc.googlesyndication.com', 'ads'], ['ad.doubleclick.net', 'ads'],
  ['static.doubleclick.net', 'ads'], ['adsense.google.com', 'ads'],
  ['afs.googlesyndication.com', 'ads'],
  // Ad verification / viewability
  ['moat.com', 'ads'], ['doubleverify.com', 'ads'],
  ['adsafeprotected.com', 'ads'], ['iasds01.com', 'ads'],
]);

// Keyword patterns for URL-based classification
const AD_URL_PATTERNS = [
  '/ads/', '/ad/', '/adserver', '/advert', '/banner',
  '/sponsor', '/pagead/', '/adsense', '/adx/', '/admanager',
  'doubleclick', 'googlesyndication', 'googleads',
  '/prebid', '/gpt.js', '/gpt/', '/dfp/',
];

const TRACKER_URL_PATTERNS = [
  '/analytics', '/tracking', '/tracker', '/pixel',
  '/beacon', '/collect', '/telemetry', '/metrics',
  '/event?', '/pageview', '/impression',
  'google-analytics', 'googletagmanager',
  '/gtm.js', '/gtag/', '/ga.js', '/analytics.js',
];

export function categorizeRequest(url) {
  const urlLower = url.toLowerCase();

  // Check domain maps first (fast)
  try {
    const hostname = new URL(url).hostname;
    // Exact match
    if (AD_DOMAINS.has(hostname)) return 'ads';
    if (TRACKER_DOMAINS.has(hostname)) return 'trackers';
    // Parent domain match
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (AD_DOMAINS.has(parent)) return 'ads';
      if (TRACKER_DOMAINS.has(parent)) return 'trackers';
    }
    // TrackerDB lookup — data-driven, broader coverage; used when hardcoded tables miss
    const tdbCat = getTrackerCategory(hostname);
    if (tdbCat && tdbCat !== 'other') return tdbCat;
  } catch {}

  // URL pattern matching
  for (const p of AD_URL_PATTERNS) {
    if (urlLower.includes(p)) return 'ads';
  }
  for (const p of TRACKER_URL_PATTERNS) {
    if (urlLower.includes(p)) return 'trackers';
  }

  return 'other';
}

export function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// ── ABP Resource Type Mapping ───────────────────────────────────────────────
// Maps webRequest resource types to ABP option names

const WEBREQUEST_TO_ABP = {
  'script': 'script',
  'stylesheet': 'stylesheet',
  'image': 'image',
  'imageset': 'image',
  'sub_frame': 'subdocument',
  'xmlhttprequest': 'xmlhttprequest',
  'media': 'media',
  'font': 'font',
  'object': 'object',
  'object_subrequest': 'object',
  'websocket': 'websocket',
  'ping': 'ping',
  'beacon': 'ping',
  'csp_report': 'other',
  'speculative': 'other',
  'other': 'other',
  'main_frame': 'document',
};

// All known ABP resource type options
const ALL_RESOURCE_TYPES = new Set([
  'script', 'stylesheet', 'image', 'subdocument', 'xmlhttprequest',
  'media', 'font', 'object', 'websocket', 'ping', 'other', 'document',
  'popup', 'webrtc',
]);

// ── Known CDN / Site Relationships ──────────────────────────────────────────

const SITE_GROUPS = [
  ['yahoo.com', 'yimg.com', 'yahooapis.com', 'oath.com', 'yahoo.net', 'yahoodns.net', 'yaho.com'],
  ['google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'googlevideo.com', 'youtube.com', 'ytimg.com', 'ggpht.com', 'youtube-nocookie.com', 'youtu.be'],
  ['facebook.com', 'fbcdn.net', 'fbcdn.com', 'facebook.net', 'fb.com', 'instagram.com', 'cdninstagram.com'],
  ['twitter.com', 'twimg.com', 'x.com', 't.co'],
  ['microsoft.com', 'msn.com', 'live.com', 'office.com', 'outlook.com', 'msecnd.net', 'bing.com', 'microsoftonline.com', 'msauth.net', 'msftauth.net', 'aspnetcdn.com', 'gfx.ms', 's-msn.com', 'msft.net'],
  ['amazon.com', 'amazonaws.com', 'ssl-images-amazon.com', 'media-amazon.com'],
  ['reddit.com', 'redd.it', 'redditstatic.com', 'redditmedia.com'],
  ['linkedin.com', 'licdn.com'],
  ['pinterest.com', 'pinimg.com'],
  ['tiktok.com', 'tiktokcdn.com', 'tiktokv.com'],
  ['twitch.tv', 'twitchcdn.net', 'jtvnw.net', 'ttvnw.net'],
  ['spotify.com', 'scdn.co', 'spotifycdn.com'],
  ['apple.com', 'mzstatic.com', 'icloud.com'],
  ['netflix.com', 'nflxvideo.net', 'nflximg.net', 'nflxext.com'],
  ['cnn.com', 'turner.com', 'cnn.io'],
  ['bbc.com', 'bbc.co.uk', 'bbci.co.uk'],
];

// Build a fast lookup: baseDomain → groupIndex
const _siteGroupMap = new Map();
for (let gi = 0; gi < SITE_GROUPS.length; gi++) {
  for (const d of SITE_GROUPS[gi]) {
    _siteGroupMap.set(d, gi);
  }
}

function getBaseDomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join('.');
}

function isSameSite(domain1, domain2) {
  if (domain1 === domain2) return true;
  const base1 = getBaseDomain(domain1);
  const base2 = getBaseDomain(domain2);
  if (base1 === base2) return true;

  // Check CDN groups
  const g1 = _siteGroupMap.get(base1);
  if (g1 !== undefined) {
    const g2 = _siteGroupMap.get(base2);
    if (g1 === g2) return true;
  }
  return false;
}

function domainMatchesPattern(hostname, pattern) {
  if (hostname === pattern) return true;
  if (hostname.endsWith('.' + pattern)) return true;
  return false;
}

// ── Filter Engine ───────────────────────────────────────────────────────────

export class FilterEngine {
  constructor() {
    // ── Block rules ──
    // Pure domain rules (||domain^) with no restricting options → fast O(1)
    this.blockedDomains = new Set();
    // Domain rules with options → need option evaluation
    this.domainRulesWithOptions = [];  // { domain, opts }
    // Pattern-based block rules with full options
    this.blockRules = [];  // { regex, opts }

    // ── Exception rules ──
    this.exceptionDomains = new Set();  // simple @@||domain^ with no options
    this.exceptionRulesWithOptions = [];  // { domain, opts } or { regex, opts }
    this.exceptionPatternRules = [];  // { regex, opts }

    // ── Cosmetic rules ──
    this.cosmeticRules = new Map();  // domain → [selectors]
    this.genericCosmetics = [];

    // ── Scriptlet rules ──
    this.scriptletRules = new Map();  // domain → [{ name, args }]
    this.genericScriptlets = [];

    // Performance optimizations
    this.bloomFilter = new BloomFilter();
    this.lruCache = new LRUCache();

    // Stats
    this.rulesCount = 0;
  }

  /**
   * Parse a raw filter list text and add rules to the engine
   */
  addList(text) {
    const lines = text.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;
      this.rulesCount++;
      this._parseLine(line);
    }
    // Clear cache when rules are updated
    this.lruCache.clear();
  }

  // ── Line parser ───────────────────────────────────────────────────────────

  _parseLine(line) {
    // Scriptlet rule: domain##+js(name, args)
    const scriptletMatch = line.match(/^([^#]*)##\+js\((.+)\)\s*$/);
    if (scriptletMatch) {
      this._addScriptletRule(scriptletMatch[1] || '', scriptletMatch[2]);
      return;
    }
    // Scriptlet exception
    if (line.includes('#@#+js(')) return;

    // Cosmetic rule: domain##selector
    const cosmeticIdx = line.indexOf('##');
    if (cosmeticIdx !== -1 && !line.startsWith('@@') && !line.includes('#@#')) {
      const domains = cosmeticIdx > 0 ? line.slice(0, cosmeticIdx) : '';
      const selector = line.slice(cosmeticIdx + 2).trim();
      if (!selector || selector.startsWith('+js(') || selector.startsWith(':has-text(')) return;
      this._addCosmeticRule(domains, selector);
      return;
    }

    // Cosmetic exception: domain#@#selector — skip
    if (line.includes('#@#')) return;

    // Skip unsupported special rules
    if (line.includes('$csp=') || line.includes('$redirect=') ||
        line.includes('$removeparam') || line.includes('$replace=')) return;

    // ── Network rules ──
    const isException = line.startsWith('@@');
    const rawRule = isException ? line.slice(2) : line;

    // Parse options
    const { pattern, opts } = this._parseNetworkRule(rawRule);
    if (!pattern) return;

    // Try to extract a pure domain from the pattern
    const domain = this._extractDomainFromPattern(pattern);

    if (isException) {
      this._addExceptionRule(domain, pattern, opts);
    } else {
      this._addBlockRule(domain, pattern, opts);
    }
  }

  // ── Option parser ─────────────────────────────────────────────────────────

  _parseNetworkRule(rawRule) {
    // Find the options separator ($)
    // Be careful: $ can appear in regex patterns /...$/
    let dollarIdx = -1;
    if (rawRule.startsWith('/') && rawRule.includes('$/')) {
      // Regex rule — find last $ that's outside the regex
      const lastSlash = rawRule.lastIndexOf('/');
      dollarIdx = rawRule.indexOf('$', lastSlash);
    } else {
      dollarIdx = rawRule.indexOf('$');
    }

    let pattern, optsStr;
    if (dollarIdx !== -1) {
      pattern = rawRule.slice(0, dollarIdx);
      optsStr = rawRule.slice(dollarIdx + 1);
    } else {
      pattern = rawRule;
      optsStr = '';
    }

    if (!pattern) return { pattern: null, opts: null };

    const opts = this._parseOptions(optsStr);
    return { pattern, opts };
  }

  _parseOptions(optsStr) {
    if (!optsStr) return null;

    const opts = {
      thirdParty: null,       // true = only 3p, false = only 1p, null = any
      domains: null,           // { include: [], exclude: [] } or null
      types: null,             // Set of allowed types, or null = any
      excludeTypes: null,      // Set of excluded types
      important: false,
      matchCase: false,
    };

    const parts = optsStr.split(',');
    const includeTypes = [];
    const excludeTypes = [];
    let hasTypeOption = false;

    for (const raw of parts) {
      const part = raw.trim().toLowerCase();
      if (!part) continue;

      // third-party / first-party
      if (part === 'third-party' || part === '3p') {
        opts.thirdParty = true;
        continue;
      }
      if (part === '~third-party' || part === '~3p' || part === 'first-party' || part === '1p') {
        opts.thirdParty = false;
        continue;
      }

      // domain=
      if (part.startsWith('domain=')) {
        opts.domains = this._parseDomainOption(part.slice(7));
        continue;
      }

      // important
      if (part === 'important') {
        opts.important = true;
        continue;
      }

      // match-case
      if (part === 'match-case') {
        opts.matchCase = true;
        continue;
      }

      // Resource type options
      if (part.startsWith('~')) {
        const typeName = part.slice(1);
        if (ALL_RESOURCE_TYPES.has(typeName)) {
          excludeTypes.push(typeName);
          hasTypeOption = true;
          continue;
        }
      } else if (ALL_RESOURCE_TYPES.has(part)) {
        includeTypes.push(part);
        hasTypeOption = true;
        continue;
      }

      // Skip unknown options (badfilter, redirect, etc.)
    }

    if (includeTypes.length > 0) {
      opts.types = new Set(includeTypes);
    }
    if (excludeTypes.length > 0) {
      opts.excludeTypes = new Set(excludeTypes);
    }

    // If no meaningful options were parsed, return null for fast path
    if (!hasTypeOption && opts.thirdParty === null && !opts.domains && !opts.important) {
      return null;
    }

    return opts;
  }

  _parseDomainOption(domainStr) {
    const include = [];
    const exclude = [];
    const parts = domainStr.split('|');
    for (const raw of parts) {
      const d = raw.trim();
      if (!d) continue;
      if (d.startsWith('~')) {
        exclude.push(d.slice(1));
      } else {
        include.push(d);
      }
    }
    if (include.length === 0 && exclude.length === 0) return null;
    return { include, exclude };
  }

  // ── Block rule storage ────────────────────────────────────────────────────

  _addBlockRule(domain, pattern, opts) {
    if (domain) {
      this.bloomFilter.add(domain);
      if (!opts) {
        // Pure domain rule, no options → fast set
        this.blockedDomains.add(domain);
      } else {
        // Domain rule with options → need evaluation
        this.domainRulesWithOptions.push({ domain, opts });
      }
    } else {
      // Pattern-based rule
      const regex = this._patternToRegex(pattern, opts?.matchCase);
      if (regex) {
        this.blockRules.push({ regex, opts });
      }
    }
  }

  // ── Exception rule storage ────────────────────────────────────────────────

  _addExceptionRule(domain, pattern, opts) {
    if (domain) {
      this.bloomFilter.add(domain);
      if (!opts) {
        this.exceptionDomains.add(domain);
      } else {
        this.exceptionRulesWithOptions.push({ domain, opts });
      }
    } else {
      const regex = this._patternToRegex(pattern, opts?.matchCase);
      if (regex) {
        this.exceptionPatternRules.push({ regex, opts });
      }
    }
  }

  // ── Cosmetic rule storage ─────────────────────────────────────────────────

  _addCosmeticRule(domains, selector) {
    if (!domains) {
      this.genericCosmetics.push(selector);
    } else {
      for (const d of domains.split(',')) {
        const domain = d.trim();
        if (domain.startsWith('~')) continue;
        if (!this.cosmeticRules.has(domain)) {
          this.cosmeticRules.set(domain, []);
        }
        this.cosmeticRules.get(domain).push(selector);
      }
    }
  }

  // ── Scriptlet rule storage ────────────────────────────────────────────────

  _addScriptletRule(domainsStr, rawArgs) {
    const parsed = this._parseScriptletArgs(rawArgs);
    if (!parsed) return;
    const rule = { name: parsed.name, args: parsed.args };

    if (!domainsStr) {
      this.genericScriptlets.push(rule);
    } else {
      for (const d of domainsStr.split(',')) {
        const domain = d.trim();
        if (domain.startsWith('~')) continue;
        if (!this.scriptletRules.has(domain)) {
          this.scriptletRules.set(domain, []);
        }
        this.scriptletRules.get(domain).push(rule);
      }
    }
  }

  // ── Pattern → Regex conversion ────────────────────────────────────────────

  _extractDomainFromPattern(pattern) {
    if (!pattern.startsWith('||')) return null;
    const rest = pattern.slice(2);
    // Match: domain.tld^ or domain.tld (end of string)
    const match = rest.match(/^([a-z0-9]([a-z0-9.-]*[a-z0-9])?)\^?$/i);
    if (match && match[1] && match[1].includes('.') && !match[1].includes('*')) {
      return match[1].toLowerCase();
    }
    return null;
  }

  _patternToRegex(pattern, matchCase) {
    if (!pattern || pattern.length < 3) return null;

    // Skip cosmetic-looking patterns
    if (pattern.includes('##') || pattern.includes('#@#')) return null;

    // Regex rules: /regex/
    if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
      try {
        return new RegExp(pattern.slice(1, -1), matchCase ? '' : 'i');
      } catch {
        return null;
      }
    }

    // Convert ABP pattern to regex
    let regex = '';
    let i = 0;

    // Handle || anchor (domain anchor)
    if (pattern.startsWith('||')) {
      regex += '(?:^https?://(?:[a-z0-9-]+\\.)*?)';
      i = 2;
    } else if (pattern.startsWith('|')) {
      regex += '^';
      i = 1;
    }

    // Process the rest of the pattern
    for (; i < pattern.length; i++) {
      const ch = pattern[i];
      switch (ch) {
        case '*':
          regex += '.*';
          break;
        case '^':
          // Separator: anything except alphanumeric, _, -, ., %
          regex += '(?:[^a-zA-Z0-9_.%-]|$)';
          break;
        case '|':
          if (i === pattern.length - 1) {
            regex += '$';
          } else {
            regex += '\\|';
          }
          break;
        // Escape regex special chars
        case '.': case '+': case '?': case '{': case '}':
        case '(': case ')': case '[': case ']': case '\\':
          regex += '\\' + ch;
          break;
        default:
          regex += ch;
          break;
      }
    }

    if (!regex || regex === '.*') return null;

    try {
      return new RegExp(regex, matchCase ? '' : 'i');
    } catch {
      return null;
    }
  }

  // ── Main matching logic ───────────────────────────────────────────────────

  /**
   * Check if a URL should be blocked
   * @param {string} url - The request URL
   * @param {string} pageHostname - The hostname of the page making the request
   * @param {string} [resourceType] - webRequest resource type (script, image, etc.)
   * @returns {boolean}
   */
  shouldBlock(url, pageHostname, resourceType) {
    // 1. Check LRU Cache (Fastest)
    const cacheKey = `${url}|${pageHostname}|${resourceType}`;
    const cached = this.lruCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const requestDomain = extractDomain(url);
    if (!requestDomain) {
      this.lruCache.set(cacheKey, false);
      return false;
    }

    // 2. Bloom Filter (Fast Domain Check)
    // If the domain is not in the bloom filter, it's definitely not in our
    // blockedDomains, exceptionDomains, or domainRulesWithOptions.
    // We only need to check pattern-based rules.
    const domainInBloom = this.bloomFilter.has(requestDomain);

    // Never block main_frame navigations
    if (resourceType === 'main_frame') {
      this.lruCache.set(cacheKey, false);
      return false;
    }

    // Map webRequest type to ABP type
    const abpType = resourceType ? (WEBREQUEST_TO_ABP[resourceType] || 'other') : null;

    // Determine third-party status
    const isThirdParty = !pageHostname || !isSameSite(requestDomain, pageHostname);

    // ── Check exceptions first ──

    if (domainInBloom) {
      // Simple domain exceptions (no options)
      if (this._domainMatches(requestDomain, this.exceptionDomains)) {
        this.lruCache.set(cacheKey, false);
        return false;
      }

      // Domain exceptions with options
      for (const rule of this.exceptionRulesWithOptions) {
        if (this._domainMatchesSingle(requestDomain, rule.domain) &&
            this._optionsMatch(rule.opts, isThirdParty, abpType, pageHostname)) {
          this.lruCache.set(cacheKey, false);
          return false;
        }
      }
    }

    // Pattern exceptions with options
    for (const rule of this.exceptionPatternRules) {
      if (rule.regex.test(url) &&
          this._optionsMatch(rule.opts, isThirdParty, abpType, pageHostname)) {
        this.lruCache.set(cacheKey, false);
        return false;
      }
    }

    // ── Check $important block rules first (override exceptions) ──
    let importantMatch = false;

    if (domainInBloom) {
      for (const rule of this.domainRulesWithOptions) {
        if (rule.opts?.important &&
            this._domainMatchesSingle(requestDomain, rule.domain) &&
            this._optionsMatch(rule.opts, isThirdParty, abpType, pageHostname)) {
          importantMatch = true;
          break;
        }
      }
    }

    if (!importantMatch) {
      for (const rule of this.blockRules) {
        if (rule.opts?.important &&
            rule.regex.test(url) &&
            this._optionsMatch(rule.opts, isThirdParty, abpType, pageHostname)) {
          importantMatch = true;
          break;
        }
      }
    }
    if (importantMatch) {
      this.lruCache.set(cacheKey, true);
      return true;
    }

    // ── Check block rules ──

    if (domainInBloom) {
      // Fast path: pure domain rules (no options)
      if (this._domainMatches(requestDomain, this.blockedDomains)) {
        this.lruCache.set(cacheKey, true);
        return true;
      }

      // Domain rules with options
      for (const rule of this.domainRulesWithOptions) {
        if (rule.opts?.important) continue;
        if (this._domainMatchesSingle(requestDomain, rule.domain) &&
            this._optionsMatch(rule.opts, isThirdParty, abpType, pageHostname)) {
          this.lruCache.set(cacheKey, true);
          return true;
        }
      }
    }

    // Pattern-based block rules
    for (const rule of this.blockRules) {
      if (rule.opts?.important) continue;
      if (rule.regex.test(url) &&
          this._optionsMatch(rule.opts, isThirdParty, abpType, pageHostname)) {
        this.lruCache.set(cacheKey, true);
        return true;
      }
    }

    this.lruCache.set(cacheKey, false);
    return false;
  }

  // ── Option evaluation ─────────────────────────────────────────────────────

  _optionsMatch(opts, isThirdParty, abpType, pageHostname) {
    if (!opts) return true;

    // $third-party / $~third-party
    if (opts.thirdParty !== null) {
      if (opts.thirdParty && !isThirdParty) return false;
      if (!opts.thirdParty && isThirdParty) return false;
    }

    // $domain= (page domain must match)
    if (opts.domains) {
      if (!pageHostname) {
        // No page context — if include list exists, can't match
        if (opts.domains.include.length > 0) return false;
      } else {
        // Check exclude list first
        for (const d of opts.domains.exclude) {
          if (domainMatchesPattern(pageHostname, d)) return false;
        }
        // Check include list (if non-empty, at least one must match)
        if (opts.domains.include.length > 0) {
          let found = false;
          for (const d of opts.domains.include) {
            if (domainMatchesPattern(pageHostname, d)) {
              found = true;
              break;
            }
          }
          if (!found) return false;
        }
      }
    }

    // Resource type filtering
    if (abpType) {
      if (opts.types && !opts.types.has(abpType)) return false;
      if (opts.excludeTypes && opts.excludeTypes.has(abpType)) return false;
    }

    return true;
  }

  // ── Domain matching helpers ───────────────────────────────────────────────

  _domainMatches(requestDomain, domainSet) {
    if (domainSet.has(requestDomain)) return true;
    // Check parent domains
    const parts = requestDomain.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (domainSet.has(parent)) return true;
    }
    return false;
  }

  _domainMatchesSingle(requestDomain, ruleDomain) {
    if (requestDomain === ruleDomain) return true;
    if (requestDomain.endsWith('.' + ruleDomain)) return true;
    return false;
  }

  // ── Cosmetic selectors ────────────────────────────────────────────────────

  getCosmeticSelectors(hostname) {
    const selectors = [...this.genericCosmetics];
    if (this.cosmeticRules.has(hostname)) {
      selectors.push(...this.cosmeticRules.get(hostname));
    }
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (this.cosmeticRules.has(parent)) {
        selectors.push(...this.cosmeticRules.get(parent));
      }
    }
    return selectors;
  }

  // ── Scriptlet rules ───────────────────────────────────────────────────────

  getScriptletRules(hostname) {
    const rules = [...this.genericScriptlets];
    if (this.scriptletRules.has(hostname)) {
      rules.push(...this.scriptletRules.get(hostname));
    }
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (this.scriptletRules.has(parent)) {
        rules.push(...this.scriptletRules.get(parent));
      }
    }
    return rules;
  }

  // ── Scriptlet arg parser ──────────────────────────────────────────────────

  _parseScriptletArgs(raw) {
    if (!raw) return null;
    const args = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (inQuote) {
        if (ch === quoteChar) {
          inQuote = false;
        } else {
          current += ch;
        }
      } else if (ch === '"' || ch === "'") {
        inQuote = true;
        quoteChar = ch;
      } else if (ch === ',') {
        args.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) args.push(current.trim());

    if (args.length === 0) return null;
    return { name: args[0], args: args.slice(1) };
  }

  // ── User custom filters ───────────────────────────────────────────────────

  addUserRule(line) {
    line = line.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) return;
    this.rulesCount++;
    this._parseLine(line);
  }

  addUserRules(text) {
    const lines = text.split('\n');
    for (const rawLine of lines) {
      this.addUserRule(rawLine);
    }
  }
}

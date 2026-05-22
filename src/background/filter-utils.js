/**
 * Midori Privacy Blocker
 * Shared URL/domain categorization helpers.
 * Extracted from legacy FilterEngine so background modules can use these
 * utilities without bundling the full legacy ABP parser/matcher.
 */

import { getTrackerCategory } from './trackerdb.js';

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
}

const categorizationCache = new LRUCache(2000);

const adUrlPatternsRegex = /(\/ads\/|\/ad\/|\/adserver|\/advert|\/banner|\/sponsor|\/pagead\/|\/adsense|\/adx\/|\/admanager|doubleclick|googlesyndication|googleads|\/prebid|\/gpt.js|\/gpt\/|\/dfp\/)/i;
const trackerUrlPatternsRegex = /(\/analytics|\/tracking|\/tracker|\/pixel|\/beacon|\/collect|\/telemetry|\/metrics|\/event\?|\/pageview|\/impression|google-analytics|googletagmanager|\/gtm.js|\/gtag\/|\/ga.js|\/analytics.js)/i;

const TRACKER_DOMAINS = new Map([
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
  ['fingerprintjs.com', 'trackers'], ['fpjs.io', 'trackers'],
]);

const AD_DOMAINS = new Map([
  ['doubleclick.net', 'ads'], ['googlesyndication.com', 'ads'],
  ['googleadservices.com', 'ads'], ['googleads.g.doubleclick.net', 'ads'],
  ['pagead2.googlesyndication.com', 'ads'], ['adservice.google.com', 'ads'],
  ['googletagservices.com', 'ads'], ['googletag.net', 'ads'],
  ['securepubads.g.doubleclick.net', 'ads'], ['pubads.g.doubleclick.net', 'ads'],
  ['tpc.googlesyndication.com', 'ads'], ['ad.doubleclick.net', 'ads'],
  ['static.doubleclick.net', 'ads'], ['partner.googleadservices.com', 'ads'],
  ['afs.googlesyndication.com', 'ads'], ['2mdn.net', 'ads'],
  ['admob.com', 'ads'], ['adsense.com', 'ads'], ['adsense.google.com', 'ads'],
  ['imasdk.googleapis.com', 'ads'],
  ['bingads.microsoft.com', 'ads'], ['ads.microsoft.com', 'ads'],
  ['bat.bing.com', 'ads'], ['msads.net', 'ads'], ['ads.msn.com', 'ads'],
  ['rad.msn.com', 'ads'], ['adsdk.microsoft.com', 'ads'],
  ['c.msn.com', 'ads'], ['g.msn.com', 'ads'], ['b.www.bing.com', 'ads'],
  ['amazon-adsystem.com', 'ads'], ['aax.amazon-adsystem.com', 'ads'],
  ['c.amazon-adsystem.com', 'ads'], ['fls-na.amazon-adsystem.com', 'ads'],
  ['mads.amazon-adsystem.com', 'ads'], ['s.amazon-adsystem.com', 'ads'],
  ['assoc-amazon.com', 'ads'],
  ['adnxs.com', 'ads'], ['adsrvr.org', 'ads'],
  ['criteo.com', 'ads'], ['criteo.net', 'ads'],
  ['outbrain.com', 'ads'], ['outbrainimg.com', 'ads'],
  ['taboola.com', 'ads'], ['taboolasyndication.com', 'ads'], ['tblcdn.com', 'ads'],
  ['ads-twitter.com', 'ads'], ['moatads.com', 'ads'],
  ['rubiconproject.com', 'ads'], ['pubmatic.com', 'ads'],
  ['magnite.com', 'ads'], ['rubiconproject.net', 'ads'],
  ['openx.net', 'ads'], ['openx.com', 'ads'], ['openxcdn.net', 'ads'],
  ['casalemedia.com', 'ads'],
  ['indexww.com', 'ads'], ['sharethrough.com', 'ads'],
  ['bidswitch.net', 'ads'], ['smartadserver.com', 'ads'],
  ['33across.com', 'ads'], ['triplelift.com', 'ads'],
  ['sovrn.com', 'ads'], ['lijit.com', 'ads'],
  ['media.net', 'ads'], ['revcontent.com', 'ads'],
  ['mgid.com', 'ads'], ['mgidcdn.com', 'ads'], ['zergnet.com', 'ads'],
  ['teads.tv', 'ads'], ['teads.com', 'ads'], ['yieldmo.com', 'ads'],
  ['spotxchange.com', 'ads'], ['spotx.tv', 'ads'],
  ['smaato.net', 'ads'], ['inmobi.com', 'ads'],
  ['mopub.com', 'ads'], ['unity3d.com/ads', 'ads'],
  ['unityads.unity3d.com', 'ads'], ['vungle.com', 'ads'],
  ['applovin.com', 'ads'], ['ironsrc.com', 'ads'],
  ['adcolony.com', 'ads'], ['chartboost.com', 'ads'],
  ['adserver.yahoo.com', 'ads'], ['ads.yahoo.com', 'ads'],
  ['gemini.yahoo.com', 'ads'], ['native.yahoo.com', 'ads'], ['yads.yahoo.com', 'ads'],
  ['moat.com', 'ads'], ['doubleverify.com', 'ads'],
  ['adsafeprotected.com', 'ads'], ['iasds01.com', 'ads'],
  ['trafficjunky.net', 'ads'], ['trafficjunky.com', 'ads'],
  ['juicyads.com', 'ads'], ['ads.juicyads.com', 'ads'],
  ['exoclick.com', 'ads'], ['a.exoclick.com', 'ads'],
  ['ero-advertising.com', 'ads'], ['plugrush.com', 'ads'],
  ['exdynsrv.com', 'ads'], ['trafficfactory.biz', 'ads'],
  ['popads.net', 'ads'], ['popcash.net', 'ads'],
  ['onclickads.net', 'ads'], ['hilltopads.net', 'ads'],
  ['adcash.com', 'ads'], ['adxpansion.com', 'ads'],
]);

const TAXONOMY_DOMAIN_HINTS = {
  'fingerprinting': ['fingerprintjs.com', 'fpjs.io', 'device.maxmind.com', 'threatmetrix.com', 'iovation.com'],
  'session-replay': ['hotjar.com', 'fullstory.com', 'mouseflow.com', 'luckyorange.com', 'clarity.ms'],
  'tag-manager': ['googletagmanager.com', 'tagmanager.google.com', 'segment.com', 'segment.io'],
  'social-pixel': ['connect.facebook.net', 'facebook.com', 'facebook.net', 'snap.licdn.com', 'analytics.twitter.com', 'tiktok.com'],
  'video-ads': ['doubleclick.net', 'googlesyndication.com', 'googlevideo.com', 'imasdk.googleapis.com', 'securepubads.g.doubleclick.net', '2mdn.net', 'teads.tv'],
  'adult-ad-network': ['trafficjunky.net', 'trafficjunky.com', 'juicyads.com', 'exoclick.com', 'ero-advertising.com', 'plugrush.com', 'exdynsrv.com'],
  'ad-exchange': ['adnxs.com', 'adsrvr.org', 'pubmatic.com', 'rubiconproject.com', 'magnite.com', 'openx.net', 'openx.com', 'bidswitch.net', 'indexww.com'],
  'native-ads': ['taboola.com', 'taboolasyndication.com', 'outbrain.com', 'outbrainimg.com', 'mgid.com', 'mgidcdn.com', 'revcontent.com'],
  'popup': ['popads.net', 'popcash.net', 'onclickads.net', 'hilltopads.net', 'adcash.com'],
  'redirect-tracker': ['branch.io', 'app.link', 'adjust.com', 'appsflyer.com', 'kochava.com', 'singular.net'],
};

const TAXONOMY_URL_PATTERNS = {
  'fingerprinting': ['fingerprint', '/fp/', 'device-id', 'canvas'],
  'session-replay': ['session-replay', 'heatmap', 'mouseflow', 'fullstory', 'clarity'],
  'tag-manager': ['/gtm.js', '/gtag/', 'tagmanager'],
  'social-pixel': ['facebook.com/tr', '/pixel', 'linkedin.com/px', 'analytics.twitter.com'],
  'video-ads': ['/pagead/', 'videoad', 'googlevideo.com/videoplayback?adformat=', 'youtubei/v1/player/ad_break', 'imasdk.googleapis.com'],
  'adult-ad-network': ['juicyads', 'trafficjunky', 'exoclick', 'ero-advertising', 'plugrush'],
  'ad-exchange': ['/prebid', '/openrtb', '/bidder', '/hb/', '/auction', '/adx/'],
  'native-ads': ['taboola', 'outbrain', 'mgid', 'revcontent', 'native-ad'],
  'popup': ['popunder', 'popup', 'onclick', 'understitial', 'tabunder', 'window.open(', 'newtab'],
  'redirect-tracker': ['branch.', 'app.link', 'redirect=', 'redir=', 'out?', 'r?u=', '/away.php?', '/out.php?', '/go.php?', 'url='],
};

const VIDEO_CONTEXT_PATTERNS = ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com', 'vimeo.com', 'dailymotion.com', 'twitch.tv', 'vkvideo.ru', 'vk.com', 'vk.ru'];
const ADULT_CONTEXT_PATTERNS = ['pornhub.com', 'redtube.com', 'youporn.com', 'xnxx.com', 'xvideos.com', 'xhamster.com', 'spankbang.com'];
const ADULT_CONTEXT_CLONES = ['porntrex.com', 'thumbzilla.com', 'beeg.com', 'sunporno.com', 'drtuber.com', 'sexvid.xxx'];
const AI_CONTEXT_PATTERNS = ['openai.com', 'chatgpt.com', 'claude.ai', 'anthropic.com', 'perplexity.ai', 'copilot.microsoft.com', 'gemini.google.com'];

function hostnameMatches(hostname, pattern) {
  return hostname === pattern || hostname.endsWith('.' + pattern);
}

function inferVerticalFromHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return 'general';

  for (const pattern of ADULT_CONTEXT_PATTERNS) {
    if (hostnameMatches(host, pattern)) return 'adult';
  }
  for (const pattern of ADULT_CONTEXT_CLONES) {
    if (hostnameMatches(host, pattern)) return 'adult';
  }
  for (const pattern of AI_CONTEXT_PATTERNS) {
    if (hostnameMatches(host, pattern)) return 'ai';
  }
  for (const pattern of VIDEO_CONTEXT_PATTERNS) {
    if (hostnameMatches(host, pattern)) return 'video';
  }
  return 'general';
}

function inferTaxonomy(hostname, urlLower) {
  for (const [taxonomy, domains] of Object.entries(TAXONOMY_DOMAIN_HINTS)) {
    for (const domain of domains) {
      if (hostnameMatches(hostname, domain)) return taxonomy;
    }
  }

  for (const [taxonomy, patterns] of Object.entries(TAXONOMY_URL_PATTERNS)) {
    for (const pattern of patterns) {
      if (urlLower.includes(pattern)) return taxonomy;
    }
  }

  return 'generic';
}

export function classifyRequestDetails(url, pageHostname = '', resourceType = 'other') {
  const cacheKey = `${url}|${pageHostname}`;
  const cached = categorizationCache.get(cacheKey);
  if (cached) return cached;

  const urlLower = url.toLowerCase();
  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {}

  let category = 'other';

  if (hostname) {
    if (AD_DOMAINS.has(hostname)) {
      category = 'ads';
    } else if (TRACKER_DOMAINS.has(hostname)) {
      category = 'trackers';
    } else {
      const parts = hostname.split('.');
      const maxParentChecks = Math.min(parts.length - 1, 4);
      for (let i = 1; i < maxParentChecks; i++) {
        const parent = parts.slice(i).join('.');
        if (AD_DOMAINS.has(parent)) {
          category = 'ads';
          break;
        }
        if (TRACKER_DOMAINS.has(parent)) {
          category = 'trackers';
          break;
        }
      }
    }

    if (category === 'other') {
      const tdbCat = getTrackerCategory(hostname);
      if (tdbCat && tdbCat !== 'other') category = tdbCat;
    }
  }

  if (category === 'other' && adUrlPatternsRegex.test(urlLower)) {
    category = 'ads';
  }

  if (category === 'other' && trackerUrlPatternsRegex.test(urlLower)) {
    category = 'trackers';
  }

  const vertical = inferVerticalFromHostname(pageHostname || hostname);
  const taxonomy = inferTaxonomy(hostname, urlLower);

  if (category === 'other' && (taxonomy === 'video-ads' || taxonomy === 'adult-ad-network' || taxonomy === 'popup')) {
    category = 'ads';
  }
  if (category === 'other' && (taxonomy === 'fingerprinting' || taxonomy === 'session-replay' || taxonomy === 'tag-manager' || taxonomy === 'social-pixel' || taxonomy === 'redirect-tracker')) {
    category = 'trackers';
  }

  if (resourceType === 'ping' && category === 'other') {
    category = 'trackers';
  }

  const result = {
    category,
    taxonomy,
    vertical,
    hostname,
    resourceType,
  };

  categorizationCache.set(cacheKey, result);
  return result;
}

export function categorizeRequest(url) {
  return classifyRequestDetails(url).category;
}

export function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

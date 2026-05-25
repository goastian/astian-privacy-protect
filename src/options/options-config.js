/**
 * Static options-page configuration and lookup data.
 * Keeping this out of options.js leaves that file focused on rendering and
 * event flow rather than long literal maps.
 */

export const FILTER_LIST_GROUPS = {
  'Core': {
    'easylist': { name: 'EasyList', desc: 'Primary ad blocking list' },
    'easyprivacy': { name: 'EasyPrivacy', desc: 'Tracker blocking list' },
    'ublock-filters': { name: 'uBlock Filters', desc: 'Complementary filters by uBlock Origin' },
    'ublock-privacy': { name: 'uBlock Privacy', desc: 'Extra privacy filters' },
    'ublock-unbreak': { name: 'uBlock Unbreak', desc: 'Fixes for sites broken by blocking' },
    'peter-lowe': { name: "Peter Lowe's Ad Servers", desc: 'Known ad server domains' },
    'ublock-quick-fixes': { name: 'uBlock Quick Fixes', desc: 'Quick fixes & anti-adblock scriptlets' },
  },
  'Annoyances': {
    'ublock-annoyances-cookies': { name: 'uBlock Annoyances (Cookies)', desc: 'Cookie consent banners' },
    'ublock-annoyances-others': { name: 'uBlock Annoyances (Other)', desc: 'Popups, notifications, etc.' },
    'fanboy-social': { name: "Fanboy's Social", desc: 'Social media widgets' },
    'fanboy-annoyance': { name: "Fanboy's Annoyance", desc: 'Comprehensive annoyance blocking' },
  },
  'AdGuard': {
    'adguard-base': { name: 'AdGuard Base', desc: 'AdGuard ad blocking rules' },
    'adguard-tracking': { name: 'AdGuard Tracking Protection', desc: 'AdGuard tracker blocking' },
    'adguard-social': { name: 'AdGuard Social Media', desc: 'Social media widgets by AdGuard' },
    'adguard-annoyances': { name: 'AdGuard Annoyances', desc: 'Popups, banners, cookie notices' },
    'adguard-mobile': { name: 'AdGuard Mobile Ads', desc: 'Mobile-specific ad blocking' },
    'adguard-spyware-firstparty': { name: 'AdGuard First-party Trackers', desc: 'First-party tracking protection' },
  },
  'Regional': {
    'easylist-spanish': { name: 'EasyList Spanish', desc: 'Ads on Spanish-language sites' },
    'easylist-germany': { name: 'EasyList Germany', desc: 'Ads on German-language sites' },
    'easylist-france': { name: 'EasyList France', desc: 'Ads on French-language sites' },
  },
};

// Flat map for backward compatibility
export const FILTER_LISTS = {};
for (const group of Object.values(FILTER_LIST_GROUPS)) {
  Object.assign(FILTER_LISTS, group);
}

// Preset filter templates
export const PRESETS = {
  'youtube-antiadblock': `! === YouTube Anti-Adblock ===
youtube.com##+js(abort-on-property-read, ytInitialPlayerResponse.adPlacements)
youtube.com##+js(set-constant, ytInitialPlayerResponse.adPlacements, undefined)
youtube.com##+js(abort-on-property-read, playerResponse.adPlacements)
youtube.com##+js(set-constant, yt.config_.EXPERIMENT_FLAGS.web_display_new_leaderboard_ad, false)
youtube.com##+js(json-prune, adPlacements playerAds adSlots)
youtube.com##+js(no-fetch-if, googlevideo.com/initplayback)
youtube.com##.ytp-ad-module
youtube.com##.ytp-ad-overlay-container
youtube.com##.ytd-ad-slot-renderer
youtube.com##ytd-in-feed-ad-layout-renderer
youtube.com##ytd-banner-promo-renderer
youtube.com##ytd-promoted-sparkles-web-renderer
youtube.com##.ytd-mealbar-promo-renderer
`,
  'twitch-ads': `! === Twitch Ad Blocking ===
twitch.tv##+js(set-constant, Tw.ads, undefined)
twitch.tv##+js(abort-on-property-read, Tw.ads)
twitch.tv##+js(no-fetch-if, usher.ttvnw.net/api/lvs/ads)
twitch.tv##+js(json-prune, data.user.self.showAds)
twitch.tv##+js(set-constant, csgo.ads.adRequested, trueFunc)
||imasdk.googleapis.com/js/sdkloader/ima3.js$domain=twitch.tv
||usher.ttvnw.net/api/lvs/ads$domain=twitch.tv
twitch.tv##.stream-display-ad__container
twitch.tv##.video-player__ad-overlay
`,
  'forbes-adblock': `! === Forbes Anti-Adblock Bypass ===
forbes.com##+js(set-constant, fbs_settings.ad.blocking.enabled, false)
forbes.com##+js(set-constant, isAdBlockerEnabled, false)
forbes.com##+js(abort-on-property-read, canRunAds)
forbes.com##+js(set-constant, forbes.adblock, false)
forbes.com##.ad-unit
forbes.com##.fbs-ad--ntv
forbes.com##.top-ad-container
`,
  'anti-adblock-general': `! === General Anti-Adblock Killer ===
##+js(abort-on-property-read, _sp_._networkListenerData)
##+js(set-constant, blurred, false)
##+js(set-constant, adBlockDetected, false)
##+js(set-constant, adblockDetector, noopFunc)
##+js(set-constant, isAdBlockActive, false)
##+js(set-constant, adBlockEnabled, false)
##+js(abort-on-property-read, blockAdBlock)
##+js(abort-on-property-read, blockAdBlock._options)
##+js(set-constant, blockAdBlock, noopFunc)
##+js(set-constant, canRunAds, true)
##+js(set-constant, isAdBlockerEnabled, false)
##+js(abort-on-property-read, FuckAdBlock)
##+js(abort-on-property-read, fuckAdBlock)
##+js(set-constant, detectAdBlock, noopFunc)
`,
  'cookie-annoyances': `! === Cookie Popup Blocking ===
##.cookie-banner
##.cookie-consent
##.cookie-notice
##.cookie-popup
##.cc-banner
##.cc-window
##.gdpr-banner
##.gdpr-consent
##.consent-banner
##.consent-modal
##[id*="cookie-banner"]
##[id*="cookie-consent"]
##[class*="cookie-notice"]
##[id*="gdpr"]
##.CookieConsent
##.js-cookie-consent
##.eupopup
`,
  'social-trackers': `! === Social Media Tracker Blocking ===
||connect.facebook.net/*/fbevents.js
||platform.twitter.com/widgets.js
||platform.linkedin.com/in.js
||apis.google.com/js/plusone.js
||static.addtoany.com/menu/page.js
||s7.addthis.com^
||platform.stumbleupon.com^
||widgets.pinterest.com^
||platform-api.sharethis.com^
||cdn.shareaholic.net^
||assets.pinterest.com/js/pinit.js
`,
};

export const VERTICAL_ORDER = ['general', 'video', 'adult', 'ai'];
export const VERTICAL_LABELS = {
  general: 'General',
  video: 'Video',
  adult: 'Adult',
  ai: 'AI',
};

export const VERTICAL_PROFILE_DEFAULTS = {
  general: {
    popupDefense: 'balanced',
    trackerSensitivity: 0,
    adSensitivity: 0,
    scriptSensitivity: 0.06,
    xhrSensitivity: 0.06,
    fingerprintSensitivity: 0.1,
    cosmeticsEnabled: true,
  },
  video: {
    popupDefense: 'balanced',
    trackerSensitivity: 0.03,
    adSensitivity: 0.08,
    scriptSensitivity: 0.04,
    xhrSensitivity: 0.04,
    fingerprintSensitivity: 0.08,
    cosmeticsEnabled: true,
  },
  adult: {
    popupDefense: 'strict',
    trackerSensitivity: 0.12,
    adSensitivity: 0.2,
    scriptSensitivity: 0.08,
    xhrSensitivity: 0.08,
    fingerprintSensitivity: 0.14,
    cosmeticsEnabled: true,
  },
  ai: {
    popupDefense: 'balanced',
    trackerSensitivity: 0.08,
    adSensitivity: 0.03,
    scriptSensitivity: 0.07,
    xhrSensitivity: 0.07,
    fingerprintSensitivity: 0.16,
    cosmeticsEnabled: true,
  },
};

export const CAT_COLORS = {
  trackers: '#f39c12',
  ads: '#e74c3c',
  fingerprinters: '#8b5cf6',
  other: '#6b7380',
};

export const TRACKER_DB = {
  'doubleclick.net':       { company: 'Google', type: 'Ad Network', country: 'US' },
  'googlesyndication.com': { company: 'Google', type: 'Ad Network', country: 'US' },
  'googleadservices.com':  { company: 'Google', type: 'Ad Network', country: 'US' },
  'google-analytics.com':  { company: 'Google', type: 'Analytics', country: 'US' },
  'googletagmanager.com':  { company: 'Google', type: 'Tag Manager', country: 'US' },
  'googleapis.com':        { company: 'Google', type: 'API Service', country: 'US' },
  'facebook.net':          { company: 'Meta', type: 'Social Tracker', country: 'US' },
  'facebook.com':          { company: 'Meta', type: 'Social Tracker', country: 'US' },
  'fbcdn.net':             { company: 'Meta', type: 'CDN / Tracker', country: 'US' },
  'instagram.com':         { company: 'Meta', type: 'Social Tracker', country: 'US' },
  'amazon-adsystem.com':   { company: 'Amazon', type: 'Ad Network', country: 'US' },
  'criteo.com':            { company: 'Criteo', type: 'Ad Retargeting', country: 'FR' },
  'criteo.net':            { company: 'Criteo', type: 'Ad Retargeting', country: 'FR' },
  'outbrain.com':          { company: 'Outbrain', type: 'Content Ads', country: 'US' },
  'taboola.com':           { company: 'Taboola', type: 'Content Ads', country: 'US' },
  'scorecardresearch.com': { company: 'comScore', type: 'Analytics', country: 'US' },
  'quantserve.com':        { company: 'Quantcast', type: 'Audience Analytics', country: 'US' },
  'hotjar.com':            { company: 'Hotjar', type: 'Session Recording', country: 'MT' },
  'mouseflow.com':         { company: 'Mouseflow', type: 'Session Recording', country: 'DK' },
  'clarity.ms':            { company: 'Microsoft', type: 'Session Recording', country: 'US' },
  'bing.com':              { company: 'Microsoft', type: 'Ad Network', country: 'US' },
  'linkedin.com':          { company: 'Microsoft', type: 'Social Tracker', country: 'US' },
  'twitter.com':           { company: 'X Corp', type: 'Social Tracker', country: 'US' },
  'x.com':                 { company: 'X Corp', type: 'Social Tracker', country: 'US' },
  't.co':                  { company: 'X Corp', type: 'Link Tracker', country: 'US' },
  'tiktok.com':            { company: 'ByteDance', type: 'Social Tracker', country: 'CN' },
  'byteoversea.com':       { company: 'ByteDance', type: 'Analytics', country: 'CN' },
  'snapchat.com':          { company: 'Snap', type: 'Social Tracker', country: 'US' },
  'pinterest.com':         { company: 'Pinterest', type: 'Social Tracker', country: 'US' },
  'adnxs.com':             { company: 'Xandr (Microsoft)', type: 'Ad Exchange', country: 'US' },
  'rubiconproject.com':    { company: 'Magnite', type: 'Ad Exchange', country: 'US' },
  'pubmatic.com':          { company: 'PubMatic', type: 'Ad Exchange', country: 'US' },
  'openx.net':             { company: 'OpenX', type: 'Ad Exchange', country: 'US' },
  'casalemedia.com':       { company: 'Index Exchange', type: 'Ad Exchange', country: 'CA' },
  'newrelic.com':          { company: 'New Relic', type: 'Performance', country: 'US' },
  'sentry.io':             { company: 'Sentry', type: 'Error Tracking', country: 'US' },
  'segment.io':            { company: 'Twilio', type: 'Analytics', country: 'US' },
  'segment.com':           { company: 'Twilio', type: 'Analytics', country: 'US' },
  'mixpanel.com':          { company: 'Mixpanel', type: 'Analytics', country: 'US' },
  'amplitude.com':         { company: 'Amplitude', type: 'Analytics', country: 'US' },
  'optimizely.com':        { company: 'Optimizely', type: 'A/B Testing', country: 'US' },
  'crazyegg.com':          { company: 'Crazy Egg', type: 'Heatmaps', country: 'US' },
  'demdex.net':            { company: 'Adobe', type: 'DMP / Tracker', country: 'US' },
  'omtrdc.net':            { company: 'Adobe', type: 'Analytics', country: 'US' },
  'yandex.ru':             { company: 'Yandex', type: 'Analytics', country: 'RU' },
  'mc.yandex.ru':          { company: 'Yandex', type: 'Metrica', country: 'RU' },
  'baidu.com':             { company: 'Baidu', type: 'Analytics', country: 'CN' },
};

/**
 * Static cosmetic selector data for content/cosmetic.js.
 * Kept separate so the content script flow is readable while preserving
 * the exact selector lists and comments.
 */

// ══════════════════════════════════════════════════════════════════════════
// LAYER 1 — Global CSS rules (injected on EVERY page, zero JS overhead)
// These target the most common ad container patterns across the web.
//
// Phase B (2026-05-06): hardened against false positives. Substring
// [class*="ad-X"] / [id^="ad-"] selectors were colliding with legitimate
// names (head-block, read-banner, thread-container, road-unit, …).
// Selectors below now require word-boundaries (delimiters `-`/`_`/space,
// explicit prefixes/suffixes, or :is/[class~=]) to avoid collateral hides.
// `pointer-events: none` was also removed: it left elements in the layout
// tree and blocked clicks on siblings due to z-index ordering.
// ══════════════════════════════════════════════════════════════════════════

// Vendor / brand-specific selectors (never collide with legitimate names).
const GLOBAL_AD_VENDOR_SELECTORS = [
  // Google Ad Manager / GPT / AdSense
  '[id^="div-gpt-ad"]',
  '[id^="google_ads_iframe"]',
  '[id^="google_ads_"]',
  '[data-google-query-id]',
  '[data-ad-slot]',
  '[data-ad-client]',
  '[data-adsbygoogle-status]',
  'ins.adsbygoogle',
  'ins.adsbygoogle[data-ad-status="unfilled"]',
  // Ad iframes (URL-based — safe)
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="amazon-adsystem.com"]',
  'iframe[src*="adnxs.com"]',
  'iframe[src*="rubiconproject.com"]',
  'iframe[src*="openx.net"]',
  'iframe[src*="pubmatic.com"]',
  'iframe[src*="criteo."]',
  'iframe[src*="taboola.com"]',
  'iframe[src*="outbrain.com"]',
  'iframe[src*="mgid.com"]',
  'iframe[id*="google_ads"]',
  'iframe[id^="aswift_"]',
  'iframe[name*="google_ads"]',
  // Aria labels / data-testid
  '[aria-label="Advertisement"]',
  '[aria-label="Publicidad"]',
  '[aria-label="Sponsored"]',
  '[aria-label="Anuncio"]',
  '[aria-label*="advertisement" i]',
  '[aria-label*="sponsored" i]',
  '[data-testid="ad"]',
  '[data-testid="advertisement"]',
  // Taboola / Outbrain / MGID widgets (vendor names — low FP risk)
  '[id^="taboola-"]',
  '[class~="taboola"]',
  '[class^="taboola-"]',
  '[class*=" taboola-"]',
  '[id^="outbrain_widget"]',
  '[class~="outbrain"]',
  '[class*="OUTBRAIN"]',
  '[data-widget-id*="taboola"]',
  '[id^="mgid-"]',
  '[id*="-mgid-"]',
  '[class~="mgid"]',
  '[class^="mgid-"]',
  '[class*=" mgid-"]',
  // Data attributes (require specificity to avoid generic [data-ad] FPs)
  '[data-ad-id]',
  '[data-ad-ref]',
  '[data-ad-type]',
  '[data-ad-name]',
  '[data-ad-unit]',
  '[data-ad-zone]',
  '[data-advertisement]',
  '[data-dfp]',
  '[data-freestar-ad]',
  '[data-revive-zoneid]',
  '[data-ad-manager-id]',
];

// Generic ID selectors — restricted to specific ad-related prefixes only
// (broad `[id^="ad-"]` was matching admin paneles, etc.).
const GLOBAL_AD_GENERIC_ID_SELECTORS = [
  '[id^="ad-slot-"]',
  '[id^="ad-banner-"]',
  '[id^="ad-container-"]',
  '[id^="ad-unit-"]',
  '[id^="ad-zone-"]',
  '[id^="ad-wrapper-"]',
  '[id^="ad-placement-"]',
  '[id^="ad-iframe-"]',
  '[id^="ad-frame-"]',
  '[id^="ad-leaderboard"]',
  '[id^="ad-rectangle"]',
  '[id^="ad-skyscraper"]',
  '[id^="ad-billboard"]',
  '[id^="ad-interstitial"]',
  '[id^="ad-sidebar"]',
  '[id^="ad-top"]',
  '[id^="ad-bottom"]',
  '[id^="ad-right"]',
  '[id^="ad-left"]',
  '[id^="ad-header"]',
  '[id^="ad-footer"]',
  '[id^="ad_slot_"]',
  '[id^="ad_banner_"]',
  '[id^="ad_container_"]',
  '[id^="ad_unit_"]',
  '[id^="ad_zone_"]',
  '[id^="ad_wrapper_"]',
  '[id^="ads-"]',
  '[id^="ads_"]',
  '[id^="adsbox"]',
  '[id^="adsense"]',
  '[id^="adContainer"]',
  '[id^="adWrapper"]',
  '[id^="adSlot"]',
  '[id^="adBanner"]',
  '[id^="adUnit"]',
  '[id^="adZone"]',
  '[id$="-adcontainer"]',
  '[id$="-adslot"]',
  '[id$="-adbanner"]',
  '[id$="-adunit"]',
  '[id$="-ad-slot"]',
  '[id$="-ad-banner"]',
  '[id$="-ad-container"]',
  '[id$="-ad-unit"]',
  '[id$="-ad-wrapper"]',
  '[id*="-ad-slot-"]',
  '[id*="-ad-banner-"]',
  '[id*="-ad-container-"]',
  '[id*="-ad-unit-"]',
];

// Generic class selectors — every entry below requires either a delimiter
// (`-`, `_`, space) or anchored start/end to avoid substring collisions
// with legitimate names like head-block, road-unit, thread-container, …
const GLOBAL_AD_GENERIC_CLASS_SELECTORS = [
  // Anchored prefixes (first class in attr starts with…)
  '[class^="ad-"]',
  '[class^="ad_"]',
  '[class^="ads-"]',
  '[class^="ads_"]',
  '[class^="adv-"]',
  '[class^="advert"]',
  '[class^="adsbygoogle"]',
  '[class^="adContainer"]',
  '[class^="adWrapper"]',
  '[class^="adSlot"]',
  '[class^="adBanner"]',
  '[class^="adUnit"]',
  '[class^="adZone"]',
  '[class^="adBlock"]',
  '[class^="adPlacement"]',
  // Anchored suffixes (last class in attr ends with…)
  '[class$="-ad"]',
  '[class$="-ads"]',
  '[class$="-advert"]',
  '[class$="-sponsored"]',
  '[class$="-adcontainer"]',
  '[class$="-adwrapper"]',
  '[class$="-adslot"]',
  '[class$="-adbanner"]',
  '[class$="-adunit"]',
  // Word-boundary (whole class name) — the `~=` selector matches when the
  // attribute value contains exactly the given token between whitespace.
  '[class~="ad"]',
  '[class~="ads"]',
  '[class~="advert"]',
  '[class~="advertisement"]',
  '[class~="sponsored"]',
  '[class~="ad-banner"]',
  '[class~="ad-slot"]',
  '[class~="ad-container"]',
  '[class~="ad-unit"]',
  '[class~="ad-zone"]',
  '[class~="ad-wrapper"]',
  '[class~="ad-block"]',
  '[class~="ad-placement"]',
  '[class~="ad-leaderboard"]',
  '[class~="ad-rectangle"]',
  '[class~="ad-skyscraper"]',
  '[class~="ad-billboard"]',
  '[class~="ad-interstitial"]',
  '[class~="ad-native"]',
  '[class~="ad-sponsored"]',
  '[class~="sponsored-ad"]',
  '[class~="native-ad"]',
  // Delimited mid-attribute matches (require a leading delimiter to
  // prevent collisions like "thread-container" / "load-block").
  '[class*=" ad-"]',
  '[class*=" ads-"]',
  '[class*=" adv-"]',
  '[class*="-ad-banner"]',
  '[class*="-ad-slot"]',
  '[class*="-ad-container"]',
  '[class*="-ad-unit"]',
  '[class*="-ad-zone"]',
  '[class*="-ad-wrapper"]',
  '[class*="-ad-block"]',
  '[class*="-ad-placement"]',
  '[class*="-ad-leaderboard"]',
  '[class*="-ad-rectangle"]',
  '[class*="-ad-skyscraper"]',
  '[class*="-ad-billboard"]',
  '[class*="-ad-interstitial"]',
  '[class*="-ad-native"]',
  '[class*="-ad-sponsored"]',
  '[class*="-sponsored-ad"]',
  '[class*="-native-ad"]',
  '[class*="_ad_banner"]',
  '[class*="_ad_slot"]',
  '[class*="_ad_container"]',
  '[class*="_ad_unit"]',
  '[class*="_ad_zone"]',
  '[class*="_ad_wrapper"]',
  '[class*="_ad_block"]',
  '[class*="_sponsored_ad"]',
  '[class*="_native_ad"]',
];

export const GLOBAL_AD_SELECTORS = [
  ...GLOBAL_AD_VENDOR_SELECTORS,
  ...GLOBAL_AD_GENERIC_ID_SELECTORS,
  ...GLOBAL_AD_GENERIC_CLASS_SELECTORS,
];

// Note: `pointer-events: none` deliberately removed — when used globally it
// leaves elements in the box tree and can intercept clicks on siblings via
// stacking context, breaking interaction on otherwise-visible UI.
export const GLOBAL_AD_CSS = `${GLOBAL_AD_SELECTORS.join(',\n')} {
display: none !important;
height: 0 !important;
min-height: 0 !important;
max-height: 0 !important;
overflow: hidden !important;
margin: 0 !important;
padding: 0 !important;
border: 0 !important;
opacity: 0 !important;
}`;

// Sites where generic ad CSS causes false positives (breaks UI).
// Phase B: extended with sensitive sites where Reddit-style CSS class
// collisions historically caused layout breakage. Will be trimmed back as
// we gain confidence in the tightened selectors above.
// Phase E (2026-05-07): mail/productivity/banking critical sites added —
// Gmail, Outlook, iCloud, Yahoo Mail, Proton, banking, etc. Generic
// [class~="ad"] / [class*=" ad-"] selectors collide with these sites'
// obfuscated class names (e.g. Gmail's `.adn`, `.adP`, `.aiL`) and hide
// the message body / reading pane. These hosts must be considered
// first-party-trusted and never receive heuristic ad CSS.
export const GLOBAL_CSS_EXCLUDE = new Set([
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  // Phase B safety allowlist
  'reddit.com',
  'redditmedia.com',
  'redditstatic.com',
  'github.com',
  'githubusercontent.com',
  'gist.github.com',
  'gitlab.com',
  'bitbucket.org',
  'x.com',
  'twitter.com',
  'linkedin.com',
  'licdn.com',
  'stackoverflow.com',
  'stackexchange.com',
  'serverfault.com',
  'superuser.com',
  'askubuntu.com',
  'mathoverflow.net',
  // Phase E: critical first-party sites (mail / productivity / banking).
  // Mirrors `CRITICAL_FIRST_PARTY_SITES` in policy-engine.js.
  // NOTE (2026-05-08): google.com / microsoft.com / msn.com / bing.com are
  // intentionally NOT here — they show sponsored ads on home / search /
  // news pages that legitimately need cosmetic filtering. Specific auth /
  // mail subdomains are protected by suffix-matching `gmail.com` etc.
  'gmail.com',
  'googlemail.com',
  'mail.google.com',
  'drive.google.com',
  'docs.google.com',
  'calendar.google.com',
  'accounts.google.com',
  'pay.google.com',
  'live.com',
  'office.com',
  'office365.com',
  'outlook.com',
  'sharepoint.com',
  'icloud.com',
  'apple.com',
  'mail.yahoo.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'tutanota.com',
  'fastmail.com',
  'zoho.com',
  'gmx.com',
  'mail.ru',
  'atlassian.com',
  'slack.com',
  'notion.so',
  'linear.app',
  'figma.com',
  'paypal.com',
  'stripe.com',
  'wise.com',
  'revolut.com',
  'shopify.com',
  // ── Video-call / WebRTC apps (require camera / mic / location) ──────────
  // Generic ad CSS collides with UI containers in these apps and can hide
  // the participant grid, chat panel, or permission-request overlays.
  'zoom.us', 'zoomgov.com', 'zoom.com',
  'teams.microsoft.com', 'teams.live.com',
  'meet.google.com', 'hangouts.google.com',
  'webex.com', 'whereby.com', 'daily.co',
  'jitsi.org', 'meet.jit.si',
  'skype.com', 'gotomeeting.com', 'gotowebinar.com',
  'bluejeans.com', 'ringcentral.com',
  // ── Banking / fintech (critical — never inject ad CSS) ───────────────────
  'bancolombia.com', 'davivienda.com', 'bbva.com', 'bbvanet.com',
  'bankofamerica.com', 'chase.com', 'wellsfargo.com', 'citibank.com',
  'capitalone.com', 'usbank.com', 'ally.com',
  'mercadopago.com', 'mercadolibre.com',
  'nubank.com.br', 'itau.com.br', 'bradesco.com.br',
  'banamex.com', 'banorte.com', 'santander.com',
]);

// ══════════════════════════════════════════════════════════════════════════
// LAYER 2 — Site-specific cosmetic selectors (enhancement layer)
// ══════════════════════════════════════════════════════════════════════════

export const BUILTIN_COSMETICS = {
  'youtube.com': [
    // ── Feed / page-level ad elements (safe to hide) ──
    '#masthead-ad', '#player-ads', '#ad-text',
    '#below ytd-ad-slot-renderer', 'ytd-ad-slot-renderer',
    'ytd-rich-item-renderer:has(> .ytd-ad-slot-renderer)',
    'ytd-banner-promo-renderer', 'ytd-statement-banner-renderer',
    'ytd-in-feed-ad-layout-renderer', 'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer',
    'ytd-compact-promoted-video-renderer',
    '#related ytd-promoted-sparkles-web-renderer',
    '#related ytd-promoted-sparkles-text-search-renderer',
    '#companion', '#offer-module',
    'ytd-merch-shelf-renderer', 'ytd-action-companion-ad-renderer',
    'ytd-search-pyv-renderer', 'ytd-promoted-sparkles-text-search-renderer',
    '.ytd-mealbar-promo-renderer', 'ytd-mealbar-promo-renderer',
    'tp-yt-paper-dialog:has(> ytd-mealbar-promo-renderer)',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
    'ytd-brand-video-singleton-renderer', 'ytd-brand-video-shelf-renderer',
    // ── Overlay ads on player (only leaf elements, not containers) ──
    '.ytp-ad-text-overlay', '.ytp-ad-image-overlay',
    '.ytp-ad-message-container',
    '.ytp-ad-survey', '.ytp-ad-feedback-dialog-container',
    '#movie_player > .ytp-paid-content-overlay',
    // NOTE: Do NOT hide .ytp-ad-overlay-container or .ytp-ad-overlay-slot —
    // they are in the player's click event path and break pause/spacebar.
    // ── Anti-adblock enforcement modals ──
    'ytd-enforcement-message-view-model',
    'tp-yt-paper-dialog.ytd-popup-container:has(ytd-enforcement-message-view-model)',
    'ytd-popup-container tp-yt-paper-dialog:has(.yt-about-this-ad-renderer)',
    // ── YouTube Shorts ads ──
    'ytd-reel-video-renderer ytd-ad-slot-renderer',
    'ytd-reel-video-renderer [is-ad]',
    'ytd-reel-video-renderer .ytd-ad-slot-renderer',
    // NOTE: Do NOT hide .ytp-ad-module, .ytp-ad-skip-button-container,
    // .video-ads, .ytp-ad-player-overlay, .ytp-ad-action-interstitial,
    // .ytp-ad-persistent-progress-bar-container — hiding them breaks
    // player controls (pause, seek, skip) and causes infinite ad loops.
  ],
  'yahoo.com': [
    '.gemini-ad', '.caas-da', '.native-ad-item', '.SponsoredContent',
    '[data-test-locator="stream-ad"]', '[data-test-locator="MAST"]',
    '[data-test-locator="LDRB"]', '[data-test-locator="LREC"]',
    '[data-test-locator="MON"]',
    '.stream-item-ad', '.ntk-ad', '.Mags-ad',
    '.ad-ldrb', '.ad-mast', '.ad-lrec', '.ad-mon',
    '.wafer-ad', '.wafer-ad-container',
    '.caas-ad-container', '.tdv2-applet-ad',
    '[data-test-locator="gemini-ad"]', '[data-testid="ad-container"]',
    '[id^="YDC-Stream-Ads"]', '[id^="defaultdestad"]',
    'li:has([data-test-locator="stream-ad"])',
  ],
  'msn.com': [
    '.ad-nativeAd', '.nativead', '.adunit',
    '[class*="AdModule"]', '.infopane-ad', '.river-ad', '.articlead',
    'msn-ad', 'msn-shopping-card', '.sponsored-content',
    '[data-t="ad"]', '[data-t*="native-ad" i]', '[data-contenttype="ad"]',
    '[data-m*="ad" i][class*="card" i]', '[class*="native-ad" i]',
    '[class*="sponsored" i][class*="card" i]', '[aria-label*="advertisement" i]',
    'iframe[src*="rad.msn.com"]', 'iframe[src*="msads.net"]',
    'msn-native-ad', '[data-module-id*="nativead" i]',
    '[data-adunit]', '[data-ad-unit]', '[data-testid*="ad" i][class*="card" i]',
  ],
  'bing.com': [
    '#b_results .b_ad', '#b_results .b_adTop', '#b_results .b_adBottom',
    '#b_context .b_ad', '.sb_add', '.b_adSlug', '.b_adlabel',
    '[data-bm="ad"]', '[data-advertiserid]', '[aria-label*="advertisement" i]',
    'li:has(.b_adSlug)', 'li:has(.b_adlabel)',
    '#b_results li:has([data-advertiserid])',
    '#b_results li:has([aria-label*="Sponsored" i])',
    '#b_context [data-advertiserid]',
  ],
  'google.com': [
    '#tads', '#tadsb', '#bottomads', '#taw', '#rhsads', '#center_col > #taw',
    'div[data-text-ad="1"]', 'div[data-pcu]', 'div[data-rw][data-pcu]',
    'div[data-dtld]', 'a[data-rw][data-pcu]', '[aria-label="Ads"]',
    '[aria-label="Sponsored"]', '[aria-label="Publicidad"]',
    'div:has(> span[aria-label="Sponsored"])',
    '#rso div[data-text-ad]', '#rso div:has(> div > span[aria-label="Sponsored"])',
    'div[role="complementary"] div[data-text-ad="1"]',
  ],
  'twitch.tv': [
    '[data-a-target="video-ad-label"]', '[data-a-target="video-ad-countdown"]',
    '[data-a-target="ad-banner"]', '.channel-leaderboard', '.stream-display-ad',
    '.video-player__overlay[data-a-target="video-ad-overlay"]',
    '[data-a-target="video-ad-info-bar"]',
    '.ad-banner', '.prime-offers', '.top-nav__prime-link',
    '.community-highlight-stack__card--ad',
    '[data-a-target="ad-countdown-text"]',
    '[data-a-target="video-ad-pause-overlay"]',
    '.ad-overlay', '.ad-notification',
  ],
  'spotify.com': [
    '[data-testid*="advert" i]',
    '[data-testid*="sponsored" i]',
    '[aria-label*="Advertisement" i]',
    '[aria-label*="Sponsored" i]',
    '[aria-label*="Publicidad" i]',
    '[aria-label*="Anuncio" i]',
    'iframe[src*="doubleclick" i]',
    'iframe[src*="googlesyndication" i]',
    'iframe[src*="ads" i]',
  ],
  'facebook.com': [
    '[data-pagelet*="FeedUnit"]:has(a[href*="ads/about"])',
    '[data-pagelet*="FeedUnit"]:has(span:has-text("Sponsored"))',
    'div[data-testid="fbfeed_story"]:has(a[href="#"]>span:has-text("Sponsored"))',
    'div[role="article"]:has(a[href*="/ads/"])',
    '[aria-label="Sponsored"]', '[aria-label="Patrocinado"]',
    '.x1lliihq:has(a[href*="ads/about"])',
    '.sponsored_stories', '.ego_column', '.pagelet_side_ads',
    '._5pcq', '._5lQU', '._5qdq',
  ],
  'twitter.com': [
    '[data-testid="placementTracking"]',
    'article:has(path[d*="M19.498"])',
    '[data-testid="tweet"]:has([data-testid="placementTracking"])',
    '[data-testid="cellInnerDiv"]:has([data-testid="placementTracking"])',
    '[data-testid="UserCell"]:has(a[href*="/i/premium"])',
    'aside[role="complementary"] [data-testid="trend"]:has(span:has-text("Promoted"))',
    '[data-testid="trend"]:has(path[d*="M19.498"])',
  ],
  'x.com': [
    '[data-testid="placementTracking"]',
    'article:has(path[d*="M19.498"])',
    '[data-testid="tweet"]:has([data-testid="placementTracking"])',
    '[data-testid="cellInnerDiv"]:has([data-testid="placementTracking"])',
    '[data-testid="UserCell"]:has(a[href*="/i/premium"])',
    'aside[role="complementary"] [data-testid="trend"]:has(span:has-text("Promoted"))',
    '[data-testid="trend"]:has(path[d*="M19.498"])',
  ],
  'reddit.com': [
    'shreddit-ad-post', '.promotedlink', '.promoted',
    '[data-testid="adPost"]', '[data-ad-clicked]',
    'shreddit-experience-tree [bundlename="ad_post"]',
    '.ad-container', '[data-testid="post-container"]:has([data-ad-clicked])',
    '.listing-ad', '#ad_1', '#ad_2',
    'shreddit-post[adpost]', 'shreddit-post[is-sponsored]',
    '[data-testid="post-container"]:has([slot="promoted"])',
    'faceplate-tracker[noun="ad"]', 'div[data-promoted="true"]',
  ],
  'instagram.com': [
    'article:has([aria-label="Sponsored"])',
    'article:has([aria-label="Patrocinado"])',
    'div:has(> span:has-text("Sponsored"))',
    '[data-testid="post-container"]:has(a[href*="/ads/"])',
  ],
  'linkedin.com': [
    '.feed-shared-update-v2:has(.update-components-actor__description:has-text("Promoted"))',
    '.feed-shared-update-v2--ad', '[data-id*="urn:li:sponsoredCreative"]',
    '.ad-banner-container', '.ads-container',
    '.artdeco-card:has(.feed-shared-actor__description:has-text("Promoted"))',
  ],
  'tiktok.com': [
    '[data-e2e="recommend-list-item-container"]:has([class*="SpanAdTag"])',
    '[class*="DivAdBadge"]', '[class*="SpanAdTag"]',
  ],
  'forbes.com': [
    '.fbs-ad', '.top-ad-container', '.article-body-ad', '.ad-rail',
  ],
  'cnn.com': [
    '.ad__container', '.pg-ad-slot',
  ],
  'bbc.com': [
    '.ssrcss-ad', '.dotcom-ad', '.bbccom_advert',
  ],
};

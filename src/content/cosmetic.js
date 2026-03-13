/**
 * Midori Privacy Blocker
 * Content script - cosmetic filtering (element hiding + ad collapse)
 * Works on ALL sites with generic ad detection + site-specific enhancements.
 * Compatible with Chromium MV3 and Firefox MV2.
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

(function () {
  'use strict';

  const COLLAPSE_CSS = 'display:none!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important;border:0!important;opacity:0!important;pointer-events:none!important;';
  const ATTR_COLLAPSED = 'data-midori-c';
  let appliedStyle = null;
  let globalAdStyle = null;

  // ── Cross-browser sendMessage wrapper ────────────────────────────────────
  // Firefox MV2: browser.runtime.sendMessage returns a Promise.
  // Chromium MV3: chrome.runtime.sendMessage returns a Promise.
  function sendMsg(msg) {
    return new Promise(resolve => {
      try {
        const p = chrome.runtime.sendMessage(msg);
        if (p && typeof p.then === 'function') {
          p.then(resolve).catch(() => resolve(null));
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 1 — Global CSS rules (injected on EVERY page, zero JS overhead)
  // These target the most common ad container patterns across the web.
  // ══════════════════════════════════════════════════════════════════════════

  const GLOBAL_AD_CSS = `
/* ── Google Ad Manager / GPT ── */
[id^="div-gpt-ad"],
[id^="google_ads_iframe"],
[id^="google_ads_"],
[data-google-query-id],
[data-ad-slot],
[data-ad-client],
[data-adsbygoogle-status],
ins.adsbygoogle,
ins.adsbygoogle[data-ad-status="unfilled"],
/* ── Generic ad containers by ID ── */
[id^="ad-"],
[id^="ad_"],
[id$="-ad"],
[id$="_ad"],
[id^="ads-"],
[id^="ads_"],
[id*="-ad-"],
[id*="_ad_"],
[id*="AdSlot"],
[id*="adslot"],
[id*="ad-slot"],
[id*="ad_slot"],
[id*="ad-container"],
[id*="ad_container"],
[id*="adContainer"],
/* ── Generic ad containers by class ── */
[class*="ad-container"],
[class*="ad_container"],
[class*="adContainer"],
[class*="ad-slot"],
[class*="ad_slot"],
[class*="adSlot"],
[class*="ad-wrapper"],
[class*="ad_wrapper"],
[class*="adWrapper"],
[class*="ad-banner"],
[class*="ad_banner"],
[class*="adBanner"],
[class*="ad-unit"],
[class*="ad_unit"],
[class*="adUnit"],
[class*="ad-placement"],
[class*="ad_placement"],
[class*="adPlacement"],
[class*="ad-zone"],
[class*="ad_zone"],
[class*="adZone"],
[class*="ad-block"],
[class*="ad_block"],
[class*="adBlock"],
[class*="ad-leaderboard"],
[class*="ad-rectangle"],
[class*="ad-skyscraper"],
[class*="ad-billboard"],
[class*="ad-interstitial"],
[class*="ad-native"],
[class*="ad-sponsored"],
[class*="sponsored-ad"],
[class*="native-ad"],
[class*="nativeAd"],
/* ── Data attributes ── */
[data-ad],
[data-ad-id],
[data-ad-ref],
[data-ad-type],
[data-ad-name],
[data-ad-unit],
[data-ad-zone],
[data-advertisement],
[data-dfp],
[data-freestar-ad],
[data-revive-zoneid],
[data-ad-manager-id],
/* ── Ad iframes ── */
iframe[src*="doubleclick.net"],
iframe[src*="googlesyndication.com"],
iframe[src*="amazon-adsystem.com"],
iframe[src*="adnxs.com"],
iframe[src*="rubiconproject.com"],
iframe[src*="openx.net"],
iframe[src*="pubmatic.com"],
iframe[src*="criteo."],
iframe[src*="taboola.com"],
iframe[src*="outbrain.com"],
iframe[src*="mgid.com"],
iframe[id*="google_ads"],
iframe[id*="aswift_"],
iframe[name*="google_ads"],
/* ── Common ad labels / sponsored ── */
[aria-label="Advertisement"],
[aria-label="Publicidad"],
[aria-label="Sponsored"],
[aria-label="Anuncio"],
[aria-label*="advertisement"],
[aria-label*="sponsored"],
[data-testid="ad"],
[data-testid="advertisement"],
/* ── Taboola / Outbrain / MGID widgets ── */
[id^="taboola-"],
[class*="taboola"],
[id^="outbrain_widget"],
[class*="outbrain"],
[class*="OUTBRAIN"],
[data-widget-id*="taboola"],
[id*="mgid"],
[class*="mgid"],
/* ── Empty ad placeholders ── */
div[style*="min-height"]:empty,
div[style*="min-width"]:empty
{
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  max-height: 0 !important;
  overflow: hidden !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
`;

  // Sites where generic ad CSS causes false positives (breaks UI)
  const GLOBAL_CSS_EXCLUDE = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];

  function shouldExcludeGlobalCSS(host) {
    for (const domain of GLOBAL_CSS_EXCLUDE) {
      if (host === domain || host.endsWith('.' + domain)) return true;
    }
    return false;
  }

  function injectGlobalAdCSS() {
    if (globalAdStyle) return;
    if (shouldExcludeGlobalCSS(window.location.hostname)) return;
    globalAdStyle = document.createElement('style');
    globalAdStyle.setAttribute('data-midori-privacy', 'global-ad-collapse');
    globalAdStyle.textContent = GLOBAL_AD_CSS;
    (document.head || document.documentElement).appendChild(globalAdStyle);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 2 — Site-specific cosmetic selectors (enhancement layer)
  // ══════════════════════════════════════════════════════════════════════════

  const BUILTIN_COSMETICS = {
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
      // ── Overlay ads on player (non-intrusive, safe to hide) ──
      '.ytp-ad-text-overlay', '.ytp-ad-image-overlay',
      '.ytp-ad-overlay-slot', '.ytp-ad-message-container',
      '.ytp-ad-overlay-container',
      '.ytp-ad-survey', '.ytp-ad-feedback-dialog-container',
      '#movie_player > .ytp-paid-content-overlay',
      // ── Anti-adblock enforcement modals ──
      'ytd-enforcement-message-view-model',
      'tp-yt-paper-dialog.ytd-popup-container:has(#dismiss-button)',
      'tp-yt-paper-dialog.ytd-popup-container:has(ytd-enforcement-message-view-model)',
      'ytd-popup-container tp-yt-paper-dialog:has(.yt-about-this-ad-renderer)',
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
    ],
    'msn.com': [
      '.ad-nativeAd', '.nativead', '.adunit',
      '[class*="AdModule"]', '.infopane-ad', '.river-ad', '.articlead',
      'msn-ad', 'msn-shopping-card', '.sponsored-content',
    ],
    'twitch.tv': [
      '[data-a-target="video-ad-label"]', '[data-a-target="video-ad-countdown"]',
      '[data-a-target="ad-banner"]', '.channel-leaderboard', '.stream-display-ad',
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

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 3 — Filter-list cosmetic selectors (from background engine)
  // ══════════════════════════════════════════════════════════════════════════

  function applySelectors(selectors) {
    if (!selectors || selectors.length === 0) return;

    if (appliedStyle && appliedStyle.parentNode) {
      appliedStyle.parentNode.removeChild(appliedStyle);
    }

    const CHUNK_SIZE = 50;
    const cssRules = [];

    for (let i = 0; i < selectors.length; i += CHUNK_SIZE) {
      const chunk = selectors.slice(i, i + CHUNK_SIZE);
      const validSelectors = chunk.filter(s => {
        try { document.querySelector(s); return true; } catch { return false; }
      });
      if (validSelectors.length > 0) {
        cssRules.push(validSelectors.join(',\n') + ' { ' + COLLAPSE_CSS.replace(/!/g, ' !') + ' }');
      }
    }

    if (cssRules.length === 0) return;

    const style = document.createElement('style');
    style.setAttribute('data-midori-privacy', 'cosmetic');
    style.textContent = cssRules.join('\n');
    (document.head || document.documentElement).appendChild(style);
    appliedStyle = style;
  }

  function getBuiltinSelectors(hostname) {
    const selectors = [];
    if (BUILTIN_COSMETICS[hostname]) {
      selectors.push(...BUILTIN_COSMETICS[hostname]);
    }
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (BUILTIN_COSMETICS[parent]) {
        selectors.push(...BUILTIN_COSMETICS[parent]);
      }
    }
    return selectors;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 4 — Universal JS-based ad detector & collapser
  // Runs on EVERY site. Detects ad containers the CSS rules may miss
  // (e.g. elements without matching selectors but with ad-related content).
  // ══════════════════════════════════════════════════════════════════════════

  // Patterns that strongly indicate an ad container
  const AD_ID_RE = /^(?:div-gpt-ad|google_ads|ad[-_]|ads[-_]|adSlot|adUnit|adContainer|adPlacement|adZone|adBanner|taboola|outbrain|mgid)/i;
  const AD_CLASS_RE = /(?:^|\s)(?:ad[-_]?(?:container|slot|wrapper|banner|unit|placement|zone|block|leaderboard|rectangle|skyscraper|billboard|interstitial|native|sponsored|box|rail|ldrb|mast|lrec|mon)|sponsored[-_]?(?:ad|content|link)|native[-_]?ad|nativeAd|adsbygoogle|taboola|outbrain|OUTBRAIN|mgid|gemini-ad|wafer-ad|fbs-ad)(?:\s|$)/i;
  const AD_SRC_RE = /(?:doubleclick\.net|googlesyndication\.com|amazon-adsystem\.com|adnxs\.com|rubiconproject\.com|openx\.net|pubmatic\.com|criteo\.|taboola\.com|outbrain\.com|mgid\.com)/i;

  // Tags that should NEVER be collapsed (to avoid breaking pages)
  const SAFE_TAGS = new Set(['HTML', 'BODY', 'HEAD', 'MAIN', 'ARTICLE', 'SECTION', 'NAV', 'HEADER', 'FOOTER', 'FORM', 'TABLE', 'UL', 'OL', 'VIDEO', 'AUDIO', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

  function isAdElement(el) {
    if (!el || !el.tagName || el.hasAttribute(ATTR_COLLAPSED)) return false;
    if (SAFE_TAGS.has(el.tagName)) return false;

    const id = el.id || '';
    const cls = el.className || '';
    const clsStr = typeof cls === 'string' ? cls : (cls.baseVal || '');

    // Check ID
    if (id && AD_ID_RE.test(id)) return true;

    // Check class
    if (clsStr && AD_CLASS_RE.test(clsStr)) return true;

    // Check data attributes
    if (el.hasAttribute('data-ad') || el.hasAttribute('data-ad-id') ||
        el.hasAttribute('data-ad-slot') || el.hasAttribute('data-ad-client') ||
        el.hasAttribute('data-adsbygoogle-status') || el.hasAttribute('data-google-query-id') ||
        el.hasAttribute('data-dfp') || el.hasAttribute('data-ad-unit') ||
        el.hasAttribute('data-freestar-ad') || el.hasAttribute('data-revive-zoneid') ||
        el.hasAttribute('data-ad-manager-id')) return true;

    // Check aria-label
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel && (ariaLabel.includes('advertisement') || ariaLabel.includes('publicidad') ||
        ariaLabel.includes('sponsored') || ariaLabel.includes('anuncio'))) return true;

    // Check iframes
    if (el.tagName === 'IFRAME') {
      const src = el.src || el.getAttribute('data-src') || '';
      if (AD_SRC_RE.test(src)) return true;
      const name = el.name || '';
      if (/google_ads|aswift_/.test(name)) return true;
      const iframeId = el.id || '';
      if (/google_ads_iframe|aswift_/.test(iframeId)) return true;
    }

    // Check for ins.adsbygoogle
    if (el.tagName === 'INS' && clsStr.includes('adsbygoogle')) return true;

    return false;
  }

  /**
   * Collapse an element and propagate upward if parent becomes empty.
   * This eliminates blank spaces left by blocked ads.
   */
  function collapseElement(el) {
    if (!el || el.hasAttribute(ATTR_COLLAPSED)) return;
    if (SAFE_TAGS.has(el.tagName)) return;

    el.style.cssText = COLLAPSE_CSS;
    el.setAttribute(ATTR_COLLAPSED, '1');

    // Propagate: if parent has no visible children left, collapse it too
    collapseEmptyParent(el.parentElement);
  }

  function collapseEmptyParent(parent) {
    if (!parent || SAFE_TAGS.has(parent.tagName) || parent.hasAttribute(ATTR_COLLAPSED)) return;

    // Check if all children are collapsed
    const children = parent.children;
    let allCollapsed = true;
    for (let i = 0; i < children.length; i++) {
      if (!children[i].hasAttribute(ATTR_COLLAPSED)) {
        allCollapsed = false;
        break;
      }
    }

    // Also check for meaningful text content outside child elements
    if (allCollapsed) {
      const textOnly = parent.textContent.trim();
      // If there's significant text content, don't collapse
      if (textOnly.length > 20) return;

      parent.style.cssText = COLLAPSE_CSS;
      parent.setAttribute(ATTR_COLLAPSED, '1');

      // Continue propagating up (max 3 levels to avoid over-collapsing)
      collapseEmptyParent(parent.parentElement);
    }
  }

  /**
   * Scan the entire document for ad elements and collapse them.
   * Uses querySelectorAll for known patterns + walks new mutations.
   */
  function scanAndCollapse(root, fullScan) {
    if (!root || !root.querySelectorAll) return;

    // Fast path: query known ad selectors (always runs)
    const fastSelectors = [
      '[id^="div-gpt-ad"]', '[id^="google_ads"]', 'ins.adsbygoogle',
      '[data-google-query-id]', '[data-ad-slot]', '[data-ad-client]',
      'iframe[id*="google_ads"]', 'iframe[id*="aswift_"]',
      '[id^="taboola-"]', '[id^="outbrain_widget"]', '[id*="mgid"]',
    ];

    for (const sel of fastSelectors) {
      try {
        const els = root.querySelectorAll(sel);
        for (let i = 0; i < els.length; i++) {
          collapseElement(els[i]);
        }
      } catch {}
    }

    // Slow path: heuristic check on all elements (only on initial/full scans)
    if (fullScan) {
      try {
        const allDivs = root.querySelectorAll('div, aside, section, ins, iframe');
        for (let i = 0; i < allDivs.length; i++) {
          if (isAdElement(allDivs[i])) {
            collapseElement(allDivs[i]);
          }
        }
      } catch {}
    }
  }

  /**
   * Lightweight scan for just the added nodes from a mutation.
   */
  function scanMutations(mutations) {
    for (const mutation of mutations) {
      for (let i = 0; i < mutation.addedNodes.length; i++) {
        const node = mutation.addedNodes[i];
        if (node.nodeType !== 1) continue; // Element nodes only

        // Check the node itself
        if (isAdElement(node)) {
          collapseElement(node);
          continue; // No need to scan children if parent is collapsed
        }

        // Check children (only if it has child elements)
        if (node.children && node.children.length > 0) {
          scanAndCollapse(node);
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 5 — Scriptlet bridge (ISOLATED → MAIN world)
  // ══════════════════════════════════════════════════════════════════════════

  function forwardScriptletsToPage(scriptlets) {
    if (!scriptlets || scriptlets.length === 0) return;
    window.postMessage({
      type: 'midori-scriptlets',
      scriptlets: scriptlets,
    }, '*');
  }

  const BUILTIN_SCRIPTLETS = {
    'youtube.com': [
      // Single scriptlet handles: auto-skip ads + enforcement modal removal.
      // Does NOT hook into YouTube internal APIs to avoid breaking playback.
      { name: 'yt-ad-pruner', args: [] },
    ],
    'twitch.tv': [
      { name: 'set-constant', args: ['__twilightBuildID', ''] },
      { name: 'abort-on-property-read', args: ['navigator.brave'] },
    ],
    'forbes.com': [
      { name: 'set-constant', args: ['fbs_settings.ad.blocking.enabled', 'false'] },
      { name: 'abort-on-property-read', args: ['forbes_ABTest'] },
      { name: 'abort-on-property-read', args: ['detectBlocker'] },
    ],
  };

  function getBuiltinScriptlets(hostname) {
    const rules = [];
    if (BUILTIN_SCRIPTLETS[hostname]) {
      rules.push(...BUILTIN_SCRIPTLETS[hostname]);
    }
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (BUILTIN_SCRIPTLETS[parent]) {
        rules.push(...BUILTIN_SCRIPTLETS[parent]);
      }
    }
    return rules;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION — runs on every page
  // ══════════════════════════════════════════════════════════════════════════

  // Listen for messages from background
  let ghosteryStyle = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'apply-cosmetics' && msg.selectors) {
      const builtin = getBuiltinSelectors(window.location.hostname);
      applySelectors([...builtin, ...msg.selectors]);
    }
    if (msg.action === 'apply-scriptlets' && msg.scriptlets) {
      forwardScriptletsToPage(msg.scriptlets);
    }
    // Ghostery engine: pre-compiled CSS styles (more complete than selectors alone)
    if (msg.action === 'apply-cosmetic-styles' && msg.styles) {
      if (ghosteryStyle && ghosteryStyle.parentNode) {
        ghosteryStyle.parentNode.removeChild(ghosteryStyle);
      }
      ghosteryStyle = document.createElement('style');
      ghosteryStyle.setAttribute('data-midori-privacy', 'ghostery-cosmetic');
      ghosteryStyle.textContent = msg.styles;
      (document.head || document.documentElement).appendChild(ghosteryStyle);
    }
    // Ghostery engine: pre-compiled scriptlet code (inject directly into page)
    if (msg.action === 'apply-compiled-scriptlets' && msg.scripts) {
      for (const code of msg.scripts) {
        if (code && typeof code === 'string') {
          window.postMessage({
            type: 'midori-compiled-scriptlet',
            code: code,
          }, '*');
        }
      }
    }
  });

  const hostname = window.location.hostname;
  if (!hostname) return;

  // ── Step 1: Inject global ad-collapse CSS immediately ──
  injectGlobalAdCSS();

  // ── Step 2: Apply site-specific + filter-list cosmetic selectors ──
  const builtin = getBuiltinSelectors(hostname);

  sendMsg({ action: 'get-cosmetics', hostname }).then(response => {
    const all = [...builtin, ...(response?.selectors || [])];
    applySelectors(all);
  });

  // ── Step 3: Inject scriptlets ──
  const builtinScriptlets = getBuiltinScriptlets(hostname);
  if (builtinScriptlets.length > 0) {
    forwardScriptletsToPage(builtinScriptlets);
  }

  sendMsg({ action: 'get-scriptlets', hostname }).then(response => {
    if (response?.scriptlets?.length > 0) {
      forwardScriptletsToPage(response.scriptlets);
    }
  });

  // ── Step 3b: Anti-fingerprinting protection ──
  sendMsg({ action: 'get-anti-fingerprint' }).then(response => {
    if (response?.enabled) {
      const fpScriptlets = [
        { name: 'canvas-fingerprint-protect', args: [] },
        { name: 'webgl-fingerprint-protect', args: [] },
        { name: 'audiocontext-fingerprint-protect', args: [] },
        { name: 'navigator-fingerprint-protect', args: [] },
        { name: 'screen-fingerprint-protect', args: [] },
      ];
      forwardScriptletsToPage(fpScriptlets);
    }
  });

  // ── Step 4: Run initial JS-based ad scan ──
  // Skip heuristic scanning on sites with complex UIs where generic patterns
  // cause false positives (YouTube, etc.). These sites rely solely on their
  // BUILTIN_COSMETICS selectors.
  const skipHeuristicScan = shouldExcludeGlobalCSS(hostname);

  function initialScan() {
    if (skipHeuristicScan) return;
    scanAndCollapse(document.body || document.documentElement, true);
  }

  if (!skipHeuristicScan) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initialScan, { once: true });
    } else {
      initialScan();
    }

    // Also scan after full load (catches lazy-loaded ads)
    window.addEventListener('load', () => {
      setTimeout(initialScan, 500);
      setTimeout(initialScan, 2000);
      setTimeout(initialScan, 5000);
    }, { once: true });
  }

  // ── Step 5: Universal MutationObserver — watches for dynamically inserted ads ──
  // Skip on excluded sites to avoid false positives and performance overhead.
  let observerTimer = null;

  function startUniversalObserver() {
    if (skipHeuristicScan) return;
    const target = document.body || document.documentElement;
    if (!target) {
      document.addEventListener('DOMContentLoaded', startUniversalObserver, { once: true });
      return;
    }

    const observer = new MutationObserver((mutations) => {
      // Debounce: batch mutations to avoid excessive processing
      if (observerTimer) return;
      observerTimer = setTimeout(() => {
        observerTimer = null;
        scanMutations(mutations);
      }, 100);
    });

    observer.observe(target, { childList: true, subtree: true });
  }

  startUniversalObserver();

  // ── Step 6: SPA navigation handler (YouTube, etc.) ──
  let lastUrl = location.href;
  function checkSPANavigation() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;

      // Re-apply cosmetics
      if (builtin.length > 0 && !appliedStyle?.parentNode) {
        applySelectors(builtin);
      }

      // Re-inject scriptlets
      if (builtinScriptlets.length > 0) {
        forwardScriptletsToPage(builtinScriptlets);
      }

      // Re-scan for ads after navigation
      setTimeout(initialScan, 300);
      setTimeout(initialScan, 1500);
    }
  }

  // Use both popstate and MutationObserver for SPA detection
  window.addEventListener('popstate', checkSPANavigation);

  // YouTube-specific: listen for yt-navigate-finish (native SPA event)
  if (hostname.endsWith('youtube.com')) {
    document.addEventListener('yt-navigate-finish', () => {
      lastUrl = location.href;
      // Re-apply cosmetics only — scriptlets (Response.prototype.json hook,
      // MutationObserver, setInterval) persist across SPA navigations.
      // Re-injecting them creates duplicate hooks that multiply latency.
      if (builtin.length > 0) {
        applySelectors(builtin);
      }
    });
  }

  // For pushState/replaceState SPAs (non-YouTube sites)
  function startSPAObserver() {
    const target = document.body || document.documentElement;
    if (!target) {
      document.addEventListener('DOMContentLoaded', startSPAObserver, { once: true });
      return;
    }
    const spaObserver = new MutationObserver(checkSPANavigation);
    spaObserver.observe(document.querySelector('title') || target, {
      childList: true, subtree: false, characterData: true,
    });
  }
  startSPAObserver();

})();

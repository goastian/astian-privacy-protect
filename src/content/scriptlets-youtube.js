/**
 * YouTube-specific scriptlet generator.
 * Extracted from scriptlets.js so the registry stays readable.
 */

// ══════════════════════════════════════════════════════════════════════════
// YOUTUBE AD BLOCKER
// Single, robust scriptlet that handles all YouTube ad blocking.
// Strategy: Auto-skip ads instantly + remove enforcement modals.
// Does NOT hook into YouTube's internal APIs (no Object.defineProperty,
// no JSON.parse, no Response.prototype.json) to avoid breaking playback.
// ══════════════════════════════════════════════════════════════════════════

export function buildYoutubeAdPrunerScriptlet() {
  return `(function() {
    if (window.__midoriYtAdPrunerInstalled) return;
    window.__midoriYtAdPrunerInstalled = true;

    // ── CONFIG ──
    var SKIP_BTN = [
      '.ytp-ad-skip-button',
      '.ytp-ad-skip-button-modern',
      '.ytp-skip-ad-button',
      'button.ytp-ad-skip-button-modern',
      '.ytp-ad-skip-button-slot button',
      '.ytp-ad-skip-button-slot .ytp-ad-skip-button-container',
      '.ytp-ad-skip-button-slot .ytp-ad-skip-button-text',
      'button[id^="skip-button"]',
      '.videoAdUiSkipButton',
      '.ytp-ad-skip-button-slot',
    ].join(',');
    var OVERLAY_CLOSE = '.ytp-ad-overlay-close-button, .ytp-ad-overlay-close-container button, .ytp-ad-overlay-close-button svg';
    var userWasMuted = false;
    var savedState = false;
    var lastAdSeenAt = 0;
    var lastTickAt = 0;
    var lastAdaptiveScanAt = 0;
    var heartbeatTimer = 0;
    var playerObserver = null;
    var enforcementObserver = null;
    var videoEventsBound = false;
    var learnedSkipSelectors = [];
    var LEARNED_SELECTOR_KEY = '__midoriYtLearnedSkipSelectors';
    var MAX_LEARNED_SELECTORS = 12;
    var SKIP_TEXT_RE = /\\b(skip|skip ads?|skip ad|omitir|saltar|saltar anuncio|saltar anuncios|ignorar|pular|passer|ignorer|überspringen|annonce überspringen|salta|salta annuncio)\\b/i;
    var AD_LABEL_RE = /\\b(ad|ads|advertisement|advertising|sponsored|publicidad|anuncio|anuncios|patrocinado|propaganda|pubblicit[aà]|annonce|werbung)\\b/i;

    function loadLearnedSelectors() {
      try {
        var raw = localStorage.getItem(LEARNED_SELECTOR_KEY);
        var parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return;
        for (var i = 0; i < parsed.length && learnedSkipSelectors.length < MAX_LEARNED_SELECTORS; i++) {
          if (typeof parsed[i] === 'string' && parsed[i].length < 180) learnedSkipSelectors.push(parsed[i]);
        }
      } catch(e) {}
    }

    function saveLearnedSelectors() {
      try { localStorage.setItem(LEARNED_SELECTOR_KEY, JSON.stringify(learnedSkipSelectors.slice(0, MAX_LEARNED_SELECTORS))); } catch(e) {}
    }

    function cssEscapeValue(value) {
      try {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
      } catch(e) {}
      return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
    }

    function compactClassSelector(el) {
      if (!el || !el.classList || el.classList.length === 0) return '';
      var parts = [];
      for (var i = 0; i < el.classList.length && parts.length < 3; i++) {
        var cls = String(el.classList[i] || '');
        if (!cls || cls.length > 60) continue;
        if (/^(ytp-|yt-|yt-spec-|yt-core-|html5-|videoAdUi)/.test(cls) || /skip|ad/i.test(cls)) {
          parts.push('.' + cssEscapeValue(cls));
        }
      }
      return parts.join('');
    }

    function stableSelectorFor(el) {
      if (!el || !el.matches) return '';
      var tag = String(el.localName || 'button').toLowerCase();
      var id = String(el.id || '');
      if (id && id.length <= 80 && /skip|ad/i.test(id)) return tag + '#' + cssEscapeValue(id);

      var testId = el.getAttribute('data-testid') || el.getAttribute('data-a-target') || el.getAttribute('aria-label');
      if (testId && testId.length <= 80 && /skip|ad|saltar|omitir|pular|annonce|werbung/i.test(testId)) {
        var attr = el.getAttribute('data-testid') ? 'data-testid' : (el.getAttribute('data-a-target') ? 'data-a-target' : 'aria-label');
        return tag + '[' + attr + '="' + cssEscapeValue(testId) + '"]';
      }

      var classSelector = compactClassSelector(el);
      if (classSelector) return tag + classSelector;
      return '';
    }

    function rememberSkipSelector(el) {
      var selector = stableSelectorFor(el);
      if (!selector || learnedSkipSelectors.indexOf(selector) !== -1) return;
      learnedSkipSelectors.unshift(selector);
      if (learnedSkipSelectors.length > MAX_LEARNED_SELECTORS) learnedSkipSelectors.length = MAX_LEARNED_SELECTORS;
      saveLearnedSelectors();
    }

    function visibleText(el) {
      if (!el) return '';
      return [
        el.getAttribute && (el.getAttribute('aria-label') || ''),
        el.getAttribute && (el.getAttribute('title') || ''),
        el.textContent || '',
        el.id || '',
        el.className || ''
      ].join(' ').replace(/\\s+/g, ' ').trim();
    }

    function shouldRunTick(minGapMs) {
      var now = Date.now();
      var gap = typeof minGapMs === 'number' ? minGapMs : 100;
      if ((now - lastTickAt) < gap) return false;
      lastTickAt = now;
      return true;
    }

    // ── INJECT CSS to hide feed-level ad elements instantly ──
    // NOTE: Do NOT hide .ytp-ad-module, .ytp-ad-overlay-container,
    // .ytp-ad-overlay-slot, .ytp-ad-player-overlay — these are part of the
    // player control layer; hiding them breaks pause/click/spacebar.
    var s = document.createElement('style');
    s.textContent = [
      'ytd-promoted-sparkles-web-renderer,',
      'ytd-promoted-video-renderer,',
      'ytd-compact-promoted-video-renderer,',
      'ytd-banner-promo-renderer,',
      'ytd-statement-banner-renderer,',
      'ytd-in-feed-ad-layout-renderer,',
      'ytd-ad-slot-renderer,',
      'ytd-rich-item-renderer:has(ytd-ad-slot-renderer),',
      'ytd-companion-slot-renderer,',
      'ytd-player-legacy-desktop-watch-ads-renderer,',
      'ytd-merch-shelf-renderer,',
      'ytd-brand-video-singleton-renderer,',
      'ytd-brand-video-shelf-renderer,',
      '#masthead-ad,',
      '#player-ads,',
      '#panels .ytd-ads-engagement-panel-content-renderer,',
      'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model),',
      'ytd-reel-video-renderer ytd-ad-slot-renderer,',
      'ytd-reel-video-renderer [is-ad],',
      'ytd-reel-video-renderer .ytd-ad-slot-renderer',
      '{ display: none !important; }'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
    loadLearnedSelectors();

    // ── AD DETECTION ──
    function isAdShowing() {
      var p = document.getElementById('movie_player');
      if (!p) return false;
      // Only trust the definitive 'ad-showing' class — overlay elements
      // can persist in DOM after ads end and cause false positives.
      if (!p.classList.contains('ad-showing')) {
        return hasVisibleAdSignal(p);
      }
      // Secondary check: guard against race condition where 'ad-showing'
      // class lingers briefly after the ad finishes. If the video has
      // already ended or is within 0.5s of its end, the ad is over.
      try {
        var v = p.querySelector('video');
        if (v && v.duration && isFinite(v.duration) && v.duration > 0) {
          if (v.ended || v.currentTime >= v.duration - 0.5) return false;
        }
      } catch(e) {}
      return true;
    }

    function hasVisibleAdSignal(player) {
      try {
        if (document.querySelector(SKIP_BTN)) return true;
        var signs = player.querySelectorAll([
          '.ytp-ad-player-overlay',
          '.ytp-ad-preview-container',
          '.ytp-ad-text',
          '.ytp-ad-simple-ad-badge',
          '.ytp-ad-duration-remaining',
          '.video-ads .ytp-ad-module',
          '[class*="ad-showing"]',
          '[id*="ad_creative"]'
        ].join(','));
        for (var i = 0; i < signs.length; i++) {
          if (isElementVisible(signs[i]) && AD_LABEL_RE.test(visibleText(signs[i]))) return true;
        }
      } catch(e) {}
      return false;
    }

    // ── SKIP LOGIC ──
    function tryClickSkip() {
      for (var s = 0; s < learnedSkipSelectors.length; s++) {
        try {
          var learned = document.querySelectorAll(learnedSkipSelectors[s]);
          for (var l = 0; l < learned.length; l++) {
            if (isElementVisible(learned[l])) {
              learned[l].click();
              return true;
            }
          }
        } catch(e) {}
      }

      var btns = document.querySelectorAll(SKIP_BTN);
      for (var i = 0; i < btns.length; i++) {
        if (isElementVisible(btns[i])) {
          rememberSkipSelector(btns[i]);
          btns[i].click();
          return true;
        }
      }

      return tryClickAdaptiveSkip();
    }

    function tryClickAdaptiveSkip() {
      var now = Date.now();
      if ((now - lastAdaptiveScanAt) < 300) return false;
      lastAdaptiveScanAt = now;

      try {
        var scope = document.getElementById('movie_player') || document;
        var candidates = scope.querySelectorAll('button, [role="button"], [tabindex], a');
        for (var i = 0; i < candidates.length; i++) {
          var el = candidates[i];
          if (!isElementVisible(el)) continue;
          var text = visibleText(el);
          if (!SKIP_TEXT_RE.test(text)) continue;
          rememberSkipSelector(el);
          el.click();
          return true;
        }
      } catch(e) {}
      return false;
    }

    function tryAPISkip() {
      try {
        var p = document.getElementById('movie_player');
        if (p && typeof p.skipAd === 'function') { p.skipAd(); return true; }
        if (p && typeof p.cancelPlayback === 'function' && isAdShowing()) {
          p.cancelPlayback();
          return true;
        }
      } catch(e) {}
      return false;
    }

    function forceSkipVideo() {
      try {
        // Try main player first, then Shorts reel player as fallback
        var v = document.querySelector('video.html5-main-video')
             || document.querySelector('ytd-reel-video-renderer video');
        if (!v || !v.duration || !isFinite(v.duration) || v.duration <= 0) return;

        // Save user state once when ad starts
        if (!savedState) {
          userWasMuted = v.muted;
          savedState = true;
        }

        // Only mute + jump near the end of the ad segment. Avoid touching
        // playbackRate to keep user play/pause/seek interactions intact.
        v.muted = true;
        v.currentTime = Math.max(v.duration - 0.1, 0);
      } catch(e) {}
    }

    function restoreState() {
      if (!savedState) return;
      try {
        var v = document.querySelector('video.html5-main-video');
        if (!v) return;
        v.muted = userWasMuted;
        savedState = false;
      } catch(e) {}
    }

    // ── OVERLAY ADS ──
    function closeOverlays() {
      try {
        var btns = document.querySelectorAll(OVERLAY_CLOSE);
        for (var i = 0; i < btns.length; i++) btns[i].click();
      } catch(e) {}
    }

    // ── SURVEY ADS ──
    function dismissSurveys() {
      try {
        var sur = document.querySelectorAll('.ytp-ad-survey, .ytp-ad-feedback-dialog-renderer');
        for (var i = 0; i < sur.length; i++) sur[i].remove();
        // Click "Skip Survey" or "No thanks" if visible
        var surBtns = document.querySelectorAll('.ytp-ad-survey .ytp-ad-skip-button, .ytp-ad-feedback-dialog-renderer button');
        for (var j = 0; j < surBtns.length; j++) surBtns[j].click();
      } catch(e) {}
    }

    function pruneAdaptiveAdNodes() {
      try {
        var nodes = document.querySelectorAll([
          'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
          'ytd-video-renderer:has(ytd-ad-slot-renderer)',
          'ytd-compact-video-renderer:has(ytd-ad-slot-renderer)',
          'ytd-reel-video-renderer:has(ytd-ad-slot-renderer)',
          '[is-ad]',
          '[data-ad-slot]',
          '[data-google-av-cxn]',
          '[aria-label*="Advertisement" i]',
          '[aria-label*="Sponsored" i]',
          '[aria-label*="Publicidad" i]',
          '[aria-label*="Anuncio" i]'
        ].join(','));
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          if (!node || !node.isConnected) continue;
          var host = node.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-reel-video-renderer') || node;
          if (host && host.style) host.style.setProperty('display', 'none', 'important');
        }
      } catch(e) {}
    }

    function isElementVisible(el) {
      if (!el || !el.isConnected) return false;
      try {
        var style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      } catch(e) {
        return false;
      }
    }

    function hasOpenNonEnforcementDialog() {
      var dialogs = document.querySelectorAll([
        'tp-yt-paper-dialog[opened]',
        'tp-yt-paper-dialog[aria-hidden="false"]',
        'ytd-popup-container tp-yt-paper-dialog',
        'ytd-modal-with-title-and-button-renderer',
        'ytd-confirm-dialog-renderer',
        'ytd-unified-share-panel-renderer'
      ].join(','));

      for (var i = 0; i < dialogs.length; i++) {
        var dialog = dialogs[i];
        if (!isElementVisible(dialog)) continue;
        if (dialog.querySelector('ytd-enforcement-message-view-model, .yt-about-this-ad-renderer')) continue;
        return true;
      }
      return false;
    }

    function clearStaleScrollLock() {
      if (hasOpenNonEnforcementDialog()) return;

      var nodes = [
        document.documentElement,
        document.body,
        document.querySelector('ytd-app'),
        document.querySelector('ytd-page-manager')
      ];

      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!node || !node.style) continue;
        try {
          if (node.style.overflow === 'hidden') node.style.overflow = '';
          if (node.style.overflowY === 'hidden') node.style.overflowY = '';
          if (node.style.position === 'fixed' && (node === document.body || node === document.documentElement)) {
            node.style.position = '';
            node.style.top = '';
            node.style.width = '';
          }
          if (node.classList) {
            node.classList.remove('iron-overlay-no-scroll', 'no-scroll', 'scroll-disabled');
          }
        } catch(e) {}
      }
    }

    // ── ENFORCEMENT MODAL REMOVAL ──
    function removeEnforcement() {
      var removed = false;
      var els = document.querySelectorAll('ytd-enforcement-message-view-model');
      for (var i = 0; i < els.length; i++) {
        els[i].remove();
        removed = true;
      }

      // Compatibility hardening: only remove dialogs that explicitly contain
      // enforcement/ad-info components. Text-based sweeping was too broad
      // and could remove legitimate YouTube dialogs used by channel links.
      var dialogs = document.querySelectorAll(
        'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model), ' +
        'tp-yt-paper-dialog:has(.yt-about-this-ad-renderer)'
      );
      for (var d = 0; d < dialogs.length; d++) {
        dialogs[d].remove();
        removed = true;
      }

      if (removed) {
        var bds = document.querySelectorAll('tp-yt-iron-overlay-backdrop[opened]');
        for (var b = 0; b < bds.length; b++) bds[b].style.display = 'none';
        clearStaleScrollLock();
        setTimeout(clearStaleScrollLock, 50);
      }

      // NOTE: Do NOT auto-play here — this observer fires on every DOM
      // mutation and would override the user's manual pause.
    }

    // ── MAIN TICK ──
    function tick() {
      if (isAdShowing()) {
        lastAdSeenAt = Date.now();
        closeOverlays();
        dismissSurveys();
        pruneAdaptiveAdNodes();
        // Try skip methods in order of preference
        if (!tryClickSkip() && !tryAPISkip()) {
          forceSkipVideo();
        }
      } else {
        pruneAdaptiveAdNodes();
        restoreState();
      }
    }

    function startHeartbeat() {
      if (heartbeatTimer) return;
      heartbeatTimer = setInterval(function() {
        // Keep a low-frequency safety tick only when ads were seen recently.
        if ((Date.now() - lastAdSeenAt) <= 12000) {
          if (shouldRunTick(200)) tick();
        }
      }, 1200);
    }

    function bindVideoEvents() {
      if (videoEventsBound) return;
      var video = document.querySelector('video.html5-main-video');
      if (!video) return;
      videoEventsBound = true;
      var onVideoEvent = function() {
        if (shouldRunTick(250)) tick();
      };
      video.addEventListener('loadedmetadata', onVideoEvent, true);
      video.addEventListener('playing', onVideoEvent, true);
      video.addEventListener('waiting', onVideoEvent, true);
      video.addEventListener('durationchange', onVideoEvent, true);
    }

    // ── OBSERVERS ──
    // Event-driven first, with low-frequency heartbeat fallback.
    startHeartbeat();

    var pendingRAF = 0;

    // MutationObserver for instant reaction to ad-showing class change
    function startObserver() {
      var player = document.getElementById('movie_player');
      if (!player) { setTimeout(startObserver, 500); return; }

      if (playerObserver) playerObserver.disconnect();
      playerObserver = new MutationObserver(function(muts) {
        var needsTick = false;
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].attributeName === 'class') {
            needsTick = true;
            break;
          }
          if (muts[i].addedNodes.length > 0) {
            bindVideoEvents();
            needsTick = true;
            break;
          }
        }
        if (needsTick && !pendingRAF) {
          pendingRAF = requestAnimationFrame(function() {
            pendingRAF = 0;
            if (shouldRunTick(120)) tick();
          });
        }
      });

      playerObserver.observe(player, {
        attributes: true, attributeFilter: ['class'],
        childList: true, subtree: true
      });

      bindVideoEvents();
    }
    startObserver();

    // Enforcement modal observer (separate, on body).
    // Perf: body-wide childList observers fire constantly on YouTube. Only
    // run the heavy querySelectorAll sweeps when the added nodes can
    // actually contain dialogs/ad renderers (ytd-*/tp-yt-* custom elements);
    // plain div/span churn from the player UI is skipped outright.
    function addedNodesLookRelevant(muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (!n || n.nodeType !== 1) continue;
          var tag = n.tagName || '';
          if (tag.indexOf('YTD-') === 0 || tag.indexOf('TP-YT-') === 0 || tag.indexOf('YTM-') === 0) return true;
          var child = n.firstElementChild;
          if (child) {
            var childTag = child.tagName || '';
            if (childTag.indexOf('YTD-') === 0 || childTag.indexOf('TP-YT-') === 0) return true;
          }
        }
      }
      return false;
    }

    function startEnforcementObserver() {
      var body = document.body;
      if (!body) { setTimeout(startEnforcementObserver, 500); return; }

      if (enforcementObserver) enforcementObserver.disconnect();
      enforcementObserver = new MutationObserver(function(muts) {
        if (!addedNodesLookRelevant(muts)) return;
        // Enforcement removal must be immediate (no rAF) for UX
        removeEnforcement();
        pruneAdaptiveAdNodes();
        // Defer tick to next animation frame to reduce CPU churn
        if (!pendingRAF) {
          pendingRAF = requestAnimationFrame(function() {
            pendingRAF = 0;
            if (shouldRunTick(250)) tick();
          });
        }
      });

      enforcementObserver.observe(body, { childList: true, subtree: true });
    }
    startEnforcementObserver();

    // YouTube SPA events (watch pages, shorts, playlist transitions)
    document.addEventListener('yt-navigate-finish', function() {
      bindVideoEvents();
      removeEnforcement();
      if (shouldRunTick(150)) tick();
    }, true);
    document.addEventListener('yt-page-data-updated', function() {
      if (shouldRunTick(180)) tick();
    }, true);
    window.addEventListener('popstate', function() {
      if (shouldRunTick(180)) tick();
    }, true);

    // Initial tick after handlers are installed.
    setTimeout(function() {
      removeEnforcement();
      tick();
    }, 0);
  })();`;
}

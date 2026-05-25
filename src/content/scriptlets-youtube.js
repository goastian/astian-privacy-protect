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
    var heartbeatTimer = 0;
    var playerObserver = null;
    var enforcementObserver = null;
    var videoEventsBound = false;

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

    // ── AD DETECTION ──
    function isAdShowing() {
      var p = document.getElementById('movie_player');
      if (!p) return false;
      // Only trust the definitive 'ad-showing' class — overlay elements
      // can persist in DOM after ads end and cause false positives.
      if (!p.classList.contains('ad-showing')) return false;
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

    // ── SKIP LOGIC ──
    function tryClickSkip() {
      var btns = document.querySelectorAll(SKIP_BTN);
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].offsetParent !== null) {
          btns[i].click();
          return true;
        }
      }
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
        // Try skip methods in order of preference
        if (!tryClickSkip() && !tryAPISkip()) {
          forceSkipVideo();
        }
      } else {
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

    // Enforcement modal observer (separate, on body)
    function startEnforcementObserver() {
      var body = document.body;
      if (!body) { setTimeout(startEnforcementObserver, 500); return; }

      if (enforcementObserver) enforcementObserver.disconnect();
      enforcementObserver = new MutationObserver(function(muts) {
        var hasAdded = false;
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].addedNodes.length > 0) { hasAdded = true; break; }
        }
        if (hasAdded) {
          // Enforcement removal must be immediate (no rAF) for UX
          removeEnforcement();
          // Defer tick to next animation frame to reduce CPU churn
          if (!pendingRAF) {
            pendingRAF = requestAnimationFrame(function() {
              pendingRAF = 0;
              if (shouldRunTick(250)) tick();
            });
          }
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

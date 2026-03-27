/**
 * Midori Privacy Blocker
 * Scriptlet library — implements +js() scriptlets for anti-adblock circumvention
 * Compatible with uBlock Origin / AdGuard scriptlet syntax
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

(function () {
  'use strict';

  let isTopFrame = false;
  try { isTopFrame = window.top === window; } catch(e) { isTopFrame = false; }
  if (!isTopFrame) return;
  const scriptStart = performance.now();

  function reportContentCost(durationMs) {
    try {
      const payload = {
        action: 'record-content-script-kpi',
        script: 'scriptlets',
        hostname: window.location.hostname || '',
        durationMs,
      };
      const p = chrome.runtime.sendMessage(payload);
      if (p && typeof p.then === 'function') p.catch(() => {});
    } catch (e) {}
  }

  // ── Scriptlet Registry ─────────────────────────────────────────────────────
  // Each scriptlet is a function that receives (...args) and returns a string
  // of JS code to be injected into the page context via a <script> element.

  const SCRIPTLETS = {};

  // ── Sanitization helper ────────────────────────────────────────────────────
  // Prevents code injection via malicious filter list arguments.
  // Uses JSON.stringify to safely escape all special characters, then
  // strips the surrounding quotes so the value can be used in template literals.
  function safeArg(str) {
    if (str === undefined || str === null) return '';
    const s = String(str);
    // Validate: reject strings with characters that could break out of JS context
    if (/[\x00-\x08\x0e-\x1f]/.test(s)) return '';
    // JSON.stringify safely escapes quotes, backslashes, newlines, etc.
    // We slice off the surrounding quotes since we embed in our own quotes.
    return JSON.stringify(s).slice(1, -1);
  }

  // ── abort-on-property-read (aopr) ──────────────────────────────────────────
  // Prevents reading a property by throwing a ReferenceError.
  // Used heavily to defeat anti-adblock (e.g. YouTube, Forbes).
  // Usage: +js(abort-on-property-read, propertyName)
  SCRIPTLETS['abort-on-property-read'] = SCRIPTLETS['aopr'] = function (prop) {
    if (!prop) return '';
    return `(function() {
      var rid = '${Math.random().toString(36).slice(2)}';
      var abortOnRead = function(obj, chain) {
        var parts = chain.split('.');
        var current = parts[0];
        if (parts.length === 1) {
          var desc = Object.getOwnPropertyDescriptor(obj, current);
          if (desc && desc.get) return;
          var val = obj[current];
          Object.defineProperty(obj, current, {
            get: function() { throw new ReferenceError(rid); },
            set: function(v) { val = v; },
            configurable: true
          });
          return;
        }
        var owner = obj[current];
        if (owner instanceof Object) {
          abortOnRead(owner, parts.slice(1).join('.'));
        } else {
          var origValue = owner;
          Object.defineProperty(obj, current, {
            get: function() { return origValue; },
            set: function(v) {
              origValue = v;
              if (v instanceof Object) {
                abortOnRead(v, parts.slice(1).join('.'));
              }
            },
            configurable: true
          });
        }
      };
      try { abortOnRead(window, '${safeArg(prop)}'); } catch(e) {}
    })();`;
  };

  // ── abort-on-property-write (aopw) ─────────────────────────────────────────
  // Prevents writing to a property. Anti-adblock scripts often set flags.
  // Usage: +js(abort-on-property-write, propertyName)
  SCRIPTLETS['abort-on-property-write'] = SCRIPTLETS['aopw'] = function (prop) {
    if (!prop) return '';
    return `(function() {
      var rid = '${Math.random().toString(36).slice(2)}';
      var abortOnWrite = function(obj, chain) {
        var parts = chain.split('.');
        var current = parts[0];
        if (parts.length === 1) {
          var val = obj[current];
          Object.defineProperty(obj, current, {
            get: function() { return val; },
            set: function() { throw new ReferenceError(rid); },
            configurable: true
          });
          return;
        }
        var owner = obj[current];
        if (owner instanceof Object) {
          abortOnWrite(owner, parts.slice(1).join('.'));
        } else {
          var origValue = owner;
          Object.defineProperty(obj, current, {
            get: function() { return origValue; },
            set: function(v) {
              origValue = v;
              if (v instanceof Object) {
                abortOnWrite(v, parts.slice(1).join('.'));
              }
            },
            configurable: true
          });
        }
      };
      try { abortOnWrite(window, '${safeArg(prop)}'); } catch(e) {}
    })();`;
  };

  // ── abort-current-inline-script (acis) ─────────────────────────────────────
  // Aborts inline scripts that access a specific property, optionally matching content.
  // Critical for YouTube anti-adblock.
  // Usage: +js(abort-current-inline-script, property, search)
  SCRIPTLETS['abort-current-inline-script'] = SCRIPTLETS['acis'] = function (prop, search) {
    if (!prop) return '';
    return `(function() {
      var rid = '${Math.random().toString(36).slice(2)}';
      var prop = '${safeArg(prop)}';
      var search = '${safeArg(search || '')}';
      var magic = rid;
      var abort = function() { throw new ReferenceError(magic); };
      var init = function(obj, chain) {
        var parts = chain.split('.');
        var current = parts[0];
        if (parts.length > 1) {
          var owner = obj[current];
          if (owner instanceof Object === false) {
            var val = owner;
            Object.defineProperty(obj, current, {
              get: function() { return val; },
              set: function(v) {
                val = v;
                if (v instanceof Object) init(v, parts.slice(1).join('.'));
              },
              configurable: true
            });
            return;
          }
          init(owner, parts.slice(1).join('.'));
          return;
        }
        var desc = Object.getOwnPropertyDescriptor(obj, current);
        var origGet = desc && desc.get;
        var origSet = desc && desc.set;
        var origVal = desc ? desc.value : obj[current];
        Object.defineProperty(obj, current, {
          get: function() {
            if (search === '') { abort(); }
            else {
              var e = new Error();
              if (e.stack && e.stack.indexOf(search) !== -1) abort();
            }
            if (origGet) return origGet.call(this);
            return origVal;
          },
          set: function(v) {
            if (origSet) origSet.call(this, v);
            else origVal = v;
          },
          configurable: true
        });
      };
      try { init(window, prop); } catch(e) {}
    })();`;
  };

  // ── set-constant (set) ─────────────────────────────────────────────────────
  // Sets a property to a constant value. Used to fake ad-related flags.
  // Usage: +js(set-constant, property, value)
  // Values: true, false, '', 0, 1, undefined, null, noopFunc, trueFunc, falseFunc, ''
  SCRIPTLETS['set-constant'] = SCRIPTLETS['set'] = function (prop, value) {
    if (!prop) return '';
    let resolvedValue;
    switch (value) {
      case 'true': resolvedValue = 'true'; break;
      case 'false': resolvedValue = 'false'; break;
      case 'undefined': resolvedValue = 'undefined'; break;
      case 'null': resolvedValue = 'null'; break;
      case 'noopFunc': resolvedValue = '(function(){})'; break;
      case 'trueFunc': resolvedValue = '(function(){return true})'; break;
      case 'falseFunc': resolvedValue = '(function(){return false})'; break;
      case 'emptyObj': resolvedValue = '({})'; break;
      case 'emptyArr': resolvedValue = '([])'; break;
      case 'emptyStr': resolvedValue = "('')"; break;
      case '': resolvedValue = "('')"; break;
      case '0': resolvedValue = '0'; break;
      case '1': resolvedValue = '1'; break;
      case '-1': resolvedValue = '-1'; break;
      case 'NaN': resolvedValue = 'NaN'; break;
      case 'Infinity': resolvedValue = 'Infinity'; break;
      default: resolvedValue = isNaN(value) ? "'" + safeArg(value) + "'" : value; break;
    }
    return `(function() {
      var cValue = ${resolvedValue};
      var chain = '${safeArg(prop)}'.split('.');
      var setConst = function(obj, parts) {
        if (parts.length === 0) return;
        var current = parts[0];
        if (parts.length === 1) {
          try {
            Object.defineProperty(obj, current, {
              get: function() { return cValue; },
              set: function() {},
              configurable: false
            });
          } catch(e) {
            obj[current] = cValue;
          }
          return;
        }
        if (!(current in obj) || obj[current] === null || obj[current] === undefined) {
          obj[current] = {};
        }
        var next = obj[current];
        if (next instanceof Object) {
          setConst(next, parts.slice(1));
        } else {
          var val = next;
          Object.defineProperty(obj, current, {
            get: function() { return val; },
            set: function(v) {
              val = v;
              if (v instanceof Object) setConst(v, parts.slice(1));
            },
            configurable: true
          });
        }
      };
      try { setConst(window, chain); } catch(e) {}
    })();`;
  };

  // ── remove-attr (ra) ───────────────────────────────────────────────────────
  // Removes specified attributes from elements matching a selector.
  // Usage: +js(remove-attr, attrName, selector)
  SCRIPTLETS['remove-attr'] = SCRIPTLETS['ra'] = function (attr, selector) {
    if (!attr) return '';
    const sel = selector || '[' + attr + ']';
    return `(function() {
      var attr = '${safeArg(attr)}';
      var selector = '${safeArg(sel)}';
      var removeAttr = function() {
        var nodes = document.querySelectorAll(selector);
        for (var i = 0; i < nodes.length; i++) {
          nodes[i].removeAttribute(attr);
        }
      };
      removeAttr();
      var observer = new MutationObserver(removeAttr);
      observer.observe(document.documentElement || document.body || document, {
        attributes: true, childList: true, subtree: true
      });
    })();`;
  };

  // ── remove-class (rc) ──────────────────────────────────────────────────────
  // Removes specified CSS classes from elements.
  // Usage: +js(remove-class, className, selector)
  SCRIPTLETS['remove-class'] = SCRIPTLETS['rc'] = function (className, selector) {
    if (!className) return '';
    const sel = selector || '.' + className;
    return `(function() {
      var cn = '${safeArg(className)}';
      var selector = '${safeArg(sel)}';
      var removeClass = function() {
        var nodes = document.querySelectorAll(selector);
        for (var i = 0; i < nodes.length; i++) {
          nodes[i].classList.remove(cn);
        }
      };
      removeClass();
      var observer = new MutationObserver(removeClass);
      observer.observe(document.documentElement || document.body || document, {
        attributes: true, childList: true, subtree: true
      });
    })();`;
  };

  // ── nano-setInterval-booster (nano-sib) ────────────────────────────────────
  // Speeds up or slows down setInterval calls matching a pattern.
  // Usage: +js(nano-setInterval-booster, match, delay)
  SCRIPTLETS['nano-setInterval-booster'] = SCRIPTLETS['nano-sib'] = function (match, boostDelay) {
    const needle = match || '';
    const delay = parseInt(boostDelay) || 0.05;
    return `(function() {
      var needle = '${safeArg(needle)}';
      var boost = ${delay};
      var origSetInterval = window.setInterval;
      window.setInterval = function(fn, ms) {
        var fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
        if (needle === '' || fnStr.indexOf(needle) !== -1) {
          if (boost < 1) ms = Math.round(ms * boost);
          else ms = boost;
        }
        return origSetInterval.apply(this, [fn, ms]);
      };
    })();`;
  };

  // ── nano-setTimeout-booster (nano-stb) ─────────────────────────────────────
  // Speeds up or slows down setTimeout calls matching a pattern.
  // Usage: +js(nano-setTimeout-booster, match, delay)
  SCRIPTLETS['nano-setTimeout-booster'] = SCRIPTLETS['nano-stb'] = function (match, boostDelay) {
    const needle = match || '';
    const delay = parseInt(boostDelay) || 0.05;
    return `(function() {
      var needle = '${safeArg(needle)}';
      var boost = ${delay};
      var origSetTimeout = window.setTimeout;
      window.setTimeout = function(fn, ms) {
        var fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
        if (needle === '' || fnStr.indexOf(needle) !== -1) {
          if (boost < 1) ms = Math.round(ms * boost);
          else ms = boost;
        }
        return origSetTimeout.apply(this, [fn, ms]);
      };
    })();`;
  };

  // ── nowebrtc ───────────────────────────────────────────────────────────────
  // Disables WebRTC to prevent IP leaks.
  // Usage: +js(nowebrtc)
  SCRIPTLETS['nowebrtc'] = function () {
    return `(function() {
      var noopCtor = function() { throw new DOMException('', 'NotSupportedError'); };
      if (window.RTCPeerConnection) {
        window.RTCPeerConnection = noopCtor;
      }
      if (window.webkitRTCPeerConnection) {
        window.webkitRTCPeerConnection = noopCtor;
      }
      if (window.mozRTCPeerConnection) {
        window.mozRTCPeerConnection = noopCtor;
      }
    })();`;
  };

  // ── json-prune ─────────────────────────────────────────────────────────────
  // Removes properties from JSON.parse results.
  // Usage: +js(json-prune, propsToRemove, requiredProps)
  SCRIPTLETS['json-prune'] = function (propsToRemove, requiredProps) {
    if (!propsToRemove) return '';
    return `(function() {
      var propsToRemove = '${safeArg(propsToRemove || '')}';
      var requiredProps = '${safeArg(requiredProps || '')}';
      var origParse = JSON.parse;
      JSON.parse = function() {
        var r = origParse.apply(this, arguments);
        if (r instanceof Object === false) return r;
        if (requiredProps) {
          var reqs = requiredProps.split(' ');
          for (var i = 0; i < reqs.length; i++) {
            if (!(reqs[i] in r)) return r;
          }
        }
        var props = propsToRemove.split(' ');
        for (var i = 0; i < props.length; i++) {
          var parts = props[i].split('.');
          var obj = r;
          for (var j = 0; j < parts.length - 1; j++) {
            if (!(parts[j] in obj)) break;
            obj = obj[parts[j]];
          }
          if (obj && parts.length > 0) {
            delete obj[parts[parts.length - 1]];
          }
        }
        return r;
      };
    })();`;
  };

  // ── addEventListener-defuser (aeld) ────────────────────────────────────────
  // Prevents addEventListener calls matching specific event types/patterns.
  // Usage: +js(addEventListener-defuser, type, pattern)
  SCRIPTLETS['addEventListener-defuser'] = SCRIPTLETS['aeld'] = function (type, pattern) {
    const typeStr = type || '';
    const patternStr = pattern || '';
    return `(function() {
      var typeNeedle = '${safeArg(typeStr)}';
      var patternNeedle = '${safeArg(patternStr)}';
      var origAdd = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, fn) {
        if (typeNeedle && type.indexOf(typeNeedle) === -1) {
          return origAdd.apply(this, arguments);
        }
        if (patternNeedle) {
          var fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
          if (fnStr.indexOf(patternNeedle) !== -1) return;
        }
        return origAdd.apply(this, arguments);
      };
    })();`;
  };

  // ── prevent-setTimeout (no-setTimeout-if) ──────────────────────────────────
  // Prevents setTimeout calls matching a pattern.
  // Usage: +js(no-setTimeout-if, pattern)
  SCRIPTLETS['no-setTimeout-if'] = SCRIPTLETS['prevent-setTimeout'] = SCRIPTLETS['nostif'] = function (needle) {
    const needleStr = needle || '';
    return `(function() {
      var needle = '${safeArg(needleStr)}';
      var origSetTimeout = window.setTimeout;
      window.setTimeout = function(fn, ms) {
        if (needle) {
          var fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
          if (fnStr.indexOf(needle) !== -1) return;
        }
        return origSetTimeout.apply(this, arguments);
      };
    })();`;
  };

  // ── prevent-setInterval (no-setInterval-if) ────────────────────────────────
  // Prevents setInterval calls matching a pattern.
  // Usage: +js(no-setInterval-if, pattern)
  SCRIPTLETS['no-setInterval-if'] = SCRIPTLETS['prevent-setInterval'] = SCRIPTLETS['nosiif'] = function (needle) {
    const needleStr = needle || '';
    return `(function() {
      var needle = '${safeArg(needleStr)}';
      var origSetInterval = window.setInterval;
      window.setInterval = function(fn, ms) {
        if (needle) {
          var fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
          if (fnStr.indexOf(needle) !== -1) return;
        }
        return origSetInterval.apply(this, arguments);
      };
    })();`;
  };

  // ── prevent-fetch (no-fetch-if) ────────────────────────────────────────────
  // Prevents fetch calls matching a URL pattern.
  // Usage: +js(no-fetch-if, pattern)
  SCRIPTLETS['no-fetch-if'] = SCRIPTLETS['prevent-fetch'] = function (needle) {
    const needleStr = needle || '';
    return `(function() {
      var needle = '${safeArg(needleStr)}';
      var origFetch = window.fetch;
      window.fetch = function(resource) {
        var url = '';
        if (typeof resource === 'string') url = resource;
        else if (resource && resource.url) url = resource.url;
        if (needle && url.indexOf(needle) !== -1) {
          return Promise.resolve(new Response('', { status: 200, statusText: 'OK' }));
        }
        return origFetch.apply(this, arguments);
      };
    })();`;
  };

  // ── prevent-xhr (no-xhr-if) ────────────────────────────────────────────────
  // Prevents XMLHttpRequest calls matching a URL pattern.
  // Usage: +js(no-xhr-if, pattern)
  SCRIPTLETS['no-xhr-if'] = SCRIPTLETS['prevent-xhr'] = function (needle) {
    const needleStr = needle || '';
    return `(function() {
      var needle = '${safeArg(needleStr)}';
      var origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        if (needle && String(url).indexOf(needle) !== -1) {
          this._blocked = true;
        }
        return origOpen.apply(this, arguments);
      };
      var origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function() {
        if (this._blocked) {
          Object.defineProperty(this, 'readyState', { value: 4 });
          Object.defineProperty(this, 'status', { value: 200 });
          Object.defineProperty(this, 'responseText', { value: '' });
          Object.defineProperty(this, 'response', { value: '' });
          this.dispatchEvent(new Event('load'));
          this.dispatchEvent(new Event('loadend'));
          return;
        }
        return origSend.apply(this, arguments);
      };
    })();`;
  };

  // ── window.name-defuser ────────────────────────────────────────────────────
  // Clears window.name to prevent tracking.
  SCRIPTLETS['window.name-defuser'] = function () {
    return `(function() { window.name = ''; })();`;
  };

  // ── disable-newtab-links ───────────────────────────────────────────────────
  // Prevents links from opening in new tabs (anti-popup).
  SCRIPTLETS['disable-newtab-links'] = function () {
    return `(function() {
      document.addEventListener('click', function(e) {
        var el = e.target.closest('a[target="_blank"]');
        if (el) { el.removeAttribute('target'); }
      }, true);
    })();`;
  };

  // ── noeval ─────────────────────────────────────────────────────────────────
  // Prevents eval() calls.
  SCRIPTLETS['noeval'] = function () {
    return `(function() {
      window.eval = function() { return ''; };
    })();`;
  };

  // ── set-cookie (trusted-set-cookie) ────────────────────────────────────────
  // Sets a cookie to a specific value (used to dismiss cookie banners).
  // Usage: +js(set-cookie, name, value)
  SCRIPTLETS['set-cookie'] = SCRIPTLETS['trusted-set-cookie'] = function (name, value) {
    if (!name) return '';
    const val = value || '1';
    return `(function() {
      document.cookie = '${safeArg(name)}=${safeArg(val)}; path=/; max-age=31536000';
    })();`;
  };

  // ── set-local-storage-item ─────────────────────────────────────────────────
  // Sets a localStorage item.
  // Usage: +js(set-local-storage-item, key, value)
  SCRIPTLETS['set-local-storage-item'] = function (key, value) {
    if (!key) return '';
    return `(function() {
      try { localStorage.setItem('${safeArg(key)}', '${safeArg(value || '')}'); } catch(e) {}
    })();`;
  };

  // ── set-session-storage-item ───────────────────────────────────────────────
  SCRIPTLETS['set-session-storage-item'] = function (key, value) {
    if (!key) return '';
    return `(function() {
      try { sessionStorage.setItem('${safeArg(key)}', '${safeArg(value || '')}'); } catch(e) {}
    })();`;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // YOUTUBE AD BLOCKER
  // Single, robust scriptlet that handles all YouTube ad blocking.
  // Strategy: Auto-skip ads instantly + remove enforcement modals.
  // Does NOT hook into YouTube's internal APIs (no Object.defineProperty,
  // no JSON.parse, no Response.prototype.json) to avoid breaking playback.
  // ══════════════════════════════════════════════════════════════════════════

  SCRIPTLETS['yt-ad-pruner'] = function () {
    return `(function() {
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
      var ENFORCEMENT_KEYWORDS = ['ad blocker','bloqueador','werbeblocker','bloqueur','adblocker','bloqueador de anuncios','adblock','premium'];
      var userWasMuted = false;
      var userPlaybackRate = 1;
      var savedState = false;

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
        'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)',
        '{ display: none !important; }'
      ].join('');
      (document.head || document.documentElement).appendChild(s);

      // ── AD DETECTION ──
      function isAdShowing() {
        var p = document.getElementById('movie_player');
        if (!p) return false;
        // Only trust the definitive 'ad-showing' class — overlay elements
        // can persist in DOM after ads end and cause false positives.
        return p.classList.contains('ad-showing');
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
          var v = document.querySelector('video.html5-main-video');
          if (!v || !v.duration || !isFinite(v.duration) || v.duration <= 0) return;

          // Save user state once when ad starts
          if (!savedState) {
            userWasMuted = v.muted;
            userPlaybackRate = v.playbackRate;
            savedState = true;
          }

          // Mute and fast-forward through the ad
          v.muted = true;
          v.playbackRate = 16;
          v.currentTime = Math.max(v.duration - 0.1, 0);
        } catch(e) {}
      }

      function restoreState() {
        if (!savedState) return;
        try {
          var v = document.querySelector('video.html5-main-video');
          if (!v) return;
          v.muted = userWasMuted;
          v.playbackRate = userPlaybackRate;
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

      // ── ENFORCEMENT MODAL REMOVAL ──
      function removeEnforcement() {
        var els = document.querySelectorAll('ytd-enforcement-message-view-model');
        for (var i = 0; i < els.length; i++) els[i].remove();

        var dialogs = document.querySelectorAll('tp-yt-paper-dialog.ytd-popup-container, tp-yt-paper-dialog');
        for (var d = 0; d < dialogs.length; d++) {
          var text = (dialogs[d].textContent || '').toLowerCase();
          for (var k = 0; k < ENFORCEMENT_KEYWORDS.length; k++) {
            if (text.indexOf(ENFORCEMENT_KEYWORDS[k]) !== -1) {
              dialogs[d].remove();
              break;
            }
          }
        }

        var bds = document.querySelectorAll('tp-yt-iron-overlay-backdrop[opened]');
        for (var b = 0; b < bds.length; b++) bds[b].style.display = 'none';

        // NOTE: Do NOT auto-play here — this observer fires on every DOM
        // mutation and would override the user's manual pause.
      }

      // ── MAIN TICK ──
      function tick() {
        if (isAdShowing()) {
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

      // ── OBSERVERS ──
      // Poll at 200ms for fast reaction
      setInterval(tick, 200);

      // MutationObserver for instant reaction to ad-showing class change
      function startObserver() {
        var player = document.getElementById('movie_player');
        if (!player) { setTimeout(startObserver, 500); return; }

        new MutationObserver(function(muts) {
          for (var i = 0; i < muts.length; i++) {
            if (muts[i].attributeName === 'class') { tick(); return; }
            if (muts[i].addedNodes.length > 0) { tick(); return; }
          }
        }).observe(player, {
          attributes: true, attributeFilter: ['class'],
          childList: true, subtree: true
        });
      }
      startObserver();

      // Enforcement modal observer (separate, on body)
      function startEnforcementObserver() {
        var body = document.body;
        if (!body) { setTimeout(startEnforcementObserver, 500); return; }

        new MutationObserver(function(muts) {
          for (var i = 0; i < muts.length; i++) {
            if (muts[i].addedNodes.length > 0) {
              removeEnforcement();
              return;
            }
          }
        }).observe(body, { childList: true, subtree: true });
      }
      startEnforcementObserver();
    })();`;
  };

  // Keep these as aliases pointing to the same scriptlet for backward compat
  SCRIPTLETS['yt-skip-ad'] = SCRIPTLETS['yt-ad-pruner'];
  SCRIPTLETS['yt-enforce-remove'] = SCRIPTLETS['yt-ad-pruner'];

  // ══════════════════════════════════════════════════════════════════════════
  // TWITCH AD BLOCKER
  // Twitch ads are embedded in the HLS stream so they can't be fully skipped.
  // This scriptlet: mutes audio during ads, hides ad overlay/countdown UI,
  // and restores state when the ad ends.
  // ══════════════════════════════════════════════════════════════════════════

  SCRIPTLETS['twitch-ad-mute'] = function () {
    return `(function() {
      var wasMuted = false;
      var savedVol = 1;
      var adActive = false;

      function isAdPlaying() {
        // Twitch signals ads via data attributes and specific elements
        var label = document.querySelector('[data-a-target="video-ad-label"]');
        if (label) return true;
        var countdown = document.querySelector('[data-a-target="video-ad-countdown"]');
        if (countdown) return true;
        var overlay = document.querySelector('.video-player__overlay[data-a-target="video-ad-overlay"]');
        if (overlay) return true;
        // Check for "Ad" text in player status
        var status = document.querySelector('.tw-media-card-stat');
        if (status && /\\bad\\b/i.test(status.textContent)) return true;
        return false;
      }

      function hideAdUI() {
        var sels = [
          '[data-a-target="video-ad-label"]',
          '[data-a-target="video-ad-countdown"]',
          '[data-a-target="ad-countdown-text"]',
          '[data-a-target="video-ad-info-bar"]',
          '.video-player__overlay[data-a-target="video-ad-overlay"]',
          '[data-a-target="video-ad-pause-overlay"]',
        ];
        for (var i = 0; i < sels.length; i++) {
          try {
            var els = document.querySelectorAll(sels[i]);
            for (var j = 0; j < els.length; j++) {
              els[j].style.display = 'none';
            }
          } catch(e) {}
        }
      }

      function muteAd() {
        try {
          var v = document.querySelector('video');
          if (!v) return;
          if (!adActive) {
            wasMuted = v.muted;
            savedVol = v.volume;
            adActive = true;
          }
          v.muted = true;
        } catch(e) {}
      }

      function restoreAudio() {
        if (!adActive) return;
        try {
          var v = document.querySelector('video');
          if (!v) return;
          v.muted = wasMuted;
          v.volume = savedVol;
          adActive = false;
        } catch(e) {}
      }

      function tick() {
        if (isAdPlaying()) {
          muteAd();
          hideAdUI();
        } else {
          restoreAudio();
        }
      }

      setInterval(tick, 300);

      // MutationObserver for faster reaction
      function startObs() {
        var target = document.querySelector('.video-player') || document.body;
        if (!target) { setTimeout(startObs, 500); return; }
        new MutationObserver(function() { tick(); }).observe(target, {
          childList: true, subtree: true, attributes: true, attributeFilter: ['class']
        });
      }
      startObs();
    })();`;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ANTI-FINGERPRINTING SCRIPTLETS
  // These randomize browser APIs used for fingerprinting to prevent tracking.
  // ══════════════════════════════════════════════════════════════════════════

  // ── canvas-fingerprint-protect ─────────────────────────────────────────────
  // Adds subtle random noise to Canvas toDataURL/toBlob output so each call
  // returns a slightly different result, defeating canvas fingerprinting.
  SCRIPTLETS['canvas-fingerprint-protect'] = function () {
    return `(function() {
      var noiseSeed = Math.floor(Math.random() * 256);
      var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      var origToBlob = HTMLCanvasElement.prototype.toBlob;
      var origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

      function addNoise(canvas) {
        try {
          var ctx = canvas.getContext('2d');
          if (!ctx) return;
          var w = Math.min(canvas.width, 16);
          var h = Math.min(canvas.height, 16);
          var imageData = origGetImageData.call(ctx, 0, 0, w, h);
          var data = imageData.data;
          for (var i = 0; i < data.length; i += 4) {
            data[i] = (data[i] + noiseSeed) % 256;
          }
          ctx.putImageData(imageData, 0, 0);
        } catch(e) {}
      }

      HTMLCanvasElement.prototype.toDataURL = function() {
        addNoise(this);
        return origToDataURL.apply(this, arguments);
      };

      HTMLCanvasElement.prototype.toBlob = function() {
        addNoise(this);
        return origToBlob.apply(this, arguments);
      };

      CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
        var result = origGetImageData.call(this, sx, sy, sw, sh);
        if (sw > 1 && sh > 1) {
          for (var i = 0; i < Math.min(result.data.length, 64); i += 4) {
            result.data[i] = (result.data[i] + noiseSeed) % 256;
          }
        }
        return result;
      };
    })();`;
  };

  // ── webgl-fingerprint-protect ──────────────────────────────────────────────
  // Spoofs WebGL renderer and vendor strings to prevent GPU fingerprinting.
  SCRIPTLETS['webgl-fingerprint-protect'] = function () {
    return `(function() {
      var fakeRenderers = [
        'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)',
        'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060, OpenGL 4.5)',
        'ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)',
        'ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 640, OpenGL 4.1)',
      ];
      var fakeVendors = ['Google Inc. (Intel)', 'Google Inc. (NVIDIA)', 'Google Inc. (AMD)'];
      var idx = Math.floor(Math.random() * fakeRenderers.length);

      var origGetParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(param) {
        if (param === 0x9245 || param === 0x9246) return fakeRenderers[idx];
        if (param === 0x9247 || param === 0x9248) return fakeVendors[Math.min(idx, fakeVendors.length - 1)];
        return origGetParameter.call(this, param);
      };

      if (typeof WebGL2RenderingContext !== 'undefined') {
        var origGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(param) {
          if (param === 0x9245 || param === 0x9246) return fakeRenderers[idx];
          if (param === 0x9247 || param === 0x9248) return fakeVendors[Math.min(idx, fakeVendors.length - 1)];
          return origGetParameter2.call(this, param);
        };
      }
    })();`;
  };

  // ── audiocontext-fingerprint-protect ───────────────────────────────────────
  // Adds subtle noise to AudioContext output to defeat audio fingerprinting.
  SCRIPTLETS['audiocontext-fingerprint-protect'] = function () {
    return `(function() {
      var noise = Math.random() * 0.0001;
      var origCreateOscillator = AudioContext.prototype.createOscillator;
      var origGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
      var origGetByteFrequencyData = AnalyserNode.prototype.getByteFrequencyData;

      AnalyserNode.prototype.getFloatFrequencyData = function(array) {
        origGetFloatFrequencyData.call(this, array);
        for (var i = 0; i < array.length; i++) {
          array[i] = array[i] + noise * (Math.random() - 0.5);
        }
      };

      AnalyserNode.prototype.getByteFrequencyData = function(array) {
        origGetByteFrequencyData.call(this, array);
        for (var i = 0; i < Math.min(array.length, 32); i++) {
          array[i] = Math.max(0, Math.min(255, array[i] + Math.floor(Math.random() * 3 - 1)));
        }
      };

      if (typeof OfflineAudioContext !== 'undefined') {
        var origRendered = OfflineAudioContext.prototype.startRendering;
        OfflineAudioContext.prototype.startRendering = function() {
          return origRendered.call(this).then(function(buffer) {
            var data = buffer.getChannelData(0);
            for (var i = 0; i < Math.min(data.length, 256); i++) {
              data[i] = data[i] + noise * (Math.random() - 0.5);
            }
            return buffer;
          });
        };
      }
    })();`;
  };

  // ── navigator-fingerprint-protect ──────────────────────────────────────────
  // Spoofs navigator properties commonly used for fingerprinting:
  // plugins, mimeTypes, hardwareConcurrency, deviceMemory, platform
  SCRIPTLETS['navigator-fingerprint-protect'] = function () {
    return `(function() {
      var cores = [2, 4, 8][Math.floor(Math.random() * 3)];
      var mem = [2, 4, 8][Math.floor(Math.random() * 3)];
      var platforms = ['Win32', 'Linux x86_64', 'MacIntel'];
      var plat = platforms[Math.floor(Math.random() * platforms.length)];

      try {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: function() { return cores; }, configurable: true });
      } catch(e) {}
      try {
        Object.defineProperty(navigator, 'deviceMemory', { get: function() { return mem; }, configurable: true });
      } catch(e) {}
      try {
        Object.defineProperty(navigator, 'platform', { get: function() { return plat; }, configurable: true });
      } catch(e) {}
      try {
        Object.defineProperty(navigator, 'plugins', { get: function() { return []; }, configurable: true });
      } catch(e) {}
      try {
        Object.defineProperty(navigator, 'mimeTypes', { get: function() { return []; }, configurable: true });
      } catch(e) {}
    })();`;
  };

  // ── screen-fingerprint-protect ─────────────────────────────────────────────
  // Adds small random offsets to screen dimensions to prevent screen fingerprinting.
  SCRIPTLETS['screen-fingerprint-protect'] = function () {
    return `(function() {
      var wOff = Math.floor(Math.random() * 8) - 4;
      var hOff = Math.floor(Math.random() * 8) - 4;
      var origW = screen.width;
      var origH = screen.height;
      var origAW = screen.availWidth;
      var origAH = screen.availHeight;

      try {
        Object.defineProperty(screen, 'width', { get: function() { return origW + wOff; }, configurable: true });
        Object.defineProperty(screen, 'height', { get: function() { return origH + hOff; }, configurable: true });
        Object.defineProperty(screen, 'availWidth', { get: function() { return origAW + wOff; }, configurable: true });
        Object.defineProperty(screen, 'availHeight', { get: function() { return origAH + hOff; }, configurable: true });
      } catch(e) {}
    })();`;
  };

  // ── Injection Engine ───────────────────────────────────────────────────────

  /**
   * Generate the JS code for a scriptlet call
   * @param {string} name - Scriptlet name (e.g. 'abort-on-property-read')
   * @param {string[]} args - Arguments for the scriptlet
   * @returns {string|null} - JS code to inject, or null if scriptlet not found
   */
  function generateScriptletCode(name, args) {
    const fn = SCRIPTLETS[name];
    if (!fn) {
      console.warn('[midori-scriptlets] Unknown scriptlet:', name);
      return null;
    }
    return fn.apply(null, args || []);
  }

  /**
   * Inject scriptlet code into the page context
   * @param {string} code - JS code to inject
   */
  function injectCode(code) {
    if (!code) return;
    var parent = document.head || document.documentElement;
    if (!parent) {
      // Extremely early — wait for documentElement
      new MutationObserver(function(_, obs) {
        if (document.documentElement) {
          obs.disconnect();
          injectCode(code);
        }
      }).observe(document, { childList: true });
      return;
    }
    try {
      var script = document.createElement('script');
      script.textContent = code;
      parent.appendChild(script);
      script.remove();
    } catch (e) {
      try {
        var blob = new Blob([code], { type: 'text/javascript' });
        var url = URL.createObjectURL(blob);
        var s = document.createElement('script');
        s.src = url;
        parent.appendChild(s);
        s.remove();
        URL.revokeObjectURL(url);
      } catch (e2) {}
    }
  }

  /**
   * Process a list of scriptlet rules and inject them
   * Each rule is: { name: string, args: string[] }
   */
  function applyScriptlets(rules) {
    if (!rules || rules.length === 0) return;

    const allCode = [];
    for (const rule of rules) {
      const code = generateScriptletCode(rule.name, rule.args);
      if (code) allCode.push(code);
    }

    if (allCode.length > 0) {
      // Inject all scriptlets in a single script element for performance
      injectCode(allCode.join('\n'));
    }
  }

  // ── Immediate YouTube scriptlet injection ─────────────────────────────────
  // Inject YouTube ad-skip scriptlet immediately at document_start (MAIN world)
  // without waiting for postMessage from cosmetic.js. This ensures the
  // MutationObserver and setInterval are active as early as possible.

  var hn = '';
  try { hn = window.location.hostname; } catch(e) {}
  if (hn === 'www.youtube.com' || hn === 'youtube.com' || hn === 'm.youtube.com') {
    applyScriptlets([{ name: 'yt-ad-pruner', args: [] }]);
  }

  // ── Communication Bridge ──────────────────────────────────────────────────
  // This script runs in MAIN world (page context).
  // It receives scriptlet rules from the ISOLATED world content script
  // via window.postMessage.

  // Track which scriptlets have already been applied to prevent duplicates
  var _appliedScriptlets = {};

  // Listen for messages from ISOLATED world content script
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.origin !== location.origin) return;
    if (!event.data) return;

    // Legacy scriptlet rules (parsed by our engine)
    if (event.data.type === 'midori-scriptlets' && event.data.scriptlets) {
      // Filter out already-applied scriptlets (prevents duplicate hooks)
      var newRules = event.data.scriptlets.filter(function(rule) {
        var key = rule.name + ':' + (rule.args || []).join(',');
        if (_appliedScriptlets[key]) return false;
        _appliedScriptlets[key] = true;
        return true;
      });
      if (newRules.length > 0) applyScriptlets(newRules);
    }

    // Ghostery engine: pre-compiled scriptlet code (inject directly)
    if (event.data.type === 'midori-compiled-scriptlet' && event.data.code) {
      injectCode(event.data.code);
    }
  });

  // Mark YouTube scriptlet as already applied (prevent duplicate from postMessage)
  if (hn === 'www.youtube.com' || hn === 'youtube.com' || hn === 'm.youtube.com') {
    _appliedScriptlets['yt-ad-pruner:'] = true;
  }

  setTimeout(function() {
    reportContentCost(performance.now() - scriptStart);
  }, 0);
})();

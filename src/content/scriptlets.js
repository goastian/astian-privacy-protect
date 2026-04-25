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

  function sendRuntimeMessage(payload) {
    return new Promise(function(resolve) {
      try {
        const maybePromise = chrome.runtime.sendMessage(payload, function(response) {
          resolve(response || null);
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve).catch(function() { resolve(null); });
        }
      } catch (e) {
        resolve(null);
      }
    });
  }

  function reportIaRisk(event) {
    if (!event || typeof event !== 'object') return;
    sendRuntimeMessage({ action: 'ia-shield-risk-event', event: event });
  }

  function isPromptField(target) {
    if (!target) return false;
    var tag = String(target.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      var type = String(target.type || 'text').toLowerCase();
      return type === 'text' || type === 'search' || type === 'url';
    }
    return !!target.isContentEditable;
  }

  function normalizePromptText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function analyzePromptPayload(text) {
    var raw = String(text || '');
    var lower = raw.toLowerCase();
    var findings = [];
    var score = 0;

    var dangerousPatterns = [
      /ignore\s+(all\s+)?previous\s+instructions?/i,
      /disregard\s+(all\s+)?(prior|previous)\s+instructions?/i,
      /developer\s+mode/i,
      /reveal\s+(the\s+)?system\s+prompt/i,
      /print\s+(the\s+)?system\s+prompt/i,
      /show\s+(me\s+)?(your\s+)?hidden\s+instructions?/i,
      /do\s+not\s+follow\s+the\s+rules/i,
      /bypass\s+(all\s+)?safety/i,
      /exfiltrat(e|ion)/i,
      /send\s+all\s+(data|history|context)\s+to/i,
      /base64/i,
      /prompt\s+chain(ing)?/i,
    ];

    for (var i = 0; i < dangerousPatterns.length; i++) {
      if (dangerousPatterns[i].test(raw)) {
        score += 2;
        findings.push('pattern:' + dangerousPatterns[i].source.slice(0, 42));
      }
    }

    if (/[\u200B-\u200F\u2060\uFEFF]/.test(raw)) {
      score += 2;
      findings.push('invisible-unicode');
    }

    if (/\$\\color\{\s*white\s*\}\{[^}]{3,}\}/i.test(raw)) {
      score += 2;
      findings.push('hidden-latex');
    }

    if (/\b[A-Za-z0-9+/]{40,}={0,2}\b/.test(raw)) {
      score += 2;
      findings.push('base64-like');
    }

    if (/\b(?:[A-Fa-f0-9]{2}){20,}\b/.test(raw)) {
      score += 2;
      findings.push('hex-like');
    }

    if (/ignroe|bpyass|revael|syts?em\s+prompt/i.test(lower)) {
      score += 1;
      findings.push('typoglycemia');
    }

    if (/\b(step\s*\d+|first\s*[:,]|then\s*[:,]|after\s+that\s*[:,])\b/i.test(raw)) {
      score += 1;
      findings.push('prompt-chaining');
    }

    var severity = 'low';
    if (score >= 7) severity = 'high';
    else if (score >= 4) severity = 'medium';

    return { score: score, severity: severity, findings: findings };
  }

  function sanitizePromptPayload(text) {
    var value = String(text || '');
    var changed = false;
    var findings = [];

    var before = value;
    value = value.replace(/[\u200B-\u200F\u2060\uFEFF]/g, '');
    if (value !== before) {
      changed = true;
      findings.push('removed-invisible-unicode');
    }

    before = value;
    value = value.replace(/\b[A-Za-z0-9+/]{60,}={0,2}\b/g, '[encoded-payload-removed]');
    if (value !== before) {
      changed = true;
      findings.push('masked-base64');
    }

    before = value;
    value = value.replace(/\b(?:[A-Fa-f0-9]{2}){24,}\b/g, '[hex-payload-removed]');
    if (value !== before) {
      changed = true;
      findings.push('masked-hex');
    }

    var dangerous = [
      /ignore\s+(all\s+)?previous\s+instructions?/gi,
      /disregard\s+(all\s+)?(prior|previous)\s+instructions?/gi,
      /reveal\s+(the\s+)?system\s+prompt/gi,
      /show\s+(me\s+)?(your\s+)?hidden\s+instructions?/gi,
      /bypass\s+(all\s+)?safety/gi,
      /you\s+are\s+now\s+in\s+developer\s+mode/gi,
    ];

    for (var i = 0; i < dangerous.length; i++) {
      before = value;
      value = value.replace(dangerous[i], '[filtered-instruction]');
      if (value !== before) {
        changed = true;
        findings.push('filtered-dangerous-instruction');
      }
    }

    var trimmed = value.slice(0, 12000);
    if (trimmed.length !== value.length) {
      changed = true;
      findings.push('trimmed-length');
      value = trimmed;
    }

    return {
      text: value,
      changed: changed,
      findings: findings,
    };
  }

  function insertTextIntoTarget(target, text) {
    if (!target) return;
    var val = String(text || '');

    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
      var start = Number.isFinite(target.selectionStart) ? target.selectionStart : target.value.length;
      var end = Number.isFinite(target.selectionEnd) ? target.selectionEnd : start;
      if (typeof target.setRangeText === 'function') {
        target.setRangeText(val, start, end, 'end');
      } else {
        var before = target.value.slice(0, start);
        var after = target.value.slice(end);
        target.value = before + val + after;
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (target.isContentEditable) {
      try {
        document.execCommand('insertText', false, val);
      } catch (e) {
        target.textContent = (target.textContent || '') + val;
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function createIaBanner() {
    var banner = document.createElement('div');
    banner.className = 'midori-ia-banner';
    banner.style.display = 'none';
    banner.innerHTML = '<strong>IA Shield:</strong> <span class="midori-ia-banner-msg"></span>';
    (document.documentElement || document.body).appendChild(banner);
    return banner;
  }

  function installIaShieldRuntime(config) {
    if (!config || config.enabled !== true) return;
    if (window.__midoriIaShieldInstalled) return;
    window.__midoriIaShieldInstalled = true;

    var strict = config.strict === true;
    var sanitizeOnPaste = config.sanitizeOnPaste !== false;
    var lastBannerAt = 0;
    var reportedHashes = {};

    var style = document.createElement('style');
    style.textContent = [
      '.midori-ia-banner{position:fixed;left:14px;right:14px;top:10px;z-index:2147483646;background:#1c2b1f;color:#e7f8ea;border:1px solid #4e9f62;border-radius:10px;padding:10px 12px;font:600 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.25)}',
      '.midori-ia-isolated-warn{outline:2px dashed #f39c12 !important;filter:blur(1px) !important}',
      '.midori-ia-isolated-block{display:none !important}',
    ].join('');
    (document.head || document.documentElement).appendChild(style);

    var banner = null;
    function showBanner(message) {
      if (!message) return;
      var now = Date.now();
      if ((now - lastBannerAt) < 700) return;
      lastBannerAt = now;
      if (!banner) banner = createIaBanner();
      var msgEl = banner.querySelector('.midori-ia-banner-msg');
      if (msgEl) msgEl.textContent = message;
      banner.style.display = 'block';
      clearTimeout(banner._hideTimer);
      banner._hideTimer = setTimeout(function() {
        banner.style.display = 'none';
      }, strict ? 5200 : 3200);
    }

    function hashText(text) {
      var s = String(text || '').slice(0, 256);
      var h = 0;
      for (var i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
      }
      return String(h);
    }

    function shouldReport(hashKey) {
      var now = Date.now();
      var prev = reportedHashes[hashKey] || 0;
      if ((now - prev) < 60000) return false;
      reportedHashes[hashKey] = now;
      var keys = Object.keys(reportedHashes);
      if (keys.length > 120) {
        for (var i = 0; i < keys.length - 120; i++) {
          delete reportedHashes[keys[i]];
        }
      }
      return true;
    }

    function analyzeAndWarn(text, source, sample) {
      var analysis = analyzePromptPayload(text);
      if (analysis.score < 4) return analysis;

      var key = hashText(source + ':' + text);
      if (shouldReport(key)) {
        reportIaRisk({
          type: 'prompt_injection_detected',
          severity: analysis.severity,
          timestamp: Date.now(),
          payload: {
            source: source,
            sample: String(sample || text || '').slice(0, 200),
            findings: analysis.findings,
            strict: strict,
          },
        });
      }
      showBanner(strict
        ? 'Contenido sospechoso aislado. Modo estricto activo.'
        : 'Posible prompt-injection detectado en esta pagina IA.');
      return analysis;
    }

    function isOverlayLike(el) {
      if (!el || el.nodeType !== 1) return false;
      var styleObj = window.getComputedStyle(el);
      if (!styleObj) return false;
      if (styleObj.position === 'fixed' || styleObj.position === 'sticky') return true;
      var cls = String(el.className || '').toLowerCase();
      if (/(overlay|modal|banner|toast|popover|dialog)/.test(cls)) return true;
      return false;
    }

    function inspectNode(node) {
      if (!node || node.nodeType !== 1) return;
      if (node.__midoriIaChecked) return;
      node.__midoriIaChecked = true;

      var text = normalizePromptText(node.textContent || '').slice(0, 4000);
      if (!text || text.length < 30) return;

      var analysis = analyzePromptPayload(text);
      if (analysis.score < 5) return;

      var overlay = isOverlayLike(node);
      if (!overlay && !strict) return;

      if (strict) node.classList.add('midori-ia-isolated-block');
      else node.classList.add('midori-ia-isolated-warn');

      analyzeAndWarn(text, 'dom-overlay', text.slice(0, 180));

      reportIaRisk({
        type: 'suspicious_overlay_isolated',
        severity: strict ? 'high' : 'medium',
        timestamp: Date.now(),
        payload: {
          source: 'dom-overlay',
          findings: analysis.findings,
          strict: strict,
          sample: text.slice(0, 180),
        },
      });
    }

    function inspectMutations(records) {
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        for (var j = 0; j < rec.addedNodes.length; j++) {
          var n = rec.addedNodes[j];
          if (!n || n.nodeType !== 1) continue;
          inspectNode(n);
          var descendants = n.querySelectorAll ? n.querySelectorAll('[role="dialog"],[role="alert"],div,aside,section') : [];
          for (var d = 0; d < Math.min(descendants.length, 18); d++) {
            inspectNode(descendants[d]);
          }
        }
      }
    }

    var observer = new MutationObserver(inspectMutations);
    observer.observe(document.documentElement || document, { childList: true, subtree: true });

    setTimeout(function() {
      var primaries = document.querySelectorAll('[role="dialog"],[role="alert"],.modal,.overlay,.banner,aside,section');
      for (var i = 0; i < Math.min(primaries.length, 50); i++) {
        inspectNode(primaries[i]);
      }
    }, 350);

    if (sanitizeOnPaste) {
      document.addEventListener('paste', function(event) {
        var target = event && event.target;
        if (!isPromptField(target)) return;
        var cd = event.clipboardData || window.clipboardData;
        var text = cd && cd.getData ? cd.getData('text/plain') : '';
        if (!text) return;

        var analysis = analyzePromptPayload(text);
        if (analysis.score < 3) return;

        var sanitized = sanitizePromptPayload(text);
        if (!sanitized.changed) return;

        event.preventDefault();
        insertTextIntoTarget(target, sanitized.text);

        showBanner('Prompt sanitizado localmente para reducir riesgo de injection.');
        reportIaRisk({
          type: 'prompt_sanitized',
          severity: analysis.severity,
          timestamp: Date.now(),
          payload: {
            source: 'paste',
            findings: analysis.findings.concat(sanitized.findings),
            fieldType: (target.tagName || '').toLowerCase(),
            sample: String(text || '').slice(0, 160),
            strict: strict,
          },
        });
      }, true);
    }

    document.addEventListener('input', function(event) {
      var target = event && event.target;
      if (!isPromptField(target)) return;
      var value = '';
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') value = target.value || '';
      else value = target.textContent || '';
      if (!value || value.length < 24) return;
      analyzeAndWarn(value.slice(0, 2000), 'prompt-input', value.slice(0, 120));
    }, true);

    function isKnownExfilUrl(url) {
      if (!url) return false;
      var u;
      try {
        u = new URL(url, location.href);
      } catch (e) {
        return false;
      }

      var host = String(u.hostname || '').toLowerCase();
      var path = String(u.pathname || '').toLowerCase();

      var hostNeedles = [
        'webhook.site', 'hookbin', 'requestbin', 'ngrok', 'pipedream',
        'beeceptor', 'interact.sh', 'oast', 'discord.com', 'slack.com',
      ];
      for (var i = 0; i < hostNeedles.length; i++) {
        if (host.indexOf(hostNeedles[i]) !== -1) return true;
      }

      if (u.origin !== location.origin) {
        if (/\/(collect|exfil|steal|dump|leak|prompt|history|conversation|memory)\b/.test(path)) return true;
      }

      var params = u.searchParams;
      var suspiciousKeys = ['prompt', 'system_prompt', 'history', 'chat_history', 'conversation', 'api_key', 'token', 'authorization'];
      var keys = [];
      params.forEach(function(_, k) { keys.push(k); });

      for (var j = 0; j < keys.length; j++) {
        var key = keys[j].toLowerCase();
        for (var k = 0; k < suspiciousKeys.length; k++) {
          if (key.indexOf(suspiciousKeys[k]) !== -1 && u.origin !== location.origin) {
            return true;
          }
        }
      }

      return false;
    }

    function maybeBlockOutbound(url, channel) {
      if (!isKnownExfilUrl(url)) return false;
      reportIaRisk({
        type: 'exfil_request_blocked',
        severity: 'high',
        timestamp: Date.now(),
        payload: {
          source: channel,
          blockedUrl: String(url || '').slice(0, 280),
          strict: strict,
        },
      });
      showBanner('Solicitud de exfiltracion bloqueada por IA Shield.');
      return true;
    }

    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function(resource, init) {
        var reqUrl = '';
        if (typeof resource === 'string') reqUrl = resource;
        else if (resource && resource.url) reqUrl = resource.url;

        if (maybeBlockOutbound(reqUrl, 'fetch')) {
          return Promise.resolve(new Response('', { status: 204, statusText: 'No Content' }));
        }
        return origFetch.apply(this, arguments);
      };
    }

    var xhrOpen = XMLHttpRequest.prototype.open;
    var xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__midoriIaUrl = String(url || '');
      return xhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      if (this.__midoriIaUrl && maybeBlockOutbound(this.__midoriIaUrl, 'xhr')) {
        try { this.abort(); } catch (e) {}
        return;
      }
      return xhrSend.apply(this, arguments);
    };

    if (typeof navigator.sendBeacon === 'function') {
      var origBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function(url) {
        if (maybeBlockOutbound(url, 'sendBeacon')) return false;
        return origBeacon.apply(null, arguments);
      };
    }
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
      function deepHas(obj, chain) {
        if (!obj || typeof obj !== 'object') return false;
        var parts = chain.split('.');
        var cur = obj;
        for (var i = 0; i < parts.length; i++) {
          if (cur == null || typeof cur !== 'object') return false;
          if (!(parts[i] in cur)) return false;
          cur = cur[parts[i]];
        }
        return true;
      }
      function deepDelete(obj, chain) {
        if (!obj || typeof obj !== 'object') return;
        var parts = chain.split('.');
        var cur = obj;
        for (var i = 0; i < parts.length - 1; i++) {
          if (cur == null || typeof cur !== 'object') return;
          if (!(parts[i] in cur)) return;
          cur = cur[parts[i]];
        }
        if (cur && typeof cur === 'object' && parts.length > 0) {
          delete cur[parts[parts.length - 1]];
        }
      }
      JSON.parse = function() {
        var r = origParse.apply(this, arguments);
        if (r instanceof Object === false) return r;
        if (requiredProps) {
          var reqs = requiredProps.split(' ');
          for (var i = 0; i < reqs.length; i++) {
            if (!deepHas(r, reqs[i])) return r;
          }
        }
        var props = propsToRemove.split(' ');
        for (var i = 0; i < props.length; i++) {
          deepDelete(r, props[i]);
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
      var ENFORCEMENT_KEYWORDS = ['ad blocker','bloqueador','werbeblocker','bloqueur','adblocker','bloqueador de anuncios','adblock','premium'];
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

      function getMainPlayerVideo() {
        // Select only the main player video, not sidebar/preview thumbnails
        var player = document.querySelector('.video-player__container video, [data-a-target="video-player"] video');
        if (player) return player;
        // Fallback: pick the largest visible video element
        var videos = document.querySelectorAll('video');
        var best = null;
        var bestArea = 0;
        for (var i = 0; i < videos.length; i++) {
          var rect = videos[i].getBoundingClientRect();
          var area = rect.width * rect.height;
          if (area > bestArea) { bestArea = area; best = videos[i]; }
        }
        return best;
      }

      function muteAd() {
        try {
          var v = getMainPlayerVideo();
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
          var v = getMainPlayerVideo();
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

  function installPopupGestureBridge() {
    var lastSentAt = 0;
    var handler = function(event) {
      if (!event || event.isTrusted !== true) return;
      var now = Date.now();
      if (now - lastSentAt < 80) return;
      lastSentAt = now;

      var href = '';
      var tagName = '';
      try {
        var node = event.target && event.target.closest ? event.target.closest('a,button,form,[role="button"]') : null;
        href = node && node.href ? String(node.href) : '';
        tagName = node && node.tagName ? String(node.tagName).toLowerCase() : '';
      } catch (e) {}

      sendRuntimeMessage({
        action: 'popup-guard-user-gesture',
        type: event.type,
        href: href,
        targetTag: tagName,
      });
    };

    window.addEventListener('pointerdown', handler, true);
    window.addEventListener('keydown', handler, true);
    window.addEventListener('touchstart', handler, true);
  }

  function buildPopupDefenseCode(config) {
    var cfg = JSON.stringify(config || {});
    return `(function() {
      var cfg = ${cfg};
      if (!cfg || cfg.enabled === false) return;
      if (window.__midoriPopupDefenseInstalled) return;
      window.__midoriPopupDefenseInstalled = true;

      var lastGestureAt = 0;
      var openTimestamps = [];

      function postBlocked(reason, url) {
        try {
          window.postMessage({ type: 'midori-popup-blocked', reason: reason, url: String(url || '') }, location.origin);
        } catch (e) {}
      }

      function markGesture(event) {
        if (!event || event.isTrusted !== true) return;
        lastGestureAt = Date.now();
      }

      function withinGestureWindow() {
        return (Date.now() - lastGestureAt) <= (cfg.gestureWindowMs || 1400);
      }

      function pruneOpens() {
        var now = Date.now();
        var win = cfg.burstWindowMs || 5000;
        openTimestamps = openTimestamps.filter(function(ts) {
          return (now - ts) <= win;
        });
      }

      document.addEventListener('pointerdown', markGesture, true);
      document.addEventListener('keydown', markGesture, true);
      document.addEventListener('touchstart', markGesture, true);

      var origOpen = window.open;
      if (typeof origOpen === 'function') {
        window.open = function(url) {
          pruneOpens();
          var hasGesture = withinGestureWindow();
          var maxBurst = Number.isFinite(cfg.maxBurstWithoutGesture) ? cfg.maxBurstWithoutGesture : 1;
          if ((!hasGesture && cfg.closeTabsWithoutGesture !== false) || (!hasGesture && openTimestamps.length > maxBurst)) {
            postBlocked(!hasGesture ? 'no-gesture' : 'burst', url);
            return null;
          }
          openTimestamps.push(Date.now());
          return origOpen.apply(this, arguments);
        };
      }

      var origAnchorClick = HTMLAnchorElement.prototype.click;
      if (typeof origAnchorClick === 'function') {
        HTMLAnchorElement.prototype.click = function() {
          var target = String(this.target || '').toLowerCase();
          if (target === '_blank' && !withinGestureWindow() && cfg.closeTabsWithoutGesture !== false) {
            postBlocked('synthetic-blank-click', this.href || '');
            return;
          }
          return origAnchorClick.apply(this, arguments);
        };
      }

      // Intercept onclick handlers that call window.open
      var origSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value) {
        if (name === 'onclick' && typeof value === 'string' && /window\\.open\\s*\\(/.test(value)) {
          if (!withinGestureWindow() && cfg.closeTabsWithoutGesture !== false) {
            postBlocked('onclick-window-open', value.slice(0, 200));
            return;
          }
        }
        return origSetAttribute.apply(this, arguments);
      };

      document.addEventListener('click', function(e) {
        if (e.isTrusted) return;
        var el = e.target;
        if (!el) return;
        var onclickFn = el.onclick;
        if (typeof onclickFn === 'function') {
          var fnStr = onclickFn.toString();
          if (/window\\.open\\s*\\(/.test(fnStr) && !withinGestureWindow() && cfg.closeTabsWithoutGesture !== false) {
            e.preventDefault();
            e.stopImmediatePropagation();
            postBlocked('onclick-handler-open', fnStr.slice(0, 200));
            return;
          }
        }
      }, true);
    })();`;
  }

  // ── Runtime state gate ────────────────────────────────────────────────────
  // Keep all scriptlet-side behavior disabled when protection is disabled
  // globally or bypassed for this host.
  var hn = '';
  try { hn = window.location.hostname; } catch(e) {}
  var siteProtectionEnabled = true;

  sendRuntimeMessage({ action: 'get-site-protection-state', hostname: hn }).then(function(state) {
    siteProtectionEnabled = state && state.enabled === false ? false : true;
    if (!siteProtectionEnabled) return;

    installPopupGestureBridge();
    sendRuntimeMessage({ action: 'get-ia-shield-config', hostname: hn }).then(function(response) {
      if (response && response.config && response.config.enabled) {
        installIaShieldRuntime(response.config);
      }
    });
    sendRuntimeMessage({ action: 'get-popup-defense-config', hostname: hn }).then(function(response) {
      if (response && response.config) {
        injectCode(buildPopupDefenseCode(response.config));
      }
    });
    if (hn === 'www.youtube.com' || hn === 'youtube.com' || hn === 'm.youtube.com') {
      applyScriptlets([{ name: 'yt-ad-pruner', args: [] }]);
      _appliedScriptlets['yt-ad-pruner:'] = true;
    }
  }).catch(function() {});

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
    if (!siteProtectionEnabled) return;

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

    // Ghostery engine: batch of pre-compiled scriptlets (inject as single script)
    if (event.data.type === 'midori-compiled-scriptlet-batch' && event.data.scripts) {
      var scripts = event.data.scripts;
      if (scripts.length > 0) {
        injectCode(scripts.join('\n'));
      }
    }

    if (event.data.type === 'midori-popup-blocked') {
      sendRuntimeMessage({
        action: 'popup-guard-blocked',
        reason: event.data.reason,
        url: event.data.url,
      });
    }
  });

  setTimeout(function() {
    reportContentCost(performance.now() - scriptStart);
  }, 0);
})();

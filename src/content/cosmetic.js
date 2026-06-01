import { BUILTIN_COSMETICS, GLOBAL_AD_CSS, GLOBAL_AD_SELECTORS, GLOBAL_CSS_EXCLUDE } from './cosmetic-rules.js';
import scriptletRuleList from '../rules/scriptlets.json';

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

  let isTopFrame = false;
  try {
    isTopFrame = window.top === window;
  } catch {
    isTopFrame = false;
  }
  if (!isTopFrame) return;
  const scriptStart = performance.now();

  const COLLAPSE_CSS = 'display:none!important;height:0!important;min-height:0!important;max-height:0!important;overflow:hidden!important;margin:0!important;padding:0!important;border:0!important;opacity:0!important;pointer-events:none!important;';
  const ATTR_COLLAPSED = 'data-midori-c';
  const APPLIED_RULES_DEBOUNCE_MS = 1200;
  const MAX_APPLIED_SELECTOR_SAMPLES = 24;
  const MAX_APPLIED_SCRIPTLET_SAMPLES = 24;
  const MAX_DISCARDED_SELECTOR_SAMPLES = 24;
  const SELECTOR_SAMPLE_RATE = 0.12;
  const SCRIPTLET_SAMPLE_RATE = 0.2;
  const COSMETIC_BLOCK_FLUSH_MS = 800;
  const MAX_COSMETIC_BLOCK_REPORT = 50;
  let appliedStyle = null;
  let globalAdStyle = null;
  let appliedRulesFlushTimer = null;
  let cosmeticBlockFlushTimer = null;
  let pendingCosmeticBlocks = 0;
  let pendingCosmeticSources = Object.create(null);
  let cosmeticAuditEnabled = false;
  const appliedRulesBuffer = {
    selectorCount: 0,
    scriptletCount: 0,
    discardedSelectorCount: 0,
    selectorsSample: [],
    scriptletsSample: [],
    discardedSelectorsSample: [],
    selectorSet: new Set(),
    scriptletSet: new Set(),
    discardedSelectorSet: new Set(),
    sources: Object.create(null),
    discardedReasons: Object.create(null),
  };

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

  function reportContentCost(durationMs) {
    const hostname = window.location.hostname || '';
    sendMsg({
      action: 'record-content-script-kpi',
      script: 'cosmetic',
      hostname,
      durationMs,
    }).catch(() => {});
  }

  async function initRolloutFlags() {
    try {
      const flags = await sendMsg({ action: 'get-rollout-flags' });
      cosmeticAuditEnabled = flags?.cosmeticAudit === true;
    } catch {
      cosmeticAuditEnabled = false;
    }
  }

  function sanitizeSampleToken(raw) {
    const token = String(raw || '').trim();
    if (!token) return '';
    return token.slice(0, 120);
  }

  function maybePushSample(list, dedupeSet, token, maxSize, sampleRate) {
    const value = sanitizeSampleToken(token);
    if (!value || dedupeSet.has(value) || list.length >= maxSize) return;
    if (list.length >= 4 && Math.random() > sampleRate) return;
    dedupeSet.add(value);
    list.push(value);
  }

  function scheduleAppliedRulesFlush() {
    if (appliedRulesFlushTimer) return;
    appliedRulesFlushTimer = setTimeout(() => {
      appliedRulesFlushTimer = null;
      flushAppliedRulesTelemetry();
    }, APPLIED_RULES_DEBOUNCE_MS);
  }

  function addAppliedRulesSource(source, count) {
    appliedRulesBuffer.sources[source] = (appliedRulesBuffer.sources[source] || 0) + count;
  }

  function hasAppliedRulesTelemetry() {
    return !!(
      appliedRulesBuffer.selectorCount ||
      appliedRulesBuffer.scriptletCount ||
      appliedRulesBuffer.discardedSelectorCount
    );
  }

  function resetAppliedRulesBuffer() {
    appliedRulesBuffer.selectorCount = 0;
    appliedRulesBuffer.scriptletCount = 0;
    appliedRulesBuffer.discardedSelectorCount = 0;
    appliedRulesBuffer.selectorsSample.length = 0;
    appliedRulesBuffer.scriptletsSample.length = 0;
    appliedRulesBuffer.discardedSelectorsSample.length = 0;
    appliedRulesBuffer.selectorSet.clear();
    appliedRulesBuffer.scriptletSet.clear();
    appliedRulesBuffer.discardedSelectorSet.clear();
    appliedRulesBuffer.sources = Object.create(null);
    appliedRulesBuffer.discardedReasons = Object.create(null);
  }

  function queueAppliedSelectors(selectors, source) {
    if (!cosmeticAuditEnabled) return;
    if (!Array.isArray(selectors) || selectors.length === 0) return;
    appliedRulesBuffer.selectorCount += selectors.length;
    addAppliedRulesSource(source, selectors.length);

    for (const sel of selectors) {
      maybePushSample(
        appliedRulesBuffer.selectorsSample,
        appliedRulesBuffer.selectorSet,
        sel,
        MAX_APPLIED_SELECTOR_SAMPLES,
        SELECTOR_SAMPLE_RATE,
      );
    }
    scheduleAppliedRulesFlush();
  }

  function queueAppliedScriptlets(scriptlets, source) {
    if (!cosmeticAuditEnabled) return;
    if (!Array.isArray(scriptlets) || scriptlets.length === 0) return;
    appliedRulesBuffer.scriptletCount += scriptlets.length;
    addAppliedRulesSource(source, scriptlets.length);

    for (const item of scriptlets) {
      const name = typeof item === 'string' ? item : item?.name;
      maybePushSample(
        appliedRulesBuffer.scriptletsSample,
        appliedRulesBuffer.scriptletSet,
        name,
        MAX_APPLIED_SCRIPTLET_SAMPLES,
        SCRIPTLET_SAMPLE_RATE,
      );
    }
    scheduleAppliedRulesFlush();
  }

  function queueDiscardedSelectors(items, source) {
    if (!cosmeticAuditEnabled) return;
    if (!Array.isArray(items) || items.length === 0) return;
    appliedRulesBuffer.discardedSelectorCount += items.length;
    const sourceKey = `discarded:${source || 'selector'}`;
    addAppliedRulesSource(sourceKey, items.length);

    for (const item of items) {
      const selector = typeof item === 'string' ? item : item?.selector;
      const reason = typeof item === 'object' && item ? String(item.reason || 'invalid') : 'invalid';
      appliedRulesBuffer.discardedReasons[reason] = (appliedRulesBuffer.discardedReasons[reason] || 0) + 1;
      maybePushSample(
        appliedRulesBuffer.discardedSelectorsSample,
        appliedRulesBuffer.discardedSelectorSet,
        selector,
        MAX_DISCARDED_SELECTOR_SAMPLES,
        SELECTOR_SAMPLE_RATE,
      );
    }
    scheduleAppliedRulesFlush();
  }

  function queueCompiledScriptlets(count, source) {
    if (!cosmeticAuditEnabled) return;
    const numeric = Number(count) || 0;
    if (numeric <= 0) return;
    appliedRulesBuffer.scriptletCount += numeric;
    addAppliedRulesSource(source, numeric);
    maybePushSample(
      appliedRulesBuffer.scriptletsSample,
      appliedRulesBuffer.scriptletSet,
      'compiled-scriptlet',
      MAX_APPLIED_SCRIPTLET_SAMPLES,
      1,
    );
    scheduleAppliedRulesFlush();
  }

  function flushAppliedRulesTelemetry() {
    if (!cosmeticAuditEnabled) return;
    if (!hasAppliedRulesTelemetry()) return;

    const payload = {
      action: 'record-applied-rules-event',
      hostname: window.location.hostname || '',
      selectorCount: appliedRulesBuffer.selectorCount,
      scriptletCount: appliedRulesBuffer.scriptletCount,
      discardedSelectorCount: appliedRulesBuffer.discardedSelectorCount,
      selectorsSample: appliedRulesBuffer.selectorsSample.slice(0, MAX_APPLIED_SELECTOR_SAMPLES),
      scriptletsSample: appliedRulesBuffer.scriptletsSample.slice(0, MAX_APPLIED_SCRIPTLET_SAMPLES),
      discardedSelectorsSample: appliedRulesBuffer.discardedSelectorsSample.slice(0, MAX_DISCARDED_SELECTOR_SAMPLES),
      sources: { ...appliedRulesBuffer.sources },
      discardedReasons: { ...appliedRulesBuffer.discardedReasons },
    };

    resetAppliedRulesBuffer();

    sendMsg(payload).catch(() => {});
  }

  function queueCosmeticBlocks(count, source) {
    const numeric = Math.max(0, Math.min(MAX_COSMETIC_BLOCK_REPORT, Number(count) || 0));
    if (numeric <= 0) return;
    const key = String(source || 'cosmetic').slice(0, 40) || 'cosmetic';
    pendingCosmeticBlocks += numeric;
    pendingCosmeticSources[key] = (pendingCosmeticSources[key] || 0) + numeric;

    if (cosmeticBlockFlushTimer) return;
    cosmeticBlockFlushTimer = setTimeout(() => {
      cosmeticBlockFlushTimer = null;
      flushCosmeticBlockReport();
    }, COSMETIC_BLOCK_FLUSH_MS);
  }

  function flushCosmeticBlockReport() {
    const count = Math.max(0, Math.min(MAX_COSMETIC_BLOCK_REPORT, pendingCosmeticBlocks));
    if (count <= 0) return;
    const sources = { ...pendingCosmeticSources };
    pendingCosmeticBlocks = 0;
    pendingCosmeticSources = Object.create(null);

    const topSource = Object.entries(sources).sort((a, b) => b[1] - a[1])[0]?.[0] || 'cosmetic';
    sendMsg({
      action: 'record-cosmetic-blocks',
      hostname: window.location.hostname || '',
      count,
      source: topSource,
      sources,
    }).catch(() => {});
  }

  initRolloutFlags();

  // Static global selector data lives in cosmetic-rules.js.


  function shouldExcludeGlobalCSS(host) {
    if (GLOBAL_CSS_EXCLUDE.has(host)) return true;
    for (const domain of GLOBAL_CSS_EXCLUDE) {
      if (host.endsWith('.' + domain)) return true;
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
    scheduleGlobalCssFalsePositiveProbe();
  }

  // ── Passive false-positive telemetry for the global ad CSS ──
  // After first paint, count how many DOM nodes the global selector list
  // matches. If the count is unusually high we report the host once per page
  // load so we can iterate on selector tightening without breaking layouts.
  const GLOBAL_CSS_FP_THRESHOLD = 60;          // hits before we flag a host
  const GLOBAL_CSS_FP_PROBE_DELAY_MS = 1500;   // wait for first paint to settle
  let globalCssFpProbeScheduled = false;
  const GLOBAL_AD_SELECTOR_LIST = GLOBAL_AD_SELECTORS.join(',');

  function scheduleGlobalCssFalsePositiveProbe() {
    if (globalCssFpProbeScheduled) return;
    globalCssFpProbeScheduled = true;
    const run = () => {
      try {
        runGlobalCssFalsePositiveProbe();
      } catch {
        /* noop */
      }
    };
    const kickoff = () => {
      // Defer until after first paint to avoid measuring during layout.
      setTimeout(run, GLOBAL_CSS_FP_PROBE_DELAY_MS);
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      kickoff();
    } else {
      window.addEventListener('DOMContentLoaded', kickoff, { once: true });
    }
  }

  function runGlobalCssFalsePositiveProbe() {
    if (!GLOBAL_AD_SELECTOR_LIST) return;
    let hits = 0;
    try {
      hits = document.querySelectorAll(GLOBAL_AD_SELECTOR_LIST).length;
    } catch {
      return;
    }
    if (hits < GLOBAL_CSS_FP_THRESHOLD) return;
    sendMsg({
      action: 'record-global-css-fp',
      hostname: window.location.hostname || '',
      hits,
      threshold: GLOBAL_CSS_FP_THRESHOLD,
    }).catch(() => {});
  }

  // Static site-specific selectors live in cosmetic-rules.js.

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 3 — Filter-list cosmetic selectors (from background engine)
  // ══════════════════════════════════════════════════════════════════════════

  let appliedSelectorsKey = '';
  let proceduralRulesKey = '';

  function stripCssStringQuotes(raw) {
    const value = String(raw || '').trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return value.slice(1, -1).replace(/\\(["'\\])/g, '$1');
      }
    }
    return value;
  }

  function extractHasTextProcedural(selector) {
    const input = String(selector || '').trim();
    if (!input.includes(':has-text(')) return null;
    const marker = ':has-text(';
    const markerIndex = input.indexOf(marker);
    const start = markerIndex + marker.length;
    let depth = 1;
    let quote = '';
    let end = -1;
    for (let i = start; i < input.length; i++) {
      const ch = input[i];
      const prev = input[i - 1];
      if (quote) {
        if (ch === quote && prev !== '\\') quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === '(') depth++;
      if (ch === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) return null;

    const before = input.slice(0, markerIndex).trim();
    const after = input.slice(end + 1).trim();
    if (after) return null;

    const baseSelector = before || '*';
    const text = stripCssStringQuotes(input.slice(start, end));
    if (!text || text.length > 120) return null;
    return { type: 'has-text', selector: baseSelector, text };
  }

  function isCssSelectorSupported(selector) {
    const s = String(selector || '').trim();
    if (!s || s.length > 1000) return false;
    if (s.includes('{') || s.includes('}')) return false;
    try {
      if (window.CSS && typeof CSS.supports === 'function' && CSS.supports(`selector(${s})`)) {
        return true;
      }
    } catch {}
    try {
      document.documentElement.matches(s);
      return true;
    } catch {
      return false;
    }
  }

  function validateCosmeticSelectors(selectors, source) {
    const valid = [];
    const procedural = [];
    const discarded = [];
    const seen = new Set();
    const proceduralSeen = new Set();

    for (const raw of selectors || []) {
      const selector = String(raw || '').trim();
      if (!selector) continue;
      if (seen.has(selector)) continue;

      if (selector.includes('{') || selector.includes('}')) {
        discarded.push({ selector, reason: 'css-block' });
        continue;
      }

      const proceduralRule = extractHasTextProcedural(selector);
      if (proceduralRule) {
        const key = `${proceduralRule.type}|${proceduralRule.selector}|${proceduralRule.text}`;
        if (!proceduralSeen.has(key) && isCssSelectorSupported(proceduralRule.selector)) {
          proceduralSeen.add(key);
          procedural.push(proceduralRule);
        } else {
          discarded.push({ selector, reason: 'invalid-procedural-base' });
        }
        seen.add(selector);
        continue;
      }

      if (!isCssSelectorSupported(selector)) {
        discarded.push({ selector, reason: selector.length > 1000 ? 'too-long' : 'invalid-selector' });
        seen.add(selector);
        continue;
      }

      seen.add(selector);
      valid.push(selector);
    }

    if (discarded.length > 0) queueDiscardedSelectors(discarded, source);
    return { valid, procedural };
  }

  function applyProceduralRules(rules) {
    if (!Array.isArray(rules) || rules.length === 0) return;
    const key = rules.map(rule => `${rule.type}|${rule.selector}|${rule.text || rule.pattern || ''}`).join('|');
    if (key === proceduralRulesKey) return;
    proceduralRulesKey = key;

    let matches = 0;
    for (const rule of rules.slice(0, 80)) {
      if (!rule || rule.type !== 'has-text' || !rule.selector || !rule.text) continue;
      let elements = [];
      try {
        elements = document.querySelectorAll(rule.selector);
      } catch {
        continue;
      }
      const needle = String(rule.text).toLowerCase();
      const limit = Math.min(elements.length, 120);
      for (let i = 0; i < limit; i++) {
        const el = elements[i];
        if (!el || SAFE_TAGS.has(el.tagName) || el.hasAttribute(ATTR_COLLAPSED)) continue;
        const text = String(el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!text || !text.includes(needle)) continue;
        collapseElement(el, 'procedural-has-text');
        matches++;
        if (matches >= MAX_COSMETIC_BLOCK_REPORT) return;
      }
    }
  }

  function applySelectors(selectors) {
    if (!selectors || selectors.length === 0) return;

    const { valid, procedural } = validateCosmeticSelectors(selectors, 'cosmetic-selectors');
    if (procedural.length > 0) applyProceduralRules(procedural);

    // Cache check: skip re-injection if selectors haven't changed and the
    // <style> element is still in the DOM (common during SPA navigations).
    const key = valid.join('|');
    if (key === appliedSelectorsKey && appliedStyle && appliedStyle.parentNode) {
      return;
    }
    appliedSelectorsKey = key;

    if (appliedStyle && appliedStyle.parentNode) {
      appliedStyle.parentNode.removeChild(appliedStyle);
    }

    const cssRules = valid.map(s => s + ' { ' + COLLAPSE_CSS + ' }');
    if (cssRules.length === 0) return;

    reportSelectorMatches(valid);

    const style = document.createElement('style');
    style.setAttribute('data-midori-privacy', 'cosmetic');
    style.textContent = cssRules.join('\n');
    (document.head || document.documentElement).appendChild(style);
    appliedStyle = style;

    queueAppliedSelectors(valid, 'cosmetic-selectors');
  }

  function reportSelectorMatches(selectors) {
    if (!Array.isArray(selectors) || selectors.length === 0) return;
    let matches = 0;
    const seen = new WeakSet();

    for (const selector of selectors.slice(0, 120)) {
      if (matches >= MAX_COSMETIC_BLOCK_REPORT) break;
      try {
        const elements = document.querySelectorAll(selector);
        for (let i = 0; i < elements.length && matches < MAX_COSMETIC_BLOCK_REPORT; i++) {
          const el = elements[i];
          if (!el || seen.has(el) || SAFE_TAGS.has(el.tagName)) continue;
          seen.add(el);
          matches++;
        }
      } catch {}
    }

    if (matches > 0) queueCosmeticBlocks(matches, 'selector-cosmetic');
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
  const AD_SRC_RE = /(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|amazon-adsystem\.com|adnxs\.com|rubiconproject\.com|openx\.net|pubmatic\.com|criteo\.|taboola\.com|outbrain\.com|mgid\.com|rad\.msn\.com|msads\.net|bingads\.microsoft\.com)/i;
  const TEXT_AD_LABEL_RE = /^(?:ad|ads|advertisement|sponsored|sponsor|promoted|publicidad|anuncio|anuncios|patrocinado|patrocinada)$/i;
  const TEXT_AD_SCAN_DOMAINS = ['msn.com', 'bing.com', 'google.com'];

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

  function shouldScanTextAdLabels() {
    const host = window.location.hostname || '';
    for (const domain of TEXT_AD_SCAN_DOMAINS) {
      if (host === domain || host.endsWith('.' + domain)) return true;
    }
    return false;
  }

  function findTextAdContainer(labelEl) {
    let current = labelEl;
    for (let depth = 0; current && depth < 7; depth++) {
      if (SAFE_TAGS.has(current.tagName)) return null;
      const rect = current.getBoundingClientRect ? current.getBoundingClientRect() : null;
      const className = String(current.className || '').toLowerCase();
      const role = String(current.getAttribute?.('role') || '').toLowerCase();
      const usefulSize = rect && rect.width >= 80 && rect.height >= 30;
      const cardLike = /(?:card|item|module|native|ad|sponsor|content|tile|feed|banner|slide)/.test(className) || role === 'article' || role === 'listitem';
      const wideBanner = rect && rect.width >= 280 && rect.height >= 70;

      if (usefulSize && (cardLike || wideBanner)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function scanTextAdLabels(root) {
    if (!shouldScanTextAdLabels() || !root?.querySelectorAll) return;
    let checked = 0;
    try {
      const labels = root.querySelectorAll('span:not([data-midori-c]), small:not([data-midori-c]), div:not([data-midori-c]), p:not([data-midori-c])');
      const limit = Math.min(labels.length, 160);
      for (let i = 0; i < limit; i++) {
        const label = labels[i];
        if (!label || label.children.length > 2) continue;
        const text = String(label.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 32 || !TEXT_AD_LABEL_RE.test(text)) continue;
        const container = findTextAdContainer(label);
        if (container) {
          collapseElement(container, 'text-ad-label');
          checked++;
          if (checked >= 20) break;
        }
      }
    } catch {}
  }

  /**
   * Collapse an element and propagate upward if parent becomes empty.
   * This eliminates blank spaces left by blocked ads.
   */
  function collapseElement(el, source = 'heuristic-collapse') {
    if (!el || el.hasAttribute(ATTR_COLLAPSED)) return;
    if (SAFE_TAGS.has(el.tagName)) return;

    el.style.cssText = COLLAPSE_CSS;
    el.setAttribute(ATTR_COLLAPSED, '1');
    queueCosmeticBlocks(1, source);

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
      queueCosmeticBlocks(1, 'empty-ad-container');

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

    // Optimization 8.2: Early exit if root is too large (likely content, not ads)
    if (root.children && root.children.length > 1000) return;

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
        // Optimization 8.2: Early exit if too many matches (likely false positives)
        if (els.length > 100) break;
        for (let i = 0; i < els.length; i++) {
          collapseElement(els[i], 'fast-selector-collapse');
        }
      } catch {}
    }

    scanTextAdLabels(root);

    // Slow path: heuristic check (only on initial/full scans AND for small roots)
    if (fullScan && root.children && root.children.length < 200) {
      try {
        // Target only likely ad containers — skip already-collapsed
        const candidates = root.querySelectorAll('div:not([data-midori-c]), aside:not([data-midori-c]), ins:not([data-midori-c]), iframe:not([data-midori-c])');
        // Optimization 8.2: Limit heuristic checks
        const limit = Math.min(candidates.length, 50);
        for (let i = 0; i < limit; i++) {
          if (isAdElement(candidates[i])) {
            collapseElement(candidates[i], 'heuristic-collapse');
          }
        }
      } catch {}
    }
  }

  /**
   * Lightweight scan for just the added nodes from a mutation.
   */
  function scanMutations(mutations) {
    // Optimization 8.2: Early exit if no mutations to process
    if (!mutations || mutations.length === 0) return;
    
    for (const mutation of mutations) {
      // Optimization 8.2: Skip mutations without added nodes
      if (!mutation.addedNodes || mutation.addedNodes.length === 0) continue;
      
      for (let i = 0; i < mutation.addedNodes.length; i++) {
        const node = mutation.addedNodes[i];
        if (node.nodeType !== 1) continue; // Element nodes only

        // Early exit: Skip if node is script/style/noscript (performance optimization)
        const tagName = node.tagName;
        if (tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'NOSCRIPT' || 
            tagName === 'META' || tagName === 'LINK') continue;

        // Check the node itself
        if (isAdElement(node)) {
          collapseElement(node, 'mutation-collapse');
          continue; // No need to scan children if parent is collapsed
        }

        // Optimization 8.2: Skip large subtrees (likely content, not ads)
        if (node.children && node.children.length > 500) continue;

        // Check children (only if it has child elements)
        if (node.children && node.children.length > 0) {
          scanAndCollapse(node);
        }
        scanTextAdLabels(node);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 5 — Scriptlet bridge (ISOLATED → MAIN world)
  // ══════════════════════════════════════════════════════════════════════════

  function forwardScriptletsToPage(scriptlets) {
    if (!scriptlets || scriptlets.length === 0) return;
    queueAppliedScriptlets(scriptlets, 'scriptlet-rules');
    window.postMessage({
      type: 'midori-scriptlets',
      scriptlets: scriptlets,
    }, '*');
  }

  function splitUboArgs(input) {
    const args = [];
    let current = '';
    let quote = '';
    let escaped = false;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        current += ch;
        continue;
      }
      if (quote) {
        current += ch;
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        current += ch;
        continue;
      }
      if (ch === ',') {
        args.push(stripCssStringQuotes(current.trim()));
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) args.push(stripCssStringQuotes(current.trim()));
    return args.map(normalizeUboScriptletArg);
  }

  function normalizeUboScriptletArg(arg) {
    return String(arg || '')
      .replace(/\\,/g, ',')
      .replace(/\\\\/g, '\\');
  }

  function normalizeScriptletDomainToken(domain) {
    let token = String(domain || '').trim().toLowerCase();
    if (!token) return '';
    if (token === '*') return '*';
    if (token.startsWith('||')) token = token.slice(2);
    if (token.startsWith('.')) token = token.slice(1);
    if (token.endsWith('^')) token = token.slice(0, -1);
    return token;
  }

  function splitScriptletDomains(domains) {
    const include = [];
    const exclude = [];
    for (const raw of domains || []) {
      const token = String(raw || '').trim();
      if (!token) continue;
      if (token.startsWith('~')) {
        const normalized = normalizeScriptletDomainToken(token.slice(1));
        if (normalized) exclude.push(normalized);
      } else {
        const normalized = normalizeScriptletDomainToken(token);
        if (normalized) include.push(normalized);
      }
    }
    return { include, exclude };
  }

  function scriptletDomainApplies(host, normalizedDomain) {
    if (!host || !normalizedDomain) return false;
    if (normalizedDomain === '*') return true;
    return host === normalizedDomain || host.endsWith('.' + normalizedDomain);
  }

  function shouldApplyBuiltinScriptletRule(host, rule) {
    if (!host || !rule) return false;
    const domains = splitScriptletDomains(rule.domains);
    const included = domains.include.length === 0
      ? true
      : domains.include.some((domain) => scriptletDomainApplies(host, domain));
    if (!included) return false;
    const excluded = domains.exclude.some((domain) => scriptletDomainApplies(host, domain));
    return !excluded;
  }

  function parseUboScriptletRule(ruleText) {
    const text = String(ruleText || '').trim();
    const marker = '##+js(';
    const markerIndex = text.indexOf(marker);
    if (markerIndex <= 0 || !text.endsWith(')')) return null;
    const domainText = text.slice(0, markerIndex).trim();
    const body = text.slice(markerIndex + marker.length, -1).trim();
    if (!domainText || !body) return null;
    const parts = splitUboArgs(body);
    const name = parts.shift();
    if (!name) return null;
    return {
      domains: domainText.split(',').map(d => d.trim()).filter(Boolean),
      name,
      args: parts,
    };
  }

  const BUILTIN_SCRIPTLET_RULES = Array.isArray(scriptletRuleList?.rules)
    ? scriptletRuleList.rules.map(parseUboScriptletRule).filter(Boolean)
    : [];

  function getBuiltinScriptlets(hostname) {
    const rules = [];
    const host = String(hostname || '').toLowerCase();
    if (!host) return rules;
    for (const rule of BUILTIN_SCRIPTLET_RULES) {
      if (shouldApplyBuiltinScriptletRule(host, rule)) {
        rules.push({ name: rule.name, args: rule.args });
      }
    }
    return rules;
  }

  function isSerpTrackingHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'bing.com' || host.endsWith('.bing.com') || host === 'google.com' || host.endsWith('.google.com');
  }

  function extractGoogleRedirectTarget(href) {
    if (!href) return null;
    let parsed;
    try {
      parsed = new URL(href, window.location.href);
    } catch {
      return null;
    }

    const host = String(parsed.hostname || '').toLowerCase();
    if (!(host === 'google.com' || host.endsWith('.google.com'))) return null;
    if (parsed.pathname !== '/url') return null;

    const target = parsed.searchParams.get('url') || parsed.searchParams.get('q');
    if (!target) return null;

    try {
      const targetUrl = new URL(target, window.location.href);
      if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') return null;
      return targetUrl.toString();
    } catch {
      return null;
    }
  }

  function sanitizeSerpLink(link) {
    if (!link || link.nodeType !== 1 || link.tagName !== 'A') return;

    if (link.hasAttribute('ping')) {
      link.removeAttribute('ping');
    }

    const onMouseDown = String(link.getAttribute('onmousedown') || '').toLowerCase();
    if (onMouseDown.includes('rwt(') || onMouseDown.includes('return rwt(')) {
      link.removeAttribute('onmousedown');
    }

    const directTarget = extractGoogleRedirectTarget(link.getAttribute('href'));
    if (directTarget) {
      link.setAttribute('href', directTarget);
    }
  }

  function installSerpTrackingPrevention() {
    if (!isSerpTrackingHost(window.location.hostname)) return;

    const sanitizeEventTargetLink = (event) => {
      const link = event?.target?.closest ? event.target.closest('a[href], a[ping], a[onmousedown]') : null;
      if (link) sanitizeSerpLink(link);
    };

    const sanitizeNodeLinks = (root) => {
      if (!root || !root.querySelectorAll) return;
      const links = root.querySelectorAll('a[href], a[ping], a[onmousedown]');
      const limit = Math.min(links.length, 300);
      for (let i = 0; i < limit; i++) sanitizeSerpLink(links[i]);
    };

    sanitizeNodeLinks(document);
    document.addEventListener('pointerdown', sanitizeEventTargetLink, true);
    document.addEventListener('mousedown', sanitizeEventTargetLink, true);
    document.addEventListener('click', sanitizeEventTargetLink, true);

    const obs = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (!node || node.nodeType !== 1) continue;
          if (node.tagName === 'A') sanitizeSerpLink(node);
          sanitizeNodeLinks(node);
        }
      }
    });

    obs.observe(document.documentElement || document.body || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'ping', 'onmousedown'],
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 6 — Never-Consent fallback (local heuristic)
  // ══════════════════════════════════════════════════════════════════════════

  const REJECT_BUTTON_TEXTS = [
    'reject', 'decline', 'deny', 'refuse', 'disagree', 'no thanks',
    'rechazar', 'denegar', 'no aceptar', 'configurar'
  ];

  let neverConsentHandled = false;

  /**
   * Local consent handling via visible dialog/button heuristics.
   */
  function handleNeverConsentFallback() {
    if (neverConsentHandled) return false;

    // 1. Look for common banner containers
    const banners = document.querySelectorAll('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [role="dialog"], [role="alertdialog"]');
    
    for (const banner of banners) {
      if (!banner.offsetParent) continue; // Skip hidden banners

      // 2. Look for buttons inside the banner
      const buttons = banner.querySelectorAll('button, a[role="button"], [class*="button" i]');
      
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        
        // 3. Try to find a "Reject" button
        if (REJECT_BUTTON_TEXTS.some(t => text.includes(t))) {
          try {
            btn.click();
            console.log('[midori] Never-Consent: rejected cookie banner');
            // Hide the banner just in case clicking doesn't close it immediately
            banner.style.display = 'none';
            neverConsentHandled = true;
            return true;
          } catch (e) {}
        }
      }
    }
    return false;
  }

  function handleNeverConsent() {
    handleNeverConsentFallback();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION — runs on every page
  // ══════════════════════════════════════════════════════════════════════════

  // Listen for messages from background
  let ghosteryStyle = null;
  let cosmeticsRuntimeEnabled = true;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'apply-cosmetics' && msg.selectors && cosmeticsRuntimeEnabled) {
      const builtin = getBuiltinSelectors(window.location.hostname);
      applySelectors([...builtin, ...msg.selectors]);
    }
    if (msg.action === 'apply-scriptlets' && msg.scriptlets) {
      forwardScriptletsToPage(msg.scriptlets);
    }
    // Ghostery engine: pre-compiled CSS styles (more complete than selectors alone)
    if (msg.action === 'apply-cosmetic-styles' && msg.styles && cosmeticsRuntimeEnabled) {
      if (ghosteryStyle && ghosteryStyle.parentNode) {
        ghosteryStyle.parentNode.removeChild(ghosteryStyle);
      }
      ghosteryStyle = document.createElement('style');
      ghosteryStyle.setAttribute('data-midori-privacy', 'ghostery-cosmetic');
      ghosteryStyle.textContent = msg.styles;
      (document.head || document.documentElement).appendChild(ghosteryStyle);
    }
    if (msg.action === 'apply-procedural-cosmetics' && msg.procedural && cosmeticsRuntimeEnabled) {
      applyProceduralRules(msg.procedural);
    }
    // Ghostery engine: pre-compiled scriptlet code (inject directly into page)
    if (msg.action === 'apply-compiled-scriptlets' && msg.scripts) {
      const validScripts = msg.scripts.filter(c => c && typeof c === 'string');
      if (validScripts.length > 0) {
        queueCompiledScriptlets(validScripts.length, 'compiled-scriptlets');
        window.postMessage({ type: 'midori-compiled-scriptlet-batch', scripts: validScripts }, '*');
      }
    }
  });

  const hostname = window.location.hostname;
  if (!hostname) return;

  installSerpTrackingPrevention();

  async function initSiteProtection() {
    const state = await sendMsg({ action: 'get-site-protection-state', hostname });
    const siteProtectionEnabled = state?.enabled !== false;
    if (!siteProtectionEnabled) {
      cosmeticsRuntimeEnabled = false;
      return;
    }

    // ── Step 1: Inject global ad-collapse CSS ──
    injectGlobalAdCSS();

    // ── Step 2: Apply site-specific + filter-list cosmetic selectors ──
    const builtin = getBuiltinSelectors(hostname);
    const cosmeticsResponse = await sendMsg({ action: 'get-cosmetics', hostname });
    cosmeticsRuntimeEnabled = cosmeticsResponse?.enabled !== false;
    if (cosmeticsRuntimeEnabled) {
      const all = [...builtin, ...(cosmeticsResponse?.selectors || [])];
      applySelectors(all);
      if (cosmeticsResponse?.styles) {
        if (ghosteryStyle && ghosteryStyle.parentNode) {
          ghosteryStyle.parentNode.removeChild(ghosteryStyle);
        }
        ghosteryStyle = document.createElement('style');
        ghosteryStyle.setAttribute('data-midori-privacy', 'ghostery-cosmetic');
        ghosteryStyle.textContent = cosmeticsResponse.styles;
        (document.head || document.documentElement).appendChild(ghosteryStyle);
      }
      if (cosmeticsResponse?.compiledScripts?.length > 0) {
        const validScripts = cosmeticsResponse.compiledScripts.filter(c => c && typeof c === 'string');
        if (validScripts.length > 0) {
          queueCompiledScriptlets(validScripts.length, 'compiled-scriptlets');
          window.postMessage({ type: 'midori-compiled-scriptlet-batch', scripts: validScripts }, '*');
        }
      }
      if (cosmeticsResponse?.procedural?.length > 0) {
        applyProceduralRules(cosmeticsResponse.procedural);
      }
    }

    // ── Step 3: Inject scriptlets ──
    const builtinScriptlets = getBuiltinScriptlets(hostname);
    const scriptletsResponse = await sendMsg({ action: 'get-scriptlets', hostname });
    if (scriptletsResponse?.enabled !== false) {
      if (builtinScriptlets.length > 0) {
        forwardScriptletsToPage(builtinScriptlets);
      }
      if (scriptletsResponse?.scriptlets?.length > 0) {
        forwardScriptletsToPage(scriptletsResponse.scriptlets);
      }
    }

    // ── Step 3b: Anti-fingerprinting protection ──
    const antiFpResponse = await sendMsg({ action: 'get-anti-fingerprint' });
    if (antiFpResponse?.enabled) {
      const fpScriptlets = [
        { name: 'canvas-fingerprint-protect', args: [] },
        { name: 'webgl-fingerprint-protect', args: [] },
        { name: 'navigator-fingerprint-protect', args: [] },
      ];
      if (antiFpResponse.mode === 'strong') {
        fpScriptlets.push(
          { name: 'audiocontext-fingerprint-protect', args: [] },
          { name: 'screen-fingerprint-protect', args: [] },
        );
      }
      forwardScriptletsToPage(fpScriptlets);
    }

    // ── Step 4: Run initial JS-based ad scan ──
    // Skip heuristic scanning on sites with complex UIs where generic patterns
    // cause false positives (YouTube, etc.). These sites rely solely on their
    // BUILTIN_COSMETICS selectors.
    const skipHeuristicScan = shouldExcludeGlobalCSS(hostname);

    // Never-Consent: skip on YouTube (excluded from consent handling)
    const NEVER_CONSENT_EXCLUDE = [
      'youtube.com', 'youtu.be', 'youtube-nocookie.com',
    ];
    function isNeverConsentExcluded() {
      for (const domain of NEVER_CONSENT_EXCLUDE) {
        if (hostname === domain || hostname.endsWith('.' + domain)) return true;
      }
      return false;
    }
    const skipNeverConsent = isNeverConsentExcluded();

    function initialScan() {
      if (skipHeuristicScan) return;
      scanAndCollapse(document.body || document.documentElement, true);
      // Never-Consent: skip if YouTube is excluded
      if (!skipNeverConsent) {
        setTimeout(() => { handleNeverConsent(); }, 500);
        setTimeout(() => { handleNeverConsent(); }, 2000);
      }
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
        setTimeout(initialScan, 3000);
      }, { once: true });
    }

    // ── Step 5: Universal MutationObserver — watches for dynamically inserted ads ──
    // Skip on excluded sites to avoid false positives and performance overhead.
    // Optimization 8.2: Early exit for sites that don't need dynamic monitoring
    // fix: Use Set for O(1) lookup + unified isObserverSkipHost() check
    const OBSERVER_SKIP_DOMAINS = new Set([
      'youtube.com', 'youtu.be', 'youtube-nocookie.com', // YouTube has native ads, skip observer
      'reddit.com', 'twitch.tv', // High-traffic sites: CSS-only hiding, no JS observer
      // Phase E (2026-05-07): critical first-party sites — never run the
      // mutation-based heuristic collapse on mail/productivity/banking apps.
      // NOTE (2026-05-08): google.com / microsoft.com / msn.com excluded
      // here too — those portals carry sponsored content that needs scanning.
      'gmail.com', 'googlemail.com',
      'mail.google.com', 'drive.google.com', 'docs.google.com',
      'calendar.google.com', 'accounts.google.com', 'pay.google.com',
      'live.com', 'office.com', 'office365.com',
      'outlook.com', 'sharepoint.com',
      'icloud.com', 'apple.com',
      'yahoo.com', 'aol.com', 'proton.me', 'protonmail.com', 'tutanota.com',
      'fastmail.com', 'zoho.com',
      'github.com', 'gitlab.com', 'bitbucket.org', 'atlassian.com',
      'slack.com', 'notion.so', 'linear.app', 'figma.com',
      'paypal.com', 'stripe.com',
      // Video-call apps — mutation observer on meeting grids creates jank
      // and can mis-collapse participant tiles / chat panels.
      'zoom.us', 'zoomgov.com', 'zoom.com',
      'teams.microsoft.com', 'teams.live.com',
      'meet.google.com', 'hangouts.google.com',
      'webex.com', 'whereby.com', 'daily.co', 'meet.jit.si',
      'skype.com', 'gotomeeting.com', 'gotowebinar.com',
      'bluejeans.com', 'ringcentral.com',
      // Banking / fintech — highly sensitive to DOM manipulation.
      'bancolombia.com', 'davivienda.com', 'bbva.com', 'bbvanet.com',
      'bankofamerica.com', 'chase.com', 'wellsfargo.com', 'citibank.com',
      'capitalone.com', 'usbank.com', 'ally.com',
      'mercadopago.com', 'mercadolibre.com',
      'nubank.com.br', 'itau.com.br', 'bradesco.com.br',
      'banamex.com', 'banorte.com', 'santander.com',
    ]);

    function isObserverSkipHost(host) {
      if (OBSERVER_SKIP_DOMAINS.has(host)) return true;
      // Check parent domains (www.reddit.com → .reddit.com)
      for (const domain of OBSERVER_SKIP_DOMAINS) {
        if (host.endsWith('.' + domain)) return true;
      }
      return false;
    }

    // Cache the result once per page load for zero-cost reuse
    const _isSkippedHost = isObserverSkipHost(hostname);

    function shouldSkipObserver() {
      return skipHeuristicScan || _isSkippedHost;
    }

    let observerTimer = null;

    function startUniversalObserver() {
      if (shouldSkipObserver()) return;
      const target = document.body || document.documentElement;
      if (!target) {
        document.addEventListener('DOMContentLoaded', startUniversalObserver, { once: true });
        return;
      }

      let pendingMutations = [];
      let mutationCount = 0;
      const MAX_MUTATIONS_PER_BATCH = 100; // Process max 100 mutations per batch (8.2 optimization: aggressive batching)

      const observer = new MutationObserver((mutations) => {
        // Optimization 8.2: Early exit if too many mutations (likely noise)
        if (mutations.length > 200) {
          return; // Skip batch to avoid performance degradation
        }

        // Batch mutations via rAF for lower overhead than setTimeout
        pendingMutations.push(...mutations.slice(0, MAX_MUTATIONS_PER_BATCH));
        mutationCount += mutations.length;

        if (observerTimer) return;
        observerTimer = requestAnimationFrame(() => {
          observerTimer = null;
          const batch = pendingMutations;
          const count = mutationCount;
          pendingMutations = [];
          mutationCount = 0;
          scanMutations(batch);

          // Report performance KPI if too many mutations
          if (count > 50) {
            reportContentCost(0); // Signal high mutation activity
          }
        });
      });

      // Optimization 8.2: Limit observer scope to main content areas only (not entire subtree)
      observer.observe(target, {
        childList: true,
        subtree: true
        // Don't observe attributes to reduce callback frequency
      });
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

        // Skip heavy heuristic rescan on observer-skipped sites
        // (Reddit, Twitch, YouTube) — rely on CSS selectors only
        if (!_isSkippedHost && !skipHeuristicScan) {
          setTimeout(initialScan, 300);
          setTimeout(initialScan, 1500);
        }
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
    // Skip on sites that already have their own SPA event handlers (e.g. YouTube
    // uses yt-navigate-finish above) to avoid redundant MutationObservers.
    function startSPAObserver() {
      // Phase 6 fix: Use cached skip result for guaranteed consistency
      if (_isSkippedHost) return;
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
  }

  initSiteProtection().catch(() => {});

  setTimeout(() => {
    flushAppliedRulesTelemetry();
    reportContentCost(performance.now() - scriptStart);
  }, 0);

})();

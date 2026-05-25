/**
 * Midori Privacy Blocker
 * Ghostery Engine Adapter — wraps @ghostery/adblocker-webextension
 * for Midori's background runtime integration.
 * Provides ~10x faster matching via reverse index + bloom filters,
 * and supports $csp=, $redirect=, $removeparam, procedural cosmetics.
 *
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 *
 * This file uses @ghostery/adblocker-webextension (and @ghostery/adblocker)
 * which are licensed under MPL-2.0.
 * Copyright (c) 2017-present Ghostery GmbH.
 */

import { FiltersEngine, Request, parseFilters } from '@ghostery/adblocker-webextension';
import { extractDomain, categorizeRequest } from './filter-utils.js';
import { buildIncrementalMergedEngine, ENGINE_PARSE_OPTIONS } from './lists-manager.js';
import { execPooledRegex } from './regex-pool.js';

// ── IndexedDB helpers for engine serialization ──────────────────────────────

const IDB_NAME = 'midori-privacy';
const IDB_STORE = 'engine-cache';
// v2-217: cache key bumped on @ghostery/adblocker 2.14.1 -> 2.17.3 upgrade so
// users automatically rebuild a clean snapshot with the engine-size-mismatch
// fix (2.14.4), case-sensitive filter id fix (2.14.3), correct $removeparam
// merging (2.14.2), procedural-regex hardening (2.14.5) and the new binary
// merge / slicing-by-8 hashing optimizations (2.16.0 / 2.17.0). Stale
// snapshots from 2.14.1 are silently discarded by the new key.
const IDB_KEY = 'ghostery-engine-v2-217';
const IDB_PROFILE_PREFIX = 'ghostery-engine-profile-v2-217:';
const IDB_PROFILE_INDEX_KEY = 'ghostery-engine-profile-index-v2-217';
const LEGACY_IDB_KEYS = ['ghostery-engine-v1'];
const LEGACY_PROFILE_PREFIXES = ['ghostery-engine-profile:'];
const LEGACY_PROFILE_INDEX_KEYS = ['ghostery-engine-profile-index'];
const MAX_PROFILE_SNAPSHOTS = 8;

const HAS_TEXT_RULE_RE = String.raw`^\s*(.+?)\s*:has-text\((['"]?)(.{1,120})\2\)\s*$`;
const PROCEDURAL_STRING_FIELDS = ['selector', 'raw', 'rawLine', 'cosmetic', 'rule', 'body'];
const PROCEDURAL_CHILD_FIELDS = ['tasks', 'procedural', 'extended'];

// Optimization 8.5: LRU cache for matching results
class LRUCache {
  constructor(capacity = 10000) {
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

const matchResultCache = new LRUCache(10000);

function stripRuleQuotes(raw) {
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

function proceduralRuleFromText(text) {
  const match = execPooledRegex(HAS_TEXT_RULE_RE, text);
  if (!match) return null;
  const selector = String(match[1] || '').trim();
  const needle = stripRuleQuotes(match[3]);
  if (!selector || !needle) return null;
  return { type: 'has-text', selector, text: needle };
}

function collectProceduralCandidateStrings(rule, out) {
  if (!rule || out.length >= 120) return;
  if (typeof rule === 'string') {
    out.push(rule);
    return;
  }
  if (Array.isArray(rule)) {
    for (const item of rule) collectProceduralCandidateStrings(item, out);
    return;
  }
  if (typeof rule !== 'object') return;
  for (const field of PROCEDURAL_STRING_FIELDS) {
    if (typeof rule[field] === 'string') out.push(rule[field]);
  }
  for (const field of PROCEDURAL_CHILD_FIELDS) {
    collectProceduralCandidateStrings(rule[field], out);
  }
}

function normalizeProceduralCosmetics(extendedRules) {
  const candidates = [];
  collectProceduralCandidateStrings(extendedRules, candidates);
  if (candidates.length === 0) return [];

  const rules = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const rule = proceduralRuleFromText(candidate);
    if (!rule) continue;
    const key = `${rule.type}|${rule.selector}|${rule.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
    if (rules.length >= 80) break;
  }
  return rules;
}

/**
 * Wipe ALL cached engine snapshots (main + per-profile + index).
 * Call from migrations to force a fresh rebuild from raw filter lists.
 */
export async function wipeEngineCache() {
  try {
    await idbDelete(IDB_KEY);
    const idx = await idbGet(IDB_PROFILE_INDEX_KEY);
    if (Array.isArray(idx)) {
      for (const entry of idx) {
        if (entry?.key) await idbDelete(entry.key);
      }
    }
    await idbDelete(IDB_PROFILE_INDEX_KEY);
    await purgeLegacyEngineCache();
    matchResultCache.clear();
    console.log('[ghostery-engine] Cache wiped (main + profile snapshots)');
  } catch (e) {
    console.warn('[ghostery-engine] wipeEngineCache failed:', e);
  }
}

/**
 * Best-effort cleanup of pre-2.17.3 engine snapshots. Old keys can otherwise
 * grow IndexedDB usage indefinitely after the version bump.
 */
async function purgeLegacyEngineCache() {
  for (const key of LEGACY_IDB_KEYS) {
    try { await idbDelete(key); } catch { /* ignore */ }
  }
  for (const legacyIndexKey of LEGACY_PROFILE_INDEX_KEYS) {
    try {
      const legacyIndex = await idbGet(legacyIndexKey);
      if (Array.isArray(legacyIndex)) {
        for (const entry of legacyIndex) {
          if (entry?.key) {
            try { await idbDelete(entry.key); } catch { /* ignore */ }
          }
        }
      }
      await idbDelete(legacyIndexKey);
    } catch { /* ignore */ }
  }
  // We cannot enumerate object store keys without an open cursor here; the
  // legacy index above covers the common case. Any leftover blobs keyed under
  // `LEGACY_PROFILE_PREFIXES` will simply be ignored by the new code paths
  // because reads go through the v2-217 prefix only.
  void LEGACY_PROFILE_PREFIXES;
}

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[ghostery-engine] IDB read failed:', e);
    return null;
  }
}

async function idbSet(key, value) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[ghostery-engine] IDB write failed:', e);
  }
}

async function idbDelete(key) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[ghostery-engine] IDB delete failed:', e);
  }
}

// ── GhosteryEngine adapter ──────────────────────────────────────────────────

export class GhosteryEngine {
  constructor() {
    /** @type {FiltersEngine|null} */
    this._engine = null;
    this.rulesCount = 0;
    this._listsLoaded = new Set();

    // Keep these structural fields for diagnostics and internal observability.
    this.blockedDomains = new Set();
    this.exceptionDomains = new Set();
    this.domainRulesWithOptions = [];
    this.blockRules = [];
    this.exceptionRulesWithOptions = [];
    this.exceptionPatternRules = [];
  }

  /**
   * Try to restore engine from IndexedDB serialized cache.
   * Returns true if restored successfully, false otherwise.
   */
  async restoreFromCache() {
    try {
      const cached = await idbGet(IDB_KEY);
      if (!cached || !(cached instanceof Uint8Array)) return false;
      this._engine = FiltersEngine.deserialize(cached);
      this._updateStats();
      console.log(`[ghostery-engine] Restored from cache: ${this.rulesCount} rules`);
      return true;
    } catch (e) {
      console.warn('[ghostery-engine] Cache restore failed:', e);
      return false;
    }
  }

  /**
   * Persist the current engine state to IndexedDB for fast startup.
   */
  async persistToCache() {
    if (!this._engine) return;
    try {
      const serialized = this._engine.serialize();
      await idbSet(IDB_KEY, serialized);
      console.log(`[ghostery-engine] Persisted to cache (${(serialized.byteLength / 1024).toFixed(0)} KB)`);
    } catch (e) {
      console.warn('[ghostery-engine] Cache persist failed:', e);
    }
  }

  /**
   * Restore an engine snapshot for a specific list/profile fingerprint.
   * @param {string} profileKey
   * @returns {Promise<boolean>}
   */
  async restoreProfileFromCache(profileKey) {
    if (!profileKey) return false;
    const key = `${IDB_PROFILE_PREFIX}${profileKey}`;
    try {
      const cached = await idbGet(key);
      if (!cached || !(cached instanceof Uint8Array)) return false;
      this._engine = FiltersEngine.deserialize(cached);
      this._updateStats();
      console.log(`[ghostery-engine] Restored profile cache: ${profileKey} (${this.rulesCount} rules)`);
      return true;
    } catch (e) {
      console.warn('[ghostery-engine] Profile cache restore failed:', e);
      return false;
    }
  }

  /**
   * Persist current engine under a specific profile fingerprint and maintain
   * a small LRU index of snapshots to bound storage growth.
   * @param {string} profileKey
   */
  async persistProfileToCache(profileKey) {
    if (!this._engine || !profileKey) return;
    const key = `${IDB_PROFILE_PREFIX}${profileKey}`;
    try {
      const serialized = this._engine.serialize();
      await idbSet(key, serialized);

      const now = Date.now();
      const currentIndex = await idbGet(IDB_PROFILE_INDEX_KEY);
      const index = Array.isArray(currentIndex) ? currentIndex : [];

      const nextIndex = index.filter(entry => entry?.key !== key);
      nextIndex.push({ key, at: now });

      if (nextIndex.length > MAX_PROFILE_SNAPSHOTS) {
        const overflow = nextIndex
          .slice()
          .sort((a, b) => (a.at || 0) - (b.at || 0))
          .slice(0, nextIndex.length - MAX_PROFILE_SNAPSHOTS);
        for (const old of overflow) {
          await idbDelete(old.key);
        }
      }

      const finalIndex = nextIndex
        .sort((a, b) => (b.at || 0) - (a.at || 0))
        .slice(0, MAX_PROFILE_SNAPSHOTS);
      await idbSet(IDB_PROFILE_INDEX_KEY, finalIndex);
    } catch (e) {
      console.warn('[ghostery-engine] Profile cache persist failed:', e);
    }
  }

  /**
   * Load raw filter list texts into the engine.
   * @param {Object<string, string>} lists - Map of listId → raw text
   */
  loadLists(lists) {
    const entries = Object.entries(lists).filter(([, text]) => typeof text === 'string' && text.length > 0);
    for (const [id] of entries) this._listsLoaded.add(id);

    this._engine = buildIncrementalMergedEngine(lists);

    this._updateStats();
    matchResultCache.clear(); // Phase 6: Invalidate stale match results after reload
    console.log(`[ghostery-engine] Loaded ${entries.length} lists, ${this.rulesCount} rules`);
  }

  /**
   * Add a single list text (for user custom filters).
   * @param {string} text - Raw filter text
   */
  addList(text) {
    if (!this._engine) {
      this._engine = FiltersEngine.parse(text, ENGINE_PARSE_OPTIONS);
    } else {
      const { networkFilters, cosmeticFilters } = parseFilters(text);
      this._engine.update({
        newNetworkFilters: networkFilters,
        newCosmeticFilters: cosmeticFilters,
      });
    }
    this._updateStats();
    matchResultCache.clear(); // Phase 6: Invalidate stale match results after rule change
  }

  /**
   * Alias for addList — used by loadEngine() in index.js for user filters.
   * @param {string} text - Raw filter text
   */
  addUserRules(text) {
    this.addList(text);
  }

  /**
   * Update resources.txt (redirect scripts, scriptlet resources).
   * @param {string} data - Raw resources.txt content
   * @param {string} checksum - Checksum string
   */
  updateResources(data, checksum) {
    if (this._engine) {
      this._engine.updateResources(data, checksum);
    }
  }

  // ── Network matching ─────────────────────────────────────────────────────

  /**
   * Check if a URL should be blocked.
   * @param {string} url - Request URL
   * @param {string} pageHostname - Page hostname
   * @param {string} [resourceType] - webRequest resource type
   * @returns {boolean}
   */
  shouldBlock(url, pageHostname, resourceType) {
    if (!this._engine) return false;

    const type = resourceType || 'other';
    if (type === 'main_frame') return false;

    const request = Request.fromRawDetails({
      url,
      sourceUrl: pageHostname ? `https://${pageHostname}/` : '',
      type,
    });

    const result = this._engine.match(request);
    return result.match && !result.redirect && !result.exception;
  }

  /**
   * Full match result with redirect/exception info.
   * @param {string} url
   * @param {string} pageHostname
   * @param {string} [resourceType]
   * @returns {import('@ghostery/adblocker').BlockingResponse}
   */
  matchRequest(url, pageHostname, resourceType) {
    if (!this._engine) return { match: false, redirect: undefined, exception: undefined, filter: undefined };

    // Optimization 8.5: Cache matching results
    const cacheKey = `${url}|${pageHostname}|${resourceType || 'other'}`;
    const cached = matchResultCache.get(cacheKey);
    if (cached) return cached;

    const request = Request.fromRawDetails({
      url,
      sourceUrl: pageHostname ? `https://${pageHostname}/` : '',
      type: resourceType || 'other',
    });

    const result = this._engine.match(request);
    matchResultCache.set(cacheKey, result);
    return result;
  }

  // ── Cosmetic selectors ───────────────────────────────────────────────────

  /**
  * Get CSS selectors to hide ad elements on a hostname.
   * @param {string} hostname
   * @returns {string[]}
   */
  getCosmeticSelectors(hostname) {
    if (!this._engine || !hostname) return [];

    try {
      // Phase 6: Inline domain extraction (removed _getDomain dead code)
      const parts = hostname.split('.');
      const domain = parts.length <= 2 ? hostname : parts.slice(-2).join('.');
      const result = this._engine.getCosmeticsFilters({
        url: `https://${hostname}/`,
        hostname,
        domain,
        getBaseRules: true,
        getInjectionRules: false,
        getExtendedRules: false,
        getRulesFromDOM: false,
        getRulesFromHostname: true,
      });

      // Extract selectors from the styles string
      const selectors = [];
      if (result.styles) {
        // Ghostery returns CSS like "sel1,sel2 { display: none !important; }"
        // We extract the selectors
        const cssText = result.styles;
        const matches = cssText.matchAll(/([^{}]+)\s*\{[^}]*display:\s*none/gi);
        for (const m of matches) {
          const selectorGroup = m[1].trim();
          for (const sel of selectorGroup.split(',')) {
            const s = sel.trim();
            if (s) selectors.push(s);
          }
        }
      }

      return selectors;
    } catch (e) {
      console.warn('[ghostery-engine] getCosmeticSelectors error:', e);
      return [];
    }
  }

  /**
   * Get full cosmetic filter result (styles + scripts + extended).
   * More powerful than getCosmeticSelectors — gives pre-compiled CSS.
   * @param {string} hostname
   * @param {Object} [opts]
   * @returns {Object} { styles, scripts, extended }
   */
  getFullCosmetics(hostname, opts = {}) {
    if (!this._engine || !hostname) return { styles: '', scripts: [], extended: [] };

    try {
      //Inline domain extraction (removed _getDomain dead code)
      const parts = hostname.split('.');
      const domain = parts.length <= 2 ? hostname : parts.slice(-2).join('.');
      const result = this._engine.getCosmeticsFilters({
        url: `https://${hostname}/`,
        hostname,
        domain,
        getBaseRules: true,
        getInjectionRules: true,
        getExtendedRules: true,
        getRulesFromDOM: opts.getRulesFromDOM || false,
        getRulesFromHostname: true,
        classes: opts.classes,
        ids: opts.ids,
        hrefs: opts.hrefs,
      });
      return {
        ...result,
        procedural: normalizeProceduralCosmetics(result.extended),
      };
    } catch (e) {
      console.warn('[ghostery-engine] getFullCosmetics error:', e);
      return { styles: '', scripts: [], extended: [], procedural: [] };
    }
  }

  // ── Scriptlet rules ──────────────────────────────────────────────────────

  /**
   * Get scriptlet rules for a hostname.
   *
   * NOTE: Ghostery engine returns compiled scriptlet code via getCosmeticsFilters.scripts.
   * Midori injects those via getFullCosmetics() / getCompiledScriptlets().
   *
   * @param {string} hostname
   * @returns {Array<{name: string, args: string[]}>}
   */
  getScriptletRules(hostname) {
    // Ghostery handles scriptlets internally via getCosmeticsFilters().scripts.
    // We return an empty rule list here and use compiled scripts from getFullCosmetics().
    return [];
  }

  /**
   * Get pre-compiled scriptlet code from Ghostery engine.
   * @param {string} hostname
   * @returns {string[]} Array of JS code strings ready to inject
   */
  getCompiledScriptlets(hostname) {
    if (!this._engine || !hostname) return [];

    try {
      const result = this.getFullCosmetics(hostname, {});
      return result.scripts || [];
    } catch (e) {
      console.warn('[ghostery-engine] getCompiledScriptlets error:', e);
      return [];
    }
  }

  // ── CSP injection ────────────────────────────────────────────────────────

  /**
   * Get Content Security Policy directives to inject for a main_frame request.
   * @param {string} url
   * @param {string} pageHostname
   * @returns {string|undefined}
   */
  getCSPDirectives(url, pageHostname) {
    if (!this._engine) return undefined;

    const request = Request.fromRawDetails({
      url,
      sourceUrl: pageHostname ? `https://${pageHostname}/` : '',
      type: 'main_frame',
    });

    return this._engine.getCSPDirectives(request);
  }

  // ── $removeparam support ─────────────────────────────────────────────────

  /**
   * Check if URL parameters should be removed.
   * @param {string} url
   * @param {string} pageHostname
   * @param {string} [resourceType]
   * @returns {{ url: string, modified: boolean }}
   */
  removeParams(url, pageHostname, resourceType) {
    if (!this._engine) return { url, modified: false };

    const request = Request.fromRawDetails({
      url,
      sourceUrl: pageHostname ? `https://${pageHostname}/` : '',
      type: resourceType || 'main_frame',
    });

    const result = this._engine.match(request);
    if (result.rewrite && result.rewrite.url) {
      return { url: result.rewrite.url, modified: true };
    }

    return { url, modified: false };
  }

  // ── Serialization ────────────────────────────────────────────────────────

  /**
   * Serialize engine to Uint8Array.
   * @returns {Uint8Array|null}
   */
  serialize() {
    if (!this._engine) return null;
    return this._engine.serialize();
  }

  /**
   * Deserialize engine from Uint8Array.
   * @param {Uint8Array} data
   */
  deserialize(data) {
    this._engine = FiltersEngine.deserialize(data);
    this._updateStats();
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  _updateStats() {
    if (!this._engine) {
      this.rulesCount = 0;
      return;
    }
    const { networkFilters, cosmeticFilters } = this._engine.getFilters();
    this.rulesCount = networkFilters.length + cosmeticFilters.length;
  }
}

// Re-export commonly used URL helpers for convenience.
export { extractDomain, categorizeRequest };

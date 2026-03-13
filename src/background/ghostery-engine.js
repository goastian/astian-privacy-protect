/**
 * Midori Privacy Blocker
 * Ghostery Engine Adapter — wraps @ghostery/adblocker to expose
 * the same interface as the legacy FilterEngine.
 * Provides ~10x faster matching via reverse index + bloom filters,
 * and supports $csp=, $redirect=, $removeparam, procedural cosmetics.
 *
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 *
 * This file uses @ghostery/adblocker which is licensed under MPL-2.0
 * Copyright (c) 2017-present Ghostery GmbH.
 */

import { FiltersEngine, Request, parseFilters, Resources } from '@ghostery/adblocker';
import { extractDomain, categorizeRequest } from './filter-engine.js';

// ── IndexedDB helpers for engine serialization ──────────────────────────────

const IDB_NAME = 'midori-privacy';
const IDB_STORE = 'engine-cache';
const IDB_KEY = 'ghostery-engine-v1';

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

// ── GhosteryEngine adapter ──────────────────────────────────────────────────

export class GhosteryEngine {
  constructor() {
    /** @type {FiltersEngine|null} */
    this._engine = null;
    this.rulesCount = 0;
    this._listsLoaded = new Set();

    // Legacy compat — expose empty sets so index.js diagnostics don't crash
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
   * Load raw filter list texts into the engine.
   * @param {Object<string, string>} lists - Map of listId → raw text
   */
  loadLists(lists) {
    const allFilters = [];
    for (const [id, text] of Object.entries(lists)) {
      allFilters.push(text);
      this._listsLoaded.add(id);
    }

    const combinedText = allFilters.join('\n');
    this._engine = FiltersEngine.parse(combinedText, {
      enableCompression: false,
      enableOptimizations: true,
      loadCosmeticFilters: true,
      loadNetworkFilters: true,
    });

    this._updateStats();
    console.log(`[ghostery-engine] Loaded ${Object.keys(lists).length} lists, ${this.rulesCount} rules`);
  }

  /**
   * Add a single list text (for user custom filters).
   * @param {string} text - Raw filter text
   */
  addList(text) {
    if (!this._engine) {
      this._engine = FiltersEngine.parse(text, {
        enableCompression: false,
        enableOptimizations: true,
        loadCosmeticFilters: true,
        loadNetworkFilters: true,
      });
    } else {
      const { networkFilters, cosmeticFilters } = parseFilters(text);
      this._engine.update({
        newNetworkFilters: networkFilters,
        newCosmeticFilters: cosmeticFilters,
      });
    }
    this._updateStats();
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
   * Compatible with legacy FilterEngine.shouldBlock() signature.
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

    const request = Request.fromRawDetails({
      url,
      sourceUrl: pageHostname ? `https://${pageHostname}/` : '',
      type: resourceType || 'other',
    });

    return this._engine.match(request);
  }

  // ── Cosmetic selectors ───────────────────────────────────────────────────

  /**
   * Get CSS selectors to hide ad elements on a hostname.
   * Compatible with legacy FilterEngine.getCosmeticSelectors().
   * @param {string} hostname
   * @returns {string[]}
   */
  getCosmeticSelectors(hostname) {
    if (!this._engine || !hostname) return [];

    try {
      const domain = this._getDomain(hostname);
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
      const domain = this._getDomain(hostname);
      return this._engine.getCosmeticsFilters({
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
    } catch (e) {
      console.warn('[ghostery-engine] getFullCosmetics error:', e);
      return { styles: '', scripts: [], extended: [] };
    }
  }

  // ── Scriptlet rules ──────────────────────────────────────────────────────

  /**
   * Get scriptlet rules for a hostname.
   * Compatible with legacy FilterEngine.getScriptletRules().
   *
   * NOTE: Ghostery engine returns compiled scriptlet code via getCosmeticsFilters.scripts.
   * For our custom scriptlet system, we return the Ghostery scripts as pre-compiled code,
   * plus our legacy scriptlet rules are handled separately in index.js.
   *
   * @param {string} hostname
   * @returns {Array<{name: string, args: string[]}>}
   */
  getScriptletRules(hostname) {
    // Ghostery handles scriptlets internally via getCosmeticsFilters().scripts
    // We return empty here; the scriptlets from Ghostery will be injected
    // via getFullCosmetics().scripts in the integration layer.
    // Legacy custom scriptlets (YouTube, etc.) are still handled by the old system.
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

  _getDomain(hostname) {
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join('.');
  }
}

// Re-export utilities from the legacy engine for backward compatibility
export { extractDomain, categorizeRequest };

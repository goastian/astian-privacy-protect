/**
 * Midori Privacy Blocker
 * TrackerDB — Ingestion, versioned local storage, continuous updates, and lookup
 * Phase 1 (2.1 – 2.3): Data layer for TrackerDB
 *
 * Supports three feed formats:
 *   - DuckDuckGo TDS  (trackers keyed by domain)
 *   - WhoTracks.me / Ghostery (trackers keyed by slug, with domains[] array)
 *   - DuckDuckGo Tracker Radar generated data:
 *       domain_summary.json + domain_map.json
 *
 * Storage model (IndexedDB "midori-trackerdb"):
 *   snapshot-current → latest verified snapshot
 *   snapshot-prev    → previous snapshot for one-level rollback
 *
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

import { storageLocal } from './storage.js';

// ── Feed URLs ────────────────────────────────────────────────────────────────
export const TRACKERDB_URL_PRIMARY =
  'https://raw.githubusercontent.com/duckduckgo/tracker-radar/main/build-data/generated/domain_summary.json';
export const TRACKERDB_URL_FALLBACK =
  'https://raw.githubusercontent.com/duckduckgo/tracker-radar/main/build-data/generated/domain_map.json';

// Alternative CDN mirrors when GitHub raw fails
export const TRACKERDB_URL_PRIMARY_ALT =
  'https://cdn.jsdelivr.net/gh/duckduckgo/tracker-radar@main/build-data/generated/domain_summary.json';
export const TRACKERDB_URL_FALLBACK_ALT =
  'https://cdn.jsdelivr.net/gh/duckduckgo/tracker-radar@main/build-data/generated/domain_map.json';

// ── Fetch robustness constants ───────────────────────────────────────────────
const FETCH_TIMEOUT_MS = 30000;
const RETRY_DELAYS = [5000, 15000, 30000];

// ── Confidence thresholds ────────────────────────────────────────────────────
/** Prevalence ≥ 5 % → high confidence (eligible for assisted blocking) */
export const HIGH_CONFIDENCE_THRESHOLD = 0.05;
/** Prevalence ≥ 1 % → medium confidence */
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.01;

// ── IDB constants ────────────────────────────────────────────────────────────
const IDB_NAME = 'midori-trackerdb';
const IDB_VERSION = 1;
const IDB_STORE = 'snapshots';
const SNAPSHOT_CURRENT = 'snapshot-current';
const SNAPSHOT_PREV = 'snapshot-prev';
const META_KEY = 'trackerdb_meta';

// ── LRU Cache for Entity Lookups (Performance Optimization Phase 8) ──────────
/**
 * Lightweight LRU cache for domain→owner lookups to avoid repeated traversals.
 * Capacity: 5000 entries, evicts oldest on overflow.
 * Hot path: ~O(1) average lookups, ~10x faster than repeated domain index lookups.
 */
class LRUCache {
  constructor(capacity = 5000) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict oldest (first entry)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

const entityLookupCache = new LRUCache(5000);

// ── Category map ─────────────────────────────────────────────────────────────
// Normalize raw category string → Midori internal category.
// Keys are lowercase with spaces/hyphens/slashes replaced by underscores.
const CAT_MAP = {
  // Advertising
  'advertising': 'ads',
  'ad_motivated_tracking': 'ads',
  'ad_tech': 'ads',
  'native_advertising': 'ads',
  // Tracking / Analytics
  'analytics': 'trackers',
  'audience_measurement': 'trackers',
  'social_network': 'trackers',
  'social_comment': 'trackers',
  'social_share': 'trackers',
  'social_media': 'trackers',
  'social': 'trackers',
  'federated_login': 'trackers',
  'fingerprinting': 'trackers',
  'tracking_pixel': 'trackers',
  'session_replay': 'trackers',
  'heat_mapping': 'trackers',
  'tag_manager': 'trackers',
  'a_b_testing': 'trackers',
  'tracking': 'trackers',
  // Non-tracking / Essential
  'embedded_content': 'other',
  'cdn': 'other',
  'non_tracking': 'other',
  'content_delivery': 'other',
  'customer_interaction': 'other',
  'essential': 'other',
  'content': 'other',
  'misc': 'other',
  'audio_video_player': 'other',
  'comments': 'other',
  'extensions': 'other',
  'unknown': 'other',
};

/**
 * Map a raw category string (any case/format) to a Midori category.
 * @param {string} rawCategory
 * @returns {'ads'|'trackers'|'other'}
 */
function mapCategory(rawCategory) {
  if (!rawCategory) return 'other';
  const normalized = String(rawCategory).toLowerCase().trim().replace(/[\s\-\/]+/g, '_');
  return CAT_MAP[normalized] || 'other';
}

const AD_HINT_PATTERNS = [
  'ad', 'ads', 'adservice', 'adserver', 'adnxs', 'doubleclick', 'googlesyndication',
  'advert', 'banner', 'prebid', 'criteo', 'rubicon', 'pubmatic', 'taboola', 'outbrain',
  'openx', 'sharethrough', 'revcontent', 'mgid', 'yield', 'moat',
];

function inferRadarCategory(domain, summary) {
  const hostname = String(domain || '').toLowerCase();
  const prevalence = Number(summary?.prevalence) || 0;
  const cookiePrevalence = Number(summary?.cookies) || 0;
  const fingerprintScore = Number(summary?.fp) || 0;

  if (fingerprintScore >= 20 || cookiePrevalence >= 0.02 || prevalence >= MEDIUM_CONFIDENCE_THRESHOLD) {
    for (const pattern of AD_HINT_PATTERNS) {
      if (hostname.includes(pattern)) return 'ads';
    }
    return 'trackers';
  }

  return 'other';
}

function inferRadarRawCategory(domain, summary) {
  const fingerprintScore = Number(summary?.fp) || 0;
  const cookiePrevalence = Number(summary?.cookies) || 0;
  const inferred = inferRadarCategory(domain, summary);
  if (fingerprintScore >= 50) return 'fingerprinting';
  if (cookiePrevalence >= 0.02 && inferred === 'trackers') return 'analytics';
  if (inferred === 'ads') return 'advertising';
  if (inferred === 'trackers') return 'tracking';
  return 'unknown';
}

function buildRadarSuggestedRules(domain, summary) {
  const rules = [`||${domain}^`];
  if ((Number(summary?.fp) || 0) >= 50) {
    rules.push(`||${domain}^$script,third-party`);
  }
  if ((Number(summary?.cookies) || 0) >= 0.02) {
    rules.push(`||${domain}^$xmlhttprequest,third-party`);
  }
  return rules.slice(0, 5);
}

// ── IndexedDB helpers ────────────────────────────────────────────────────────
let _idb = null;

function openIDB() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      _idb = req.result;
      resolve(_idb);
    };
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
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[trackerdb] IDB read failed:', e.message);
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
    console.warn('[trackerdb] IDB write failed:', e.message);
  }
}

// ── Checksum (FNV-1a 32-bit) ─────────────────────────────────────────────────
/**
 * Compute a lightweight FNV-1a 32-bit checksum for integrity verification.
 * Used on version string + domain count to detect corruption.
 * @param {string} str
 * @returns {string} 8-char hex digest
 */
function computeChecksum(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function snapshotChecksum(snapshot) {
  // Checksum covers: version + domain count + first 20 domain keys
  const keys = Object.keys(snapshot.domains || {}).slice(0, 20).join(',');
  return computeChecksum(`${snapshot.version}|${snapshot.size}|${keys}`);
}

// ── Normalization pipeline ────────────────────────────────────────────────────

/**
 * Normalize a raw TrackerDB JSON payload into a uniform internal structure.
 *
 * Supports two shapes:
 *   Shape A — DuckDuckGo TDS (domain-keyed trackers):
 *     { trackers: { "domain.com": { owner, prevalence, categories, rules } }, entities: {...} }
 *   Shape B — WhoTracks.me / Ghostery (slug-keyed with domains array):
 *     { trackers: { "google_analytics": { name, domains[], category, prevalence } }, entities: {...} }
 *
 * Output: { domains: Map<string, NormalizedEntry>, entities: Map<string, EntityEntry>, sourceVersion: string }
 *
 * @param {object} raw - parsed JSON
 * @returns {{ domains: Map, entities: Map, sourceVersion: string }}
 */
export function normalizeTrackerDb(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid TrackerDB payload: expected object');
  }

  const domains = new Map();
  const entities = new Map();
  const version = raw.version || raw.generatedAt || raw.sourceVersion || String(Date.now());

  // ── Shape C: DuckDuckGo Tracker Radar generated data ──
  if (raw.domainSummary && typeof raw.domainSummary === 'object') {
    const domainMap = raw.domainMap || {};

    for (const [domain, summary] of Object.entries(raw.domainSummary)) {
      const ownerInfo = domainMap[domain] || {};
      const ownerId = ownerInfo.entityName || ownerInfo.displayName || domain;
      const ownerDisplay = ownerInfo.displayName || ownerInfo.entityName || domain;
      const rawCategory = inferRadarRawCategory(domain, summary);

      if (!entities.has(ownerId)) {
        entities.set(ownerId, {
          name: ownerDisplay,
          domains: [domain],
          prevalence: Number(summary?.prevalence) || 0,
        });
      } else {
        const entity = entities.get(ownerId);
        if (!entity.domains.includes(domain)) entity.domains.push(domain);
        entity.prevalence = Math.max(entity.prevalence || 0, Number(summary?.prevalence) || 0);
      }

      domains.set(domain, {
        name: domain,
        owner: ownerDisplay,
        ownerId,
        category: rawCategory,
        midoriCat: inferRadarCategory(domain, summary),
        confidence: Number(summary?.prevalence) || 0,
        suggestedRules: buildRadarSuggestedRules(domain, summary),
        fingerprintScore: Number(summary?.fp) || 0,
        cookiePrevalence: Number(summary?.cookies) || 0,
      });
    }

    return { domains, entities, sourceVersion: version };
  }

  if (!raw.trackers || typeof raw.trackers !== 'object') {
    throw new Error('Invalid TrackerDB payload: missing trackers field');
  }

  const firstEntry = Object.values(raw.trackers)[0] || {};

  // ── Shape A: DuckDuckGo TDS (each key IS the domain) ──
  if (firstEntry.domain !== undefined || firstEntry.owner !== undefined) {
    // Build entity map (keyed by owner name in DDG format)
    for (const [ownerName, entity] of Object.entries(raw.entities || {})) {
      entities.set(ownerName, {
        name: entity.displayName || ownerName,
        domains: Array.isArray(entity.domains) ? entity.domains : [],
        prevalence: Number(entity.prevalence) || 0,
      });
    }

    for (const [domain, tracker] of Object.entries(raw.trackers)) {
      const rawCats = Array.isArray(tracker.categories) ? tracker.categories : [];
      const rawCat = rawCats[0] || '';
      const ownerId = tracker.owner?.name || '';
      const ownerDisplay = tracker.owner?.displayName || tracker.owner?.name || ownerId;
      const confidence = Number(tracker.prevalence) || 0;

      // Extract up to 5 rule patterns
      const suggestedRules = [];
      for (const rule of (tracker.rules || []).slice(0, 5)) {
        const pattern = typeof rule === 'string' ? rule : (rule.rule || '');
        if (pattern) suggestedRules.push(pattern);
      }

      domains.set(domain, {
        name: tracker.domain || domain,
        owner: ownerDisplay,
        ownerId,
        category: rawCat,
        midoriCat: mapCategory(rawCat),
        confidence,
        suggestedRules,
      });
    }

    return { domains, entities, sourceVersion: version };
  }

  // ── Shape B: WhoTracks.me / Ghostery (slug has domains[] inside) ──
  for (const [ownerId, entity] of Object.entries(raw.entities || {})) {
    entities.set(ownerId, {
      name: entity.name || ownerId,
      domains: entity.domains || entity.properties || [],
      prevalence: Number(entity.prevalence) || 0,
    });
  }

  for (const [, tracker] of Object.entries(raw.trackers)) {
    const rawCat = tracker.category || tracker.categoryId || '';
    const ownerId = tracker.owner?.key || tracker.ownerId || '';
    const ownerDisplay = tracker.owner?.name || entities.get(ownerId)?.name || ownerId;
    const confidence = Number(tracker.prevalence || tracker.confidence) || 0;
    const suggestedRules = (Array.isArray(tracker.rules) ? tracker.rules : [])
      .slice(0, 5)
      .map(r => (typeof r === 'string' ? r : r.rule || ''))
      .filter(Boolean);

    for (const domain of (tracker.domains || [])) {
      if (!domain || domains.has(domain)) continue;
      domains.set(domain, {
        name: tracker.name || domain,
        owner: ownerDisplay,
        ownerId,
        category: rawCat,
        midoriCat: mapCategory(rawCat),
        confidence,
        suggestedRules,
      });
    }
  }

  return { domains, entities, sourceVersion: version };
}

// ── In-memory runtime index ──────────────────────────────────────────────────
/** @type {Map<string, object> | null} */
let _domainIndex = null;
/** @type {Map<string, object> | null} */
let _entityIndex = null;
let _indexVersion = null;
let _indexSize = 0;

function buildRuntimeIndex(normalized) {
  _domainIndex = normalized.domains;
  _entityIndex = normalized.entities;
  _indexVersion = normalized.sourceVersion;
  _indexSize = _domainIndex.size;
  // Clear LRU cache on rebuild (ensures consistency with new data)
  clearEntityLookupCache();
  console.log(`[trackerdb] Index ready: ${_indexSize} domains, ${_entityIndex.size} entities, v${_indexVersion}`);
}

// ── Snapshot serialization ───────────────────────────────────────────────────

function serializeSnapshot(normalized, etag) {
  const domainsObj = Object.fromEntries(normalized.domains);
  const entitiesObj = Object.fromEntries(normalized.entities);
  const base = {
    version: normalized.sourceVersion,
    etag: etag || '',
    savedAt: Date.now(),
    size: normalized.domains.size,
    domains: domainsObj,
    entities: entitiesObj,
  };
  base.checksum = snapshotChecksum(base);
  return base;
}

function deserializeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.domains !== 'object') return null;
  const domains = new Map(Object.entries(snapshot.domains));
  const entities = new Map(Object.entries(snapshot.entities || {}));
  return { domains, entities, sourceVersion: snapshot.version };
}

function verifySnapshotChecksum(snapshot) {
  if (!snapshot?.checksum) return true; // Skip if no checksum (legacy compat)
  return snapshotChecksum(snapshot) === snapshot.checksum;
}

// ── Snapshot rotation ────────────────────────────────────────────────────────
/** Rotate snapshots: current → prev, new data → current. Enables rollback. */
async function rotateSnapshots(serialized) {
  const current = await idbGet(SNAPSHOT_CURRENT);
  if (current) {
    await idbSet(SNAPSHOT_PREV, current);
  }
  await idbSet(SNAPSHOT_CURRENT, serialized);
}

// ── Public lookup API ────────────────────────────────────────────────────────

/**
 * Look up a domain in the live TrackerDB index.
 * Automatically falls back to parent-domain lookup for subdomains.
 *
 * @param {string} domain
 * @returns {object|null} normalized entry or null if not found
 */
export function lookupDomain(domain) {
  if (!_domainIndex || !domain) return null;
  const d = domain.toLowerCase();
  if (_domainIndex.has(d)) return _domainIndex.get(d);
  // Subdomain fallback
  const parts = d.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (_domainIndex.has(parent)) return _domainIndex.get(parent);
  }
  return null;
}

/**
 * Look up an entity by owner ID.
 * @param {string} ownerId
 * @returns {object|null}
 */
export function lookupEntity(ownerId) {
  if (!_entityIndex || !ownerId) return null;
  return _entityIndex.get(ownerId) || null;
}

/**
 * Get the Midori category for a domain from TrackerDB.
 * Returns null if the domain is not in the database (caller should fall back).
 *
 * @param {string} domain
 * @returns {'ads'|'trackers'|'other'|null}
 */
export function getTrackerCategory(domain) {
  const entry = lookupDomain(domain);
  return entry ? entry.midoriCat : null;
}

/**
 * Get the confidence score (prevalence) for a domain.
 * @param {string} domain
 * @returns {number} 0.0 – 1.0
 */
export function getTrackerConfidence(domain) {
  const entry = lookupDomain(domain);
  return entry ? entry.confidence : 0;
}

// Domains that must never be blocked by TrackerDB, regardless of classification.
// These deliver essential web content (CDN, video, first-party infra).
const NEVER_BLOCK_DOMAINS = new Set([
  'youtube.com', 'youtu.be', 'ytimg.com', 'googlevideo.com', 'yt3.ggpht.com',
  'ggpht.com', 'gstatic.com', 'googleapis.com', 'google.com', 'googleusercontent.com',
  'cloudflare.com', 'fastly.net', 'akamai.net', 'akamaized.net', 'akamaihd.net',
  'cloudfront.net', 'amazonaws.com', 'github.com', 'github.io',
  'twitter.com', 'x.com', 'twimg.com',
  'facebook.com', 'fbcdn.net', 'instagram.com', 'cdninstagram.com',
  'reddit.com', 'redditmedia.com', 'redd.it',
  'wikipedia.org', 'wikimedia.org',
]);

function isNeverBlockDomain(domain) {
  const d = (domain || '').toLowerCase();
  for (const safe of NEVER_BLOCK_DOMAINS) {
    if (d === safe || d.endsWith('.' + safe)) return true;
  }
  return false;
}

/**
 * Returns true if the domain is a high-confidence ad/tracker
 * and eligible for assisted blocking.
 *
 * High-confidence criterion: prevalence ≥ HIGH_CONFIDENCE_THRESHOLD
 * and the category is 'ads' or 'trackers'.
 *
 * @param {string} domain
 * @returns {boolean}
 */
export function isHighConfidenceTracker(domain) {
  if (!domain || isNeverBlockDomain(domain)) return false;
  const entry = lookupDomain(domain);
  if (!entry) return false;
  return (
    entry.confidence >= HIGH_CONFIDENCE_THRESHOLD &&
    (entry.midoriCat === 'ads' || entry.midoriCat === 'trackers')
  );
}

/**
 * Returns true if the domain is classified as a fingerprinter in TrackerDB.
 * @param {string} domain
 * @returns {boolean}
 */
export function isTrackerFingerprinter(domain) {
  const entry = lookupDomain(domain);
  if (!entry) return false;
  return String(entry.category).toLowerCase().includes('fingerprint');
}

// ── Phase 8: Entity Enrichment API (Tracker-Radar Metadata) ──────────────────
/**
 * Get the owner/entity name for a domain (with LRU caching for performance).
 * Falls back to domain itself if not found in trackerdb.
 * 
 * Hot path: ~O(1) due to LRU cache, ~10x faster than uncached lookups.
 * 
 * @param {string} domain
 * @returns {string} entity display name or domain as fallback
 */
export function getTrackerOwner(domain) {
  if (!domain) return '';
  const d = domain.toLowerCase();

  // Check LRU cache first (hot path optimization)
  const cached = entityLookupCache.get(d);
  if (cached !== undefined) return cached;

  // Lookup in trackerdb
  const entry = lookupDomain(d);
  const owner = entry ? entry.owner : d;

  // Cache result for future lookups
  entityLookupCache.set(d, owner);
  return owner;
}

/**
 * Get the owner ID (unique key) for a domain.
 * Used for grouping multiple domains under one entity (e.g., all Google domains).
 * 
 * @param {string} domain
 * @returns {string} entity ID or domain as fallback
 */
export function getTrackerOwnerId(domain) {
  if (!domain) return '';
  const entry = lookupDomain(domain.toLowerCase());
  return entry ? entry.ownerId : domain;
}

/**
 * Enrich a domain with all available metadata from TrackerDB.
 * Returns a structured object suitable for popup display and analytics.
 * 
 * Includes: domain, owner, ownerId, category, confidence, fingerprint score, etc.
 * 
 * @param {string} domain
 * @returns {object} enriched tracker metadata or null if not found
 */
export function enrichTrackerWithOwner(domain) {
  if (!domain) return null;
  const entry = lookupDomain(domain.toLowerCase());
  if (!entry) return { domain, owner: domain, ownerId: domain, category: 'unknown', confidence: 0 };

  return {
    domain: entry.name || domain,
    owner: entry.owner || domain,
    ownerId: entry.ownerId || domain,
    category: entry.category || 'unknown',
    midoriCat: entry.midoriCat || 'other',
    confidence: entry.confidence || 0,
    fingerprintScore: entry.fingerprintScore || 0,
    cookiePrevalence: entry.cookiePrevalence || 0,
  };
}

/**
 * Get complete entity metadata (all domains under an owner).
 * Useful for showing entity profiles in the UI.
 * 
 * @param {string} ownerId
 * @returns {object} entity info with all associated domains
 */
export function getTrackerEntityMetadata(ownerId) {
  if (!_entityIndex || !ownerId) return null;
  const entity = _entityIndex.get(ownerId);
  return entity || null;
}

/**
 * Clear the entity lookup cache (call on major index rebuild).
 * Normally called automatically by buildRuntimeIndex.
 */
export function clearEntityLookupCache() {
  entityLookupCache.clear();
}

/**
 * Returns true if the TrackerDB index is loaded and has data.
 */
export function isTrackerDbReady() {
  return _domainIndex !== null && _domainIndex.size > 0;
}

/**
 * Returns summary metadata for the currently loaded database.
 */
export function getTrackerDbMeta() {
  return {
    ready: isTrackerDbReady(),
    version: _indexVersion,
    size: _indexSize,
  };
}

/**
 * Collect up to `limit` high-confidence tracker/ad domains from the live index.
 * Used by the Chromium dynamic DNR rules generator for assisted blocking.
 *
 * High-confidence: prevalence ≥ HIGH_CONFIDENCE_THRESHOLD and category is ads/trackers.
 *
 * @param {number} [limit=500]
 * @returns {string[]}
 */
export function collectHighConfidenceDomains(limit = 500) {
  if (!_domainIndex) return [];
  const results = [];
  for (const [domain, entry] of _domainIndex) {
    if (results.length >= limit) break;
    if (
      entry.confidence >= HIGH_CONFIDENCE_THRESHOLD &&
      (entry.midoriCat === 'ads' || entry.midoriCat === 'trackers')
    ) {
      results.push(domain);
    }
  }
  return results;
}

// ── Metadata persistence ─────────────────────────────────────────────────────
async function getStoredMeta() {
  const data = await storageLocal.get(META_KEY);
  return data[META_KEY] || {
    summaryEtag: '',
    mapEtag: '',
    fetchedAt: 0,
    version: '',
    size: 0,
  };
}

async function setStoredMeta(meta) {
  await storageLocal.set({ [META_KEY]: { ...meta, updatedAt: Date.now() } });
}

// ── Fetch pipeline ───────────────────────────────────────────────────────────

/**
 * Fetch with AbortController timeout
 */
function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch TrackerDB from a URL with timeout and retry with backoff.
 * Sends If-None-Match header if we have a cached ETag.
 * Returns { text, etag } on success, null on HTTP 304 (unchanged), throws on error.
 *
 * @param {string} url
 * @param {string} [currentEtag]
 * @returns {Promise<{text: string, etag: string} | null>}
 */
async function fetchTrackerDb(url, currentEtag) {
  const headers = { Accept: 'application/json' };
  if (currentEtag) {
    headers['If-None-Match'] = currentEtag;
  }

  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      const waitMs = RETRY_DELAYS[attempt - 1];
      console.log(`[trackerdb] Retry ${attempt}/${RETRY_DELAYS.length} for ${url} in ${waitMs / 1000}s`);
      await delay(waitMs);
    }

    try {
      const response = await fetchWithTimeout(url, { headers, cache: 'no-cache' });

      if (response.status === 304) return null; // Not modified

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }

      const text = await response.text();
      const etag = response.headers.get('ETag') || '';
      return { text, etag };
    } catch (e) {
      lastError = e;
      const isTimeout = e.name === 'AbortError';
      console.warn(`[trackerdb] Attempt ${attempt + 1} failed for ${url}: ${isTimeout ? 'timeout' : e.message}`);
    }
  }

  throw lastError || new Error(`Failed to fetch ${url} after ${RETRY_DELAYS.length + 1} attempts`);
}

async function fetchRadarPair(summaryUrl, mapUrl, meta) {
  let summaryResult;
  let mapResult;

  try {
    summaryResult = await fetchTrackerDb(summaryUrl, meta.summaryEtag);
  } catch (e) {
    throw new Error(`summary fetch failed: ${e.message}`);
  }

  try {
    mapResult = await fetchTrackerDb(mapUrl, meta.mapEtag);
  } catch (e) {
    throw new Error(`domain_map fetch failed: ${e.message}`);
  }

  if (summaryResult === null && mapResult === null) {
    return null;
  }

  if (summaryResult === null) {
    summaryResult = await fetchTrackerDb(summaryUrl, '');
  }

  if (mapResult === null) {
    mapResult = await fetchTrackerDb(mapUrl, '');
  }

  const summaryText = summaryResult?.text;
  const mapText = mapResult?.text;
  const summaryEtag = summaryResult?.etag || meta.summaryEtag || '';
  const mapEtag = mapResult?.etag || meta.mapEtag || '';

  return { summaryText, mapText, summaryEtag, mapEtag };
}

// ── Rollback ─────────────────────────────────────────────────────────────────

/**
 * Roll back to the previous snapshot.
 * Verifies checksum before applying to prevent loading corrupt data.
 *
 * @returns {Promise<boolean>} true if rollback succeeded
 */
export async function rollbackTrackerDb() {
  const prev = await idbGet(SNAPSHOT_PREV);
  if (!prev) {
    console.warn('[trackerdb] No previous snapshot available for rollback');
    return false;
  }

  if (!verifySnapshotChecksum(prev)) {
    console.error('[trackerdb] Previous snapshot checksum mismatch — rollback aborted');
    return false;
  }

  const normalized = deserializeSnapshot(prev);
  if (!normalized || normalized.domains.size === 0) {
    console.error('[trackerdb] Previous snapshot is empty — rollback aborted');
    return false;
  }

  buildRuntimeIndex(normalized);
  await idbSet(SNAPSHOT_CURRENT, prev);
  await storageLocal.remove(META_KEY);
  console.log(`[trackerdb] Rolled back to v${prev.version} (${prev.size} domains)`);
  return true;
}

// ── Main update function ─────────────────────────────────────────────────────

/**
 * Fetch and apply a TrackerDB update.
 *
 * Strategy:
 *   1. Try primary URL with If-None-Match (ETag).
 *   2. On failure, try fallback URL.
 *   3. On 304 (unchanged), return 'unchanged' — current index stays live.
 *   4. On any parse / validation failure, leave the running index intact.
 *   5. On success, rotate snapshots and rebuild the runtime index.
 *
 * @param {object} [opts]
 * @param {string} [opts.primaryUrl]
 * @param {string} [opts.fallbackUrl]
 * @returns {Promise<'updated'|'unchanged'|'failed'>}
 */
export async function fetchAndUpdateTrackerDb({ primaryUrl, fallbackUrl } = {}) {
  const meta = await getStoredMeta();
  const url1 = primaryUrl || TRACKERDB_URL_PRIMARY;
  const url2 = fallbackUrl || TRACKERDB_URL_FALLBACK;

  // ── Step 1: Fetch Tracker Radar pair (primary URLs) ──
  let fetchResult = null;
  try {
    fetchResult = await fetchRadarPair(url1, url2, meta);
  } catch (e) {
    console.warn(`[trackerdb] Primary feed failed (${e.message}). Trying alternative CDN...`);

    // ── Step 1b: Try alternative CDN URLs as fallback ──
    try {
      fetchResult = await fetchRadarPair(TRACKERDB_URL_PRIMARY_ALT, TRACKERDB_URL_FALLBACK_ALT, meta);
      console.log('[trackerdb] Alternative CDN fetch succeeded');
    } catch (e2) {
      console.error(`[trackerdb] Alternative CDN also failed (${e2.message}). Keeping current data.`);
      return 'failed';
    }
  }

  if (fetchResult === null) {
    console.log('[trackerdb] Not modified (ETag match) — no update needed');
    return 'unchanged';
  }

  const { summaryText, mapText, summaryEtag, mapEtag } = fetchResult;

  // ── Step 2: Parse ──
  let raw;
  try {
    let domainSummary;
    let domainMap;

    domainSummary = JSON.parse(summaryText);
    domainMap = JSON.parse(mapText);

    raw = {
      domainSummary,
      domainMap,
      sourceVersion: `${summaryEtag || 'summary'}:${mapEtag || 'map'}`,
    };
  } catch (e) {
    console.error('[trackerdb] JSON parse failed:', e.message);
    return 'failed';
  }

  // ── Step 3: Normalize ──
  let normalized;
  try {
    normalized = normalizeTrackerDb(raw);
  } catch (e) {
    console.error('[trackerdb] Normalization failed:', e.message);
    return 'failed';
  }

  if (normalized.domains.size === 0) {
    console.error('[trackerdb] Normalized data has 0 domains — discarding update');
    return 'failed';
  }

  // ── Step 4: Serialize and verify checksum ──
  const serialized = serializeSnapshot(normalized, `${summaryEtag}|${mapEtag}`);
  if (!verifySnapshotChecksum(serialized)) {
    // This should never happen; indicates a bug in serializeSnapshot
    console.error('[trackerdb] Checksum mismatch on freshly serialized snapshot — discarding');
    return 'failed';
  }

  // ── Step 5: Rotate snapshots ──
  await rotateSnapshots(serialized);

  // ── Step 6: Update runtime index ──
  buildRuntimeIndex(normalized);

  // ── Step 7: Persist metadata ──
  await setStoredMeta({
    summaryEtag,
    mapEtag,
    fetchedAt: Date.now(),
    version: normalized.sourceVersion,
    size: normalized.domains.size,
  });

  console.log(`[trackerdb] Updated: v${normalized.sourceVersion}, ${normalized.domains.size} domains`);
  return 'updated';
}

// ── Startup cache load ───────────────────────────────────────────────────────

/**
 * Load TrackerDB from the local IndexedDB cache (fast path at startup).
 * If the checksum fails, attempts rollback to the previous snapshot.
 *
 * @returns {Promise<boolean>} true if loaded successfully
 */
export async function loadTrackerDbFromCache() {
  const snapshot = await idbGet(SNAPSHOT_CURRENT);

  if (!snapshot) {
    console.log('[trackerdb] No cached snapshot found (primer arranque o caché vacía)');
    return false;
  }

  if (!verifySnapshotChecksum(snapshot)) {
    console.error('[trackerdb] Snapshot checksum mismatch — attempting rollback');
    return rollbackTrackerDb();
  }

  const normalized = deserializeSnapshot(snapshot);
  if (!normalized || normalized.domains.size === 0) {
    console.warn('[trackerdb] Cached snapshot is empty');
    return false;
  }

  buildRuntimeIndex(normalized);
  console.log(`[trackerdb] Loaded from cache: v${snapshot.version}, ${snapshot.size} domains`);
  return true;
}

// ── Alarm scheduling ─────────────────────────────────────────────────────────

export const TRACKERDB_ALARM_NAME = 'update-trackerdb';
const DEFAULT_INTERVAL_HOURS = 24;

/**
 * Schedule periodic TrackerDB updates via chrome.alarms.
 * The first check fires 5 minutes after the call; subsequent checks
 * use the configured interval (default: every 24 h).
 *
 * @param {number} [intervalHours] - Hours between updates (default 24)
 */
export function scheduleTrackerDbUpdates(intervalHours) {
  const hours = (intervalHours > 0) ? intervalHours : DEFAULT_INTERVAL_HOURS;
  chrome.alarms.create(TRACKERDB_ALARM_NAME, {
    delayInMinutes: 120,  // first check 2h after startup — avoids crashing SW on large feeds
    periodInMinutes: hours * 60,
  });
  console.log(`[trackerdb] Scheduled updates every ${hours}h`);
}

/**
 * Handle a chrome.alarms alarm for the TrackerDB update cycle.
 * Call this inside your alarms.onAlarm listener.
 *
 * @param {string} alarmName
 * @param {object} [opts] - forwarded to fetchAndUpdateTrackerDb
 * @returns {Promise<void>}
 */
export async function handleTrackerDbAlarm(alarmName, opts) {
  if (alarmName !== TRACKERDB_ALARM_NAME) return undefined;
  console.log('[trackerdb] Alarm fired — checking for updates');
  const result = await fetchAndUpdateTrackerDb(opts || {});
  console.log(`[trackerdb] Alarm update result: ${result}`);
  return result;
}

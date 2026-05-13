/**
 * Local host reputation.
 *
 * Stores compact, privacy-preserving counters only:
 *   - tracker domains
 *   - salted hashes of site registrable domains where they appeared
 *   - aggregate counters for critical first-party usage
 *   - aggregate URL-cleaner param removal counts by destination host
 *
 * No full URLs or raw browsing-history host lists are persisted.
 */

import { storageLocal } from './storage.js';

const STORAGE_KEY = 'localHostReputation';
const URL_CLEANER_STORAGE_KEY = 'urlCleanerParamCounters';
const MAX_DOMAINS = 300;
const MAX_SITE_HASHES_PER_DOMAIN = 24;
const FLUSH_DELAY_MS = 5000;

let reputation = { version: 1, salt: '', domains: {}, updatedAt: 0 };
let cleanerCounters = { version: 1, byHost: {}, updatedAt: 0 };
let reputationDirty = false;
let cleanerDirty = false;
let flushTimer = null;

function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^\.+|\.+$/g, '');
}

function registryDomain(hostname) {
  const host = normalizeHost(hostname);
  if (!host) return '';
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  return parts.slice(-2).join('.');
}

function makeSalt() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function hashSite(input) {
  const source = `${reputation.salt || ''}:${registryDomain(input)}`;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isTrackingTaxonomy(taxonomy) {
  return taxonomy === 'fingerprinting' ||
    taxonomy === 'session-replay' ||
    taxonomy === 'tag-manager' ||
    taxonomy === 'social-pixel' ||
    taxonomy === 'redirect-tracker' ||
    taxonomy === 'generic';
}

function getDomainEntry(domain) {
  const key = normalizeHost(domain);
  if (!key) return null;
  if (!reputation.domains[key]) {
    reputation.domains[key] = {
      trackerSiteHashes: [],
      trackerObservations: 0,
      firstPartyFunctional: 0,
      lastSeenAt: 0,
    };
  }
  return reputation.domains[key];
}

function trimReputation() {
  const entries = Object.entries(reputation.domains || {});
  if (entries.length <= MAX_DOMAINS) return;
  entries.sort((a, b) => Number(a[1].lastSeenAt || 0) - Number(b[1].lastSeenAt || 0));
  for (const [domain] of entries.slice(0, entries.length - MAX_DOMAINS)) {
    delete reputation.domains[domain];
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushLocalReputation().catch((e) =>
      console.warn('[midori] Local reputation flush failed:', e)
    );
  }, FLUSH_DELAY_MS);
}

export async function loadLocalReputation() {
  try {
    const data = await storageLocal.get([STORAGE_KEY, URL_CLEANER_STORAGE_KEY]);
    const stored = data?.[STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      reputation = {
        version: 1,
        salt: stored.salt || makeSalt(),
        domains: stored.domains && typeof stored.domains === 'object' ? stored.domains : {},
        updatedAt: Number(stored.updatedAt || 0),
      };
    } else {
      reputation = { version: 1, salt: makeSalt(), domains: {}, updatedAt: 0 };
      reputationDirty = true;
    }

    const storedCleaner = data?.[URL_CLEANER_STORAGE_KEY];
    if (storedCleaner && typeof storedCleaner === 'object') {
      cleanerCounters = {
        version: 1,
        byHost: storedCleaner.byHost && typeof storedCleaner.byHost === 'object' ? storedCleaner.byHost : {},
        updatedAt: Number(storedCleaner.updatedAt || 0),
      };
    }
    if (reputationDirty) scheduleFlush();
  } catch (e) {
    console.warn('[midori] Local reputation load failed:', e);
  }
}

export async function flushLocalReputation() {
  const updates = {};
  if (reputationDirty) {
    reputationDirty = false;
    reputation.updatedAt = Date.now();
    trimReputation();
    updates[STORAGE_KEY] = reputation;
  }
  if (cleanerDirty) {
    cleanerDirty = false;
    cleanerCounters.updatedAt = Date.now();
    updates[URL_CLEANER_STORAGE_KEY] = cleanerCounters;
  }
  if (Object.keys(updates).length > 0) {
    await storageLocal.set(updates);
  }
}

export function getLocalTrackerReputation(domain) {
  const entry = reputation.domains?.[normalizeHost(domain)];
  const distinctTrackerSites = Array.isArray(entry?.trackerSiteHashes)
    ? entry.trackerSiteHashes.length
    : 0;
  const firstPartyFunctional = Number(entry?.firstPartyFunctional || 0);

  const confidenceBoost = distinctTrackerSites >= 8 ? 0.12
    : distinctTrackerSites >= 5 ? 0.08
    : distinctTrackerSites >= 3 ? 0.04
    : 0;
  const aggressionMultiplier = firstPartyFunctional >= 3 ? 0.65
    : firstPartyFunctional >= 1 ? 0.8
    : 1;

  return {
    distinctTrackerSites,
    firstPartyFunctional,
    confidenceBoost,
    aggressionMultiplier,
  };
}

export function recordTrackerObservation({
  requestDomain,
  pageHostname,
  isThirdParty,
  trackerCategory,
  taxonomy,
  wasBlocked,
  resourceType,
  isCriticalSite,
}) {
  const domain = normalizeHost(requestDomain);
  const page = normalizeHost(pageHostname);
  if (!domain || !page) return;

  const trackerLike = trackerCategory === 'ads' ||
    trackerCategory === 'trackers' ||
    isTrackingTaxonomy(taxonomy);
  const firstPartyFunctional = !isThirdParty &&
    !wasBlocked &&
    trackerLike &&
    (resourceType === 'script' || resourceType === 'xmlhttprequest') &&
    isCriticalSite === true;

  if (!(isThirdParty && trackerLike) && !firstPartyFunctional) return;

  const entry = getDomainEntry(domain);
  if (!entry) return;

  const now = Date.now();

  if (isThirdParty && trackerLike) {
    const siteHash = hashSite(page);
    if (!entry.trackerSiteHashes.includes(siteHash)) {
      entry.trackerSiteHashes.push(siteHash);
      if (entry.trackerSiteHashes.length > MAX_SITE_HASHES_PER_DOMAIN) {
        entry.trackerSiteHashes.shift();
      }
    }
    entry.trackerObservations = Math.min(9999, Number(entry.trackerObservations || 0) + 1);
  }

  if (firstPartyFunctional) {
    entry.firstPartyFunctional = Math.min(99, Number(entry.firstPartyFunctional || 0) + 1);
  }

  entry.lastSeenAt = now;
  reputationDirty = true;
  scheduleFlush();
}

export function recordUrlCleanerRemoval(hostname, removedParams = []) {
  const host = registryDomain(hostname);
  if (!host || !Array.isArray(removedParams) || removedParams.length === 0) return;

  const byHost = cleanerCounters.byHost || (cleanerCounters.byHost = {});
  const entry = byHost[host] || { totalRemoved: 0, params: {}, updatedAt: 0 };
  for (const param of removedParams) {
    const key = String(param || '').slice(0, 80);
    if (!key) continue;
    entry.params[key] = Math.min(9999, Number(entry.params[key] || 0) + 1);
    entry.totalRemoved = Math.min(999999, Number(entry.totalRemoved || 0) + 1);
  }
  entry.updatedAt = Date.now();
  byHost[host] = entry;

  const entries = Object.entries(byHost);
  if (entries.length > 200) {
    entries
      .sort((a, b) => Number(a[1].updatedAt || 0) - Number(b[1].updatedAt || 0))
      .slice(0, entries.length - 200)
      .forEach(([oldHost]) => { delete byHost[oldHost]; });
  }

  cleanerDirty = true;
  scheduleFlush();
}

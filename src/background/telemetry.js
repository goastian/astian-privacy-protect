import { setOptions } from './storage.js';

const TELEMETRY_FLUSH_INTERVAL = 15000;

function createMetricBucket() {
  return { count: 0, avg: 0, min: 0, max: 0, last: 0 };
}

function pushUniqueSamples(target, incoming, maxItems) {
  if (!Array.isArray(target) || !Array.isArray(incoming)) return;
  const seen = new Set(target);
  for (const raw of incoming) {
    const value = String(raw || '').trim().slice(0, 120);
    if (!value || seen.has(value)) continue;
    target.push(value);
    seen.add(value);
    if (target.length >= maxItems) break;
  }
}

function updateMetricBucket(bucket, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return;

  bucket.count = (bucket.count || 0) + 1;
  bucket.last = numeric;
  bucket.avg = bucket.count === 1 ? numeric : ((bucket.avg || 0) * (bucket.count - 1) + numeric) / bucket.count;
  bucket.min = bucket.count === 1 ? numeric : Math.min(bucket.min, numeric);
  bucket.max = bucket.count === 1 ? numeric : Math.max(bucket.max, numeric);
}

export function normalizeTelemetry(raw) {
  const t = raw || {};
  const contentScriptCostMs = t.contentScriptCostMs || {};
  const falsePositiveReports = t.falsePositiveReports || {};
  const iaShield = t.iaShield || {};
  const appliedRulesDiagnostics = t.appliedRulesDiagnostics || {};
  return {
    enabled: t.enabled !== false,
    version: 1,
    updatedAt: t.updatedAt || 0,
    startupLatencyMs: { ...createMetricBucket(), ...(t.startupLatencyMs || {}) },
    matchingLatencyMs: { ...createMetricBucket(), ...(t.matchingLatencyMs || {}) },
    contentScriptCostMs: {
      cosmetic: { ...createMetricBucket(), ...(contentScriptCostMs.cosmetic || {}) },
      scriptlets: { ...createMetricBucket(), ...(contentScriptCostMs.scriptlets || {}) },
      perPage: { ...(contentScriptCostMs.perPage || {}) },
    },
    blockedByCategory: {
      total: 0,
      ads: 0,
      trackers: 0,
      other: 0,
      unknown: 0,
      ...(t.blockedByCategory || {}),
    },
    falsePositiveReports: {
      total: 0,
      byCategory: { ads: 0, trackers: 0, other: 0, unknown: 0, ...(falsePositiveReports.byCategory || {}) },
      byHostname: { ...(falsePositiveReports.byHostname || {}) },
    },
    iaShield: {
      totalEvents: 0,
      bySeverity: { low: 0, medium: 0, high: 0, critical: 0, ...(iaShield.bySeverity || {}) },
      byType: { ...(iaShield.byType || {}) },
      byHostname: { ...(iaShield.byHostname || {}) },
      lastEventAt: iaShield.lastEventAt || 0,
    },
    appliedRulesDiagnostics: {
      totalEvents: 0,
      updatedAt: 0,
      byTabHost: {
        ...(appliedRulesDiagnostics.byTabHost || {}),
      },
    },
    firefoxEngineReloads: {
      snapshotHits: (t.firefoxEngineReloads?.snapshotHits || 0),
      rawParseCount: (t.firefoxEngineReloads?.rawParseCount || 0),
    },
  };
}

export function createTelemetryController() {
  let telemetryState = null;
  let telemetryFlushTimer = null;
  let telemetryDirty = false;

  function markDirty() {
    if (!telemetryState?.enabled) return;
    telemetryDirty = true;
    if (!telemetryFlushTimer) {
      telemetryFlushTimer = setTimeout(() => {
        flush().catch((e) => {
          console.warn('[midori] Failed to flush local telemetry:', e);
        });
      }, TELEMETRY_FLUSH_INTERVAL);
    }
  }

  async function flush() {
    if (telemetryFlushTimer) {
      clearTimeout(telemetryFlushTimer);
      telemetryFlushTimer = null;
    }
    if (!telemetryDirty || !telemetryState) return;
    telemetryDirty = false;
    telemetryState.updatedAt = Date.now();
    await setOptions({ localTelemetry: telemetryState });
  }

  return {
    initFromOptions(options) {
      telemetryState = normalizeTelemetry(options?.localTelemetry);
    },

    getState() {
      return telemetryState;
    },

    isDirty() {
      return telemetryDirty;
    },

    applyRawState(raw) {
      telemetryState = normalizeTelemetry(raw);
    },

    recordStartupLatency(ms) {
      if (!telemetryState?.enabled) return;
      updateMetricBucket(telemetryState.startupLatencyMs, ms);
      markDirty();
    },

    recordMatchingLatency(ms) {
      if (!telemetryState?.enabled) return;
      updateMetricBucket(telemetryState.matchingLatencyMs, ms);
      markDirty();
    },

    recordBlockedCategory(category) {
      if (!telemetryState?.enabled) return;
      const cat = (category === 'ads' || category === 'trackers' || category === 'other') ? category : 'unknown';
      telemetryState.blockedByCategory.total = (telemetryState.blockedByCategory.total || 0) + 1;
      telemetryState.blockedByCategory[cat] = (telemetryState.blockedByCategory[cat] || 0) + 1;
      markDirty();
    },

    recordContentScriptCost(script, hostname, durationMs) {
      if (!telemetryState?.enabled) return;
      const key = script === 'scriptlets' ? 'scriptlets' : 'cosmetic';
      updateMetricBucket(telemetryState.contentScriptCostMs[key], durationMs);

      const host = (hostname || '').toLowerCase();
      if (host) {
        const perPage = telemetryState.contentScriptCostMs.perPage;
        const current = perPage[host] || { count: 0, avg: 0, last: 0, total: 0 };
        current.count += 1;
        current.total += Number(durationMs) || 0;
        current.last = Number(durationMs) || 0;
        current.avg = current.total / current.count;
        perPage[host] = current;

        const keys = Object.keys(perPage);
        if (keys.length > 250) {
          const oldest = keys.slice(0, keys.length - 250);
          for (const k of oldest) {
            delete perPage[k];
          }
        }
      }

      markDirty();
    },

    recordFalsePositive(hostname, category) {
      if (!telemetryState?.enabled) return;
      const cat = (category === 'ads' || category === 'trackers' || category === 'other') ? category : 'unknown';
      const fp = telemetryState.falsePositiveReports;
      fp.total = (fp.total || 0) + 1;
      fp.byCategory[cat] = (fp.byCategory[cat] || 0) + 1;

      const host = (hostname || '').toLowerCase();
      if (host) {
        fp.byHostname[host] = (fp.byHostname[host] || 0) + 1;
        const keys = Object.keys(fp.byHostname);
        if (keys.length > 250) {
          const oldest = keys.slice(0, keys.length - 250);
          for (const k of oldest) {
            delete fp.byHostname[k];
          }
        }
      }

      markDirty();
    },

    recordIaShieldRiskEvent(event) {
      if (!telemetryState?.enabled || !event) return;

      const bucket = telemetryState.iaShield || {
        totalEvents: 0,
        bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
        byType: {},
        byHostname: {},
        lastEventAt: 0,
      };

      const severity = String(event.severity || 'medium');
      const type = String(event.type || 'unknown').slice(0, 64);
      const hostname = String(event.hostname || '').toLowerCase();

      bucket.totalEvents = (bucket.totalEvents || 0) + 1;
      bucket.bySeverity[severity] = (bucket.bySeverity[severity] || 0) + 1;
      bucket.byType[type] = (bucket.byType[type] || 0) + 1;
      if (hostname) {
        bucket.byHostname[hostname] = (bucket.byHostname[hostname] || 0) + 1;
        const keys = Object.keys(bucket.byHostname);
        if (keys.length > 250) {
          const oldest = keys.slice(0, keys.length - 250);
          for (const k of oldest) {
            delete bucket.byHostname[k];
          }
        }
      }

      bucket.lastEventAt = Number(event.timestamp) || Date.now();
      telemetryState.iaShield = bucket;
      markDirty();
    },

    recordAppliedRulesEvent(msg, sender) {
      if (!telemetryState?.enabled) return;

      const tabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : -1;
      const hostname = String(msg?.hostname || '').trim().toLowerCase().slice(0, 255);
      if (!hostname) return;

      const selectorCount = Math.max(0, Number(msg?.selectorCount) || 0);
      const scriptletCount = Math.max(0, Number(msg?.scriptletCount) || 0);
      if (selectorCount === 0 && scriptletCount === 0) return;

      const diag = telemetryState.appliedRulesDiagnostics || {
        totalEvents: 0,
        updatedAt: 0,
        byTabHost: {},
      };

      const byTabHost = diag.byTabHost || {};
      const key = `${tabId}|${hostname}`;
      const entry = byTabHost[key] || {
        tabId,
        hostname,
        eventCount: 0,
        selectorCount: 0,
        scriptletCount: 0,
        selectorsSample: [],
        scriptletsSample: [],
        sources: {},
        firstSeenAt: Date.now(),
        lastSeenAt: 0,
      };

      entry.eventCount += 1;
      entry.selectorCount += selectorCount;
      entry.scriptletCount += scriptletCount;
      entry.lastSeenAt = Date.now();

      pushUniqueSamples(entry.selectorsSample, msg?.selectorsSample || [], 24);
      pushUniqueSamples(entry.scriptletsSample, msg?.scriptletsSample || [], 24);

      const sources = msg?.sources && typeof msg.sources === 'object' ? msg.sources : {};
      for (const [source, value] of Object.entries(sources)) {
        const n = Math.max(0, Number(value) || 0);
        if (!n) continue;
        entry.sources[source] = (entry.sources[source] || 0) + n;
      }

      byTabHost[key] = entry;

      const keys = Object.keys(byTabHost);
      if (keys.length > 180) {
        keys
          .sort((left, right) => (byTabHost[left]?.lastSeenAt || 0) - (byTabHost[right]?.lastSeenAt || 0))
          .slice(0, keys.length - 180)
          .forEach((oldKey) => {
            delete byTabHost[oldKey];
          });
      }

      diag.totalEvents = (diag.totalEvents || 0) + 1;
      diag.updatedAt = Date.now();
      diag.byTabHost = byTabHost;
      telemetryState.appliedRulesDiagnostics = diag;

      markDirty();
    },

    incrementFirefoxSnapshotHit() {
      if (!telemetryState?.firefoxEngineReloads) return;
      telemetryState.firefoxEngineReloads.snapshotHits++;
      markDirty();
    },

    incrementFirefoxRawParseCount() {
      if (!telemetryState?.firefoxEngineReloads) return;
      telemetryState.firefoxEngineReloads.rawParseCount++;
      markDirty();
    },

    async setEnabled(enabled) {
      telemetryState = telemetryState || normalizeTelemetry(null);
      telemetryState.enabled = enabled !== false;
      telemetryState.updatedAt = Date.now();
      await setOptions({ localTelemetry: telemetryState });
      telemetryDirty = false;
      return telemetryState.enabled;
    },

    async reset() {
      telemetryState = normalizeTelemetry(null);
      await setOptions({ localTelemetry: telemetryState });
      telemetryDirty = false;
    },

    getFalsePositiveTotal() {
      return telemetryState?.falsePositiveReports?.total || 0;
    },

    flush,
  };
}

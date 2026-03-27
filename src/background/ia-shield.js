/**
 * Midori Privacy Blocker
 * IA Shield helpers (host targeting, per-site config, local risk events)
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

const AI_HOST_PATTERNS = [
  'chat.openai.com',
  'chatgpt.com',
  'openai.com',
  'gemini.google.com',
  'bard.google.com',
  'claude.ai',
  'copilot.microsoft.com',
  'bing.com',
  'you.com',
  'poe.com',
  'perplexity.ai',
  'mistral.ai',
  'console.mistral.ai',
  'deepseek.com',
  'chat.deepseek.com',
  'grok.com',
  'x.ai',
  'notebooklm.google.com',
  'character.ai',
  'phind.com',
  'cerebras.ai',
  'gmail.com',
  'google.com',
  'bing.com',
  'github.com',
  'gitlab.com',
];

const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function hostnameMatches(hostname, pattern) {
  if (!hostname || !pattern) return false;
  return hostname === pattern || hostname.endsWith(`.${pattern}`);
}

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
}

function resolveDomainOverride(hostname, overrides) {
  if (!hostname || !overrides || typeof overrides !== 'object') return null;

  if (overrides[hostname]) {
    return { domain: hostname, config: overrides[hostname] };
  }

  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (overrides[parent]) {
      return { domain: parent, config: overrides[parent] };
    }
  }

  return null;
}

export function isAiHostname(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return false;
  for (const pattern of AI_HOST_PATTERNS) {
    if (hostnameMatches(host, pattern)) return true;
  }
  return false;
}

export function buildIaShieldConfig(options, hostname) {
  const host = normalizeHostname(hostname);
  const experiments = options?.experiments || {};
  const whitelist = options?.whitelist || {};
  const overrides = options?.sitePolicy?.domainOverrides || {};
  const override = resolveDomainOverride(host, overrides);
  const overrideConfig = override?.config || {};

  const aiHost = isAiHostname(host);
  const experimentEnabled = experiments.iaShield === true;
  const bypassed = overrideConfig.iaShieldBypass === true;
  const siteWhitelisted = !!whitelist[host];
  const enabled = aiHost && experimentEnabled && !bypassed && !siteWhitelisted;

  return {
    enabled,
    aiHost,
    strict: enabled && (options?.iaShieldStrict === true || overrideConfig.iaShieldStrict === true),
    sanitizeOnPaste: enabled && options?.iaShieldSanitizeOnPaste !== false,
    bypassed,
    hostname: host,
    matchedOverrideDomain: override?.domain || '',
    reason: !aiHost
      ? 'not-ai-host'
      : !experimentEnabled
        ? 'disabled'
        : bypassed
          ? 'bypassed'
          : siteWhitelisted
            ? 'site-whitelisted'
            : 'enabled',
  };
}

export function normalizeIaRiskEvent(event, fallbackHostname) {
  if (!event || typeof event !== 'object') return null;

  const now = Date.now();
  const timestamp = Number(event.timestamp);
  const type = String(event.type || 'unknown').trim().toLowerCase().slice(0, 64);
  const severityRaw = String(event.severity || 'medium').trim().toLowerCase();
  const severity = VALID_SEVERITIES.has(severityRaw) ? severityRaw : 'medium';
  const hostname = normalizeHostname(event.hostname || fallbackHostname);

  if (!type) return null;

  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const details = {
    findings: Array.isArray(payload.findings) ? payload.findings.slice(0, 16).map(v => String(v).slice(0, 120)) : [],
    source: String(payload.source || '').slice(0, 120),
    sample: String(payload.sample || '').slice(0, 320),
    blockedUrl: String(payload.blockedUrl || '').slice(0, 320),
    fieldType: String(payload.fieldType || '').slice(0, 64),
    strict: payload.strict === true,
  };

  return {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : now,
    type,
    severity,
    hostname,
    details,
  };
}

export function appendIaRiskEvent(events, event, maxSize = 300) {
  const list = Array.isArray(events) ? [...events] : [];
  list.push(event);
  if (list.length <= maxSize) return list;
  return list.slice(list.length - maxSize);
}

export function summarizeIaRiskEvents(events, days = 30, limit = 100) {
  const list = Array.isArray(events) ? events : [];
  const cutoff = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;

  const filtered = list
    .filter(e => Number(e?.timestamp) >= cutoff)
    .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

  const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 };
  const byType = {};
  const byHostname = {};

  for (const event of filtered) {
    const sev = VALID_SEVERITIES.has(event.severity) ? event.severity : 'medium';
    bySeverity[sev] = (bySeverity[sev] || 0) + 1;

    const type = String(event.type || 'unknown');
    byType[type] = (byType[type] || 0) + 1;

    const host = normalizeHostname(event.hostname);
    if (host) {
      byHostname[host] = (byHostname[host] || 0) + 1;
    }
  }

  return {
    total: filtered.length,
    bySeverity,
    byType,
    byHostname,
    events: filtered.slice(0, Math.max(1, Math.min(500, limit))),
  };
}

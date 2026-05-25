/**
 * Midori Privacy Blocker
 * Report generator - analyzes tracker data for user reports
 * Real data-based category distribution and privacy scoring.
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

import { getOptions } from './storage.js';
import { categorizeRequest } from './filter-utils.js';
import { isTrackerFingerprinter } from './trackerdb.js';

// ── Known fingerprinting domains ─────────────────────────────────────────────
const FP_DOMAINS = new Set([
  'fingerprintjs.com', 'fpjs.io', 'creativecdn.com', 'iovation.com',
  'threatmetrix.com', 'mpsnare.iesnare.com', 'cdn.krxd.net',
  'device.maxmind.com', 'api.audienceproject.com', 'sociaplus.com',
  'permutive.com', 'permutive.app', 'bluekai.com', 'exelator.com',
  'tapad.com', 'intentiq.com', 'eyeota.net',
]);

function isFingerprinter(domain) {
  if (!domain) return false;
  const d = domain.toLowerCase();
  if (FP_DOMAINS.has(d)) return true;
  // TrackerDB data-driven check (gradually replaces hardcoded list)
  if (isTrackerFingerprinter(d)) return true;
  const parts = d.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (FP_DOMAINS.has(parts.slice(i).join('.'))) return true;
  }
  if (d.includes('fingerprint') || d.includes('fpjs') || d.includes('device-id')) return true;
  return false;
}

/**
 * Get top sites with most trackers (last N days)
 */
export async function getTopTrackedSites(days = 30, limit = 10) {
  const options = await getOptions();
  const dailyStats = options.dailyStats || [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const siteMap = {};

  for (const day of dailyStats) {
    if (day.date < cutoffStr) continue;
    for (const [hostname, data] of Object.entries(day.sites || {})) {
      if (!siteMap[hostname]) {
        siteMap[hostname] = { blocked: 0, trackers: new Set(), categories: { trackers: 0, ads: 0, fingerprinters: 0, other: 0 } };
      }
      siteMap[hostname].blocked += data.blocked || 0;
      for (const t of (data.trackers || [])) {
        siteMap[hostname].trackers.add(t);
        // Categorize each tracker domain using real data
        if (isFingerprinter(t)) {
          siteMap[hostname].categories.fingerprinters++;
        } else {
          const cat = categorizeRequest('https://' + t + '/');
          if (cat === 'ads') siteMap[hostname].categories.ads++;
          else if (cat === 'trackers') siteMap[hostname].categories.trackers++;
          else siteMap[hostname].categories.other++;
        }
      }
    }
  }

  return Object.entries(siteMap)
    .map(([hostname, data]) => ({
      hostname,
      trackerCount: data.trackers.size,
      blocked: data.blocked,
      trackers: [...data.trackers],
      categories: data.categories,
      score: computeSiteScore(data),
    }))
    .sort((a, b) => b.trackerCount - a.trackerCount)
    .slice(0, limit);
}

/**
 * Compute privacy score for a site (0-100)
 */
function computeSiteScore(data) {
  const t = data.categories?.trackers || 0;
  const a = data.categories?.ads || 0;
  const f = data.categories?.fingerprinters || 0;
  const o = data.categories?.other || 0;
  const penalty = t * 5 + a * 2 + f * 10 + o * 1;
  return Math.max(0, Math.min(100, 100 - penalty));
}

function scoreToGrade(score) {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

/**
 * Get blocking statistics per day
 */
export async function getBlockingStats(days = 30) {
  const options = await getOptions();
  const dailyStats = options.dailyStats || [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return dailyStats
    .filter(d => d.date >= cutoffStr)
    .map(d => ({ date: d.date, blocked: d.totalBlocked || 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get tracker category distribution — REAL data, no hardcoded ratios
 */
export async function getCategoryDistribution(days = 30) {
  const options = await getOptions();
  const dailyStats = options.dailyStats || [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const categories = { trackers: 0, ads: 0, fingerprinters: 0, other: 0 };

  for (const day of dailyStats) {
    if (day.date < cutoffStr) continue;
    for (const data of Object.values(day.sites || {})) {
      for (const t of (data.trackers || [])) {
        if (isFingerprinter(t)) {
          categories.fingerprinters++;
        } else {
          const cat = categorizeRequest('https://' + t + '/');
          if (cat === 'ads') categories.ads++;
          else if (cat === 'trackers') categories.trackers++;
          else categories.other++;
        }
      }
    }
  }

  return categories;
}

/**
 * Get hourly heatmap data (last N days)
 * Returns array of 24 values (0-23h) with total blocked per hour
 */
export async function getHourlyHeatmap(days = 7) {
  const options = await getOptions();
  const hourlyStats = options.hourlyStats || {};

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const hours = new Array(24).fill(0);

  for (const [dateKey, hourData] of Object.entries(hourlyStats)) {
    if (dateKey < cutoffStr) continue;
    for (let h = 0; h < 24; h++) {
      hours[h] += (hourData[h] || 0);
    }
  }

  return hours;
}

/**
 * Get weekly trend comparison
 * Returns { thisWeek, lastWeek, change (%) }
 */
export async function getWeeklyTrend() {
  const thisWeekStats = await getBlockingStats(7);
  const lastWeekStats = await getBlockingStats(14);

  const thisWeekTotal = thisWeekStats.reduce((s, d) => s + d.blocked, 0);
  // Last week = total of 14 days minus this week
  const twoWeekTotal = lastWeekStats.reduce((s, d) => s + d.blocked, 0);
  const lastWeekTotal = twoWeekTotal - thisWeekTotal;

  const change = lastWeekTotal > 0
    ? Math.round(((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100)
    : (thisWeekTotal > 0 ? 100 : 0);

  return { thisWeek: thisWeekTotal, lastWeek: lastWeekTotal, change };
}

/**
 * Get overall privacy summary
 */
export async function getPrivacySummary(days = 30) {
  const options = await getOptions();
  const topSites = await getTopTrackedSites(days, 100);
  const categories = await getCategoryDistribution(days);
  const trend = await getWeeklyTrend();

  const totalBlocked = options.totalBlocked || 0;
  const totalTrackers = categories.trackers + categories.ads + categories.fingerprinters + categories.other;

  // Average score across all sites
  let avgScore = 100;
  if (topSites.length > 0) {
    avgScore = Math.round(topSites.reduce((s, site) => s + site.score, 0) / topSites.length);
  }

  return {
    totalBlocked,
    totalTrackers,
    avgScore,
    avgGrade: scoreToGrade(avgScore),
    categories,
    trend,
    sitesAnalyzed: topSites.length,
  };
}

/**
 * Get lightweight diagnostics for applied selectors/scriptlets by tab+host.
 */
export async function getAppliedRulesDiagnostics(limit = 20) {
  const options = await getOptions();
  const telemetry = options.localTelemetry || {};
  const diag = telemetry.appliedRulesDiagnostics || {};
  const byTabHost = diag.byTabHost && typeof diag.byTabHost === 'object'
    ? diag.byTabHost
    : {};

  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));

  const entries = Object.values(byTabHost)
    .filter(entry => entry && typeof entry === 'object')
    .sort((left, right) => (right.lastSeenAt || 0) - (left.lastSeenAt || 0))
    .slice(0, safeLimit)
    .map(entry => ({
      tabId: Number.isInteger(entry.tabId) ? entry.tabId : -1,
      hostname: String(entry.hostname || ''),
      eventCount: Number(entry.eventCount) || 0,
      selectorCount: Number(entry.selectorCount) || 0,
      scriptletCount: Number(entry.scriptletCount) || 0,
      discardedSelectorCount: Number(entry.discardedSelectorCount) || 0,
      lastSeenAt: Number(entry.lastSeenAt) || 0,
      selectorsSample: Array.isArray(entry.selectorsSample) ? entry.selectorsSample.slice(0, 12) : [],
      scriptletsSample: Array.isArray(entry.scriptletsSample) ? entry.scriptletsSample.slice(0, 12) : [],
      discardedSelectorsSample: Array.isArray(entry.discardedSelectorsSample) ? entry.discardedSelectorsSample.slice(0, 12) : [],
      sources: entry.sources && typeof entry.sources === 'object' ? entry.sources : {},
      discardedReasons: entry.discardedReasons && typeof entry.discardedReasons === 'object' ? entry.discardedReasons : {},
    }));

  const hostTotals = Object.create(null);
  for (const entry of entries) {
    if (!entry.hostname) continue;
    hostTotals[entry.hostname] = (hostTotals[entry.hostname] || 0) + entry.eventCount;
  }

  const topHosts = Object.entries(hostTotals)
    .map(([hostname, eventCount]) => ({ hostname, eventCount }))
    .sort((left, right) => right.eventCount - left.eventCount)
    .slice(0, 8);

  return {
    updatedAt: Number(diag.updatedAt) || Number(telemetry.updatedAt) || 0,
    totalEvents: Number(diag.totalEvents) || 0,
    totalTabHosts: Object.keys(byTabHost).length,
    entries,
    topHosts,
  };
}

/**
 * Export full report as JSON
 */
export async function exportReport() {
  const options = await getOptions();
  const topSites = await getTopTrackedSites(90, 50);
  const stats7 = await getBlockingStats(7);
  const stats30 = await getBlockingStats(30);
  const categories = await getCategoryDistribution(30);
  const heatmap = await getHourlyHeatmap(7);
  const trend = await getWeeklyTrend();
  const summary = await getPrivacySummary(30);

  return {
    generatedAt: new Date().toISOString(),
    totalBlocked: options.totalBlocked || 0,
    summary,
    topTrackedSites: topSites,
    blockingStats7Days: stats7,
    blockingStats30Days: stats30,
    categoryDistribution: categories,
    hourlyHeatmap: heatmap,
    weeklyTrend: trend,
  };
}

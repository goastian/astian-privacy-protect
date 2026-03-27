/**
 * Midori Privacy Blocker
 * Options page logic
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const FILTER_LIST_GROUPS = {
  'Core': {
    'easylist': { name: 'EasyList', desc: 'Primary ad blocking list' },
    'easyprivacy': { name: 'EasyPrivacy', desc: 'Tracker blocking list' },
    'ublock-filters': { name: 'uBlock Filters', desc: 'Complementary filters by uBlock Origin' },
    'ublock-privacy': { name: 'uBlock Privacy', desc: 'Extra privacy filters' },
    'ublock-unbreak': { name: 'uBlock Unbreak', desc: 'Fixes for sites broken by blocking' },
    'peter-lowe': { name: "Peter Lowe's Ad Servers", desc: 'Known ad server domains' },
    'ublock-quick-fixes': { name: 'uBlock Quick Fixes', desc: 'Quick fixes & anti-adblock scriptlets' },
  },
  'Annoyances': {
    'ublock-annoyances-cookies': { name: 'uBlock Annoyances (Cookies)', desc: 'Cookie consent banners' },
    'ublock-annoyances-others': { name: 'uBlock Annoyances (Other)', desc: 'Popups, notifications, etc.' },
    'fanboy-social': { name: "Fanboy's Social", desc: 'Social media widgets' },
    'fanboy-annoyance': { name: "Fanboy's Annoyance", desc: 'Comprehensive annoyance blocking' },
  },
  'AdGuard': {
    'adguard-base': { name: 'AdGuard Base', desc: 'AdGuard ad blocking rules' },
    'adguard-tracking': { name: 'AdGuard Tracking Protection', desc: 'AdGuard tracker blocking' },
    'adguard-social': { name: 'AdGuard Social Media', desc: 'Social media widgets by AdGuard' },
    'adguard-annoyances': { name: 'AdGuard Annoyances', desc: 'Popups, banners, cookie notices' },
    'adguard-mobile': { name: 'AdGuard Mobile Ads', desc: 'Mobile-specific ad blocking' },
    'adguard-spyware-firstparty': { name: 'AdGuard First-party Trackers', desc: 'First-party tracking protection' },
  },
  'Regional': {
    'easylist-spanish': { name: 'EasyList Spanish', desc: 'Ads on Spanish-language sites' },
    'easylist-germany': { name: 'EasyList Germany', desc: 'Ads on German-language sites' },
    'easylist-france': { name: 'EasyList France', desc: 'Ads on French-language sites' },
  },
};

// Flat map for backward compatibility
const FILTER_LISTS = {};
for (const group of Object.values(FILTER_LIST_GROUPS)) {
  Object.assign(FILTER_LISTS, group);
}

// Preset filter templates
const PRESETS = {
  'youtube-antiadblock': `! === YouTube Anti-Adblock ===
youtube.com##+js(abort-on-property-read, ytInitialPlayerResponse.adPlacements)
youtube.com##+js(set-constant, ytInitialPlayerResponse.adPlacements, undefined)
youtube.com##+js(abort-on-property-read, playerResponse.adPlacements)
youtube.com##+js(set-constant, yt.config_.EXPERIMENT_FLAGS.web_display_new_leaderboard_ad, false)
youtube.com##+js(json-prune, adPlacements playerAds adSlots)
youtube.com##+js(no-fetch-if, googlevideo.com/initplayback)
youtube.com##.ytp-ad-module
youtube.com##.ytp-ad-overlay-container
youtube.com##.ytd-ad-slot-renderer
youtube.com##ytd-in-feed-ad-layout-renderer
youtube.com##ytd-banner-promo-renderer
youtube.com##ytd-promoted-sparkles-web-renderer
youtube.com##.ytd-mealbar-promo-renderer
`,
  'twitch-ads': `! === Twitch Ad Blocking ===
twitch.tv##+js(set-constant, Tw.ads, undefined)
twitch.tv##+js(abort-on-property-read, Tw.ads)
twitch.tv##+js(no-fetch-if, usher.ttvnw.net/api/lvs/ads)
twitch.tv##+js(json-prune, data.user.self.showAds)
twitch.tv##+js(set-constant, csgo.ads.adRequested, trueFunc)
||imasdk.googleapis.com/js/sdkloader/ima3.js$domain=twitch.tv
||usher.ttvnw.net/api/lvs/ads$domain=twitch.tv
twitch.tv##.stream-display-ad__container
twitch.tv##.video-player__ad-overlay
`,
  'forbes-adblock': `! === Forbes Anti-Adblock Bypass ===
forbes.com##+js(set-constant, fbs_settings.ad.blocking.enabled, false)
forbes.com##+js(set-constant, isAdBlockerEnabled, false)
forbes.com##+js(abort-on-property-read, canRunAds)
forbes.com##+js(set-constant, forbes.adblock, false)
forbes.com##.ad-unit
forbes.com##.fbs-ad--ntv
forbes.com##.top-ad-container
`,
  'anti-adblock-general': `! === General Anti-Adblock Killer ===
##+js(abort-on-property-read, _sp_._networkListenerData)
##+js(set-constant, blurred, false)
##+js(set-constant, adBlockDetected, false)
##+js(set-constant, adblockDetector, noopFunc)
##+js(set-constant, isAdBlockActive, false)
##+js(set-constant, adBlockEnabled, false)
##+js(abort-on-property-read, blockAdBlock)
##+js(abort-on-property-read, blockAdBlock._options)
##+js(set-constant, blockAdBlock, noopFunc)
##+js(set-constant, canRunAds, true)
##+js(set-constant, isAdBlockerEnabled, false)
##+js(abort-on-property-read, FuckAdBlock)
##+js(abort-on-property-read, fuckAdBlock)
##+js(set-constant, detectAdBlock, noopFunc)
`,
  'cookie-annoyances': `! === Cookie Popup Blocking ===
##.cookie-banner
##.cookie-consent
##.cookie-notice
##.cookie-popup
##.cc-banner
##.cc-window
##.gdpr-banner
##.gdpr-consent
##.consent-banner
##.consent-modal
##[id*="cookie-banner"]
##[id*="cookie-consent"]
##[class*="cookie-notice"]
##[id*="gdpr"]
##.CookieConsent
##.js-cookie-consent
##.eupopup
`,
  'social-trackers': `! === Social Media Tracker Blocking ===
||connect.facebook.net/*/fbevents.js
||platform.twitter.com/widgets.js
||platform.linkedin.com/in.js
||apis.google.com/js/plusone.js
||static.addtoany.com/menu/page.js
||s7.addthis.com^
||platform.stumbleupon.com^
||widgets.pinterest.com^
||platform-api.sharethis.com^
||cdn.shareaholic.net^
||assets.pinterest.com/js/pinit.js
`,
};

let currentOptions = null;
let reportDays = 7;

// ── Initialize ──────────────────────────────────────────────────────────────

async function init() {
  currentOptions = await sendMessage({ action: 'get-options' });
  applyTheme(currentOptions?.theme || 'system');

  setupNavigation();
  renderGeneral();
  renderFilterLists();
  renderCustomFilters();
  renderWhitelist();
  renderAbout();
  setupListeners();

  // Handle hash navigation
  const hash = window.location.hash.replace('#', '');
  if (hash) {
    switchSection(hash);
  }

  // Load reports after section is visible (canvas needs offsetWidth > 0)
  const reportsSection = $('#section-reports');
  if (reportsSection && reportsSection.classList.contains('active')) {
    await loadReports();
  }
  if ($('#section-tracker-browser')?.classList.contains('active')) renderTrackerBrowser();
  if ($('#section-trends')?.classList.contains('active')) requestAnimationFrame(() => loadTrendsAlerts());
  if ($('#section-difficult-sites')?.classList.contains('active')) renderDifficultSites();
}

// ── Navigation ──────────────────────────────────────────────────────────────

function setupNavigation() {
  for (const item of $$('.nav-item')) {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.dataset.section;
      switchSection(section);
      window.location.hash = section;
    });
  }
}

function switchSection(name) {
  for (const item of $$('.nav-item')) {
    item.classList.toggle('active', item.dataset.section === name);
  }
  for (const section of $$('.section')) {
    section.classList.toggle('active', section.id === `section-${name}`);
  }

  // Re-render charts when Reports section becomes visible (canvas needs offsetWidth > 0)
  if (name === 'reports') {
    requestAnimationFrame(() => loadReports());
  }
  if (name === 'tracker-browser') {
    renderTrackerBrowser();
  }
  if (name === 'trends') {
    requestAnimationFrame(() => loadTrendsAlerts());
  }
  if (name === 'difficult-sites') {
    renderDifficultSites();
  }
}

// ── General Settings ────────────────────────────────────────────────────────

function renderGeneral() {
  if (!currentOptions) return;

  const lists = currentOptions.lists || {};
  const experiments = currentOptions.experiments || {};
  const telemetry = currentOptions.localTelemetry || {};
  $('#opt-block-ads').checked = lists['easylist']?.enabled !== false;
  $('#opt-block-trackers').checked = lists['easyprivacy']?.enabled !== false;
  $('#opt-block-annoyances').checked = lists['ublock-annoyances-cookies']?.enabled === true;
  $('#opt-block-social').checked = lists['fanboy-social']?.enabled === true;
  $('#opt-anti-fingerprint').checked = currentOptions.antiFingerprint !== false;
  $('#opt-local-telemetry').checked = telemetry.enabled !== false;
  $('#exp-serp-bar').checked = experiments.serpBar === true;
  $('#exp-trackerdb-assisted').checked = experiments.trackerDbAssisted === true;
  $('#exp-ia-shield').checked = experiments.iaShield === true;
  $('#exp-aggressive-vertical-rules').checked = experiments.aggressiveVerticalRules === true;
  $('#opt-theme').value = currentOptions.theme || 'system';
  $('#opt-update-interval').value = String(currentOptions.updateInterval || 4);

  if (currentOptions.lastUpdated) {
    const date = new Date(currentOptions.lastUpdated);
    const ago = getTimeAgo(date);
    $('#last-updated').textContent = ago;
  }

  renderKpiSnapshot();
}

function formatMetric(metric, unit = 'ms') {
  if (!metric || !metric.count) return 'No data yet';
  return `${metric.avg.toFixed(2)} ${unit} avg (${metric.count} samples)`;
}

function renderKpiSnapshot() {
  const telemetry = currentOptions?.localTelemetry || {};
  const startup = telemetry.startupLatencyMs || {};
  const matching = telemetry.matchingLatencyMs || {};
  const content = telemetry.contentScriptCostMs || {};
  const blocked = telemetry.blockedByCategory || {};
  const fp = telemetry.falsePositiveReports || {};

  $('#kpi-startup-latency').textContent = formatMetric(startup);
  $('#kpi-matching-latency').textContent = formatMetric(matching);

  const cosmeticAvg = content.cosmetic?.avg || 0;
  const scriptletsAvg = content.scriptlets?.avg || 0;
  const scriptCount = (content.cosmetic?.count || 0) + (content.scriptlets?.count || 0);
  $('#kpi-content-cost').textContent = scriptCount > 0
    ? `${(cosmeticAvg + scriptletsAvg).toFixed(2)} ms (cosmetic ${cosmeticAvg.toFixed(2)} / scriptlets ${scriptletsAvg.toFixed(2)})`
    : 'No data yet';

  const totalBlocked = blocked.total || 0;
  if (totalBlocked > 0) {
    const adsRate = Math.round(((blocked.ads || 0) / totalBlocked) * 100);
    const trackersRate = Math.round(((blocked.trackers || 0) / totalBlocked) * 100);
    const otherRate = Math.max(0, 100 - adsRate - trackersRate);
    $('#kpi-block-rate').textContent = `Ads ${adsRate}% · Trackers ${trackersRate}% · Other ${otherRate}%`;
  } else {
    $('#kpi-block-rate').textContent = 'No data yet';
  }

  const fpTotal = fp.total || 0;
  const fpRate = totalBlocked > 0 ? ((fpTotal / totalBlocked) * 100) : 0;
  $('#kpi-fp-rate').textContent = totalBlocked > 0
    ? `${fpRate.toFixed(2)}% (${fpTotal} reports / ${totalBlocked} blocked)`
    : 'No data yet';
}

// ── Filter Lists ────────────────────────────────────────────────────────────

function renderFilterLists() {
  const container = $('#filter-lists-container');
  container.innerHTML = '';

  const lists = currentOptions?.lists || {};

  for (const [groupName, groupLists] of Object.entries(FILTER_LIST_GROUPS)) {
    // Group header
    const groupHeader = document.createElement('div');
    groupHeader.className = 'filter-list-group-header';
    groupHeader.innerHTML = `<span class="font-semibold text-sm">${groupName}</span>`;
    container.appendChild(groupHeader);

    for (const [id, meta] of Object.entries(groupLists)) {
      const config = lists[id] || { enabled: false };
      const item = document.createElement('div');
      item.className = 'filter-list-item';
      item.innerHTML = `
        <div class="filter-list-info">
          <div class="filter-list-name">${meta.name}</div>
          <div class="filter-list-meta">${meta.desc}</div>
        </div>
        <label class="toggle">
          <input type="checkbox" data-list-id="${id}" ${config.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      `;
      container.appendChild(item);
    }
  }

  // List toggle handlers
  for (const checkbox of container.querySelectorAll('input[type="checkbox"]')) {
    checkbox.addEventListener('change', async (e) => {
      const listId = e.target.dataset.listId;
      const lists = { ...currentOptions.lists };
      if (lists[listId]) {
        lists[listId] = { ...lists[listId], enabled: e.target.checked };
      } else {
        // New list not yet in options — get URL from defaults
        const defaultUrl = getDefaultListUrl(listId);
        if (defaultUrl) {
          lists[listId] = { enabled: e.target.checked, url: defaultUrl };
        }
      }
      currentOptions = await saveOptions({ lists });
    });
  }

  renderCustomLists();
}

function getDefaultListUrl(listId) {
  for (const group of Object.values(FILTER_LIST_GROUPS)) {
    if (listId in group) {
      // Look up in storage defaults
      const allDefaults = currentOptions?.lists || {};
      if (allDefaults[listId]?.url) return allDefaults[listId].url;
    }
  }
  return null;
}

function renderCustomLists() {
  const container = $('#custom-lists-container');
  const customLists = currentOptions?.customLists || [];

  if (customLists.length === 0) {
    container.innerHTML = '<p class="text-sm text-tertiary p-3">No custom lists added</p>';
    return;
  }

  container.innerHTML = '';
  customLists.forEach((url, i) => {
    const item = document.createElement('div');
    item.className = 'whitelist-item';
    item.innerHTML = `
      <span class="text-sm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(url)}</span>
      <button class="whitelist-remove" data-index="${i}" title="Remove">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    container.appendChild(item);
  });

  for (const btn of container.querySelectorAll('.whitelist-remove')) {
    btn.addEventListener('click', async () => {
      const index = parseInt(btn.dataset.index);
      const customLists = [...(currentOptions.customLists || [])];
      customLists.splice(index, 1);
      currentOptions = await saveOptions({ customLists });
      renderCustomLists();
    });
  }
}

// ── Whitelist ───────────────────────────────────────────────────────────────

function renderWhitelist() {
  const container = $('#whitelist-container');
  const whitelist = currentOptions?.whitelist || {};
  const domains = Object.keys(whitelist).filter(d => whitelist[d]);

  if (domains.length === 0) {
    container.innerHTML = '<p class="text-sm text-tertiary p-3">No sites in the allow list</p>';
    return;
  }

  container.innerHTML = '';
  for (const domain of domains) {
    const item = document.createElement('div');
    item.className = 'whitelist-item';
    item.innerHTML = `
      <span class="text-sm font-semibold">${escapeHtml(domain)}</span>
      <button class="whitelist-remove" data-domain="${escapeHtml(domain)}" title="Remove">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    container.appendChild(item);
  }

  for (const btn of container.querySelectorAll('.whitelist-remove')) {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      await sendMessage({ action: 'toggle-site', hostname: domain });
      currentOptions = await sendMessage({ action: 'get-options' });
      renderWhitelist();
    });
  }
}

// ── Reports / Privacy Dashboard ──────────────────────────────────────────────

const CAT_COLORS = {
  trackers: '#f39c12',
  ads: '#e74c3c',
  fingerprinters: '#8b5cf6',
  other: '#6b7380',
};

function scoreToGrade(score) {
  if (score >= 95) return { grade: 'A+', css: 'grade-aplus' };
  if (score >= 85) return { grade: 'A', css: 'grade-a' };
  if (score >= 70) return { grade: 'B', css: 'grade-b' };
  if (score >= 50) return { grade: 'C', css: 'grade-c' };
  if (score >= 30) return { grade: 'D', css: 'grade-d' };
  return { grade: 'F', css: 'grade-f' };
}

async function loadReports() {
  const [stats, topSites, categories, heatmap, trend, summary] = await Promise.all([
    sendMessage({ action: 'get-report-stats', days: reportDays }),
    sendMessage({ action: 'get-report-top-sites', days: reportDays, limit: 10 }),
    sendMessage({ action: 'get-report-categories', days: reportDays }),
    sendMessage({ action: 'get-hourly-heatmap', days: reportDays }),
    sendMessage({ action: 'get-weekly-trend' }),
    sendMessage({ action: 'get-privacy-summary', days: reportDays }),
  ]);

  // Privacy Summary
  renderPrivacySummary(summary);

  // Stats overview
  const totalBlocked = (stats || []).reduce((sum, d) => sum + d.blocked, 0);
  $('#stat-total-blocked').textContent = formatNumber(totalBlocked);
  $('#stat-trackers').textContent = formatNumber(categories?.trackers || 0);
  $('#stat-ads').textContent = formatNumber(categories?.ads || 0);
  $('#stat-fingerprinters').textContent = formatNumber(categories?.fingerprinters || 0);

  // Weekly Trend
  renderWeeklyTrend(trend);

  // Charts
  renderChart(stats || []);
  renderCategoryDonut(categories);

  // Heatmap
  renderHeatmap(heatmap || new Array(24).fill(0));

  // Top sites
  renderTopSites(topSites || []);

  // Privacy alerts
  renderPrivacyAlerts(topSites || [], categories);

  // Tracker database
  renderTrackerDatabase(topSites || []);
}

function renderPrivacySummary(summary) {
  if (!summary) return;
  const { avgScore, avgGrade, sitesAnalyzed } = summary;
  const g = scoreToGrade(avgScore || 100);

  const badge = $('#dash-grade-badge');
  badge.className = 'dash-grade-badge ' + g.css;
  $('#dash-grade-letter').textContent = g.grade;
  $('#dash-grade-label').textContent = avgGrade === 'A+' ? 'Excellent Privacy' :
    avgGrade === 'A' ? 'Very Good Privacy' :
    avgGrade === 'B' ? 'Good Privacy' :
    avgGrade === 'C' ? 'Fair Privacy' :
    avgGrade === 'D' ? 'Poor Privacy' : 'Bad Privacy';

  const totalThreats = (summary.categories?.trackers || 0) + (summary.categories?.ads || 0) +
    (summary.categories?.fingerprinters || 0) + (summary.categories?.other || 0);
  $('#dash-grade-detail').textContent = sitesAnalyzed > 0
    ? `${totalThreats} threats blocked across ${sitesAnalyzed} sites`
    : 'Browse some sites to generate your privacy score';
  $('#dash-sites-count').textContent = sitesAnalyzed || 0;
}

function renderWeeklyTrend(trend) {
  if (!trend) return;
  $('#trend-this-week').textContent = formatNumber(trend.thisWeek || 0);
  $('#trend-last-week').textContent = formatNumber(trend.lastWeek || 0);

  const arrow = $('#trend-arrow');
  const change = trend.change || 0;
  if (change > 0) {
    arrow.className = 'trend-arrow trend-up';
    $('#trend-change').textContent = '↑' + change + '%';
  } else if (change < 0) {
    arrow.className = 'trend-arrow trend-down';
    $('#trend-change').textContent = '↓' + Math.abs(change) + '%';
  } else {
    arrow.className = 'trend-arrow trend-neutral';
    $('#trend-change').textContent = '→ 0%';
  }
}

// Store chart metadata for tooltip interaction
let chartMeta = null;

function renderChart(stats) {
  const canvas = $('#chart-blocking');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = 200 * dpr;
  ctx.scale(dpr, dpr);

  const w = canvas.offsetWidth;
  const h = 200;
  const padding = { top: 20, right: 10, bottom: 30, left: 40 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  ctx.clearRect(0, 0, w, h);

  if (stats.length === 0) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-text-tertiary');
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data yet', w / 2, h / 2);
    chartMeta = null;
    return;
  }

  const maxVal = Math.max(...stats.map(d => d.blocked), 1);
  const barWidth = Math.max(4, (chartW / stats.length) - 4);

  // Store metadata for tooltip
  chartMeta = { stats, padding, chartW, chartH, maxVal, barWidth, w, h };

  // Grid lines
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-border-light');
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-text-tertiary');
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    const val = Math.round(maxVal * (1 - i / 4));
    ctx.fillText(formatNumber(val), padding.left - 6, y + 3);
  }

  // Bars
  const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary');
  const barPositions = [];
  stats.forEach((d, i) => {
    const x = padding.left + (chartW / stats.length) * i + 2;
    const barH = (d.blocked / maxVal) * chartH;
    const y = padding.top + chartH - barH;

    barPositions.push({ x, y, w: barWidth, h: barH });

    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barH, 2);
    ctx.fill();

    if (stats.length <= 7 || i % Math.ceil(stats.length / 7) === 0) {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-text-tertiary');
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      const label = d.date.slice(5);
      ctx.fillText(label, x + barWidth / 2, h - 8);
    }
  });

  // Trend line overlay
  if (stats.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(26, 158, 111, 0.6)';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    stats.forEach((d, i) => {
      const cx = barPositions[i].x + barWidth / 2;
      const cy = padding.top + chartH - (d.blocked / maxVal) * chartH;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    });
    ctx.stroke();

    // Dots on line
    stats.forEach((d, i) => {
      const cx = barPositions[i].x + barWidth / 2;
      const cy = padding.top + chartH - (d.blocked / maxVal) * chartH;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = primaryColor;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  chartMeta.barPositions = barPositions;

  // Setup tooltip (once)
  if (!canvas._tooltipSetup) {
    canvas._tooltipSetup = true;
    canvas.style.position = 'relative';

    let tooltip = canvas.parentElement.querySelector('.chart-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'chart-tooltip';
      canvas.parentElement.style.position = 'relative';
      canvas.parentElement.appendChild(tooltip);
    }

    canvas.addEventListener('mousemove', (e) => {
      if (!chartMeta || !chartMeta.barPositions) { tooltip.classList.remove('visible'); return; }
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const { barPositions: bp, stats: st } = chartMeta;

      let found = -1;
      for (let i = 0; i < bp.length; i++) {
        if (mx >= bp[i].x && mx <= bp[i].x + bp[i].w) { found = i; break; }
      }

      if (found >= 0) {
        const d = st[found];
        tooltip.innerHTML = `<strong>${d.date}</strong><br>${formatNumber(d.blocked)} blocked`;
        tooltip.style.left = (bp[found].x + bp[found].w / 2) + 'px';
        tooltip.style.top = (bp[found].y - 40) + 'px';
        tooltip.classList.add('visible');
      } else {
        tooltip.classList.remove('visible');
      }
    });

    canvas.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });
  }
}

function renderCategoryDonut(categories) {
  const canvas = $('#chart-categories');
  if (!canvas || !categories) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = 160 * dpr;
  ctx.scale(dpr, dpr);

  const w = canvas.offsetWidth;
  const h = 160;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 10;
  const innerRadius = radius * 0.55;

  ctx.clearRect(0, 0, w, h);

  const data = [
    { key: 'trackers', value: categories.trackers || 0, color: CAT_COLORS.trackers, label: 'Trackers' },
    { key: 'ads', value: categories.ads || 0, color: CAT_COLORS.ads, label: 'Ads' },
    { key: 'fingerprinters', value: categories.fingerprinters || 0, color: CAT_COLORS.fingerprinters, label: 'Fingerprinters' },
    { key: 'other', value: categories.other || 0, color: CAT_COLORS.other, label: 'Other' },
  ];

  const total = data.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-text-tertiary');
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data', cx, cy);
  } else {
    let startAngle = -Math.PI / 2;
    for (const d of data) {
      if (d.value === 0) continue;
      const sliceAngle = (d.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fillStyle = d.color;
      ctx.fill();
      startAngle += sliceAngle;
    }
    // Inner circle (donut hole)
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-bg');
    ctx.fill();

    // Center text
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-text');
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatNumber(total), cx, cy - 6);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-text-tertiary');
    ctx.fillText('total', cx, cy + 10);
  }

  // Legend
  const legend = $('#category-legend');
  if (legend) {
    legend.innerHTML = '';
    for (const d of data) {
      const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
      const item = document.createElement('div');
      item.className = 'cat-legend-item';
      item.innerHTML = `<span class="cat-legend-dot" style="background:${d.color}"></span>
        <span class="text-secondary">${d.label}</span>
        <span class="cat-legend-value">${formatNumber(d.value)} (${pct}%)</span>`;
      legend.appendChild(item);
    }
  }
}

function renderHeatmap(hours) {
  const container = $('#heatmap-container');
  if (!container) return;
  container.innerHTML = '';

  const maxVal = Math.max(...hours, 1);

  for (let h = 0; h < 24; h++) {
    const val = hours[h] || 0;
    const level = val === 0 ? 0 : Math.min(5, Math.ceil((val / maxVal) * 5));
    const cell = document.createElement('div');
    cell.className = `heatmap-cell heatmap-level-${level}`;
    cell.textContent = String(h).padStart(2, '0');
    cell.title = `${String(h).padStart(2, '0')}:00 — ${formatNumber(val)} blocked`;
    container.appendChild(cell);
  }
}

function renderTopSites(sites) {
  const container = $('#top-sites-list');
  if (!container) return;

  if (sites.length === 0) {
    container.innerHTML = '<p class="text-sm text-tertiary">No data yet. Browse some websites to see tracker reports.</p>';
    return;
  }

  container.innerHTML = '';
  sites.forEach((site, i) => {
    const g = scoreToGrade(site.score ?? 50);
    const item = document.createElement('div');
    item.className = 'top-site-item';
    item.innerHTML = `
      <span class="top-site-rank">${i + 1}</span>
      <div class="top-site-info">
        <div class="top-site-hostname">${escapeHtml(site.hostname)}</div>
        <div class="top-site-count">${site.blocked} blocked · ${site.trackerCount} trackers</div>
      </div>
      <div class="top-site-score ${g.css}" title="Privacy score: ${g.grade}">${g.grade}</div>
    `;
    container.appendChild(item);
  });
}

// ── Known Tracker Database ───────────────────────────────────────────────────

const TRACKER_DB = {
  'doubleclick.net':       { company: 'Google', type: 'Ad Network', country: 'US' },
  'googlesyndication.com': { company: 'Google', type: 'Ad Network', country: 'US' },
  'googleadservices.com':  { company: 'Google', type: 'Ad Network', country: 'US' },
  'google-analytics.com':  { company: 'Google', type: 'Analytics', country: 'US' },
  'googletagmanager.com':  { company: 'Google', type: 'Tag Manager', country: 'US' },
  'googleapis.com':        { company: 'Google', type: 'API Service', country: 'US' },
  'facebook.net':          { company: 'Meta', type: 'Social Tracker', country: 'US' },
  'facebook.com':          { company: 'Meta', type: 'Social Tracker', country: 'US' },
  'fbcdn.net':             { company: 'Meta', type: 'CDN / Tracker', country: 'US' },
  'instagram.com':         { company: 'Meta', type: 'Social Tracker', country: 'US' },
  'amazon-adsystem.com':   { company: 'Amazon', type: 'Ad Network', country: 'US' },
  'criteo.com':            { company: 'Criteo', type: 'Ad Retargeting', country: 'FR' },
  'criteo.net':            { company: 'Criteo', type: 'Ad Retargeting', country: 'FR' },
  'outbrain.com':          { company: 'Outbrain', type: 'Content Ads', country: 'US' },
  'taboola.com':           { company: 'Taboola', type: 'Content Ads', country: 'US' },
  'scorecardresearch.com': { company: 'comScore', type: 'Analytics', country: 'US' },
  'quantserve.com':        { company: 'Quantcast', type: 'Audience Analytics', country: 'US' },
  'hotjar.com':            { company: 'Hotjar', type: 'Session Recording', country: 'MT' },
  'mouseflow.com':         { company: 'Mouseflow', type: 'Session Recording', country: 'DK' },
  'clarity.ms':            { company: 'Microsoft', type: 'Session Recording', country: 'US' },
  'bing.com':              { company: 'Microsoft', type: 'Ad Network', country: 'US' },
  'linkedin.com':          { company: 'Microsoft', type: 'Social Tracker', country: 'US' },
  'twitter.com':           { company: 'X Corp', type: 'Social Tracker', country: 'US' },
  'x.com':                 { company: 'X Corp', type: 'Social Tracker', country: 'US' },
  't.co':                  { company: 'X Corp', type: 'Link Tracker', country: 'US' },
  'tiktok.com':            { company: 'ByteDance', type: 'Social Tracker', country: 'CN' },
  'byteoversea.com':       { company: 'ByteDance', type: 'Analytics', country: 'CN' },
  'snapchat.com':          { company: 'Snap', type: 'Social Tracker', country: 'US' },
  'pinterest.com':         { company: 'Pinterest', type: 'Social Tracker', country: 'US' },
  'adnxs.com':             { company: 'Xandr (Microsoft)', type: 'Ad Exchange', country: 'US' },
  'rubiconproject.com':    { company: 'Magnite', type: 'Ad Exchange', country: 'US' },
  'pubmatic.com':          { company: 'PubMatic', type: 'Ad Exchange', country: 'US' },
  'openx.net':             { company: 'OpenX', type: 'Ad Exchange', country: 'US' },
  'casalemedia.com':       { company: 'Index Exchange', type: 'Ad Exchange', country: 'CA' },
  'newrelic.com':          { company: 'New Relic', type: 'Performance', country: 'US' },
  'sentry.io':             { company: 'Sentry', type: 'Error Tracking', country: 'US' },
  'segment.io':            { company: 'Twilio', type: 'Analytics', country: 'US' },
  'segment.com':           { company: 'Twilio', type: 'Analytics', country: 'US' },
  'mixpanel.com':          { company: 'Mixpanel', type: 'Analytics', country: 'US' },
  'amplitude.com':         { company: 'Amplitude', type: 'Analytics', country: 'US' },
  'optimizely.com':        { company: 'Optimizely', type: 'A/B Testing', country: 'US' },
  'crazyegg.com':          { company: 'Crazy Egg', type: 'Heatmaps', country: 'US' },
  'demdex.net':            { company: 'Adobe', type: 'DMP / Tracker', country: 'US' },
  'omtrdc.net':            { company: 'Adobe', type: 'Analytics', country: 'US' },
  'yandex.ru':             { company: 'Yandex', type: 'Analytics', country: 'RU' },
  'mc.yandex.ru':          { company: 'Yandex', type: 'Metrica', country: 'RU' },
  'baidu.com':             { company: 'Baidu', type: 'Analytics', country: 'CN' },
};

function lookupTracker(domain) {
  if (TRACKER_DB[domain]) return TRACKER_DB[domain];
  // Try parent domain (e.g. ads.google.com → google.com)
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (TRACKER_DB[parent]) return TRACKER_DB[parent];
  }
  return null;
}

// ── Privacy Alerts ──────────────────────────────────────────────────────────

function renderPrivacyAlerts(topSites, categories) {
  const container = $('#alerts-list');
  const countEl = $('#alerts-count');
  if (!container) return;

  const alerts = [];

  // Alert: sites with excessive trackers (>10)
  for (const site of topSites) {
    if (site.trackerCount > 10) {
      alerts.push({
        level: 'high',
        message: `<strong>${escapeHtml(site.hostname)}</strong> has ${site.trackerCount} trackers — consider avoiding this site`,
      });
    } else if (site.trackerCount > 5) {
      alerts.push({
        level: 'medium',
        message: `<strong>${escapeHtml(site.hostname)}</strong> has ${site.trackerCount} trackers`,
      });
    }
  }

  // Alert: high fingerprinter count
  if ((categories?.fingerprinters || 0) > 20) {
    alerts.push({
      level: 'high',
      message: `<strong>${categories.fingerprinters}</strong> fingerprinting attempts detected — fingerprint protection is active`,
    });
  }

  // Alert: heavy ad activity
  if ((categories?.ads || 0) > 500) {
    alerts.push({
      level: 'medium',
      message: `<strong>${formatNumber(categories.ads)}</strong> ads blocked — heavy advertising exposure detected`,
    });
  }

  if (countEl) countEl.textContent = alerts.length;

  if (alerts.length === 0) {
    container.innerHTML = '<p class="text-sm text-tertiary">No alerts. Your browsing looks safe.</p>';
    return;
  }

  container.innerHTML = '';
  for (const alert of alerts.slice(0, 10)) {
    const div = document.createElement('div');
    div.className = 'alert-item alert-' + alert.level;
    div.innerHTML = `<span class="alert-dot alert-dot-${alert.level}"></span><span class="text-sm">${alert.message}</span>`;
    container.appendChild(div);
  }
}

// ── Tracker Database Renderer ───────────────────────────────────────────────

function renderTrackerDatabase(topSites) {
  const container = $('#tracker-db-list');
  if (!container) return;

  // Collect all unique tracker domains across top sites
  const allTrackers = new Map();
  for (const site of topSites) {
    if (!site.trackers) continue;
    for (const domain of site.trackers) {
      if (!allTrackers.has(domain)) {
        const info = lookupTracker(domain);
        allTrackers.set(domain, {
          domain,
          company: info?.company || 'Unknown',
          type: info?.type || 'Tracker',
          country: info?.country || '??',
          sites: [site.hostname],
        });
      } else {
        allTrackers.get(domain).sites.push(site.hostname);
      }
    }
  }

  if (allTrackers.size === 0) {
    container.innerHTML = '<p class="text-sm text-tertiary">No tracker data yet.</p>';
    return;
  }

  // Sort by frequency (most common first)
  const sorted = [...allTrackers.values()].sort((a, b) => b.sites.length - a.sites.length);

  container.innerHTML = '';
  const table = document.createElement('div');
  table.className = 'tracker-db-table';

  // Header
  const header = document.createElement('div');
  header.className = 'tracker-db-row tracker-db-header';
  header.innerHTML = '<span>Domain</span><span>Company</span><span>Type</span><span>Country</span><span>Sites</span>';
  table.appendChild(header);

  for (const t of sorted.slice(0, 30)) {
    const row = document.createElement('div');
    row.className = 'tracker-db-row';
    row.innerHTML = `<span class="tracker-db-domain" title="${escapeHtml(t.domain)}">${escapeHtml(t.domain)}</span>` +
      `<span class="font-semibold">${escapeHtml(t.company)}</span>` +
      `<span class="text-tertiary">${escapeHtml(t.type)}</span>` +
      `<span>${t.country}</span>` +
      `<span class="badge badge-primary">${t.sites.length}</span>`;
    table.appendChild(row);
  }

  container.appendChild(table);
}

// ── Export HTML Report ──────────────────────────────────────────────────────

async function exportHtmlReport() {
  const report = await sendMessage({ action: 'export-report' });
  if (!report) return;

  const g = scoreToGrade(report.summary?.avgScore || 100);
  const totalBlocked = report.totalBlocked || 0;
  const cats = report.categoryDistribution || {};

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Midori Privacy Report - ${new Date().toLocaleDateString()}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1a1d21; line-height: 1.6; }
    h1 { color: #1a9e6f; } h2 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 8px; }
    .grade { display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 50%; color: #fff; font-size: 1.5rem; font-weight: 800; }
    .grade-a { background: #1a9e6f; } .grade-b { background: #3b82f6; } .grade-c { background: #f59e0b; } .grade-d { background: #f97316; } .grade-f { background: #e74c3c; }
    .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
    .stat-box { text-align: center; padding: 16px; background: #f5f7fa; border-radius: 8px; }
    .stat-box .num { font-size: 1.5rem; font-weight: 800; color: #1a9e6f; }
    .stat-box .label { font-size: 0.8rem; color: #666; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
    th { background: #f5f7fa; font-size: 0.8rem; color: #666; text-transform: uppercase; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee; font-size: 0.8rem; color: #999; }
  </style>
</head>
<body>
  <h1>Midori Privacy Report</h1>
  <p>Generated on ${new Date().toLocaleString()}</p>

  <h2>Privacy Score</h2>
  <div style="display:flex;align-items:center;gap:16px">
    <div class="grade grade-${g.css.replace('grade-', '').replace('aplus', 'a')}">${g.grade}</div>
    <div><strong>${report.summary?.sitesAnalyzed || 0}</strong> sites analyzed<br><strong>${formatNumber(totalBlocked)}</strong> threats blocked</div>
  </div>

  <h2>Statistics</h2>
  <div class="stat-grid">
    <div class="stat-box"><div class="num">${formatNumber(totalBlocked)}</div><div class="label">Total Blocked</div></div>
    <div class="stat-box"><div class="num" style="color:#f39c12">${formatNumber(cats.trackers || 0)}</div><div class="label">Trackers</div></div>
    <div class="stat-box"><div class="num" style="color:#e74c3c">${formatNumber(cats.ads || 0)}</div><div class="label">Ads</div></div>
    <div class="stat-box"><div class="num" style="color:#8b5cf6">${formatNumber(cats.fingerprinters || 0)}</div><div class="label">Fingerprinters</div></div>
  </div>

  <h2>Top Tracked Sites</h2>
  <table>
    <tr><th>#</th><th>Site</th><th>Blocked</th><th>Trackers</th><th>Score</th></tr>
    ${(report.topTrackedSites || []).map((s, i) => {
      const sg = scoreToGrade(s.score ?? 50);
      return `<tr><td>${i + 1}</td><td>${escapeHtml(s.hostname)}</td><td>${s.blocked}</td><td>${s.trackerCount}</td><td><strong>${sg.grade}</strong></td></tr>`;
    }).join('')}
  </table>

  <div class="footer">Report generated by Midori Privacy Blocker &mdash; <a href="https://astian.org">astian.org</a></div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `midori-privacy-report-${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════
// TRACKER DATABASE BROWSER (5.3)
// ═══════════════════════════════════════════════════════════════════════════

let tdbAllEntries = [];
let tdbFiltered = [];
let tdbPage = 0;
const TDB_PAGE_SIZE = 50;
let tdbSearchTimeout = null;
let trendsDays = 7;

async function renderTrackerBrowser() {
  // Pull data from TrackerDB background module + local top-site data
  const [tdbMeta, topSites] = await Promise.all([
    sendMessage({ action: 'get-trackerdb-meta' }),
    sendMessage({ action: 'get-report-top-sites', days: 30, limit: 50 }),
  ]);

  // Build entries from TRACKER_DB static map merged with TrackerDB live data
  const seen = new Map();
  // Sites data to compute how many local sites each domain appeared on
  const sitePerDomain = new Map();
  for (const site of topSites || []) {
    for (const d of site.trackers || []) {
      sitePerDomain.set(d, (sitePerDomain.get(d) || 0) + 1);
    }
  }

  // Merge static TRACKER_DB + any seen domains
  for (const [domain, info] of Object.entries(TRACKER_DB)) {
    seen.set(domain, {
      domain,
      company: info.company,
      category: info.type,
      country: info.country,
      confidence: sitePerDomain.has(domain) ? Math.min(1, sitePerDomain.get(domain) / 5) : 0.1,
      sites: sitePerDomain.get(domain) || 0,
      source: 'static',
    });
  }
  // Add any additional domains from local history not in static map
  for (const [domain, count] of sitePerDomain.entries()) {
    if (!seen.has(domain)) {
      const info = lookupTracker(domain);
      seen.set(domain, {
        domain,
        company: info?.company || 'Unknown',
        category: info?.type || 'Tracker',
        country: info?.country || '??',
        confidence: Math.min(1, count / 5),
        sites: count,
        source: 'local',
      });
    } else {
      seen.get(domain).sites = count;
      seen.get(domain).confidence = Math.min(1, count / 5);
    }
  }

  tdbAllEntries = [...seen.values()].sort((a, b) => b.sites - a.sites || b.confidence - a.confidence);

  // Populate company filter
  const companies = [...new Set(tdbAllEntries.map(e => e.company))].sort();
  const companySelect = $('#tdb-filter-company');
  if (companySelect) {
    const prev = companySelect.value;
    const opts = ['<option value="">All Companies</option>',
      ...companies.map(c => `<option value="${escapeHtml(c)}"${c === prev ? ' selected' : ''}>${escapeHtml(c)}</option>`)];
    companySelect.innerHTML = opts.join('');
  }

  // Summary chips
  const sumEl = $('#tdb-summary');
  if (sumEl) {
    const catCounts = {};
    for (const e of tdbAllEntries) catCounts[e.category] = (catCounts[e.category] || 0) + 1;
    const top5 = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    sumEl.innerHTML = top5.map(([cat, n]) =>
      `<span class="tdb-chip" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)} <strong>${n}</strong></span>`
    ).join('') + `<span class="tdb-chip tdb-chip--total">${tdbAllEntries.length} trackers total</span>`;
    for (const chip of sumEl.querySelectorAll('.tdb-chip[data-cat]')) {
      chip.addEventListener('click', () => {
        const catSel = $('#tdb-filter-cat');
        if (catSel) { catSel.value = chip.dataset.cat; applyTdbFilters(); }
      });
    }
  }

  applyTdbFilters();

  // Wire up search + filters (once)
  if (!$('#tdb-search')?._wired) {
    $('#tdb-search')._wired = true;
    $('#tdb-search')?.addEventListener('input', () => {
      clearTimeout(tdbSearchTimeout);
      tdbSearchTimeout = setTimeout(applyTdbFilters, 180);
    });
    $('#tdb-filter-cat')?.addEventListener('change', applyTdbFilters);
    $('#tdb-filter-company')?.addEventListener('change', applyTdbFilters);
    $('#tdb-sort')?.addEventListener('change', applyTdbFilters);
  }
}

function applyTdbFilters() {
  const q = ($('#tdb-search')?.value || '').trim().toLowerCase();
  const cat = $('#tdb-filter-cat')?.value || '';
  const company = $('#tdb-filter-company')?.value || '';
  const sort = $('#tdb-sort')?.value || 'prevalence';

  tdbFiltered = tdbAllEntries.filter(e => {
    if (cat && !e.category.includes(cat)) return false;
    if (company && e.company !== company) return false;
    if (q) {
      return e.domain.includes(q) || e.company.toLowerCase().includes(q) || e.category.toLowerCase().includes(q);
    }
    return true;
  });

  if (sort === 'company') tdbFiltered.sort((a, b) => a.company.localeCompare(b.company) || b.sites - a.sites);
  else if (sort === 'category') tdbFiltered.sort((a, b) => a.category.localeCompare(b.category) || b.sites - a.sites);
  else if (sort === 'domain') tdbFiltered.sort((a, b) => a.domain.localeCompare(b.domain));
  // else: prevalence (default, already sorted above)

  tdbPage = 0;
  renderTdbPage();
}

function renderTdbPage() {
  const rowsEl = $('#tdb-rows');
  const pagEl = $('#tdb-pagination');
  if (!rowsEl) return;

  if (tdbFiltered.length === 0) {
    rowsEl.innerHTML = '<div class="tdb-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>No trackers match the current filters.</span></div>';
    if (pagEl) pagEl.innerHTML = '';
    return;
  }

  const start = tdbPage * TDB_PAGE_SIZE;
  const page = tdbFiltered.slice(start, start + TDB_PAGE_SIZE);

  rowsEl.innerHTML = '';
  for (const e of page) {
    const conf = Math.round(e.confidence * 100);
    const row = document.createElement('div');
    row.className = 'tdb-row';
    row.innerHTML =
      `<span class="tracker-db-domain tdb-cell">${escapeHtml(e.domain)}</span>` +
      `<span class="tdb-cell font-semibold">${escapeHtml(e.company)}</span>` +
      `<span class="tdb-cell"><span class="tdb-cat-badge">${escapeHtml(e.category)}</span></span>` +
      `<span class="tdb-cell tdb-country">${e.country}</span>` +
      `<span class="tdb-cell tdb-col-conf"><span class="tdb-conf-bar"><span class="tdb-conf-fill" style="width:${conf}%"></span></span><span class="tdb-conf-val">${conf}%</span></span>` +
      `<span class="tdb-cell tdb-col-sites">${e.sites > 0 ? `<span class="badge badge-primary">${e.sites}</span>` : '<span class="text-tertiary">—</span>'}</span>`;
    rowsEl.appendChild(row);
  }

  // Pagination
  if (pagEl) {
    const pages = Math.ceil(tdbFiltered.length / TDB_PAGE_SIZE);
    if (pages <= 1) { pagEl.innerHTML = `<span class="tdb-pag-info">${tdbFiltered.length} results</span>`; return; }
    const btns = [];
    btns.push(`<span class="tdb-pag-info">${tdbFiltered.length} results</span>`);
    if (tdbPage > 0) btns.push(`<button class="btn btn-outline btn-sm" data-page="${tdbPage - 1}">← Prev</button>`);
    btns.push(`<span class="tdb-pag-page">Page ${tdbPage + 1} / ${pages}</span>`);
    if (tdbPage < pages - 1) btns.push(`<button class="btn btn-outline btn-sm" data-page="${tdbPage + 1}">Next →</button>`);
    pagEl.innerHTML = btns.join('');
    for (const btn of pagEl.querySelectorAll('[data-page]')) {
      btn.addEventListener('click', () => { tdbPage = parseInt(btn.dataset.page); renderTdbPage(); });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TRENDS & ALERTS (5.4)
// ═══════════════════════════════════════════════════════════════════════════

async function loadTrendsAlerts() {
  const [stats, topSites, categories, trend] = await Promise.all([
    sendMessage({ action: 'get-report-stats', days: trendsDays }),
    sendMessage({ action: 'get-report-top-sites', days: trendsDays, limit: 15 }),
    sendMessage({ action: 'get-report-categories', days: trendsDays }),
    sendMessage({ action: 'get-weekly-trend' }),
  ]);

  renderActionableAlerts(topSites || [], categories);
  renderSiteRecommendations(topSites || []);
  renderCategoryTrends(categories, trend);
  renderTrendChart(stats || []);
  renderTopThreatDomains(topSites || []);
}

function renderActionableAlerts(topSites, categories) {
  const container = $('#ta-alerts-list');
  const countEl = $('#ta-alerts-count');
  if (!container) return;

  const alerts = [];

  for (const site of topSites) {
    if (site.trackerCount >= 15) {
      alerts.push({
        level: 'high',
        action: 'block',
        site: site.hostname,
        message: `<strong>${escapeHtml(site.hostname)}</strong> loads <strong>${site.trackerCount} trackers</strong> — consider blocking or adding to strict list`,
        cta: 'Add to strict',
        ctaAction: () => addSiteToStrictMode(site.hostname),
      });
    } else if (site.trackerCount >= 8) {
      alerts.push({
        level: 'medium',
        action: 'review',
        site: site.hostname,
        message: `<strong>${escapeHtml(site.hostname)}</strong> has ${site.trackerCount} trackers — review tracker categories`,
        cta: 'Review',
        ctaAction: () => switchSection('tracker-browser'),
      });
    }
  }

  if ((categories?.fingerprinters || 0) > 30) {
    alerts.push({
      level: 'high',
      action: 'setting',
      message: `<strong>${formatNumber(categories.fingerprinters)}</strong> fingerprinting attempts — ensure anti-fingerprint is enabled`,
      cta: 'Check settings',
      ctaAction: () => switchSection('general'),
    });
  }

  if ((categories?.ads || 0) > 1000) {
    alerts.push({
      level: 'medium',
      action: 'info',
      message: `<strong>${formatNumber(categories.ads)}</strong> ads blocked this period — heavy ad exposure`,
    });
  }

  const experiments = currentOptions?.experiments || {};
  if (!experiments.serpBar) {
    alerts.push({
      level: 'info',
      action: 'feature',
      message: 'SERP risk badges are disabled — enable them to see pre-visit risk scores on search results',
      cta: 'Enable',
      ctaAction: async () => {
        const exps = { ...(currentOptions.experiments || {}), serpBar: true };
        currentOptions = await saveOptions({ experiments: exps });
        renderDifficultSites();
      },
    });
  }

  if (countEl) countEl.textContent = alerts.filter(a => a.level !== 'info').length;

  if (alerts.length === 0) {
    container.innerHTML = '<p class="text-sm text-tertiary">No alerts — your browsing looks clean.</p>';
    return;
  }

  container.innerHTML = '';
  for (const alert of alerts.slice(0, 12)) {
    const div = document.createElement('div');
    div.className = `ta-alert ta-alert-${alert.level}`;
    div.innerHTML =
      `<div class="ta-alert-dot ta-alert-dot-${alert.level}"></div>` +
      `<div class="ta-alert-body"><span class="text-sm">${alert.message}</span></div>` +
      (alert.cta ? `<button class="btn btn-outline btn-sm ta-alert-cta">${escapeHtml(alert.cta)}</button>` : '');
    if (alert.ctaAction) {
      div.querySelector('.ta-alert-cta')?.addEventListener('click', alert.ctaAction);
    }
    container.appendChild(div);
  }
}

async function addSiteToStrictMode(hostname) {
  const current = currentOptions?.siteVerticalOverrides || {};
  const updated = { ...current, [hostname]: 'strict' };
  currentOptions = await saveOptions({ siteVerticalOverrides: updated });
}

function renderSiteRecommendations(topSites) {
  const container = $('#ta-site-recs');
  if (!container) return;

  const recs = topSites
    .filter(s => s.trackerCount > 3 || s.score < 70)
    .slice(0, 8)
    .map(s => {
      const g = scoreToGrade(s.score ?? 50);
      const tips = [];
      if (s.trackerCount > 10) tips.push('Many trackers — consider blocking or limiting visits');
      else if (s.trackerCount > 5) tips.push('Moderate tracking — check tracker categories');
      if ((s.score ?? 50) < 50) tips.push('Low privacy score — review allowed-sites list');
      return { site: s, grade: g, tip: tips[0] || 'Review tracker activities' };
    });

  if (recs.length === 0) {
    container.innerHTML = '<p class="text-sm text-tertiary">No recommendations — your browsing looks clean.</p>';
    return;
  }

  container.innerHTML = '';
  for (const { site, grade, tip } of recs) {
    const div = document.createElement('div');
    div.className = 'ta-site-rec';
    div.innerHTML =
      `<div class="ta-rec-grade ${grade.css}">${grade.grade}</div>` +
      `<div class="ta-rec-info"><div class="ta-rec-host">${escapeHtml(site.hostname)}</div><div class="ta-rec-tip text-xs text-tertiary">${escapeHtml(tip)}</div></div>` +
      `<div class="ta-rec-count text-xs">${site.blocked} blocked · ${site.trackerCount} trackers</div>`;
    container.appendChild(div);
  }
}

function renderCategoryTrends(categories, trend) {
  const container = $('#ta-cat-trends');
  if (!container) return;

  const cats = [
    { key: 'trackers', label: 'Trackers', color: CAT_COLORS.trackers },
    { key: 'ads', label: 'Ads', color: CAT_COLORS.ads },
    { key: 'fingerprinters', label: 'Fingerprinters', color: CAT_COLORS.fingerprinters },
    { key: 'other', label: 'Other', color: CAT_COLORS.other },
  ];
  const total = cats.reduce((s, c) => s + (categories?.[c.key] || 0), 0) || 1;

  container.innerHTML = '';
  for (const cat of cats) {
    const val = categories?.[cat.key] || 0;
    const pct = Math.round((val / total) * 100);
    const div = document.createElement('div');
    div.className = 'ta-cat-trend-row';
    div.innerHTML =
      `<span class="ta-cat-dot" style="background:${cat.color}"></span>` +
      `<span class="ta-cat-label">${cat.label}</span>` +
      `<div class="ta-cat-bar-wrap"><div class="ta-cat-bar" style="width:${pct}%;background:${cat.color}"></div></div>` +
      `<span class="ta-cat-val">${formatNumber(val)}</span>` +
      `<span class="ta-cat-pct text-tertiary">${pct}%</span>`;
    container.appendChild(div);
  }

  // Week-over-week direction hint
  if (trend) {
    const dir = document.createElement('div');
    dir.className = 'ta-trend-hint';
    const change = trend.change || 0;
    const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
    const cls = change > 0 ? 'trend-up' : change < 0 ? 'trend-down' : 'trend-neutral';
    dir.innerHTML = `<span class="${cls} text-sm">${arrow} ${Math.abs(change)}% vs last week</span>`;
    container.appendChild(dir);
  }
}

function renderTrendChart(stats) {
  const canvas = $('#ta-trend-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr || 600 * dpr;
  canvas.height = 180 * dpr;
  ctx.scale(dpr, dpr);
  const w = (canvas.width / dpr) || 600;
  const h = 180;
  const pad = { top: 16, right: 12, bottom: 28, left: 40 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  ctx.clearRect(0, 0, w, h);

  if (!stats.length) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-text-tertiary');
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data yet', w / 2, h / 2);
    return;
  }

  const maxVal = Math.max(...stats.map(d => d.blocked), 1);
  const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary');
  const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--color-border-light');
  const tertiary = getComputedStyle(document.documentElement).getPropertyValue('--color-text-tertiary');

  // Grid lines
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ch / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = tertiary; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(formatNumber(Math.round(maxVal * (1 - i / 4))), pad.left - 5, y + 3);
  }

  // Area fill
  ctx.beginPath();
  stats.forEach((d, i) => {
    const x = pad.left + (cw / (stats.length - 1 || 1)) * i;
    const y = pad.top + ch - (d.blocked / maxVal) * ch;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  const lastX = pad.left + cw;
  ctx.lineTo(lastX, pad.top + ch);
  ctx.lineTo(pad.left, pad.top + ch);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
  grad.addColorStop(0, primaryColor + '44');
  grad.addColorStop(1, primaryColor + '00');
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  stats.forEach((d, i) => {
    const x = pad.left + (cw / (stats.length - 1 || 1)) * i;
    const y = pad.top + ch - (d.blocked / maxVal) * ch;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Labels
  stats.forEach((d, i) => {
    if (stats.length <= 10 || i % Math.ceil(stats.length / 10) === 0) {
      const x = pad.left + (cw / (stats.length - 1 || 1)) * i;
      ctx.fillStyle = tertiary; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(d.date.slice(5), x, h - 6);
    }
  });
}

function renderTopThreatDomains(topSites) {
  const container = $('#ta-top-domains');
  if (!container) return;

  const domainCounts = new Map();
  for (const site of topSites) {
    for (const d of site.trackers || []) {
      domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
    }
  }

  if (domainCounts.size === 0) {
    container.innerHTML = '<p class="text-sm text-tertiary">No data yet.</p>';
    return;
  }

  const sorted = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  container.innerHTML = '';
  sorted.forEach(([domain, count], i) => {
    const info = lookupTracker(domain);
    const div = document.createElement('div');
    div.className = 'ta-domain-row';
    div.innerHTML =
      `<span class="ta-domain-rank">${i + 1}</span>` +
      `<div class="ta-domain-info"><div class="ta-domain-name">${escapeHtml(domain)}</div>` +
      `<div class="text-xs text-tertiary">${escapeHtml(info?.company || 'Unknown')} · ${escapeHtml(info?.type || 'Tracker')}</div></div>` +
      `<span class="badge badge-primary">${count} site${count !== 1 ? 's' : ''}</span>`;
    container.appendChild(div);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// DIFFICULT SITES (5.5 advanced section)
// ═══════════════════════════════════════════════════════════════════════════

function renderDifficultSites() {
  if (!currentOptions) return;
  const lists = currentOptions.lists || {};
  const experiments = currentOptions.experiments || {};

  const ds = (id, val) => { const el = $(`#${id}`); if (el) el.checked = !!val; };
  ds('ds-ia-shield', experiments.iaShield);
  ds('ds-ia-strict', currentOptions.iaShieldStrict);
  ds('ds-youtube', lists['ublock-quick-fixes']?.enabled !== false);
  ds('ds-aggressive-vertical', experiments.aggressiveVerticalRules);
  ds('ds-anti-adblock', lists['ublock-annoyances-others']?.enabled !== false);
  ds('ds-serp-bar', experiments.serpBar);
  ds('ds-trackerdb-assisted', experiments.trackerDbAssisted);
}

// ── About ───────────────────────────────────────────────────────────────────

function renderAbout() {
  const manifest = api.runtime.getManifest();
  $('#about-version').textContent = `Version ${manifest.version}`;
}

// ── Custom Filters ──────────────────────────────────────────────────────────

async function renderCustomFilters() {
  const editor = $('#user-filters-editor');
  if (!editor) return;

  // Load user filters from background
  const result = await sendMessage({ action: 'get-user-filters' });
  editor.value = result?.userFilters || '';
  updateFilterLineCount();
}

function updateFilterLineCount() {
  const editor = $('#user-filters-editor');
  const countEl = $('#filter-line-count');
  if (!editor || !countEl) return;

  const text = editor.value.trim();
  if (!text) {
    countEl.textContent = '0 rules';
    return;
  }
  const lines = text.split('\n').filter(l => {
    const t = l.trim();
    return t && !t.startsWith('!') && !t.startsWith('[');
  });
  countEl.textContent = `${lines.length} rule${lines.length !== 1 ? 's' : ''}`;
}

async function saveUserFilters() {
  const editor = $('#user-filters-editor');
  const statusEl = $('#filter-save-status');
  if (!editor) return;

  const result = await sendMessage({ action: 'save-user-filters', userFilters: editor.value });

  if (result?.success) {
    statusEl.classList.remove('hidden');
    statusEl.textContent = `Saved! (${result.rulesCount} total rules)`;
    setTimeout(() => statusEl.classList.add('hidden'), 3000);
  }
  updateFilterLineCount();
}

function appendToEditor(text) {
  const editor = $('#user-filters-editor');
  if (!editor) return;

  const current = editor.value.trim();
  if (current) {
    editor.value = current + '\n\n' + text;
  } else {
    editor.value = text;
  }
  updateFilterLineCount();
  // Auto-scroll to bottom
  editor.scrollTop = editor.scrollHeight;
}

// ── Event Listeners ─────────────────────────────────────────────────────────

function setupListeners() {
  // General toggles
  $('#opt-block-ads').addEventListener('change', async (e) => {
    const lists = { ...currentOptions.lists };
    lists['easylist'] = { ...lists['easylist'], enabled: e.target.checked };
    lists['ublock-filters'] = { ...lists['ublock-filters'], enabled: e.target.checked };
    lists['peter-lowe'] = { ...lists['peter-lowe'], enabled: e.target.checked };
    currentOptions = await saveOptions({ lists });
    renderFilterLists();
  });

  $('#opt-block-trackers').addEventListener('change', async (e) => {
    const lists = { ...currentOptions.lists };
    lists['easyprivacy'] = { ...lists['easyprivacy'], enabled: e.target.checked };
    lists['ublock-privacy'] = { ...lists['ublock-privacy'], enabled: e.target.checked };
    currentOptions = await saveOptions({ lists });
    renderFilterLists();
  });

  $('#opt-block-annoyances').addEventListener('change', async (e) => {
    const lists = { ...currentOptions.lists };
    lists['ublock-annoyances-cookies'] = { ...lists['ublock-annoyances-cookies'], enabled: e.target.checked };
    lists['ublock-annoyances-others'] = { ...lists['ublock-annoyances-others'], enabled: e.target.checked };
    currentOptions = await saveOptions({ lists });
    renderFilterLists();
  });

  $('#opt-block-social').addEventListener('change', async (e) => {
    const lists = { ...currentOptions.lists };
    lists['fanboy-social'] = { ...lists['fanboy-social'], enabled: e.target.checked };
    currentOptions = await saveOptions({ lists });
    renderFilterLists();
  });

  $('#opt-anti-fingerprint').addEventListener('change', async (e) => {
    currentOptions = await saveOptions({ antiFingerprint: e.target.checked });
  });

  $('#opt-local-telemetry').addEventListener('change', async (e) => {
    const localTelemetry = {
      ...(currentOptions.localTelemetry || {}),
      enabled: e.target.checked,
    };
    currentOptions = await saveOptions({ localTelemetry });
    await sendMessage({ action: 'set-telemetry-enabled', enabled: e.target.checked });
    renderKpiSnapshot();
  });

  const syncExperimentFlags = async () => {
    const experiments = {
      ...(currentOptions.experiments || {}),
      serpBar: $('#exp-serp-bar').checked,
      trackerDbAssisted: $('#exp-trackerdb-assisted').checked,
      iaShield: $('#exp-ia-shield').checked,
      aggressiveVerticalRules: $('#exp-aggressive-vertical-rules').checked,
    };
    currentOptions = await saveOptions({ experiments });
  };

  $('#exp-serp-bar').addEventListener('change', syncExperimentFlags);
  $('#exp-trackerdb-assisted').addEventListener('change', syncExperimentFlags);
  $('#exp-ia-shield').addEventListener('change', syncExperimentFlags);
  $('#exp-aggressive-vertical-rules').addEventListener('change', syncExperimentFlags);

  $('#opt-theme').addEventListener('change', async (e) => {
    const theme = e.target.value;
    currentOptions = await saveOptions({ theme });
    applyTheme(theme);
  });

  $('#opt-update-interval').addEventListener('change', async (e) => {
    currentOptions = await saveOptions({ updateInterval: parseInt(e.target.value) });
  });

  // Update now
  $('#btn-update-now').addEventListener('click', async () => {
    const btn = $('#btn-update-now');
    btn.textContent = 'Updating...';
    btn.disabled = true;
    try {
      const result = await sendMessage({ action: 'update-lists' });
      if (result?.updatedAt) {
        $('#last-updated').textContent = 'Just now';
      }
    } catch (e) {
      console.error('Update failed:', e);
    }
    btn.textContent = 'Update now';
    btn.disabled = false;
  });

  $('#btn-reset-kpis').addEventListener('click', async () => {
    const btn = $('#btn-reset-kpis');
    btn.disabled = true;
    btn.textContent = 'Resetting...';
    await sendMessage({ action: 'reset-local-telemetry' });
    currentOptions = await sendMessage({ action: 'get-options' });
    renderGeneral();
    btn.textContent = 'Reset KPIs';
    btn.disabled = false;
  });

  // Add custom list
  $('#btn-add-custom-list').addEventListener('click', async () => {
    const input = $('#input-custom-list');
    const url = input.value.trim();
    if (!url || !url.startsWith('http')) return;

    const customLists = [...(currentOptions.customLists || []), url];
    currentOptions = await saveOptions({ customLists });
    input.value = '';
    renderCustomLists();
  });

  // Add whitelist
  $('#btn-add-whitelist').addEventListener('click', async () => {
    const input = $('#input-whitelist');
    const domain = input.value.trim().toLowerCase();
    if (!domain) return;

    const whitelist = { ...currentOptions.whitelist, [domain]: true };
    currentOptions = await saveOptions({ whitelist });
    input.value = '';
    renderWhitelist();
  });

  // Enter key for inputs
  $('#input-custom-list').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-add-custom-list').click();
  });
  $('#input-whitelist').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-add-whitelist').click();
  });

  // ── Custom Filters listeners ──

  // Quick add
  $('#btn-quick-add')?.addEventListener('click', () => {
    const input = $('#input-quick-filter');
    let value = input.value.trim();
    if (!value) return;
    // Auto-format as domain rule if it looks like a plain domain
    if (!value.startsWith('||') && !value.startsWith('@@') && !value.includes('#') && !value.includes('*')) {
      value = '||' + value.replace(/^https?:\/\//, '').replace(/\/.*$/, '') + '^';
    }
    appendToEditor(value);
    input.value = '';
    saveUserFilters();
  });
  $('#input-quick-filter')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-quick-add').click();
  });

  // Save filters
  $('#btn-save-filters')?.addEventListener('click', saveUserFilters);

  // Ctrl+S shortcut in editor
  $('#user-filters-editor')?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveUserFilters();
    }
  });

  // Update line count on input
  $('#user-filters-editor')?.addEventListener('input', updateFilterLineCount);

  // Clear filters
  $('#btn-clear-filters')?.addEventListener('click', async () => {
    const editor = $('#user-filters-editor');
    if (!editor) return;
    if (editor.value.trim() && !confirm('Are you sure you want to clear all custom filters?')) return;
    editor.value = '';
    await saveUserFilters();
  });

  // Preset templates
  for (const btn of $$('.preset-btn')) {
    btn.addEventListener('click', () => {
      const presetId = btn.dataset.preset;
      const preset = PRESETS[presetId];
      if (!preset) return;
      appendToEditor(preset.trim());
      btn.classList.add('added');
      setTimeout(() => btn.classList.remove('added'), 2000);
      saveUserFilters();
    });
  }

  // Import filters
  $('#btn-import-filters')?.addEventListener('click', () => {
    $('#file-import-filters').click();
  });
  $('#file-import-filters')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      appendToEditor(reader.result);
      saveUserFilters();
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Export filters
  $('#btn-export-filters')?.addEventListener('click', () => {
    const editor = $('#user-filters-editor');
    if (!editor || !editor.value.trim()) return;
    const blob = new Blob([editor.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `midori-custom-filters-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Report period buttons
  for (const btn of $$('.report-period-btn')) {
    btn.addEventListener('click', async () => {
      for (const b of $$('.report-period-btn')) b.classList.remove('active');
      btn.classList.add('active');
      reportDays = parseInt(btn.dataset.days);
      await loadReports();
    });
  }

  // Trends period buttons
  for (const btn of $$('.trends-period-btn')) {
    btn.addEventListener('click', async () => {
      for (const b of $$('.trends-period-btn')) b.classList.remove('active');
      btn.classList.add('active');
      trendsDays = parseInt(btn.dataset.days);
      await loadTrendsAlerts();
    });
  }

  // Difficult Sites toggles
  const syncDifficultSites = async () => {
    const lists = { ...currentOptions.lists };
    const experiments = { ...(currentOptions.experiments || {}) };

    const iaOn = $('#ds-ia-shield')?.checked;
    const iaStrictOn = $('#ds-ia-strict')?.checked;
    const ytOn = $('#ds-youtube')?.checked ?? true;
    const aggrOn = $('#ds-aggressive-vertical')?.checked;
    const antiAbOn = $('#ds-anti-adblock')?.checked ?? true;
    const serpBarOn = $('#ds-serp-bar')?.checked;
    const tdbAsstOn = $('#ds-trackerdb-assisted')?.checked;

    experiments.iaShield = !!iaOn;
    experiments.aggressiveVerticalRules = !!aggrOn;
    experiments.serpBar = !!serpBarOn;
    experiments.trackerDbAssisted = !!tdbAsstOn;

    if (lists['ublock-quick-fixes']) lists['ublock-quick-fixes'] = { ...lists['ublock-quick-fixes'], enabled: !!ytOn };
    if (lists['ublock-annoyances-others']) lists['ublock-annoyances-others'] = { ...lists['ublock-annoyances-others'], enabled: !!antiAbOn };

    currentOptions = await saveOptions({ experiments, lists, iaShieldStrict: !!iaStrictOn });
    // Notify background for experiment flag changes
    await sendMessage({ action: 'set-trackerdb-assisted', enabled: !!tdbAsstOn });
  };

  for (const id of ['ds-ia-shield', 'ds-ia-strict', 'ds-youtube', 'ds-aggressive-vertical', 'ds-anti-adblock', 'ds-serp-bar', 'ds-trackerdb-assisted']) {
    $(`#${id}`)?.addEventListener('change', syncDifficultSites);
  }

  // Difficult Sites — site diagnostic
  $('#ds-diag-check')?.addEventListener('click', async () => {
    const domain = $('#ds-diag-domain')?.value.trim().toLowerCase();
    const result = $('#ds-diag-result');
    if (!domain || !result) return;
    result.innerHTML = '<span class="text-sm text-tertiary">Checking…</span>';
    const info = lookupTracker(domain);
    const topSites = await sendMessage({ action: 'get-report-top-sites', days: 30, limit: 50 });
    const siteData = (topSites || []).find(s => s.hostname === domain);
    if (info || siteData) {
      const g = siteData ? scoreToGrade(siteData.score ?? 50) : null;
      result.innerHTML =
        `<div class="option-card p-3 mt-2">` +
        (info ? `<div class="text-sm mb-2"><strong>${escapeHtml(domain)}</strong> — ${escapeHtml(info.company)} · ${escapeHtml(info.type)} · ${info.country}</div>` : '') +
        (siteData ? `<div class="text-sm text-secondary">${siteData.blocked} requests blocked · ${siteData.trackerCount} unique trackers · Score: <strong>${g?.grade}</strong></div>` : '') +
        `</div>`;
    } else {
      result.innerHTML = '<div class="text-sm text-tertiary mt-2">No local data found for this domain yet.</div>';
    }
  });
  $('#ds-diag-domain')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('#ds-diag-check')?.click(); });

  // Export report (JSON)
  $('#btn-export-report').addEventListener('click', async () => {
    const report = await sendMessage({ action: 'export-report' });
    if (!report) return;

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `midori-privacy-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Export report (HTML)
  $('#btn-export-html')?.addEventListener('click', () => {
    exportHtmlReport();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function saveOptions(partial) {
  // Merge locally first
  const merged = { ...currentOptions, ...partial };
  // Save via background
  const storage = (typeof browser !== 'undefined' && browser.storage?.local) ? browser.storage.local : chrome.storage.local;
  await new Promise((resolve, reject) => {
    const result = storage.set({ options: merged });
    if (result && typeof result.then === 'function') { result.then(resolve, reject); }
    else if (chrome.storage.local.set.length > 1) { chrome.storage.local.set({ options: merged }, () => resolve()); }
    else { resolve(); }
  });
  return merged;
}

function sendMessage(msg) {
  try {
    if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
      return browser.runtime.sendMessage(msg).catch(() => null);
    }
  } catch (e) {}
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      resolve(response);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function applyTheme(theme) {
  if (theme === 'system' || !theme) {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

// ── Start ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

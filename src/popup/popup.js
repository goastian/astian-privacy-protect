/**
 * Midori Privacy Blocker
 * Popup UI logic
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Cross-browser API: Firefox browser.* returns Promises, Chrome chrome.* returns Promises in MV3
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

let currentTabId = null;
let currentHostname = '';
let isWhitelisted = false;

// ── Privacy Score System ─────────────────────────────────────────────────────
// Known fingerprinting domains/patterns
const FINGERPRINT_DOMAINS = [
  'fingerprintjs.com', 'fpjs.io', 'creativecdn.com', 'iovation.com',
  'threatmetrix.com', 'sociaplus.com', 'mpsnare.iesnare.com',
  'cdn.krxd.net', 'device.maxmind.com', 'api.audienceproject.com',
];
const FINGERPRINT_PATTERNS = [
  'fingerprint', 'device-id', 'deviceid', 'canvas-fp', 'webgl-fp',
  'browser-hash', 'fp.js', 'fpjs', 'audioctx',
];

function isFingerprinter(domain) {
  const d = domain.toLowerCase();
  for (const fp of FINGERPRINT_DOMAINS) {
    if (d === fp || d.endsWith('.' + fp)) return true;
  }
  for (const p of FINGERPRINT_PATTERNS) {
    if (d.includes(p)) return true;
  }
  return false;
}

/**
 * Calcula la puntuación de privacidad de A+ a F.
 * Basado en: cantidad de trackers, ads, fingerprinters bloqueados,
 * y si la protección está activa.
 * Retorna { grade, label, detail, score (0-100), cssClass, trackers, ads, fingerprinters }
 */
function computePrivacyScore(groups, blocked, whitelisted) {
  if (whitelisted) {
    return {
      grade: 'F', label: 'Unprotected', detail: 'Protection is paused on this site',
      score: 0, cssClass: 'grade-f', trackers: 0, ads: 0, fingerprinters: 0,
    };
  }

  // Count domains per category from groups
  let trackers = 0, ads = 0, fingerprinters = 0, other = 0;
  for (const domain of (groups?.trackers || [])) {
    if (isFingerprinter(domain)) fingerprinters++;
    else trackers++;
  }
  for (const domain of (groups?.ads || [])) {
    if (isFingerprinter(domain)) fingerprinters++;
    else ads++;
  }
  for (const domain of (groups?.other || [])) {
    if (isFingerprinter(domain)) fingerprinters++;
    else other++;
  }

  const totalGrouped = trackers + ads + fingerprinters + other;

  // Score calculation: the site tried to load these resources
  // More blocked = site is more aggressive with tracking/ads
  // We penalize based on what was detected
  let score;
  if (blocked === 0 && totalGrouped === 0) {
    score = 100; // Clean site
  } else if (totalGrouped > 0) {
    // We have categorized domains — use weighted penalty
    const penalty = trackers * 5 + ads * 3 + fingerprinters * 10 + other * 2;
    score = Math.max(0, 100 - penalty);
  } else {
    // Blocked items but no categorized groups (e.g. Chromium without debug API)
    // Use blocked count as proxy — each blocked request = -3 points
    score = Math.max(0, 100 - blocked * 3);
  }

  score = Math.round(Math.max(0, Math.min(100, score)));

  let grade, label, cssClass;
  if (score >= 95) { grade = 'A+'; label = 'Excellent'; cssClass = 'grade-aplus'; }
  else if (score >= 85) { grade = 'A'; label = 'Very Good'; cssClass = 'grade-a'; }
  else if (score >= 70) { grade = 'B'; label = 'Good'; cssClass = 'grade-b'; }
  else if (score >= 50) { grade = 'C'; label = 'Fair'; cssClass = 'grade-c'; }
  else if (score >= 30) { grade = 'D'; label = 'Poor'; cssClass = 'grade-d'; }
  else { grade = 'F'; label = 'Bad'; cssClass = 'grade-f'; }

  const totalThreats = totalGrouped > 0 ? totalGrouped : blocked;
  const detail = totalThreats === 0
    ? 'No threats detected'
    : `${totalThreats} threat${totalThreats > 1 ? 's' : ''} found & blocked`;

  return { grade, label, detail, score, cssClass, trackers, ads, fingerprinters };
}

function updatePrivacyScoreUI(groups, blocked) {
  const result = computePrivacyScore(groups, blocked, isWhitelisted);

  const badge = $('#score-badge');
  badge.className = 'score-badge ' + result.cssClass;
  $('#score-letter').textContent = result.grade;
  $('#score-label').textContent = result.label;
  $('#score-detail').textContent = result.detail;
  $('#score-bar-fill').style.width = result.score + '%';
  $('#cat-trackers-n').textContent = result.trackers;
  $('#cat-ads-n').textContent = result.ads;
  $('#cat-fp-n').textContent = result.fingerprinters;
}

// ── Category toggle state ────────────────────────────────────────────────────
let categoryState = { ads: true, trackers: true, fingerprinting: true };

// ── Pause timer state ────────────────────────────────────────────────────────
let pauseEndTime = 0;
let pauseInterval = null;

// ── Live stream state ────────────────────────────────────────────────────────
let lastLiveCount = 0;
let liveStreamEnabled = true;

// ── Initialize ──────────────────────────────────────────────────────────────

async function init() {
  // Get current tab
  let tabs;
  try {
    tabs = await api.tabs.query({ active: true, currentWindow: true });
  } catch (e) {
    return;
  }
  const tab = tabs?.[0];
  if (!tab) return;

  currentTabId = tab.id;

  try {
    currentHostname = new URL(tab.url).hostname;
  } catch {
    currentHostname = '';
  }

  $('#hostname').textContent = currentHostname || 'No website';

  // Get options to check whitelist, protection level, category state, and pause
  const options = await sendMessage({ action: 'get-options' });
  isWhitelisted = !!(options?.whitelist?.[currentHostname]);

  // Restore category toggle state
  if (options?.categoryState) {
    categoryState = { ...categoryState, ...options.categoryState };
  }
  updateCategoryTogglesUI();

  // Restore pause state
  if (options?.pauseUntil && options.pauseUntil > Date.now()) {
    pauseEndTime = options.pauseUntil;
    startPauseCountdown();
  }
  updatePauseUI();

  updateStatusUI();

  // Set current protection level
  const currentLevel = options?.protectionLevel || 'standard';
  updateLevelUI(currentLevel);

  // Load tab stats
  await loadTabStats();

  // Set up event listeners
  setupListeners();

  // Poll for updates every 2 seconds (live stream + stats)
  setInterval(loadTabStats, 2000);
}

// ── Load tab stats ──────────────────────────────────────────────────────────

async function loadTabStats() {
  if (!currentTabId) return;

  const data = await sendMessage({ action: 'get-tab-stats', tabId: currentTabId });
  if (!data) return;

  // Update counter
  const blocked = data.blocked || 0;
  $('#blocked-count').textContent = blocked;

  // Update bandwidth saved estimate
  const savedKB = data.dataSaved ? Math.round(data.dataSaved / 1024) : Math.round(blocked * 35);
  if (savedKB >= 1024) {
    $('#saved-size').textContent = (savedKB / 1024).toFixed(1);
    $('#saved-unit').textContent = 'MB saved';
  } else {
    $('#saved-size').textContent = savedKB;
    $('#saved-unit').textContent = 'KB saved';
  }

  // Update groups
  const groups = data.groups || { trackers: [], ads: [], other: [] };

  renderGroup('trackers', groups.trackers);
  renderGroup('ads', groups.ads);
  renderGroup('other', groups.other);

  // Update privacy score
  updatePrivacyScoreUI(groups, blocked);

  // Show/hide empty state
  const hasItems = groups.trackers.length + groups.ads.length + groups.other.length > 0;
  $('#empty-state').classList.toggle('hidden', hasItems);

  // Update live stream
  updateLiveStream(data.recentRequests || [], blocked);
}

function renderGroup(name, domains) {
  const groupEl = $(`#group-${name}`);
  const countEl = $(`#count-${name}`);
  const listEl = $(`#list-${name}`);

  if (!domains || domains.length === 0) {
    groupEl.classList.add('hidden');
    return;
  }

  groupEl.classList.remove('hidden');
  countEl.textContent = domains.length;

  // Only re-render if content changed
  const currentContent = listEl.dataset.domains || '';
  const newContent = domains.join(',');
  if (currentContent === newContent) return;
  listEl.dataset.domains = newContent;

  listEl.innerHTML = '';
  for (const domain of domains) {
    const item = document.createElement('div');
    item.className = 'request-item';
    item.innerHTML = `
      <span class="request-domain" title="${escapeHtml(domain)}">${escapeHtml(domain)}</span>
      <span class="request-blocked-icon">✕</span>
    `;
    listEl.appendChild(item);
  }
}

// ── UI State ────────────────────────────────────────────────────────────────

function updateStatusUI() {
  const statusSection = $('#status-section');
  const statusDot = $('#status-dot');
  const statusText = $('#status-text');
  const toggle = $('#toggle-site');

  if (isWhitelisted) {
    statusSection.className = 'popup-status paused';
    statusDot.className = 'status-dot paused';
    statusText.textContent = 'Protection PAUSED';
    toggle.checked = false;
  } else {
    statusSection.className = 'popup-status active';
    statusDot.className = 'status-dot active';
    statusText.textContent = 'Protection ACTIVE';
    toggle.checked = true;
  }
}

// ── Protection Level ─────────────────────────────────────────────────────────

function updateLevelUI(level) {
  for (const btn of $$('.level-btn')) {
    btn.classList.toggle('active', btn.dataset.level === level);
  }
  $('#level-status').textContent = '';
}

async function changeProtectionLevel(level) {
  const btns = $$('.level-btn');
  const statusEl = $('#level-status');

  // Disable buttons while applying
  for (const btn of btns) btn.classList.add('loading');
  statusEl.textContent = 'Applying...';
  statusEl.style.color = '';

  const result = await sendMessage({ action: 'change-protection-level', level });

  for (const btn of btns) btn.classList.remove('loading');

  if (result?.success) {
    updateLevelUI(level);
    statusEl.style.color = 'var(--color-primary)';
    statusEl.textContent = `${result.label} protection applied`;
    setTimeout(() => { statusEl.textContent = ''; }, 2500);
  } else {
    statusEl.style.color = 'var(--color-danger)';
    statusEl.textContent = 'Failed to apply';
    setTimeout(() => { statusEl.textContent = ''; }, 2500);
  }
}

// ── Live Stream ─────────────────────────────────────────────────────────────

function updateLiveStream(recentRequests, totalBlocked) {
  const container = $('#live-stream');
  const itemsEl = $('#live-items');
  if (!container || !itemsEl) return;

  // Show live stream when there's activity
  if (totalBlocked > 0) {
    container.classList.remove('hidden');
  }

  // Only update if new requests arrived
  if (totalBlocked === lastLiveCount) return;
  const newCount = totalBlocked - lastLiveCount;
  lastLiveCount = totalBlocked;

  // Add new items (most recent first, max 20 visible)
  if (recentRequests && recentRequests.length > 0) {
    const toShow = recentRequests.slice(-Math.min(newCount, 5));
    for (const req of toShow) {
      const item = document.createElement('div');
      item.className = 'live-item';
      const color = req.type === 'tracker' ? 'var(--color-warning)' :
                    req.type === 'ad' ? 'var(--color-danger)' : 'var(--color-text-tertiary)';
      const now = new Date();
      const time = String(now.getHours()).padStart(2, '0') + ':' +
                   String(now.getMinutes()).padStart(2, '0') + ':' +
                   String(now.getSeconds()).padStart(2, '0');
      item.innerHTML = `<span class="live-item-type" style="background:${color}"></span>` +
        `<span class="live-item-domain">${escapeHtml(req.domain || req.url || 'unknown')}</span>` +
        `<span class="live-item-time">${time}</span>`;
      itemsEl.insertBefore(item, itemsEl.firstChild);
    }
  }

  // Keep max 20 items
  while (itemsEl.children.length > 20) {
    itemsEl.removeChild(itemsEl.lastChild);
  }
}

// ── Category Toggles ────────────────────────────────────────────────────────

function updateCategoryTogglesUI() {
  for (const btn of $$('.cat-toggle')) {
    const cat = btn.dataset.cat;
    btn.classList.toggle('active', !!categoryState[cat]);
  }
}

async function toggleCategory(cat) {
  categoryState[cat] = !categoryState[cat];
  updateCategoryTogglesUI();

  // Map category to options
  const optMap = {
    ads: { 'easylist': categoryState.ads, 'ublock-filters': categoryState.ads, 'peter-lowe': categoryState.ads },
    trackers: { 'easyprivacy': categoryState.trackers, 'ublock-privacy': categoryState.trackers },
    fingerprinting: { antiFingerprint: categoryState.fingerprinting },
  };

  if (cat === 'fingerprinting') {
    await sendMessage({ action: 'save-options-partial', options: { antiFingerprint: categoryState.fingerprinting, categoryState } });
  } else {
    const listUpdates = optMap[cat] || {};
    await sendMessage({ action: 'toggle-category', category: cat, enabled: categoryState[cat], listUpdates, categoryState });
  }
}

// ── Pause Timer ─────────────────────────────────────────────────────────────

function updatePauseUI() {
  const section = $('#pause-section');
  if (!section) return;

  const isPaused = pauseEndTime > Date.now();
  section.classList.toggle('visible', isPaused || isWhitelisted);

  if (isPaused) {
    updatePauseCountdownDisplay();
  }
}

function startPauseCountdown() {
  if (pauseInterval) clearInterval(pauseInterval);
  updatePauseUI();

  pauseInterval = setInterval(() => {
    if (pauseEndTime <= Date.now()) {
      clearInterval(pauseInterval);
      pauseInterval = null;
      pauseEndTime = 0;
      // Auto-resume
      resumeProtection();
      return;
    }
    updatePauseCountdownDisplay();
  }, 1000);
}

function updatePauseCountdownDisplay() {
  const remaining = Math.max(0, pauseEndTime - Date.now());
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const el = $('#pause-remaining');
  if (el) el.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
}

async function pauseProtection(minutes) {
  if (!currentHostname) return;
  pauseEndTime = Date.now() + minutes * 60000;

  // Whitelist the site temporarily
  const result = await sendMessage({
    action: 'pause-protection',
    hostname: currentHostname,
    minutes: minutes,
    pauseUntil: pauseEndTime,
  });

  isWhitelisted = true;
  updateStatusUI();
  startPauseCountdown();
}

async function resumeProtection() {
  pauseEndTime = 0;
  if (pauseInterval) { clearInterval(pauseInterval); pauseInterval = null; }

  await sendMessage({
    action: 'resume-protection',
    hostname: currentHostname,
  });

  isWhitelisted = false;
  updateStatusUI();
  updatePauseUI();
}

// ── Event Listeners ─────────────────────────────────────────────────────────

function setupListeners() {
  // Toggle site protection
  $('#toggle-site').addEventListener('change', async (e) => {
    if (!currentHostname) return;

    const result = await sendMessage({
      action: 'toggle-site',
      hostname: currentHostname,
    });

    isWhitelisted = result?.whitelisted || false;
    updateStatusUI();
  });

  // Protection level buttons
  for (const btn of $$('.level-btn')) {
    btn.addEventListener('click', () => {
      const level = btn.dataset.level;
      if (btn.classList.contains('active') || btn.classList.contains('loading')) return;
      changeProtectionLevel(level);
    });
  }

  // Category toggles
  for (const btn of $$('.cat-toggle')) {
    btn.addEventListener('click', () => {
      toggleCategory(btn.dataset.cat);
    });
  }

  // Pause buttons
  for (const btn of $$('.pause-btn')) {
    btn.addEventListener('click', () => {
      const minutes = parseInt(btn.dataset.minutes);
      pauseProtection(minutes);
    });
  }

  // Resume button
  $('#btn-resume')?.addEventListener('click', () => {
    resumeProtection();
  });

  // Settings button
  $('#btn-settings').addEventListener('click', () => {
    api.runtime.openOptionsPage();
    window.close();
  });

  // Report button
  $('#btn-report').addEventListener('click', () => {
    const url = api.runtime.getURL('options/options.html#reports');
    api.tabs.create({ url });
    window.close();
  });

  // Group toggle (collapse/expand)
  for (const header of $$('.group-header')) {
    header.addEventListener('click', () => {
      header.classList.toggle('open');
    });
    // Start open
    header.classList.add('open');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Start ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

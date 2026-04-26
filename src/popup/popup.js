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
let lastGroups = { trackers: [], ads: [], other: [] };
let currentBlockedEntities = {};
let currentEntityControl = null;

// ── Category toggle state ────────────────────────────────────────────────────
let categoryState = { ads: true, trackers: true, fingerprinting: true };

// ── Pause timer state ────────────────────────────────────────────────────────
let pauseEndTime = 0;
let pauseInterval = null;

// ── Live stream state ────────────────────────────────────────────────────────
let lastLiveCount = 0;
let liveStreamEnabled = false; // Disabled by default for performance

// ── Smart refresh debounce ──────────────────────────────────────────────────
let lastRenderedData = null;
let refreshDebounceTimer = null;
const SMART_REFRESH_DEBOUNCE_MS = 300; // Debounce rapid updates
let pollbackTimer = null;
const POLLBACK_INTERVAL_MS = 5000; // Fallback polling every 5s if no events

function getGroupCount(groups, key) {
  const arr = groups?.[key];
  return Array.isArray(arr) ? arr.length : 0;
}

function getFastGroupFingerprint(groups) {
  const trackers = groups?.trackers || [];
  const ads = groups?.ads || [];
  const other = groups?.other || [];

  const firstTracker = normalizeTrackerItem(trackers[0] || {}).domain || '';
  const firstAd = normalizeTrackerItem(ads[0] || {}).domain || '';
  const firstOther = normalizeTrackerItem(other[0] || {}).domain || '';

  return [
    trackers.length,
    ads.length,
    other.length,
    firstTracker,
    firstAd,
    firstOther,
  ].join('|');
}

// ── Check if data changed ───────────────────────────────────────────────────
function hasDataChanged(newData) {
  if (!lastRenderedData) return true;

  const prevGroups = lastRenderedData.groups || {};
  const nextGroups = newData.groups || {};
  const groupCountsChanged = (
    getGroupCount(prevGroups, 'trackers') !== getGroupCount(nextGroups, 'trackers') ||
    getGroupCount(prevGroups, 'ads') !== getGroupCount(nextGroups, 'ads') ||
    getGroupCount(prevGroups, 'other') !== getGroupCount(nextGroups, 'other')
  );

  const prevCats = lastRenderedData.blockedByCategory || {};
  const nextCats = newData.blockedByCategory || {};
  
  // Compare key fields for efficient diffing
  return (
    newData.blocked !== lastRenderedData.blocked ||
    newData.dataSaved !== lastRenderedData.dataSaved ||
    newData.energySaved !== lastRenderedData.energySaved ||
    newData.co2Saved !== lastRenderedData.co2Saved ||
    groupCountsChanged ||
    (groupCountsChanged === false && getFastGroupFingerprint(prevGroups) !== getFastGroupFingerprint(nextGroups)) ||
    (nextCats.ads || 0) !== (prevCats.ads || 0) ||
    (nextCats.trackers || 0) !== (prevCats.trackers || 0) ||
    (nextCats.other || 0) !== (prevCats.other || 0)
  );
}

// ── Smart refresh with debounce ─────────────────────────────────────────────
function scheduleSmartRefresh(data) {
  if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
  
  refreshDebounceTimer = setTimeout(async () => {
    refreshDebounceTimer = null;
    if (currentTabId && hasDataChanged(data)) {
      renderTabStats(data);
    }
  }, SMART_REFRESH_DEBOUNCE_MS);
}

// ── Setup message listener for background updates ─────────────────────────────
function setupMessageListener() {
  api.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'popup-stats-update') {
      const tabId = request.tabId;
      if (tabId === currentTabId && request.data) {
        // Debounced smart refresh
        scheduleSmartRefresh(request.data);
      }
      sendResponse({ ok: true });
      return true;
    }
  });
}

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
  currentBlockedEntities = options?.blockedEntities || {};

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

  // Apply theme
  applyTheme(options?.theme || 'system');

  // Render module cards from options
  updateModuleCards(options);

  // Setup message listener for background updates (event-driven)
  setupMessageListener();

  // Load tab stats once on init
  await loadTabStats();

  // Set up event listeners
  setupListeners();

  // Fallback polling every 5 seconds (only if background stops sending updates)
  pollbackTimer = setInterval(loadTabStats, POLLBACK_INTERVAL_MS);
}

// ── Load tab stats ──────────────────────────────────────────────────────────

async function loadTabStats() {
  if (!currentTabId) return;

  const data = await sendMessage({ action: 'get-tab-stats', tabId: currentTabId });
  if (!data) return;
  // Smart refresh: only render if data changed
  if (hasDataChanged(data)) {
    renderTabStats(data);
  }
}

// ── Render tab stats (extracted from loadTabStats for reusability) ─────────────

function renderTabStats(data) {
  if (!data) return;
  lastRenderedData = { ...data }; // Save for next diff
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
    $('#saved-unit').textContent = 'KB Saved';
  }

  // Update Eco Stats
  const energyWh = (data.energySaved || 0) * 1000;
  $('#eco-energy').textContent = energyWh >= 1000 ? (energyWh / 1000).toFixed(2) + ' kWh' : Math.round(energyWh) + ' Wh';
  const ecoC02El = $('#eco-co2');
  if (ecoC02El) ecoC02El.textContent = (data.co2Saved || 0).toFixed(1) + ' g';

  // Update groups
  const groups = data.groups || { trackers: [], ads: [], other: [] };
  if (!groups.trackers) groups.trackers = [];
  if (!groups.ads) groups.ads = [];
  if (!groups.other) groups.other = [];
  lastGroups = groups;
  currentEntityControl = resolveEntityControl(data);

  renderGroup('trackers', groups.trackers);
  renderGroup('ads', groups.ads);
  renderGroup('other', groups.other);
  updateEntityActionUI();

  // Show/hide empty state (hidden compat list)
  const hasItems = groups.trackers.length + groups.ads.length + groups.other.length > 0;
  const emptyStateEl = $('#empty-state');
  if (emptyStateEl) emptyStateEl.classList.toggle('hidden', hasItems);

  // OA Panel — dona + categorías
  updateOAPanel(groups, blocked, data.blockedByCategory || null);

  // Update live stream (skip if disabled by default)
  if (liveStreamEnabled) {
    updateLiveStream(data.recentRequests || [], blocked);
  }
}

/**
 * Render a group of trackers/ads/other.
 * Phase 8: Handles enriched objects {domain, owner, category} with owner display.
 * Falls back to plain domain strings for backward compatibility.
 * 
 * @param {string} name - group name (trackers, ads, other)
 * @param {array} items - array of strings or enriched objects
 */
function renderGroup(name, items) {
  const groupEl = $(`#group-${name}`);
  const countEl = $(`#count-${name}`);
  const listEl = $(`#list-${name}`);

  if (!items || items.length === 0) {
    groupEl.classList.add('hidden');
    return;
  }

  groupEl.classList.remove('hidden');
  if (countEl) countEl.textContent = items.length;

  // Only re-render if content changed (with enrichment handling)
  const currentContent = listEl.dataset.items || '';
  const newContent = items.map(item => {
    if (typeof item === 'string') return item;
    return `${item.domain}|${item.owner}|${item.reason}|${item.confidence}|${item.fingerprinting}`;
  }).join(',');
  if (currentContent === newContent) return;
  listEl.dataset.items = newContent;

  listEl.innerHTML = '';
  for (const item of items) {
    const tracker = normalizeTrackerItem(item);
    const { domain, owner } = tracker;
    
    const domainDisplay = escapeHtml(domain);
    const ownerDisplay = escapeHtml(owner);
    const detailsHtml = buildTrackerMetaLine(tracker);
    const titleText = owner && owner !== domain ? `${owner} (${domain})` : domain;
    const subtitleHtml = owner && owner !== domain ? `<small>${domainDisplay}</small>` : '';
    
    const item_el = document.createElement('div');
    item_el.className = 'request-item';
    item_el.innerHTML = `
      <span class="request-domain" title="${escapeHtml(titleText)}">
        <span class="request-owner">${ownerDisplay}</span>
        ${subtitleHtml}
        <span class="request-meta">${detailsHtml}</span>
      </span>
      <span class="request-blocked-icon">✕</span>
    `;
    listEl.appendChild(item_el);
  }
}

function normalizeTrackerItem(item) {
  if (typeof item === 'string') {
    return { domain: item, owner: item, ownerId: item, reason: 'rule-match', category: 'other', confidence: 0, fingerprinting: false };
  }

  if (item && typeof item === 'object') {
    const domain = String(item.domain || item.d || 'unknown');
    const owner = String(item.owner || domain);
    return {
      domain,
      owner,
      ownerId: String(item.ownerId || domain),
      reason: String(item.reason || 'rule-match'),
      category: String(item.category || 'other'),
      confidence: Number(item.confidence) || 0,
      fingerprinting: item.fingerprinting === true,
    };
  }

  const fallback = String(item || 'unknown');
  return { domain: fallback, owner: fallback, ownerId: fallback, reason: 'rule-match', category: 'other', confidence: 0, fingerprinting: false };
}

function resolveEntityControl(data) {
  if (data?.entityControl?.ownerId) {
    return {
      ownerId: String(data.entityControl.ownerId),
      owner: String(data.entityControl.owner || data.entityControl.ownerId),
      blocked: data.entityControl.blocked === true || currentBlockedEntities[data.entityControl.ownerId] === true,
      domainCount: Number(data.entityControl.domainCount) || 0,
    };
  }

  const items = [
    ...(data?.groups?.trackers || []),
    ...(data?.groups?.ads || []),
    ...(data?.groups?.other || []),
  ];
  const counts = new Map();

  for (const rawItem of items) {
    const item = normalizeTrackerItem(rawItem);
    const ownerId = String(item.ownerId || item.domain || '').trim();
    if (!ownerId) continue;

    const entry = counts.get(ownerId) || { ownerId, owner: item.owner || ownerId, score: 0 };
    entry.score += 1 + (Number(item.confidence) || 0);
    counts.set(ownerId, entry);
  }

  const ranked = [...counts.values()].sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;

  const top = ranked[0];
  return {
    ownerId: top.ownerId,
    owner: top.owner,
    blocked: currentBlockedEntities[top.ownerId] === true,
    domainCount: 0,
  };
}

function updateEntityActionUI() {
  const section = $('#entity-action-section');
  const ownerEl = $('#entity-action-owner');
  const metaEl = $('#entity-action-meta');
  const btn = $('#btn-entity-action');
  if (!section || !ownerEl || !metaEl || !btn) return;

  if (!currentEntityControl?.ownerId) {
    section.classList.add('hidden');
    btn.disabled = true;
    return;
  }

  section.classList.remove('hidden');
  ownerEl.textContent = currentEntityControl.owner;
  metaEl.textContent = currentEntityControl.domainCount > 1
    ? `${currentEntityControl.domainCount} domains in this entity`
    : 'Apply blocking to every domain in this entity';

  const blocked = currentBlockedEntities[currentEntityControl.ownerId] === true || currentEntityControl.blocked === true;
  currentEntityControl.blocked = blocked;
  btn.disabled = false;
  btn.classList.toggle('is-unblock', blocked);
  btn.textContent = blocked
    ? `Unblock ${currentEntityControl.owner}`
    : `Block ${currentEntityControl.owner}`;
}

async function toggleEntityBlock() {
  if (!currentEntityControl?.ownerId) return;

  const btn = $('#btn-entity-action');
  if (!btn) return;

  const nextBlocked = !currentEntityControl.blocked;
  const previousText = btn.textContent;
  btn.disabled = true;
  btn.textContent = nextBlocked ? 'Blocking...' : 'Unblocking...';

  const result = await sendMessage({
    action: 'toggle-entity-block',
    ownerId: currentEntityControl.ownerId,
    blocked: nextBlocked,
  });

  if (result?.success) {
    if (result.blocked) currentBlockedEntities[currentEntityControl.ownerId] = true;
    else delete currentBlockedEntities[currentEntityControl.ownerId];

    currentEntityControl.blocked = result.blocked === true;
    updateEntityActionUI();
    await loadTabStats();
    return;
  }

  btn.disabled = false;
  btn.textContent = previousText;
}

function formatReasonLabel(reason) {
  switch (reason) {
    case 'entity-block':
      return 'Entity block';
    case 'first-party-relaxed':
      return 'First-party relaxed';
    case 'allowlist':
      return 'Allowed by allowlist';
    case 'rule-match':
      return 'Matched block rule';
    default:
      return 'Blocked';
  }
}

function formatConfidenceLabel(confidence) {
  if (!confidence || confidence <= 0) return 'Low confidence';
  if (confidence >= 0.05) return 'High confidence';
  if (confidence >= 0.01) return 'Medium confidence';
  return 'Low confidence';
}

function buildTrackerMetaLine(item) {
  const parts = [formatReasonLabel(item.reason)];
  if (item.category && item.category !== 'other') {
    parts.push(String(item.category));
  }
  parts.push(formatConfidenceLabel(item.confidence));
  if (item.fingerprinting) {
    parts.push('Fingerprinting');
  }
  return escapeHtml(parts.join(' • '));
}

// ── OA Panel — dona de categorías ──────────────────────────────────────────

const OA_COLORS = {
  ads:      '#e74c3c',
  trackers: '#f39c12',
  other:    '#34dbc2',
};

const OA_LABELS = {
  ads:      'Advertising',
  trackers: 'Site Analytics',
  other:    'Other',
};

let lastDonutCounts = null;

function updateOAPanel(groups, blocked, blockedByCategory) {
  // Domain-unique counts (used only for donut segments proportions + domain list)
  const domainCounts = {
    ads:      (groups.ads      || []).length,
    trackers: (groups.trackers || []).length,
    other:    (groups.other    || []).length,
  };
  const domainTotal = domainCounts.ads + domainCounts.trackers + domainCounts.other;

  // Per-category request counts (accurate total, same units as badge)
  const counts = blockedByCategory && (blockedByCategory.ads + blockedByCategory.trackers + blockedByCategory.other) > 0
    ? blockedByCategory
    : { ads: domainCounts.ads, trackers: domainCounts.trackers, other: domainCounts.other };
  const total = counts.ads + counts.trackers + counts.other;

  // Contador de blockeados en la fila inferior
  const blockedBadge = $('#oa-blocked-count');
  if (blockedBadge) blockedBadge.textContent = blocked;

  // Número central de la dona — muestra el total de requests bloqueadas (igual que el badge)
  const totalEl = $('#donut-total');
  if (totalEl) totalEl.textContent = blocked;

  // Donut CSS vars — skip si counts idénticos
  const donutEl = $('#oa-donut-wrap');
  if (donutEl) {
    const countsChanged = !lastDonutCounts ||
      lastDonutCounts.ads !== counts.ads ||
      lastDonutCounts.trackers !== counts.trackers ||
      lastDonutCounts.other !== counts.other;
    if (countsChanged) {
      renderDonut(donutEl, counts, total);
      lastDonutCounts = { ...counts };
    }
  }

  // Filas de categorías
  renderOACats(counts, total);

  // Lista plana (vista lista) — usa dominios únicos para no repetir entradas
  const flatList = $('#flat-list');
  if (flatList) {
    const all = [
      ...(groups.ads      || []).map(d => ({ d, cat: 'ads' })),
      ...(groups.trackers || []).map(d => ({ d, cat: 'trackers' })),
      ...(groups.other    || []).map(d => ({ d, cat: 'other' })),
    ];
    const newKey = all.map(({ d, cat }) => {
      const { domain, owner, reason, confidence, fingerprinting } = normalizeTrackerItem(d);
      return `${cat}:${domain}:${owner}:${reason}:${confidence}:${fingerprinting}`;
    }).join(',');
    if (flatList.dataset.key !== newKey) {
      flatList.dataset.key = newKey;
      flatList.innerHTML = '';
      for (const { d, cat } of all.slice(0, 50)) {
        const tracker = normalizeTrackerItem(d);
        const { domain, owner } = tracker;
        const primary = owner && owner !== domain ? owner : domain;
        const secondary = owner && owner !== domain ? domain : OA_LABELS[cat] || cat;
        const meta = buildTrackerMetaLine({ ...tracker, category: cat });
        const el = document.createElement('div');
        el.className = 'flat-entry';
        el.innerHTML =
          `<span class="flat-entry-dot" style="background:${OA_COLORS[cat]}"></span>` +
          `<span class="flat-entry-body">` +
            `<span class="flat-entry-domain" title="${escapeHtml(domain)}">${escapeHtml(primary)}</span>` +
            `<span class="flat-entry-subtitle">${escapeHtml(secondary)}</span>` +
          `</span>` +
          `<span class="flat-entry-meta">${meta}</span>`;
        flatList.appendChild(el);
      }
    }
  }
}

function renderDonut(container, counts, total) {
  const adsAngle = total > 0 ? (counts.ads || 0) / total * 360 : 0;
  const trackersAngle = total > 0 ? (counts.trackers || 0) / total * 360 : 0;
  const otherAngle = total > 0 ? (counts.other || 0) / total * 360 : 0;

  container.style.setProperty('--oa-ads-angle', `${adsAngle}deg`);
  container.style.setProperty('--oa-trackers-angle', `${trackersAngle}deg`);
  container.style.setProperty('--oa-other-angle', `${otherAngle}deg`);
}

function renderOACats(counts, total) {
  const catsEl = $('#oa-cats');
  if (!catsEl) return;
  const emptyEl = $('#oa-empty');

  // Elimina filas anteriores
  for (const el of [...catsEl.querySelectorAll('.oa-cat-row')]) el.remove();

  if (total === 0) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }
  if (emptyEl) emptyEl.classList.add('hidden');

  for (const cat of ['ads', 'trackers', 'other']) {
    const count = counts[cat] || 0;
    if (count === 0) continue;
    const row = document.createElement('div');
    row.className = 'oa-cat-row';
    row.innerHTML =
      `<span class="oa-cat-dot" style="background:${OA_COLORS[cat]}"></span>` +
      `<span class="oa-cat-name">${escapeHtml(OA_LABELS[cat])}</span>` +
      `<span class="oa-cat-count">${count}</span>`;
    if (emptyEl) { catsEl.insertBefore(row, emptyEl); } else { catsEl.appendChild(row); }
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
    statusText.textContent = 'Protection Paused';
    toggle.checked = false;
  } else {
    statusSection.className = 'popup-status active';
    statusDot.className = 'status-dot active';
    statusText.textContent = 'Protection Active';
    toggle.checked = true;
  }
}

// ── Protection Level ─────────────────────────────────────────────────────────

function updateLevelUI(level) {
  for (const btn of $$('.level-btn')) {
    const isActive = btn.dataset.level === level;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  }
  $('#level-status').textContent = '';
}

async function changeProtectionLevel(level) {
  const btns = $$('.level-btn');
  const statusEl = $('#level-status');

  // Disable buttons while applying
  for (const btn of btns) {
    btn.classList.add('loading');
    btn.disabled = true;
  }
  statusEl.textContent = 'Applying...';
  statusEl.style.color = '';

  // Timeout fallback in case background never responds
  const applyingTimeout = setTimeout(() => {
    for (const btn of btns) {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
    statusEl.style.color = 'var(--color-danger)';
    statusEl.textContent = 'Timed out — try again';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  }, 8000);

  const result = await sendMessage({ action: 'change-protection-level', level });

  clearTimeout(applyingTimeout);
  for (const btn of btns) {
    btn.classList.remove('loading');
    btn.disabled = false;
  }

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
                    (req.type === 'ad' || req.type === 'ads') ? 'var(--color-danger)' : 'var(--color-text-tertiary)';
      const now = new Date();
      const time = String(now.getHours()).padStart(2, '0') + ':' +
                   String(now.getMinutes()).padStart(2, '0') + ':' +
                   String(now.getSeconds()).padStart(2, '0');
      const liveLabel = req.owner && req.owner !== req.domain ? req.owner : (req.domain || req.url || 'unknown');
      const liveTitle = req.reason ? `${liveLabel} • ${formatReasonLabel(req.reason)}` : liveLabel;
      item.innerHTML = `<span class="live-item-type" style="background:${color}"></span>` +
        `<span class="live-item-domain" title="${escapeHtml(liveTitle)}">${escapeHtml(liveLabel)}</span>` +
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
  for (const btn of $$('.cat-chip')) {
    const cat = btn.dataset.cat;
    btn.classList.toggle('active', !!categoryState[cat]);
  }
}

let categoryTogglePending = false;

async function toggleCategory(cat) {
  if (categoryTogglePending) return; // Guard against race from rapid clicks
  categoryTogglePending = true;

  categoryState[cat] = !categoryState[cat];
  updateCategoryTogglesUI();

  try {
    // Build a single atomic message combining list updates + categoryState + antiFingerprint
    const listUpdates = {};
    const extraOptions = {};

    if (cat === 'ads') {
      listUpdates['easylist'] = categoryState.ads;
      listUpdates['ublock-filters'] = categoryState.ads;
      listUpdates['peter-lowe'] = categoryState.ads;
    } else if (cat === 'trackers') {
      listUpdates['easyprivacy'] = categoryState.trackers;
      listUpdates['ublock-privacy'] = categoryState.trackers;
    } else if (cat === 'fingerprinting') {
      extraOptions.antiFingerprint = categoryState.fingerprinting;
    }

    await sendMessage({
      action: 'toggle-category',
      category: cat,
      enabled: categoryState[cat],
      listUpdates,
      categoryState,
      extraOptions,
    });
  } finally {
    categoryTogglePending = false;
  }
}

// ── Pause Timer ─────────────────────────────────────────────────────────────

function updatePauseUI() {
  const section = $('#pause-section');
  if (!section) return;

  const isPaused = pauseEndTime > Date.now();
  section.classList.toggle('visible', isPaused);

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

function inferFalsePositiveCategory() {
  const ads = lastGroups?.ads?.length || 0;
  const trackers = lastGroups?.trackers?.length || 0;
  const other = lastGroups?.other?.length || 0;
  if (ads >= trackers && ads >= other && ads > 0) return 'ads';
  if (trackers >= other && trackers > 0) return 'trackers';
  if (other > 0) return 'other';
  return 'unknown';
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

    if (currentTabId) {
      try {
        await api.tabs.reload(currentTabId);
      } catch (err) {
        // Ignore reload failures (tab closed/navigated)
      }
    }
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
  for (const btn of $$('.cat-chip')) {
    btn.addEventListener('click', () => {
      toggleCategory(btn.dataset.cat);
    });
  }

  // Pause buttons
  for (const btn of $$('.pause-opt')) {
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

  $('#btn-report-fp').addEventListener('click', async () => {
    const btn = $('#btn-report-fp');
    const prevHTML = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Reporting...';
    const category = inferFalsePositiveCategory();
    const result = await sendMessage({
      action: 'report-false-positive',
      hostname: currentHostname,
      category,
    });
    if (result?.success) {
      btn.textContent = 'Reported';
      setTimeout(() => {
        btn.innerHTML = prevHTML;
        btn.disabled = false;
      }, 1200);
      return;
    }
    btn.textContent = 'Retry Report';
    btn.disabled = false;
  });

  $('#btn-entity-action')?.addEventListener('click', () => {
    toggleEntityBlock();
  });

  // Group toggle (collapse/expand)
  for (const header of $$('.group-header')) {
    header.addEventListener('click', () => {
      header.classList.toggle('open');
    });
    // Start open
    header.classList.add('open');
  }

  // OA view toggles (chart / list)
  $('#view-chart')?.addEventListener('click', () => {
    $('#oa-chart-view')?.classList.remove('hidden');
    $('#oa-list-view')?.classList.add('hidden');
    $('#view-chart')?.classList.add('active');
    $('#view-list')?.classList.remove('active');
  });
  $('#view-list')?.addEventListener('click', () => {
    $('#oa-chart-view')?.classList.add('hidden');
    $('#oa-list-view')?.classList.remove('hidden');
    $('#view-chart')?.classList.remove('active');
    $('#view-list')?.classList.add('active');
  });

  // Module card toggles
  $('#mc-toggle-adblock')?.addEventListener('change', async (e) => {
    const opts = await sendMessage({ action: 'get-options' });
    const lists = { ...opts.lists };
    lists['easylist'] = { ...lists['easylist'], enabled: e.target.checked };
    lists['ublock-filters'] = { ...lists['ublock-filters'], enabled: e.target.checked };
    lists['peter-lowe'] = { ...lists['peter-lowe'], enabled: e.target.checked };
    const updated = { ...opts, lists };
    const storage = (typeof browser !== 'undefined' && browser.storage?.local) ? browser.storage.local : chrome.storage.local;
    await new Promise(r => {
      const p = storage.set({ options: updated });
      if (p && typeof p.then === 'function') p.then(r, r); else r();
    });
    updateModuleCards(updated);
  });

  $('#mc-toggle-antitrack')?.addEventListener('change', async (e) => {
    const opts = await sendMessage({ action: 'get-options' });
    const lists = { ...opts.lists };
    lists['easyprivacy'] = { ...lists['easyprivacy'], enabled: e.target.checked };
    lists['ublock-privacy'] = { ...lists['ublock-privacy'], enabled: e.target.checked };
    const updated = { ...opts, lists };
    const storage = (typeof browser !== 'undefined' && browser.storage?.local) ? browser.storage.local : chrome.storage.local;
    await new Promise(r => {
      const p = storage.set({ options: updated });
      if (p && typeof p.then === 'function') p.then(r, r); else r();
    });
    updateModuleCards(updated);
  });

  $('#mc-toggle-consent')?.addEventListener('change', async (e) => {
    const opts = await sendMessage({ action: 'get-options' });
    const lists = { ...opts.lists };
    lists['ublock-annoyances-cookies'] = { ...lists['ublock-annoyances-cookies'], enabled: e.target.checked };
    lists['ublock-annoyances-others'] = { ...lists['ublock-annoyances-others'], enabled: e.target.checked };
    const updated = { ...opts, lists };
    const storage = (typeof browser !== 'undefined' && browser.storage?.local) ? browser.storage.local : chrome.storage.local;
    await new Promise(r => {
      const p = storage.set({ options: updated });
      if (p && typeof p.then === 'function') p.then(r, r); else r();
    });
    updateModuleCards(updated);
  });

  $('#mc-toggle-ia-shield')?.addEventListener('change', async (e) => {
    const opts = await sendMessage({ action: 'get-options' });
    const experiments = { ...(opts.experiments || {}), iaShield: e.target.checked };
    const updated = { ...opts, experiments };
    const storage = (typeof browser !== 'undefined' && browser.storage?.local) ? browser.storage.local : chrome.storage.local;
    await new Promise(r => {
      const p = storage.set({ options: updated });
      if (p && typeof p.then === 'function') p.then(r, r); else r();
    });
    updateModuleCards(updated);
  });
}

// ── Module Cards ─────────────────────────────────────────────────────────────

function updateModuleCards(options) {
  const lists = options?.lists || {};
  const experiments = options?.experiments || {};

  const adblockOn = lists['easylist']?.enabled !== false;
  const antitrackOn = lists['easyprivacy']?.enabled !== false;
  const consentOn = lists['ublock-annoyances-cookies']?.enabled === true;
  const iaShieldOn = experiments.iaShield === true;

  function applyCard(id, toggleId, stateId, on) {
    const card = $(`#${id}`);
    const toggle = $(`#${toggleId}`);
    const state = $(`#${stateId}`);
    if (!card) return;
    card.classList.toggle('active', on);
    if (toggle) toggle.checked = on;
    if (state) state.textContent = on ? 'On' : 'Off';
  }

  applyCard('mc-adblock', 'mc-toggle-adblock', 'mc-adblock-state', adblockOn);
  applyCard('mc-antitrack', 'mc-toggle-antitrack', 'mc-antitrack-state', antitrackOn);
  applyCard('mc-consent', 'mc-toggle-consent', 'mc-consent-state', consentOn);
  applyCard('mc-ia-shield', 'mc-toggle-ia-shield', 'mc-ia-shield-state', iaShieldOn);
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
  div.textContent = String(str ?? '');
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

// ── Start ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

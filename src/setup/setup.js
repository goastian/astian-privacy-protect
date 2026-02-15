/**
 * Midori Privacy Blocker — Setup Wizard
 * Handles the first-run onboarding experience.
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

let currentStep = 1;
const TOTAL_STEPS = 4;

// ── Protection level presets ─────────────────────────────────────────────────

const PROTECTION_LEVELS = {
  basic: {
    label: 'Basic',
    antiFingerprint: false,
    lists: {
      'easylist': true,
      'easyprivacy': true,
      'ublock-filters': true,
      'ublock-privacy': true,
      'peter-lowe': true,
      'ublock-quick-fixes': true,
      // Disabled
      'ublock-annoyances-cookies': false,
      'ublock-annoyances-others': false,
      'fanboy-social': false,
      'fanboy-annoyance': false,
      'adguard-base': false,
      'adguard-tracking': false,
      'adguard-social': false,
      'adguard-annoyances': false,
      'adguard-mobile': false,
      'adguard-spyware-firstparty': false,
      'easylist-spanish': false,
      'easylist-germany': false,
      'easylist-france': false,
      'ublock-unbreak': true,
    },
  },
  standard: {
    label: 'Standard',
    antiFingerprint: true,
    lists: {
      'easylist': true,
      'easyprivacy': true,
      'ublock-filters': true,
      'ublock-privacy': true,
      'peter-lowe': true,
      'ublock-quick-fixes': true,
      'ublock-unbreak': true,
      'ublock-annoyances-cookies': true,
      'fanboy-social': true,
      // Disabled
      'ublock-annoyances-others': false,
      'fanboy-annoyance': false,
      'adguard-base': false,
      'adguard-tracking': false,
      'adguard-social': false,
      'adguard-annoyances': false,
      'adguard-mobile': false,
      'adguard-spyware-firstparty': false,
      'easylist-spanish': false,
      'easylist-germany': false,
      'easylist-france': false,
    },
  },
  strict: {
    label: 'Strict',
    antiFingerprint: true,
    lists: {
      'easylist': true,
      'easyprivacy': true,
      'ublock-filters': true,
      'ublock-privacy': true,
      'peter-lowe': true,
      'ublock-quick-fixes': true,
      'ublock-unbreak': true,
      'ublock-annoyances-cookies': true,
      'ublock-annoyances-others': true,
      'fanboy-social': true,
      'fanboy-annoyance': true,
      'adguard-base': true,
      'adguard-tracking': true,
      'adguard-social': true,
      'adguard-annoyances': true,
      'adguard-mobile': false,
      'adguard-spyware-firstparty': true,
      'easylist-spanish': false,
      'easylist-germany': false,
      'easylist-france': false,
    },
  },
};

// ── Navigation ───────────────────────────────────────────────────────────────

function goToStep(step) {
  if (step < 1 || step > TOTAL_STEPS) return;

  currentStep = step;

  // Update step visibility
  for (const el of $$('.setup-step')) {
    el.classList.toggle('active', el.id === `step-${step}`);
  }

  // Update progress bar
  const pct = (step / TOTAL_STEPS) * 100;
  $('#progress-fill').style.width = pct + '%';

  // Update step indicators
  for (const dot of $$('.progress-step')) {
    const s = parseInt(dot.dataset.step);
    dot.classList.toggle('active', s === step);
    dot.classList.toggle('done', s < step);
  }

  // Update buttons
  const btnBack = $('#btn-back');
  const btnNext = $('#btn-next');

  btnBack.style.visibility = step === 1 ? 'hidden' : 'visible';

  if (step === TOTAL_STEPS) {
    btnNext.innerHTML = `
      Finish Setup
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    `;
    btnNext.className = 'btn btn-finish';
    updateSummary();
  } else {
    btnNext.innerHTML = `
      Continue
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    `;
    btnNext.className = 'btn btn-primary btn-lg';
  }
}

// ── Option card selection ────────────────────────────────────────────────────

function setupOptionCards() {
  // Step 1: Install mode cards
  for (const card of $$('.option-card')) {
    card.addEventListener('click', () => {
      for (const c of $$('.option-card')) c.classList.remove('selected');
      card.classList.add('selected');
      card.querySelector('input').checked = true;
    });
  }

  // Step 2: Protection level cards
  for (const card of $$('.level-card')) {
    card.addEventListener('click', () => {
      for (const c of $$('.level-card')) c.classList.remove('selected');
      card.classList.add('selected');
      card.querySelector('input').checked = true;
    });
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

function getSelectedMode() {
  const radio = document.querySelector('input[name="install-mode"]:checked');
  return radio ? radio.value : 'both';
}

function getSelectedLevel() {
  const radio = document.querySelector('input[name="protection-level"]:checked');
  return radio ? radio.value : 'standard';
}

function updateSummary() {
  const mode = getSelectedMode();
  const level = getSelectedLevel();
  const preset = PROTECTION_LEVELS[level];

  // Mode
  const modeLabels = {
    both: 'Blocker + AstianGO Search',
    blocker: 'Blocker Only',
    search: 'AstianGO Search Only',
  };
  $('#summary-mode').textContent = modeLabels[mode] || mode;

  // Level
  $('#summary-level').textContent = preset.label;

  // Search engine
  const useAstianGO = mode === 'both' || mode === 'search';
  $('#summary-search').textContent = useAstianGO ? 'AstianGO.com' : 'Default (unchanged)';

  // Anti-fingerprinting
  const blockerEnabled = mode === 'both' || mode === 'blocker';
  $('#summary-fp').textContent = (blockerEnabled && preset.antiFingerprint) ? 'Enabled' : 'Disabled';

  // Count enabled lists
  if (blockerEnabled) {
    const enabledCount = Object.values(preset.lists).filter(Boolean).length;
    $('#summary-lists').textContent = `${enabledCount} active`;
  } else {
    $('#summary-lists').textContent = 'None (blocker disabled)';
  }
}

// ── Apply configuration ──────────────────────────────────────────────────────

async function applyConfiguration() {
  const mode = getSelectedMode();
  const level = getSelectedLevel();
  const preset = PROTECTION_LEVELS[level];
  const blockerEnabled = mode === 'both' || mode === 'blocker';

  // Build the options to save
  const configUpdate = {
    setupCompleted: true,
    protectionLevel: level,
    installMode: mode,
    enabled: blockerEnabled,
    antiFingerprint: blockerEnabled ? preset.antiFingerprint : false,
  };

  // Update list enabled states if blocker is active
  if (blockerEnabled) {
    // Get current options to preserve list URLs
    const currentOptions = await sendMessage({ action: 'get-options' });
    const lists = currentOptions?.lists || {};

    for (const [listId, enabled] of Object.entries(preset.lists)) {
      if (lists[listId]) {
        lists[listId].enabled = enabled;
      }
    }

    configUpdate.lists = lists;
  }

  // Try saving via background message first
  const result = await sendMessage({ action: 'save-setup', config: configUpdate });

  // Fallback: save directly to storage if background didn't respond
  if (!result || result.error) {
    console.log('[midori-setup] Background unavailable, saving directly to storage');
    await saveDirectToStorage(configUpdate);
  }
}

// AstianGO is set as default search engine via chrome_settings_overrides
// in the manifest. The browser handles the prompt to the user automatically
// on extension install. No programmatic action needed here.

// ── Finish ───────────────────────────────────────────────────────────────────

async function finishSetup() {
  const btnNext = $('#btn-next');
  btnNext.disabled = true;
  btnNext.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
    Applying settings...
  `;

  try {
    await applyConfiguration();

    // Brief delay for visual feedback
    await new Promise(r => setTimeout(r, 600));

    // Redirect to options page
    let optionsUrl;
    try {
      optionsUrl = api.runtime.getURL('options/options.html');
    } catch (e) {
      optionsUrl = '../options/options.html';
    }
    window.location.href = optionsUrl;
  } catch (e) {
    console.error('[midori-setup] Failed to apply configuration:', e.message || e);
    btnNext.disabled = false;
    btnNext.innerHTML = `
      Retry
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    `;
  }
}

// ── Messaging ────────────────────────────────────────────────────────────────

function sendMessage(msg) {
  return new Promise((resolve) => {
    try {
      if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
        browser.runtime.sendMessage(msg).then(resolve).catch((e) => {
          console.warn('[midori-setup] sendMessage error:', e);
          resolve(null);
        });
        return;
      }
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[midori-setup] sendMessage error:', chrome.runtime.lastError.message);
            resolve(null);
          } else {
            resolve(response);
          }
        });
        return;
      }
    } catch (e) {
      console.warn('[midori-setup] sendMessage exception:', e);
    }
    resolve(null);
  });
}

/**
 * Fallback: save directly to storage if background messaging fails.
 * This ensures the setup can complete even if the background script
 * hasn't fully initialized yet.
 */
async function saveDirectToStorage(config) {
  const storage = (typeof browser !== 'undefined' && browser.storage?.local)
    ? browser.storage.local
    : chrome.storage.local;

  return new Promise((resolve, reject) => {
    storage.get('options', (data) => {
      const current = data?.options || {};
      const merged = { ...current, ...config };
      const result = storage.set({ options: merged });
      if (result && typeof result.then === 'function') {
        result.then(() => resolve(merged)).catch(reject);
      } else {
        // Callback-based (Chromium)
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(merged);
        }
      }
    });
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupOptionCards();

  $('#btn-next').addEventListener('click', () => {
    if (currentStep === TOTAL_STEPS) {
      finishSetup();
    } else {
      goToStep(currentStep + 1);
    }
  });

  $('#btn-back').addEventListener('click', () => {
    goToStep(currentStep - 1);
  });

  // Initialize first step
  goToStep(1);
});

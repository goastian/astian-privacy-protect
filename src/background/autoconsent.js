/**
 * Midori Privacy Blocker
 * Background script - AutoConsent handler for cookie banner auto-rejection
 * Runs CMP detection and auto-consent logic via DuckDuckGo AutoConsent library
 * License: MPL-2.0
 */

import AutoConsent from '@duckduckgo/autoconsent';
import autoconsentRulesJson from '@duckduckgo/autoconsent/rules/rules.json' assert { type: 'json' };
import consentomaticJson from '@duckduckgo/autoconsent/rules/consentomatic.json' assert { type: 'json' };
import { getOptions } from './storage.js';

// ═════════════════════════════════════════════════════════════════════════════
// AutoConsent Background Handler
// ═════════════════════════════════════════════════════════════════════════════

// Cache of per-tabId AutoConsent instances
const autoconsentInstances = new Map();
const AUTOCONSENT_TIMEOUT = 5000; // 5s max execution time per tab
const INSTANCE_CACHE_TTL = 60000; // 1m TTL for instances

// Extract rules from JSON imports
const autoconsentRulesCache = {
  autoconsent: autoconsentRulesJson.autoconsent || autoconsentRulesJson,
  consentomatic: consentomaticJson.consentomatic || consentomaticJson
};

/**
 * Initialize AutoConsent for a specific tab
 */
function getOrCreateAutoConsent(tabId) {
  if (autoconsentInstances.has(tabId)) {
    return autoconsentInstances.get(tabId);
  }

  try {
    const instance = new AutoConsent(
      (message) => {
        // Message handler callback for background ↔ page communication
        return new Promise((resolve) => {
          try {
            chrome.tabs.sendMessage(tabId, {
              action: 'autoconsent-bg-message',
              payload: message,
            }, (response) => {
              resolve(response?.result || null);
            });
          } catch (e) {
            resolve(null);
          }
        });
      },
      null, // no config
      autoconsentRulesCache
    );

    autoconsentInstances.set(tabId, instance);
    
    // Auto-cleanup after TTL
    setTimeout(() => {
      autoconsentInstances.delete(tabId);
    }, INSTANCE_CACHE_TTL);

    return instance;
  } catch (error) {
    console.error('[midori] AutoConsent creation failed:', error);
    return null;
  }
}

/**
 * Handle AutoConsent request from content script
 * Optimization: aggressive timeout, early exit on disabled, caching per tab
 */
export async function handleAutoConsentRequest(tabId) {
  const options = await getOptions();
  
  // Check if AutoConsent is enabled in options
  if (options.autoconsentEnabled === false) {
    return { success: false, reason: 'disabled' };
  }

  const instance = getOrCreateAutoConsent(tabId);
  if (!instance) {
    return { success: false, reason: 'init_failed' };
  }

  try {
    // Create a race between detectCmp and a timeout for faster failure
    const detectPromise = instance.detectCmp?.() || Promise.resolve(false);
    const timeoutPromise = new Promise(resolve => {
      setTimeout(() => resolve(false), 2000); // 2s timeout for detection
    });
    
    const cmpDetected = await Promise.race([detectPromise, timeoutPromise]);
    
    if (!cmpDetected) {
      return { success: false, reason: 'no_cmp' };
    }

    // Handle CMP (auto-reject) with timeout
    const handlePromise = instance.handleCmp?.() || Promise.resolve(false);
    const handleTimeoutPromise = new Promise(resolve => {
      setTimeout(() => resolve(false), 2000); // 2s timeout for handling
    });
    
    const handled = await Promise.race([handlePromise, handleTimeoutPromise]);
    
    if (handled) {
      console.log('[midori] AutoConsent: CMP handled on tab', tabId);
      return { success: true, handled: true };
    }

    return { success: true, handled: false, reason: 'cmp_not_handled' };
  } catch (error) {
    console.error('[midori] AutoConsent handling error:', error);
    return { success: false, reason: 'error', error: error.message };
  }
}

/**
 * Handle message from AutoConsent page context
 */
export function handleAutoConsentPageMessage(tabId, message) {
  const instance = autoconsentInstances.get(tabId);
  if (!instance) {
    return { result: null };
  }

  try {
    const result = instance.receiveMessageCallback?.(message);
    return { result };
  } catch (error) {
    console.error('[midori] AutoConsent page message error:', error);
    return { result: null };
  }
}

export default {
  getOrCreateAutoConsent,
  handleAutoConsentRequest,
  handleAutoConsentPageMessage,
};

import { getOptions } from './storage.js';
import {
  collectHighConfidenceDomains,
  getTrackerCategory,
  getTrackerDbMeta,
  getTrackerEntityMetadata,
} from './trackerdb.js';

const TRACKERDB_RULE_ID_MIN = 800001;
const TRACKERDB_RULE_ID_MAX = 800500;
const TRACKERDB_MAX_RULES = TRACKERDB_RULE_ID_MAX - TRACKERDB_RULE_ID_MIN + 1;
const TRACKERDB_LOW_RISK_RESOURCE_TYPES = ['image', 'sub_frame', 'ping', 'media', 'object', 'other'];
const TRACKERDB_SAFE_INITIATORS = [
  'gmail.com', 'googlemail.com', 'mail.google.com', 'drive.google.com',
  'docs.google.com', 'calendar.google.com', 'accounts.google.com',
  'outlook.com', 'live.com', 'office.com', 'office365.com', 'sharepoint.com',
  'youtube.com', 'youtu.be', 'twitch.tv', 'reddit.com',
];

export function createTrackerDbDnrController({ isChromium, protectionLevels, getEffectiveRolloutFlags }) {
  function shouldEnableTrackerDbAssisted(options) {
    const rollout = getEffectiveRolloutFlags(options);
    if (!rollout.entityBlocking) return false;

    const level = options?.protectionLevel || 'standard';
    return (
      options?.trackerDbEnabled !== false
      && protectionLevels[level]?.trackerDbAssisted === true
    );
  }

  async function applyTrackerDbDynamicRules(enabled) {
    if (!isChromium) return;

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = existing
      .filter((rule) => rule.id >= TRACKERDB_RULE_ID_MIN && rule.id <= TRACKERDB_RULE_ID_MAX)
      .map((rule) => rule.id);

    if (!enabled) {
      if (removeIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds });
        console.log(`[trackerdb] Cleared ${removeIds.length} TrackerDB dynamic rules`);
      }
      return;
    }

    const meta = getTrackerDbMeta();
    if (!meta.ready) {
      if (removeIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds });
        console.log(`[trackerdb] Cleared ${removeIds.length} TrackerDB dynamic rules (index not ready)`);
      }
      console.log('[trackerdb] Index not ready - skipping dynamic rule generation');
      return;
    }

    const options = await getOptions();
    const whitelist = options.whitelist || {};

    const candidates = collectHighConfidenceDomains(TRACKERDB_MAX_RULES);

    let ruleId = TRACKERDB_RULE_ID_MIN;
    const addRules = [];
    for (const domain of candidates) {
      if (whitelist[domain]) continue;
      if (ruleId > TRACKERDB_RULE_ID_MAX) break;
      const category = getTrackerCategory(domain);
      addRules.push({
        id: ruleId++,
        priority: category === 'ads' ? 12 : 6,
        action: { type: 'block' },
        condition: {
          requestDomains: [domain],
          domainType: 'thirdParty',
          resourceTypes: TRACKERDB_LOW_RISK_RESOURCE_TYPES,
          excludedInitiatorDomains: TRACKERDB_SAFE_INITIATORS,
        },
      });
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
      addRules,
    });
    console.log(`[trackerdb] Applied ${addRules.length} dynamic rules (assisted blocking)`);
  }

  async function updateDnrEntityBlockRules(options) {
    if (!isChromium) return;

    const rollout = getEffectiveRolloutFlags(options);
    const blockedEntities = options?.blockedEntities && typeof options.blockedEntities === 'object'
      ? options.blockedEntities
      : {};

    const blockedOwnerIds = rollout.entityBlocking
      ? Object.keys(blockedEntities).filter((ownerId) => blockedEntities[ownerId] === true)
      : [];

    const existingRules = await chrome.declarativeNetRequest.getSessionRules();
    const removeIds = existingRules
      .filter((rule) => rule.id >= 910000 && rule.id < 920000)
      .map((rule) => rule.id);

    const addRules = [];
    let nextRuleId = 910000;

    for (const ownerId of blockedOwnerIds) {
      const entity = getTrackerEntityMetadata(ownerId);
      const domains = Array.isArray(entity?.domains) && entity.domains.length
        ? entity.domains
        : (ownerId.includes('.') ? [ownerId] : []);

      if (!domains.length) continue;

      addRules.push({
        id: nextRuleId++,
        priority: 35,
        action: { type: 'allow' },
        condition: {
          initiatorDomains: domains,
          requestDomains: domains,
          resourceTypes: ['image', 'stylesheet', 'font', 'media', 'other'],
        },
      });

      addRules.push({
        id: nextRuleId++,
        priority: 15,
        action: { type: 'block' },
        condition: {
          requestDomains: domains,
          domainType: 'thirdParty',
          resourceTypes: [
            'sub_frame', 'stylesheet', 'script', 'image',
            'font', 'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other',
          ],
        },
      });
    }

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: removeIds,
      addRules,
    });
  }

  return {
    shouldEnableTrackerDbAssisted,
    applyTrackerDbDynamicRules,
    updateDnrEntityBlockRules,
  };
}

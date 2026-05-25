/**
 * Background service constants and policy presets.
 */

export const CHROMIUM_STATIC_RULESET_IDS = ['easylist', 'easyprivacy', 'ublock-filters', 'ublock-privacy', 'peter-lowe'];

export const VK_DEBUG_SITE_HOSTS = ['vkvideo.ru', 'vk.com', 'vk.ru'];

export const VK_DEBUG_REQUEST_HOSTS = ['vk.com', 'vk.ru', 'ms.vk.com', 'ms.vk.ru', 'login.vk.com', 'vkanalytics.net', 'userapi.com'];

export const FIREFOX_NETWORK_RESCUE_BYPASS_HOSTS = ['vkvideo.ru', 'vk.com', 'vk.ru'];

export const PROTECTION_LEVELS = {
  basic: {
    label: 'Basic',
    antiFingerprint: false,
      trackerDbAssisted: false,
    lists: {
      'easylist': true, 'easyprivacy': true, 'ublock-filters': true,
      'ublock-privacy': true, 'peter-lowe': false, 'ublock-quick-fixes': true,
      'ublock-unbreak': true,
      'ublock-annoyances-cookies': false, 'ublock-annoyances-others': false,
      'fanboy-social': false, 'fanboy-annoyance': false,
      'adguard-base': false, 'adguard-tracking': false, 'adguard-social': false,
      'adguard-annoyances': false, 'adguard-mobile': false,
      'adguard-spyware-firstparty': false,
      'easylist-spanish': false, 'easylist-germany': false, 'easylist-france': false,
    },
  },
  standard: {
    label: 'Standard',
    antiFingerprint: true,
      trackerDbAssisted: false,
    lists: {
      'easylist': true, 'easyprivacy': true, 'ublock-filters': true,
      'ublock-privacy': true, 'peter-lowe': false, 'ublock-quick-fixes': true,
      'ublock-unbreak': true, 'ublock-annoyances-cookies': false, 'fanboy-social': false,
      'ublock-annoyances-others': false, 'fanboy-annoyance': false,
      'adguard-base': false, 'adguard-tracking': false, 'adguard-social': false,
      'adguard-annoyances': false, 'adguard-mobile': false,
      'adguard-spyware-firstparty': false,
      'easylist-spanish': false, 'easylist-germany': false, 'easylist-france': false,
    },
  },
  strict: {
    label: 'Strict',
      trackerDbAssisted: true,
    antiFingerprint: true,
    lists: {
      'easylist': true, 'easyprivacy': true, 'ublock-filters': true,
      'ublock-privacy': true, 'peter-lowe': true, 'ublock-quick-fixes': true,
      'ublock-unbreak': true, 'ublock-annoyances-cookies': true,
      'ublock-annoyances-others': true, 'fanboy-social': true, 'fanboy-annoyance': true,
      'adguard-base': true, 'adguard-tracking': true, 'adguard-social': true,
      'adguard-annoyances': true, 'adguard-spyware-firstparty': true,
      'adguard-mobile': false,
      'easylist-spanish': false, 'easylist-germany': false, 'easylist-france': false,
    },
  },
};

export const DNR_RECORD_RATE_LIMIT_PER_TAB = 30; // events / sec / tab

export const CHROMIUM_BLOCK_DEDUPE_TTL_MS = 1500;

export const MAX_COSMETIC_BLOCKS_PER_REPORT = 50;

export const EXTERNAL_ALLOWED_ACTIONS = new Set([
  'get-stats-summary', 'get-report-stats', 'get-report-categories',
  'get-weekly-trend', 'get-privacy-summary', 'get-hourly-heatmap',
]);

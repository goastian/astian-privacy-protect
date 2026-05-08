/**
 * Midori Privacy Blocker
 * URL Cleaner — strips known tracking query parameters from navigations.
 *
 * Inspired by Ghostery's anti-tracking component: removes parameters that
 * carry user identifiers (utm_*, fbclid, gclid, _hsenc, mc_eid, ...) without
 * blocking the request, so the page still loads but the tracking ID does not
 * leak into the destination's analytics or referer chain.
 *
 * Cross-browser strategy:
 *   - Firefox / MV2: webRequest.onBeforeRequest returns { redirectUrl }.
 *   - Chromium / MV3: dynamic declarativeNetRequest rules with
 *     `redirect.transform.queryTransform.removeParams`.
 *
 * Scope: only `main_frame` and `sub_frame` requests. Subresources (images,
 * scripts, XHR) are left alone to avoid breaking SDKs that legitimately use
 * the same parameter names internally.
 *
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

// Curated allow-removal list. Each entry is a query parameter name that is
// known to be a passive tracking identifier safe to drop on navigation.
// Sources cross-referenced: ClearURLs, Ghostery, Brave query-filter, uBO.
export const TRACKING_PARAMS = Object.freeze([
  // Google Analytics / Ads
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'utm_brand', 'utm_social', 'utm_social-type',
  'utm_creative_format', 'utm_marketing_tactic',
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', '_ga', '_gl',
  // Facebook / Meta
  'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_source', 'fb_ref',
  // Microsoft / Bing
  'msclkid',
  // Twitter / X
  'twclid', 's', 't',
  // TikTok
  'ttclid',
  // LinkedIn
  'li_fat_id', 'trk', 'trkCampaign',
  // Mailchimp
  'mc_cid', 'mc_eid',
  // HubSpot
  '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp',
  // Yandex
  'yclid', '_openstat',
  // Pinterest
  'epik',
  // Reddit
  'rdt_cid',
  // Adobe Analytics
  's_cid',
  // Salesforce / Marketo
  'mkt_tok', 'sfmc_id',
  // Generic email-campaign markers
  'ml_subscriber', 'ml_subscriber_hash', 'oly_anon_id', 'oly_enc_id',
  // Klaviyo / Drip / others
  'kclickid', '_kx',
]);

const TRACKING_PARAMS_SET = new Set(TRACKING_PARAMS);

// Hostnames that should NEVER have query parameters touched. Includes
// well-known auth/OAuth flows where removing query keys would break login,
// plus the user's whitelist + critical first-party list (handled by callers).
const NEVER_CLEAN_HOSTS = new Set([
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'login.yahoo.com',
  'auth0.com',
  'okta.com',
]);

/**
 * Check if a URL has any known tracking parameter.
 * @param {URL} u
 */
function hasTrackingParam(u) {
  for (const key of u.searchParams.keys()) {
    if (TRACKING_PARAMS_SET.has(key)) return true;
  }
  return false;
}

/**
 * Build a cleaned URL string by stripping tracking params, or return null
 * if no change is needed.
 * @param {string} rawUrl
 * @returns {string|null}
 */
export function cleanUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  if (!rawUrl.startsWith('http')) return null;

  let u;
  try { u = new URL(rawUrl); }
  catch { return null; }

  if (NEVER_CLEAN_HOSTS.has(u.hostname)) return null;
  if (!u.search) return null;
  if (!hasTrackingParam(u)) return null;

  const removed = [];
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS_SET.has(key)) {
      u.searchParams.delete(key);
      removed.push(key);
    }
  }
  if (removed.length === 0) return null;
  return u.toString();
}

/**
 * Build the dynamic DNR rule used by Chromium MV3 to strip tracking params.
 * One single rule using `queryTransform.removeParams` covers all listed keys.
 *
 * @param {number} ruleId - stable id reserved for the cleaner rule
 * @returns {chrome.declarativeNetRequest.Rule}
 */
export function buildCleanerDnrRule(ruleId) {
  return {
    id: ruleId,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        transform: {
          queryTransform: {
            removeParams: [...TRACKING_PARAMS],
          },
        },
      },
    },
    condition: {
      // Match any URL that contains at least one '?' — actual filtering of
      // params is done by queryTransform; the engine only fires the rule
      // when removeParams produces a different URL.
      regexFilter: '^https?://.*\\?.+',
      resourceTypes: ['main_frame', 'sub_frame'],
    },
  };
}

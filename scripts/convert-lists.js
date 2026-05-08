/**
 * Midori Privacy Blocker
 * Convert ABP filter lists to Chrome declarativeNetRequest JSON format
 * Run: node scripts/convert-lists.js
 * Copyright 2024-present Astian Inc. All rights reserved.
 * License: MPL-2.0
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const RULES_DIR = resolve(ROOT, 'src', 'rules');

const LISTS = {
  'easylist': 'https://easylist.to/easylist/easylist.txt',
  'easyprivacy': 'https://easylist.to/easylist/easyprivacy.txt',
  'ublock-filters': 'https://ublockorigin.github.io/uAssets/filters/filters.txt',
  'ublock-privacy': 'https://ublockorigin.github.io/uAssets/filters/privacy.txt',
  'peter-lowe': 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext',
};

// Chrome DNR limits
const MAX_RULES_PER_LIST = 60000;

// Critical domains that should NEVER be blocked when navigating their own site.
// These are first-party functional domains required for major services to work.
// Rules targeting these domains will be forced to third-party only.
const CRITICAL_FIRST_PARTY_DOMAINS = [
  'youtube.com', 'www.youtube.com', 'googlevideo.com',
  'ytimg.com', 'i.ytimg.com', 's.ytimg.com',
  'facebook.com', 'www.facebook.com', 'fbcdn.net',
  'instagram.com', 'www.instagram.com', 'cdninstagram.com',
  'twitter.com', 'x.com', 'twimg.com',
  'reddit.com', 'www.reddit.com', 'redd.it',
  'netflix.com', 'www.netflix.com', 'nflxvideo.net',
  'twitch.tv', 'www.twitch.tv', 'jtvnw.net',
  'amazon.com', 'www.amazon.com',
  'spotify.com', 'open.spotify.com',
  'tiktok.com', 'www.tiktok.com',
  'linkedin.com', 'www.linkedin.com',
  'github.com', 'www.github.com',
  'google.com', 'www.google.com',
  'firebase.googleapis.com',
];

// Patterns that should be completely skipped (too broad, break sites)
const DANGEROUS_PATTERNS = [
  '||youtube.com^',
  '||www.youtube.com^',
  '||facebook.com^',
  '||www.facebook.com^',
  '||twitter.com^',
  '||x.com^',
  '||instagram.com^',
  '||reddit.com^',
  '||google.com^',
  '||www.google.com^',
  '||netflix.com^',
  '||tiktok.com^',
  '||linkedin.com^',
  '||github.com^',
  '||spotify.com^',
];

if (!existsSync(RULES_DIR)) {
  mkdirSync(RULES_DIR, { recursive: true });
}

/**
 * Parse ABP filter options string
 */
function parseOptions(optStr) {
  const opts = {
    thirdParty: null,    // true = 3p only, false = 1p only, null = both
    domains: [],         // domain= include list
    excludeDomains: [],  // ~domain exclude list
    types: [],           // resource types
    isImportant: false,
  };

  if (!optStr) return opts;

  for (const part of optStr.split(',')) {
    const p = part.trim();
    if (!p) continue;

    if (p === 'third-party' || p === '3p') {
      opts.thirdParty = true;
    } else if (p === '~third-party' || p === 'first-party' || p === '1p') {
      opts.thirdParty = false;
    } else if (p === 'important') {
      opts.isImportant = true;
    } else if (p.startsWith('domain=')) {
      const domainStr = p.slice(7);
      for (const d of domainStr.split('|')) {
        if (d.startsWith('~')) {
          opts.excludeDomains.push(d.slice(1));
        } else {
          opts.domains.push(d);
        }
      }
    } else if (p === 'script') { opts.types.push('script'); }
    else if (p === 'image') { opts.types.push('image'); }
    else if (p === 'stylesheet' || p === 'css') { opts.types.push('stylesheet'); }
    else if (p === 'xmlhttprequest' || p === 'xhr') { opts.types.push('xmlhttprequest'); }
    else if (p === 'subdocument' || p === 'sub_frame') { opts.types.push('sub_frame'); }
    else if (p === 'font') { opts.types.push('font'); }
    else if (p === 'media') { opts.types.push('media'); }
    else if (p === 'websocket') { opts.types.push('websocket'); }
    else if (p === 'ping') { opts.types.push('ping'); }
    else if (p === 'object') { opts.types.push('object'); }
    else if (p === 'other') { opts.types.push('other'); }
    else if (p === 'popup') { /* skip - not supported in DNR */ }
    else if (p === 'document' || p === 'doc') { /* skip - we don't block main_frame */ }
  }

  return opts;
}

/**
 * Check if a urlFilter pattern targets a critical first-party domain
 */
function targetsCriticalDomain(pattern) {
  const lp = pattern.toLowerCase();
  for (const domain of CRITICAL_FIRST_PARTY_DOMAINS) {
    if (lp.includes(domain)) return domain;
  }
  return null;
}

/**
 * Parse an ABP filter line into a DNR rule (if possible)
 */
function parseToDNR(line, ruleId) {
  line = line.trim();

  // Skip comments, empty lines, cosmetic rules, headers
  if (!line || line.startsWith('!') || line.startsWith('[') || line.includes('##') || line.includes('#@#') || line.includes('#?#')) {
    return null;
  }

  // Exception rules: @@||domain^
  if (line.startsWith('@@')) {
    const domain = extractDomain(line.slice(2));
    if (domain) {
      return {
        id: ruleId,
        priority: 2,
        action: { type: 'allow' },
        condition: {
          urlFilter: `||${domain}^`,
          resourceTypes: allResourceTypes(),
        },
      };
    }
    return null;
  }

  // Split pattern and options
  const dollarIdx = line.indexOf('$');
  let pattern, optStr;
  if (dollarIdx !== -1) {
    pattern = line.slice(0, dollarIdx);
    optStr = line.slice(dollarIdx + 1);
  } else {
    pattern = line;
    optStr = '';
  }

  if (!pattern || pattern.length < 3) return null;

  // Skip unsupported patterns for Chrome DNR urlFilter
  if (pattern.startsWith('/') && pattern.endsWith('/')) return null;
  if (pattern.includes('#')) return null;
  if (/[{}()\[\]\\]/.test(pattern)) return null;
  if (/^\|\|\*/.test(pattern)) return null;
  if (/^\*+$/.test(pattern)) return null;
  if (/[\s\t]/.test(pattern)) return null;

  // Skip dangerous patterns that would block entire major sites
  if (DANGEROUS_PATTERNS.includes(pattern)) return null;

  // Parse options
  const opts = parseOptions(optStr);

  // Build condition
  const condition = {};

  // For domain block rules (||domain^), try to extract clean domain
  const domain = extractDomain(line);
  if (domain) {
    condition.urlFilter = `||${domain}^`;
  } else {
    condition.urlFilter = pattern;
  }

  // Resource types
  if (opts.types.length > 0) {
    condition.resourceTypes = opts.types;
  } else {
    condition.resourceTypes = allResourceTypes();
  }

  // Third-party / first-party
  if (opts.thirdParty === true) {
    condition.domainType = 'thirdParty';
  } else if (opts.thirdParty === false) {
    condition.domainType = 'firstParty';
  }

  // Domain restrictions
  if (opts.domains.length > 0) {
    condition.initiatorDomains = opts.domains;
  }
  if (opts.excludeDomains.length > 0) {
    condition.excludedInitiatorDomains = opts.excludeDomains;
  }

  // SAFETY: Protect critical domains from being blocked in first-party context.
  const criticalDomain = targetsCriticalDomain(condition.urlFilter);
  if (criticalDomain) {
    if (condition.domainType === 'firstParty') {
      // This rule blocks a critical domain's own resources when you visit it → SKIP
      return null;
    }
    // If initiatorDomains includes a related critical domain, skip
    // (e.g. googlevideo.com blocked when initiator is youtube.com)
    if (condition.initiatorDomains) {
      const relatedCritical = condition.initiatorDomains.some(d =>
        CRITICAL_FIRST_PARTY_DOMAINS.includes(d) || CRITICAL_FIRST_PARTY_DOMAINS.some(cd => d.endsWith(cd))
      );
      if (relatedCritical) return null;
    }
    if (!condition.domainType && !condition.initiatorDomains) {
      // No domain restriction → force third-party only
      condition.domainType = 'thirdParty';
    }
  }

  return {
    id: ruleId,
    priority: opts.isImportant ? 2 : 1,
    action: { type: 'block' },
    condition,
  };
}

function extractDomain(rule) {
  // Only match simple domain rules: ||domain.com^ or ||domain.com^$options
  const raw = rule.startsWith('@@') ? rule.slice(2) : rule;
  if (!raw.startsWith('||')) return null;
  const rest = raw.slice(2);
  const match = rest.match(/^([a-z0-9.-]+)\^?(\$.*)?$/i);
  if (match && match[1] && match[1].includes('.')) {
    return match[1].toLowerCase();
  }
  return null;
}

function allResourceTypes() {
  return [
    'sub_frame', 'stylesheet', 'script', 'image',
    'font', 'object', 'xmlhttprequest', 'ping', 'media',
    'websocket', 'other',
  ];
}

/**
 * Convert TDS-style tracker JSON to Chrome DNR rules.
 * Only trackers with default:'block' are converted; rules with action:'ignore' become allow rules.
 * All rules are scoped to third-party context since TDS only tracks cross-site trackers.
 */
function parseTDStoDNR(tds, startId = 1) {
  const rules = [];
  let ruleId = startId;

  for (const [domain, tracker] of Object.entries(tds.trackers || {})) {
    if (ruleId > MAX_RULES_PER_LIST) break;

    const urlFilter = `||${domain}^`;

    // Skip patterns that would dangerously block major sites
    if (DANGEROUS_PATTERNS.includes(urlFilter)) continue;
    const criticalDomain = targetsCriticalDomain(urlFilter);
    if (criticalDomain) continue;

    const defaultAction = tracker.default || 'block';
    const trackerRules = tracker.rules || [];

    if (defaultAction === 'block') {
      // Emit allow rules for sub-patterns with action:'ignore' (exception overrides)
      for (const r of trackerRules) {
        if (ruleId > MAX_RULES_PER_LIST) break;
        if (r.action !== 'ignore') continue;
        if (!r.rule) continue;
        // Convert the regex pattern to a DNR urlFilter via anchored regex
        try {
          // Validate regex is usable
          new RegExp(r.rule); // eslint-disable-line no-new
          rules.push({
            id: ruleId++,
            priority: 3, // Higher than block rule so allow wins
            action: { type: 'allow' },
            condition: {
              regexFilter: r.rule,
              resourceTypes: allResourceTypes(),
              domainType: 'thirdParty',
            },
          });
        } catch (_) {
          // Malformed regex – skip
        }
      }

      // Emit the block rule for the whole domain (third-party)
      rules.push({
        id: ruleId++,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter,
          resourceTypes: allResourceTypes(),
          domainType: 'thirdParty',
        },
      });
    }
  }

  return rules;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  let skippedDangerous = 0;
  let forcedThirdParty = 0;

  for (const [name, url] of Object.entries(LISTS)) {
    const outputPath = resolve(RULES_DIR, `${name}.json`);

    if (existsSync(outputPath)) {
      console.log(`[skip] ${name}.json already exists`);
      continue;
    }

    process.stdout.write(`Downloading ${name}...`);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const lines = text.split('\n');

      process.stdout.write(` ${lines.length} lines. Converting...`);

      const rules = [];
      let ruleId = 1;

      for (const line of lines) {
        if (ruleId > MAX_RULES_PER_LIST) break;
        const rule = parseToDNR(line, ruleId);
        if (rule) {
          rules.push(rule);
          ruleId++;
        }
      }

      writeFileSync(outputPath, JSON.stringify(rules, null, 0));
      console.log(` ${rules.length} rules. Done.`);
    } catch (e) {
      console.error(` FAILED: ${e.message}`);
    }
  }

  console.log('\nAll lists converted.');
}

main();

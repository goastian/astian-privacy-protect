export function createSiteDomainHandlers(ctx) {
  const TRUSTED_SCRIPTLET_HOSTS = new Set([
    'youtube.com', 'youtu.be', 'reddit.com', 'twitch.tv',
    'forbes.com', 'cnn.com', 'bbc.com',
  ]);

  function hostMatches(hostname, domain) {
    return hostname === domain || hostname.endsWith('.' + domain);
  }

  function allowsTrustedScriptlets(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    for (const domain of TRUSTED_SCRIPTLET_HOSTS) {
      if (hostMatches(host, domain)) return true;
    }
    return false;
  }

  function popupAllowedForHost(hostname, allowlist) {
    const host = String(hostname || '').toLowerCase();
    if (!host || !allowlist || typeof allowlist !== 'object') return false;
    const now = Date.now();
    const parts = host.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts.slice(i).join('.');
      const entry = allowlist[key];
      if (!entry) continue;
      if (entry === true || entry.permanent === true) return true;
      const expiresAt = Number(entry.expiresAt || 0);
      if (!expiresAt || expiresAt > now) return true;
    }
    return false;
  }

  function resolveHostname(msg, sender) {
    const tabHostname = sender?.tab?.url ? ctx.extractDomain(sender.tab.url) : '';
    return String(msg?.hostname || tabHostname || '').toLowerCase();
  }

  function emptyCosmeticsResponse() {
    return { enabled: false, selectors: [], styles: '', compiledScripts: [] };
  }

  function emptyScriptletsResponse() {
    return { enabled: false, scriptlets: [] };
  }

  function disabledPopupConfig(reason = 'disabled') {
    return {
      enabled: false,
      defense: reason === 'popups-allowed' ? 'allowed' : 'relaxed',
      gestureWindowMs: 0,
      evaluationDelayMs: 0,
      burstWindowMs: 5000,
      maxBurstWithoutGesture: 99,
      redirectHopThreshold: 99,
      closeTabsWithoutGesture: false,
      vertical: 'general',
    };
  }

  return {
    'get-popup-defense-config': async (msg, sender) => {
      const hostname = resolveHostname(msg, sender);
      const runtime = ctx.getRuntimeOptions();
      if (ctx.isProtectionBypassedForHost(hostname, runtime)) {
        return { config: disabledPopupConfig('site-bypassed') };
      }
      if (popupAllowedForHost(hostname, runtime?.popupAllowlist || {})) {
        return { config: disabledPopupConfig('popups-allowed') };
      }
      return { config: ctx.getPopupDefenseConfig(hostname, runtime) };
    },

    'get-site-protection-state': async (msg, sender) => {
      const hostname = resolveHostname(msg, sender);
      const runtime = ctx.getRuntimeOptions();
      const globalEnabled = runtime?.enabled !== false;
      const whitelisted = ctx.isHostnameWhitelisted(hostname, runtime?.whitelist || {});
      return {
        hostname,
        globalEnabled,
        whitelisted,
        enabled: globalEnabled && !whitelisted,
      };
    },

    'popup-guard-user-gesture': async (msg, sender) => {
      const tabId = sender?.tab?.id ?? msg.tabId;
      if (Number.isInteger(tabId) && tabId >= 0) {
        ctx.recordUserGesture(tabId, msg);
      }
      return { success: true };
    },

    'popup-guard-window-signal': async (msg, sender) => {
      const tabId = sender?.tab?.id ?? msg.tabId;
      if (Number.isInteger(tabId) && tabId >= 0 && ctx.recordWindowSignal) {
        ctx.recordWindowSignal(tabId, msg);
      }
      return { success: true };
    },

    'popup-guard-blocked': async (msg, sender) => {
      const tabId = sender?.tab?.id;
      const recorded = Number.isInteger(tabId) && ctx.recordPopupBlocked
        ? ctx.recordPopupBlocked(tabId, msg.url || '')
        : false;
      return { success: true, recorded };
    },

    'get-tab-stats': async (msg) => {
      const runtimeOptions = ctx.getRuntimeOptions();
      const rollout = ctx.getEffectiveRolloutFlags(runtimeOptions);

      if (ctx.IS_CHROMIUM) {
        const stats = await ctx.getChromiumTabStats(msg.tabId);
        const eco = ctx.getEcoStats(msg.tabId);
        stats.entityControl = rollout.entityBlocking
          ? ctx.getEntityControlForGroups(stats.groups, runtimeOptions)
          : null;
        stats.blockedByCategory = ctx.getBlockedByCategory(msg.tabId);
        return { ...stats, ...eco };
      }

      const tab = ctx.getTab(msg.tabId);
      const groups = ctx.getGroupedRequestsEnriched(msg.tabId);
      const eco = ctx.getEcoStats(msg.tabId);
      return {
        hostname: tab?.hostname || '',
        blocked: tab?.blocked || 0,
        blockedByCategory: ctx.getBlockedByCategory(msg.tabId),
        dataSaved: ctx.getDataSaved(msg.tabId),
        groups,
        entityControl: rollout.entityBlocking
          ? ctx.getEntityControlForGroups(groups, runtimeOptions)
          : null,
        recentRequests: ctx.getRecentRequests(msg.tabId, 10),
        ...eco,
      };
    },

    'get-site-profile': async (msg, sender) => {
      const host = resolveHostname(msg, sender);
      if (!host) return { vertical: 'general', profile: null };
      const siteContext = ctx.resolveSiteProfile(host, ctx.getRuntimeOptions());
      return {
        hostname: siteContext.hostname,
        vertical: siteContext.vertical,
        profile: siteContext.profile,
      };
    },

    'get-ia-shield-config': async (msg, sender) => {
      const hostname = resolveHostname(msg, sender);
      const opts = await ctx.getOptions();
      if (ctx.isProtectionBypassedForHost(hostname, opts)) {
        return {
          config: {
            enabled: false,
            strict: false,
            sanitizeOnPaste: false,
            monitor: { paste: false, input: false, dom: false },
            isolate: { enabled: false, mode: 'warn' },
            vertical: 'general',
            matchedOverrideDomain: '',
            reason: opts?.enabled === false ? 'disabled' : 'site-whitelisted',
          },
        };
      }
      return { config: ctx.buildIaShieldConfig(opts, hostname) };
    },

    'ia-shield-risk-event': async (msg, sender) => {
      const opts = await ctx.getOptions();
      const hostname = resolveHostname(msg, sender);
      const event = ctx.normalizeIaRiskEvent(msg.event || null, hostname);
      if (!event) {
        return { success: false, error: 'invalid-event' };
      }

      const iaRiskEvents = ctx.appendIaRiskEvent(opts.iaRiskEvents, event, 300);
      await ctx.setOptions({ iaRiskEvents });
      ctx.refreshRuntimeOptions({ ...opts, iaRiskEvents });
      ctx.recordIaShieldRiskEvent(event);
      return { success: true };
    },

    'get-ia-risk-events': async (msg) => {
      const opts = await ctx.getOptions();
      const days = Math.max(1, Math.min(365, Number(msg.days) || 30));
      const limit = Math.max(1, Math.min(500, Number(msg.limit) || 100));
      return ctx.summarizeIaRiskEvents(opts.iaRiskEvents || [], days, limit);
    },

    'clear-ia-risk-events': async () => {
      const opts = await ctx.getOptions();
      await ctx.setOptions({ iaRiskEvents: [] });
      ctx.refreshRuntimeOptions({ ...opts, iaRiskEvents: [] });
      return { success: true };
    },

    'set-ia-shield-site-policy': async (msg, sender) => {
      const opts = await ctx.getOptions();
      const hostname = resolveHostname(msg, sender).trim();
      if (!hostname) return { success: false, error: 'missing-hostname' };

      const domainOverrides = {
        ...(opts.sitePolicy?.domainOverrides || {}),
      };
      const existing = domainOverrides[hostname] || {};
      const patch = {};

      if (typeof msg.iaShieldBypass === 'boolean') patch.iaShieldBypass = msg.iaShieldBypass;
      if (typeof msg.iaShieldStrict === 'boolean') patch.iaShieldStrict = msg.iaShieldStrict;
      if (typeof msg.iaShieldProtected === 'boolean') patch.iaShieldProtected = msg.iaShieldProtected;

      domainOverrides[hostname] = {
        ...existing,
        ...patch,
        updatedAt: Date.now(),
      };

      const sitePolicy = {
        ...(opts.sitePolicy || {}),
        domainOverrides,
      };
      const updated = await ctx.setOptions({ sitePolicy });
      ctx.refreshRuntimeOptions(updated);
      return {
        success: true,
        config: ctx.buildIaShieldConfig(updated, hostname),
      };
    },

    'get-cosmetics': async (msg) => {
      const hostname = resolveHostname(msg);
      const runtime = ctx.getRuntimeOptions();
      if (ctx.isProtectionBypassedForHost(hostname, runtime)) {
        return emptyCosmeticsResponse();
      }
      // Critical first-party sites (Gmail, Outlook, iCloud, banking, etc.)
      // are highly sensitive to cosmetic-rule false positives — skip cosmetic
      // injection entirely on these hosts. User can still toggle protection
      // off per-site if needed.
      if (ctx.isCriticalFirstPartySite?.(hostname)) {
        return emptyCosmeticsResponse();
      }
      const siteContext = ctx.resolveSiteProfile(hostname, ctx.getRuntimeOptions());
      const cosmeticsEnabled = siteContext.profile?.cosmeticsEnabled !== false;
      if (!cosmeticsEnabled) {
        return emptyCosmeticsResponse();
      }

      const cosmetics = ctx.ghosteryEngine.getFullCosmetics(hostname);
      const compiledScripts = allowsTrustedScriptlets(hostname)
        ? (cosmetics.scripts || []).slice(0, 100)
        : [];
      return {
        enabled: true,
        selectors: [],
        styles: cosmetics.styles || '',
        compiledScripts,
        procedural: Array.isArray(cosmetics.procedural) ? cosmetics.procedural.slice(0, 80) : [],
      };
    },

    'get-scriptlets': async (msg) => {
      const hostname = resolveHostname(msg);
      const runtime = ctx.getRuntimeOptions();
      if (ctx.isProtectionBypassedForHost(hostname, runtime)) {
        return emptyScriptletsResponse();
      }
      if (ctx.isCriticalFirstPartySite?.(hostname)) {
        return emptyScriptletsResponse();
      }
      return {
        enabled: true,
        scriptlets: ctx.getEngine().getScriptletRules(hostname).slice(0, 100),
      };
    },

    'get-anti-fingerprint': async (_msg, sender) => {
      const tabHostname = resolveHostname({}, sender);
      const runtime = ctx.getRuntimeOptions();
      if (ctx.isProtectionBypassedForHost(tabHostname, runtime)) {
        return { enabled: false };
      }
      // Critical first-party sites (banking, government, healthcare, mail) —
      // anti-fingerprint scriptlets override native browser APIs (canvas, WebGL,
      // AudioContext, navigator.*) in ways that trigger fraud-detection systems
      // and can break WebRTC/camera/geolocation flows on these sensitive hosts.
      // Cosmetics and scriptlets are already disabled here; anti-fingerprint
      // must follow the same policy.
      const mode = ctx.getAntiFingerprintMode
        ? ctx.getAntiFingerprintMode(tabHostname, runtime)
        : (ctx.isCriticalFirstPartySite?.(tabHostname) ? 'off' : 'balanced');
      if (mode === 'off') {
        return { enabled: false };
      }
      const afOpts = await ctx.getOptions();
      return { enabled: afOpts.antiFingerprint !== false, mode };
    },
  };
}

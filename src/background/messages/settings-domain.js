function getDnrRulesets() {
  return ['easylist', 'easyprivacy', 'ublock-filters', 'ublock-privacy', 'peter-lowe'];
}

async function updateEnabledRulesetsFromFlags(flags) {
  const enableRulesetIds = [];
  const disableRulesetIds = [];
  for (const id of getDnrRulesets()) {
    if (flags[id]) enableRulesetIds.push(id);
    else disableRulesetIds.push(id);
  }
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds,
    disableRulesetIds,
  });
}

async function syncDnrRulesForOptions(ctx, options, reason = 'settings-change') {
  if (!ctx.IS_CHROMIUM) return;
  if (typeof ctx.syncChromiumDnrForOptions === 'function') {
    await ctx.syncChromiumDnrForOptions(options, reason);
    return;
  }
  await updateEnabledRulesetsFromFlags(Object.fromEntries(
    Object.entries(options?.lists || {}).map(([key, value]) => [key, value?.enabled])
  ));
}

export function createSettingsDomainHandlers(ctx) {
  return {
    'get-rollout-flags': async () => {
      const runtime = ctx.getRuntimeOptions();
      return ctx.getEffectiveRolloutFlags(runtime);
    },

    'get-options': async () => ctx.getOptions(),

    'toggle-site': async (msg) => {
      const nowWhitelisted = await ctx.toggleWhitelist(msg.hostname);
      const updatedOptions = await ctx.getOptions();
      ctx.refreshRuntimeOptions(updatedOptions);
      if (ctx.IS_CHROMIUM) {
        await syncDnrRulesForOptions(ctx, updatedOptions, 'toggle-site');
      }
      return { whitelisted: nowWhitelisted };
    },

    'toggle-entity-block': async (msg) => {
      const runtime = ctx.getRuntimeOptions();
      if (!ctx.getEffectiveRolloutFlags(runtime).entityBlocking) {
        return { success: false, error: 'entity-blocking-rollout-disabled' };
      }

      const ownerId = String(msg.ownerId || '').trim();
      if (!ownerId) return { success: false, error: 'ownerId-required' };

      const opts = await ctx.getOptions();
      const blockedEntities = { ...ctx.getBlockedEntitiesMap(opts) };
      const nextBlocked = msg.blocked !== false;

      if (nextBlocked) blockedEntities[ownerId] = true;
      else delete blockedEntities[ownerId];

      const updatedOptions = await ctx.setOptions({ blockedEntities });
      ctx.refreshRuntimeOptions(updatedOptions);

      if (ctx.IS_CHROMIUM) {
        await syncDnrRulesForOptions(ctx, updatedOptions, 'toggle-entity-block');
      }

      return { success: true, blocked: nextBlocked, ownerId };
    },

    'toggle-enabled': async () => {
      const options = await ctx.getOptions();
      const enabled = !options.enabled;
      ctx.setEnabled(enabled);
      await ctx.setOptions({ enabled });
      const updatedOptions = { ...options, enabled };
      ctx.refreshRuntimeOptions(updatedOptions);

      if (ctx.IS_CHROMIUM) {
        await syncDnrRulesForOptions(ctx, updatedOptions, 'toggle-enabled');
      }

      return { enabled };
    },

    'get-user-filters': async () => {
      const opts = await ctx.getOptions();
      return { userFilters: opts.userFilters || '' };
    },

    'save-user-filters': async (msg) => {
      const updatedOptions = await ctx.setOptions({ userFilters: msg.userFilters || '' });
      if (!ctx.IS_CHROMIUM) {
        await ctx.reloadFirefoxEngineForOptions(updatedOptions, 'save-user-filters');
      }
      return { success: true, rulesCount: ctx.getEngine().rulesCount };
    },

    'change-protection-level': async (msg) => {
      const level = msg.level;
      const preset = ctx.PROTECTION_LEVELS[level];
      if (!preset) return { error: 'Invalid protection level' };

      const opts = await ctx.getOptions();
      const lists = opts.lists || {};
      for (const [listId, enabled] of Object.entries(preset.lists)) {
        if (lists[listId]) {
          lists[listId].enabled = enabled;
        }
      }

      const updatedOptions = await ctx.setOptions({
        protectionLevel: level,
        antiFingerprint: preset.antiFingerprint,
        lists,
      });
      ctx.refreshRuntimeOptions(updatedOptions);

      const assisted = ctx.shouldEnableTrackerDbAssisted(updatedOptions);
      ctx.setTrackerDbAssistedEnabled(assisted);

      if (ctx.IS_CHROMIUM) {
        try {
          await syncDnrRulesForOptions(ctx, updatedOptions, 'change-protection-level');
        } catch (e) {
          console.warn('[midori] Failed to update DNR rulesets:', e);
        }
      }

      if (!ctx.IS_CHROMIUM) {
        try {
          await ctx.reloadFirefoxEngineForOptions(updatedOptions, 'change-protection-level');
        } catch (e) {
          console.warn('[midori] Failed to reload engine:', e);
        }
      }

      return { success: true, level, label: preset.label };
    },

    'save-setup': async (msg) => {
      const config = msg.config || {};
      const nextOptions = await ctx.setOptions(config);
      ctx.refreshRuntimeOptions(nextOptions);
      ctx.setTrackerDbAssistedEnabled(ctx.shouldEnableTrackerDbAssisted(nextOptions));

      if (config.enabled !== undefined) {
        ctx.setEnabled(config.enabled);
      }

      if (ctx.IS_CHROMIUM && config.lists) {
        try {
          await syncDnrRulesForOptions(ctx, nextOptions, 'save-setup');
        } catch (e) {
          console.warn('[midori] Failed to update DNR rulesets from setup:', e);
        }
      }

      if (!ctx.IS_CHROMIUM) {
        try {
          await ctx.reloadFirefoxEngineForOptions(nextOptions, 'save-setup');
        } catch (e) {
          console.warn('[midori] Failed to reload engine from setup:', e);
        }
      }

      return { success: true };
    },

    'pause-protection': async (msg) => {
      const opts = await ctx.getOptions();
      const whitelist = { ...(opts.whitelist || {}), [msg.hostname]: true };
      await ctx.setOptions({ whitelist, pauseUntil: msg.pauseUntil, pausedHostname: msg.hostname });
      ctx.refreshRuntimeOptions({ ...opts, whitelist, pauseUntil: msg.pauseUntil, pausedHostname: msg.hostname });
      if (ctx.IS_CHROMIUM) {
        await syncDnrRulesForOptions(ctx, { ...opts, whitelist, pauseUntil: msg.pauseUntil, pausedHostname: msg.hostname }, 'pause-protection');
      }
      const mins = msg.minutes || 5;
      chrome.alarms.create('resume-protection', { delayInMinutes: mins });
      return { success: true };
    },

    'set-popup-allowlist': async (msg) => {
      const hostname = String(msg.hostname || '').trim().toLowerCase();
      if (!hostname) return { success: false, error: 'missing-hostname' };

      const opts = await ctx.getOptions();
      const popupAllowlist = { ...(opts.popupAllowlist || {}) };
      const mode = String(msg.mode || 'hour');

      if (mode === 'remove') {
        delete popupAllowlist[hostname];
      } else if (mode === 'permanent') {
        popupAllowlist[hostname] = { permanent: true, updatedAt: Date.now() };
      } else {
        popupAllowlist[hostname] = {
          expiresAt: Date.now() + 60 * 60 * 1000,
          updatedAt: Date.now(),
        };
      }

      const updated = await ctx.setOptions({ popupAllowlist });
      ctx.refreshRuntimeOptions(updated);
      if (ctx.IS_CHROMIUM && typeof ctx.installPopunderDnrRules === 'function') {
        await ctx.installPopunderDnrRules();
      }
      ctx.broadcastOptionsChanged({ popupAllowlist });
      return { success: true, popupAllowlist };
    },

    'resume-protection': async (msg) => {
      const opts = await ctx.getOptions();
      const whitelist = { ...(opts.whitelist || {}) };
      if (msg.hostname) delete whitelist[msg.hostname];
      const pausedHost = opts.pausedHostname;
      if (pausedHost && !msg.hostname) delete whitelist[pausedHost];
      await ctx.setOptions({ whitelist, pauseUntil: 0, pausedHostname: '' });
      ctx.refreshRuntimeOptions({ ...opts, whitelist, pauseUntil: 0, pausedHostname: '' });
      if (ctx.IS_CHROMIUM) {
        await syncDnrRulesForOptions(ctx, { ...opts, whitelist, pauseUntil: 0, pausedHostname: '' }, 'resume-protection');
      }
      chrome.alarms.clear('resume-protection');
      return { success: true };
    },

    'toggle-category': async (msg) => {
      const opts = await ctx.getOptions();
      const lists = { ...(opts.lists || {}) };
      const updates = msg.listUpdates || {};
      for (const [listId, enabled] of Object.entries(updates)) {
        if (lists[listId]) {
          lists[listId] = { ...lists[listId], enabled };
        }
      }
      const extra = msg.extraOptions || {};
      const savePayload = { lists, categoryState: msg.categoryState || {}, ...extra };
      await ctx.setOptions(savePayload);
      ctx.refreshRuntimeOptions({ ...opts, ...savePayload });
      ctx.broadcastOptionsChanged({ lists, categoryState: msg.categoryState || {} });

      if (ctx.IS_CHROMIUM) {
        try {
          await syncDnrRulesForOptions(ctx, { ...opts, ...savePayload }, 'toggle-category');
        } catch (e) {
          console.warn('[midori] Failed to update DNR rulesets:', e);
        }
      }

      if (!ctx.IS_CHROMIUM) {
        try {
          await ctx.reloadFirefoxEngineForOptions({ ...opts, ...savePayload }, 'toggle-category');
        } catch (e) {
          // Keep behavior: ignore Firefox reload errors here.
        }
      }

      return { success: true };
    },

    'save-options-partial': async (msg) => {
      if (msg.options) {
        const updatedOptions = await ctx.setOptions(msg.options);
        ctx.refreshRuntimeOptions(updatedOptions);
        ctx.broadcastOptionsChanged(msg.options);
        if (Object.prototype.hasOwnProperty.call(msg.options, 'localTelemetry')) {
          ctx.telemetry.applyRawState(msg.options.localTelemetry);
        }
        const affectsDnr = (
          msg.options.enabled !== undefined ||
          msg.options.lists !== undefined ||
          msg.options.whitelist !== undefined ||
          msg.options.popupAllowlist !== undefined ||
          msg.options.blockedEntities !== undefined ||
          msg.options.experiments?.trackerDbAssisted !== undefined ||
          msg.options.protectionLevel !== undefined ||
          msg.options.trackerDbEnabled !== undefined
        );
        if (affectsDnr) {
          ctx.setTrackerDbAssistedEnabled(ctx.shouldEnableTrackerDbAssisted(updatedOptions));
          if (ctx.IS_CHROMIUM) {
            await syncDnrRulesForOptions(ctx, updatedOptions, 'save-options-partial').catch((e) =>
              console.warn('[midori] syncChromiumDnrForOptions:', e)
            );
          }
        }
      }
      return { success: true };
    },
  };
}

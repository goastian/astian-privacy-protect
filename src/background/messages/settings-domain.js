function getDnrRulesets() {
  return ['easylist', 'easyprivacy', 'ublock-filters', 'ublock-privacy', 'peter-lowe', 'ddg-tds'];
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

export function createSettingsDomainHandlers(ctx) {
  return {
    'get-rollout-flags': async () => {
      const runtime = ctx.getRuntimeOptions();
      return ctx.getEffectiveRolloutFlags(runtime);
    },

    'get-options': async () => ctx.getOptions(),

    'toggle-site': async (msg) => {
      const nowWhitelisted = await ctx.toggleWhitelist(msg.hostname);
      ctx.refreshRuntimeOptions(await ctx.getOptions());
      if (ctx.IS_CHROMIUM) {
        await ctx.updateDnrWhitelist();
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
        await ctx.updateDnrEntityBlockRules(updatedOptions);
      }

      return { success: true, blocked: nextBlocked, ownerId };
    },

    'toggle-enabled': async () => {
      const options = await ctx.getOptions();
      const enabled = !options.enabled;
      ctx.setEnabled(enabled);
      await ctx.setOptions({ enabled });
      ctx.refreshRuntimeOptions({ ...options, enabled });

      if (ctx.IS_CHROMIUM) {
        const rulesetIds = getDnrRulesets();
        if (enabled) {
          await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: rulesetIds });
        } else {
          await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: rulesetIds });
        }
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

      await ctx.setOptions({
        protectionLevel: level,
        antiFingerprint: preset.antiFingerprint,
        lists,
      });
      ctx.refreshRuntimeOptions({
        ...opts,
        protectionLevel: level,
        antiFingerprint: preset.antiFingerprint,
        lists,
      });

      const assisted = ctx.shouldEnableTrackerDbAssisted({
        ...opts,
        protectionLevel: level,
      });
      ctx.setTrackerDbAssistedEnabled(assisted);

      if (ctx.IS_CHROMIUM) {
        try {
          await updateEnabledRulesetsFromFlags(preset.lists);
          await ctx.applyTrackerDbDynamicRules(assisted);
        } catch (e) {
          console.warn('[midori] Failed to update DNR rulesets:', e);
        }
      }

      if (!ctx.IS_CHROMIUM) {
        try {
          await ctx.reloadFirefoxEngineForOptions({
            ...opts,
            protectionLevel: level,
            antiFingerprint: preset.antiFingerprint,
            lists,
          }, 'change-protection-level');
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
          await updateEnabledRulesetsFromFlags(Object.fromEntries(
            Object.entries(config.lists).map(([key, value]) => [key, value?.enabled])
          ));
          await ctx.applyTrackerDbDynamicRules(ctx.isTrackerDbAssistedEnabled());
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
      if (ctx.IS_CHROMIUM) await ctx.updateDnrWhitelist();
      const mins = msg.minutes || 5;
      chrome.alarms.create('resume-protection', { delayInMinutes: mins });
      return { success: true };
    },

    'resume-protection': async (msg) => {
      const opts = await ctx.getOptions();
      const whitelist = { ...(opts.whitelist || {}) };
      if (msg.hostname) delete whitelist[msg.hostname];
      const pausedHost = opts.pausedHostname;
      if (pausedHost && !msg.hostname) delete whitelist[pausedHost];
      await ctx.setOptions({ whitelist, pauseUntil: 0, pausedHostname: '' });
      ctx.refreshRuntimeOptions({ ...opts, whitelist, pauseUntil: 0, pausedHostname: '' });
      if (ctx.IS_CHROMIUM) await ctx.updateDnrWhitelist();
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
          await updateEnabledRulesetsFromFlags(Object.fromEntries(
            Object.entries(lists).map(([key, value]) => [key, value?.enabled])
          ));
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
        if (
          msg.options.experiments?.trackerDbAssisted !== undefined ||
          msg.options.protectionLevel !== undefined ||
          msg.options.trackerDbEnabled !== undefined
        ) {
          ctx.setTrackerDbAssistedEnabled(ctx.shouldEnableTrackerDbAssisted(updatedOptions));
          if (ctx.IS_CHROMIUM) {
            await ctx.applyTrackerDbDynamicRules(ctx.isTrackerDbAssistedEnabled()).catch((e) =>
              console.warn('[midori] applyTrackerDbDynamicRules:', e)
            );
          }
        }
      }
      return { success: true };
    },
  };
}

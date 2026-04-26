export function createMaintenanceDomainHandlers(ctx) {
  return {
    'update-lists': async () => {
      const { lists, changedCount } = await ctx.downloadAllListsWithStatus();
      if (Object.keys(lists).length > 0 && (ctx.getEngine().rulesCount === 0 || changedCount > 0)) {
        await ctx.loadEngine(lists);
      }
      return { rulesCount: ctx.getEngine().rulesCount, updatedAt: Date.now() };
    },

    'force-update-all': async () => {
      const results = { lists: false, trackerDb: false, errors: [] };
      try {
        const { lists } = await ctx.downloadAllListsWithStatus(true);
        if (Object.keys(lists).length > 0) {
          await ctx.loadEngine(lists);
          results.lists = true;
        }
      } catch (e) {
        results.errors.push(`Lists: ${e.message}`);
      }

      try {
        const opts = await ctx.getOptions();
        const tdResult = await ctx.fetchAndUpdateTrackerDb({
          primaryUrl: opts.trackerDbUrl || undefined,
        });
        results.trackerDb = tdResult === 'updated';
        if (tdResult === 'unchanged') results.trackerDb = true;
      } catch (e) {
        results.errors.push(`TrackerDB: ${e.message}`);
      }

      results.updatedAt = Date.now();
      results.rulesCount = ctx.getEngine().rulesCount;
      return results;
    },

    'get-trackerdb-meta': async () => ctx.getTrackerDbMeta(),

    'update-trackerdb': async () => {
      const opts = await ctx.getOptions();
      const result = await ctx.fetchAndUpdateTrackerDb({
        primaryUrl: opts.trackerDbUrl || undefined,
      });
      if (result === 'updated' && ctx.shouldEnableTrackerDbAssisted(opts) && ctx.IS_CHROMIUM) {
        ctx.applyTrackerDbDynamicRules(true).catch(() => {});
      }
      return { result, meta: ctx.getTrackerDbMeta() };
    },

    'rollback-trackerdb': async () => {
      const ok = await ctx.rollbackTrackerDb();
      return { success: ok, meta: ctx.getTrackerDbMeta() };
    },

    'set-trackerdb-assisted': async (msg) => {
      const opts = await ctx.getOptions();
      const rollout = ctx.getEffectiveRolloutFlags(opts);
      const enable = rollout.entityBlocking && msg.enabled !== false;
      const experiments = { ...(opts.experiments || {}), trackerDbAssisted: enable };
      const updatedOptions = await ctx.setOptions({ experiments });
      ctx.refreshRuntimeOptions(updatedOptions);
      ctx.setTrackerDbAssistedEnabled(ctx.shouldEnableTrackerDbAssisted(updatedOptions));
      if (ctx.IS_CHROMIUM) {
        await ctx.applyTrackerDbDynamicRules(ctx.isTrackerDbAssistedEnabled()).catch((e) =>
          console.warn('[midori] applyTrackerDbDynamicRules:', e)
        );
      }
      return { success: true, enabled: ctx.isTrackerDbAssistedEnabled() };
    },
  };
}

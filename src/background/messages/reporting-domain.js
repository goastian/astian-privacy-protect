export function createReportingDomainHandlers(ctx) {
  return {
    'get-report-top-sites': async (msg) => ctx.getTopTrackedSites(msg.days || 30, msg.limit || 10),

    'get-report-stats': async (msg) => ctx.getBlockingStats(msg.days || 30),

    'get-report-categories': async (msg) => ctx.getCategoryDistribution(msg.days || 30),

    'get-hourly-heatmap': async (msg) => ctx.getHourlyHeatmap(msg.days || 7),

    'get-weekly-trend': async () => ctx.getWeeklyTrend(),

    'get-privacy-summary': async (msg) => ctx.getPrivacySummary(msg.days || 30),

    'get-applied-rules-diagnostics': async (msg) => ctx.getAppliedRulesDiagnostics(msg.limit || 20),

    'export-report': async () => ctx.exportReport(),

    'record-content-script-kpi': async (msg) => {
      ctx.recordContentScriptCost(msg.script, msg.hostname, msg.durationMs);
      return { success: true };
    },

    'record-applied-rules-event': async (msg, sender) => {
      const runtime = ctx.getRuntimeOptions();
      if (ctx.getEffectiveRolloutFlags(runtime).cosmeticAudit) {
        ctx.recordAppliedRulesEvent(msg, sender);
      }
      return { success: true };
    },

    'report-false-positive': async (msg) => {
      ctx.recordFalsePositive(msg.hostname, msg.category);
      return { success: true, total: ctx.telemetry.getFalsePositiveTotal() };
    },

    'report-site-ad-issue': async (msg) => {
      const hostname = String(msg.hostname || '').trim().toLowerCase();
      if (!hostname) return { success: false, error: 'hostname-required' };

      const issue = String(msg.issue || 'ad-visible').trim().toLowerCase();
      const note = String(msg.note || '').trim().slice(0, 240);
      const evidence = msg.evidence && typeof msg.evidence === 'object' ? msg.evidence : {};

      const opts = await ctx.getOptions();
      const reports = Array.isArray(opts.siteAdReports) ? [...opts.siteAdReports] : [];
      reports.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: Date.now(),
        hostname,
        issue,
        note,
        evidence: {
          blocked: Number(evidence.blocked) || 0,
          trackerCount: Number(evidence.trackerCount) || 0,
          score: Number(evidence.score) || 0,
          protectionLevel: String(evidence.protectionLevel || opts.protectionLevel || 'standard'),
          aggressiveVerticalRules: evidence.aggressiveVerticalRules === true,
          quickFixesEnabled: evidence.quickFixesEnabled !== false,
          antiAdblockEnabled: evidence.antiAdblockEnabled !== false,
        },
      });

      const capped = reports.slice(-100);
      await ctx.setOptions({ siteAdReports: capped });
      ctx.refreshRuntimeOptions({ ...opts, siteAdReports: capped });
      return { success: true, total: capped.length };
    },

    'get-site-ad-reports': async (msg) => {
      const opts = await ctx.getOptions();
      const limit = Math.max(1, Math.min(50, Number(msg.limit) || 10));
      const hostname = String(msg.hostname || '').trim().toLowerCase();
      let reports = Array.isArray(opts.siteAdReports) ? opts.siteAdReports : [];
      if (hostname) {
        reports = reports.filter((report) => report.hostname === hostname);
      }
      return reports.slice(-limit).reverse();
    },

    'set-telemetry-enabled': async (msg) => {
      const enabled = await ctx.telemetry.setEnabled(msg.enabled);
      return { success: true, enabled };
    },

    'reset-local-telemetry': async () => {
      await ctx.telemetry.reset();
      return { success: true };
    },

    'get-stats-summary': async (msg) => {
      const days = msg.days || 7;
      const [stats, categories, topSites, summary, trend] = await Promise.all([
        ctx.getBlockingStats(days),
        ctx.getCategoryDistribution(days),
        ctx.getTopTrackedSites(days, msg.limit || 5),
        ctx.getPrivacySummary(days),
        ctx.getWeeklyTrend(),
      ]);
      const totalBlocked = (stats || []).reduce((sum, day) => sum + day.blocked, 0);
      return {
        totalBlocked,
        categories: categories || { trackers: 0, ads: 0, fingerprinters: 0, other: 0 },
        topSites: topSites || [],
        privacyScore: summary?.avgScore || 100,
        privacyGrade: summary?.avgGrade || 'A+',
        sitesAnalyzed: summary?.sitesAnalyzed || 0,
        trend: trend || { thisWeek: 0, lastWeek: 0, change: 0 },
        dailyStats: stats || [],
      };
    },
  };
}

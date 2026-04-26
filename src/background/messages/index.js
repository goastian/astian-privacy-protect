import { createSiteDomainHandlers } from './site-domain.js';
import { createSettingsDomainHandlers } from './settings-domain.js';
import { createReportingDomainHandlers } from './reporting-domain.js';
import { createMaintenanceDomainHandlers } from './maintenance-domain.js';

export function createMessageDispatcher(ctx) {
  const handlers = {
    ...createSiteDomainHandlers(ctx),
    ...createSettingsDomainHandlers(ctx),
    ...createReportingDomainHandlers(ctx),
    ...createMaintenanceDomainHandlers(ctx),
  };

  return async function dispatchMessage(msg, sender) {
    const action = msg?.action;
    if (!action || !handlers[action]) {
      return { error: 'Unknown action' };
    }
    return handlers[action](msg, sender);
  };
}

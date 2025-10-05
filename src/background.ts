import { AdBlocker } from './adblocker';
import { AstianStats } from './astian-stats';
import { RequestMonitor } from './request-monitor';

// Inicializar el bloqueador cuando se instala la extensión
browser.runtime.onInstalled.addListener(async (details: any) => {
    console.log('AdBlock Extension installed/updated');

    try {
        // Inicializar sistema de estadísticas primero
        const statsManager = AstianStats.getInstance();
        await statsManager.loadStats();

        // Inicializar el bloqueador
        const adBlocker = AdBlocker.getInstance();
        await adBlocker.initialize();

        // Iniciar monitoreo de requests
        const requestMonitor = RequestMonitor.getInstance();
        requestMonitor.startMonitoring();

        // Configurar icono de la extensión
        try {
            browser.browserAction.setBadgeText({ text: '' });
            browser.browserAction.setBadgeBackgroundColor({ color: '#4CAF50' });
        } catch (error) {
            console.warn('Could not set badge:', error);
        }

        console.log('AdBlock Extension ready');
    } catch (error) {
        console.error('Failed to initialize AdBlock Extension:', error);
    }
});

// Manejar actualizaciones de la extensión
chrome.runtime.onStartup.addListener(async () => {
    console.log('AdBlock Extension starting up');

    try {
        const adBlocker = AdBlocker.getInstance();
        if (!adBlocker.isEnabled()) {
            await adBlocker.initialize();
        }
    } catch (error) {
        console.error('Failed to start AdBlock Extension:', error);
    }
});

// Manejar mensajes desde content scripts y popup
const runtimeAPI = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
runtimeAPI.onMessage.addListener((request: any, sender: any, sendResponse: any) => {
    const adBlocker = AdBlocker.getInstance();

    switch (request.action) {
        case 'getStats':
            try {
                const astianStats = AstianStats.getInstance();
                const stats = astianStats.getFormattedStats();
                sendResponse(stats);
            } catch (error) {
                sendResponse({ error: (error as Error).message });
            }
            break;

        case 'getConfig':
            sendResponse(adBlocker.getConfig());
            break;

        case 'updateConfig':
            adBlocker.updateConfig(request.config).then(() => {
                sendResponse({ success: true });
            }).catch((error) => {
                sendResponse({ success: false, error: (error as Error).message });
            });
            return true; // Mantener el canal abierto para respuesta asíncrona

        case 'toggle':
            adBlocker.toggle().then(() => {
                sendResponse({ success: true, enabled: adBlocker.isEnabled() });
            }).catch((error) => {
                sendResponse({ success: false, error: (error as Error).message });
            });
            return true;

        case 'resetStats':
            adBlocker.resetStats().then(() => {
                sendResponse({ success: true });
            }).catch((error) => {
                sendResponse({ success: false, error: (error as Error).message });
            });
            return true;

        case 'reinitialize':
            adBlocker.reinitialize().then(() => {
                sendResponse({ success: true });
            }).catch((error) => {
                sendResponse({ success: false, error: (error as Error).message });
            });
            return true;

        case 'getCurrentTabStats':
            try {
                const astianStats = AstianStats.getInstance();
                const currentTabStats = AstianStats.getCurrentTabStats();
                sendResponse({ success: true, stats: currentTabStats });
            } catch (error) {
                sendResponse({ success: false, error: (error as Error).message });
            }
            break;

        case 'getGlobalStats':
            try {
                const astianStats = AstianStats.getInstance();
                const globalStats = AstianStats.getGlobalStats();
                sendResponse({ success: true, stats: globalStats });
            } catch (error) {
                sendResponse({ success: false, error: (error as Error).message });
            }
            break;

        case 'getTabStats':
            try {
                const astianStats = AstianStats.getInstance();
                const tabStats = AstianStats.getTabStats(request.tabId);
                sendResponse({ success: true, stats: tabStats });
            } catch (error) {
                sendResponse({ success: false, error: (error as Error).message });
            }
            break;

        case 'updateBadge':
            try {
                updateBadge();
                sendResponse({ success: true });
            } catch (error) {
                sendResponse({ success: false, error: (error as Error).message });
            }
            break;

        default:
            sendResponse({ error: 'Unknown action' });
    }
});

// Manejar cambios en las pestañas para actualizar estadísticas
const tabsAPI = typeof browser !== 'undefined' ? browser.tabs : chrome.tabs;
(tabsAPI.onUpdated as any).addListener((tabId: number, changeInfo: any, tab: any) => {
    if (changeInfo.status === 'complete' && tab.url) {
        // Establecer la pestaña actual en el sistema de estadísticas
        const astianStats = AstianStats.getInstance();
        AstianStats.setCurrentTab(tabId.toString());

        // Actualizar badge con estadísticas de la pestaña actual
        updateBadge();
    }
});

// Manejar cuando se activa una pestaña
(tabsAPI as any).onActivated.addListener(async (activeInfo: any) => {
    const astianStats = AstianStats.getInstance();
    AstianStats.setCurrentTab(activeInfo.tabId.toString());

    // Actualizar badge con estadísticas de la pestaña actual
    updateBadge();

    // Limpiar pestañas antiguas
    await astianStats.cleanupOldTabs();
});

// Función para actualizar el badge de la extensión
async function updateBadge(): Promise<void> {
    try {
        // Obtener la pestaña activa actual
        const tabsAPI = typeof browser !== 'undefined' ? browser.tabs : chrome.tabs;
        const tabs = await new Promise<any>((resolve) => {
            tabsAPI.query({ active: true, currentWindow: true }, resolve);
        });

        if (!tabs || !tabs[0]) {
            return;
        }

        const currentTabId = tabs[0].id.toString();
        const astianStats = AstianStats.getInstance();
        const currentTabStats = AstianStats.getTabStats(currentTabId);

        // Mostrar número de bloqueos de la pestaña actual en el badge
        const blockedCount = currentTabStats ? currentTabStats.blocked : 0;

        if (blockedCount > 0) {
            if (typeof browser !== 'undefined') {
                // Firefox
                await browser.browserAction.setBadgeText({
                    text: blockedCount.toString()
                });
                await browser.browserAction.setBadgeBackgroundColor({
                    color: '#FF5722'
                });
            } else {
                // Chrome/Edge
                await chrome.action.setBadgeText({
                    text: blockedCount.toString()
                });
                await chrome.action.setBadgeBackgroundColor({
                    color: '#FF5722'
                });
            }
        } else {
            if (typeof browser !== 'undefined') {
                // Firefox
                await browser.browserAction.setBadgeText({ text: '' });
            } else {
                // Chrome/Edge
                await chrome.action.setBadgeText({ text: '' });
            }
        }
    } catch (error) {
        console.error('Error updating badge:', error);
    }
}

// Limpiar recursos cuando se desinstala la extensión
if (runtimeAPI.onSuspend) {
    runtimeAPI.onSuspend.addListener(() => {
        console.log('AdBlock Extension suspending');
    });
}

// Manejar errores no capturados
self.addEventListener('error', (event: any) => {
    console.error('AdBlock Extension error:', event.error);
});

self.addEventListener('unhandledrejection', (event: any) => {
    console.error('AdBlock Extension unhandled rejection:', event.reason);
});
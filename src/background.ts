import { AdBlocker } from './adblocker';
import { GhosteryStats } from './ghostery-stats';
import { RequestMonitor } from './request-monitor';

// Inicializar el bloqueador cuando se instala la extensión
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('AdBlock Extension installed/updated');

    try {
        // Inicializar sistema de estadísticas primero
        const statsManager = GhosteryStats.getInstance();
        await statsManager.loadStats();

        // Inicializar el bloqueador
        const adBlocker = AdBlocker.getInstance();
        await adBlocker.initialize();

        // Iniciar monitoreo de requests
        const requestMonitor = RequestMonitor.getInstance();
        requestMonitor.startMonitoring();

        // Configurar icono de la extensión
        try {
            if (typeof browser !== 'undefined') {
                // Firefox
                browser.browserAction.setBadgeText({ text: '' });
                browser.browserAction.setBadgeBackgroundColor({ color: '#4CAF50' });
            } else if (typeof chrome !== 'undefined' && chrome.action) {
                // Chrome/Edge
                chrome.action.setBadgeText({ text: '' });
                chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
            }
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
browser.runtime.onMessage.addListener((request: any, sender: any, sendResponse: any) => {
    const adBlocker = AdBlocker.getInstance();

    switch (request.action) {
        case 'getStats':
            try {
                const ghosteryStats = GhosteryStats.getInstance();
                const stats = ghosteryStats.getFormattedStats();
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
            (async () => {
                try {
                    if (adBlocker.isEnabled()) {
                        await adBlocker.disable();
                    } else {
                        await adBlocker.enable();
                    }
                    updateBadge(); // Update badge after toggling
                    sendResponse({ success: true, enabled: adBlocker.isEnabled() });
                } catch (error) {
                    sendResponse({ success: false, error: (error as Error).message });
                }
            })();
            return true; // Indica que la respuesta será asíncrona

        case 'resetStats':
            (async () => {
                try {
                    const ghosteryStats = GhosteryStats.getInstance();
                    await ghosteryStats.resetStats();
                    updateBadge(); // Update badge after resetting
                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: (error as Error).message });
                }
            })();
            return true; // Indica que la respuesta será asíncrona

        case 'reinitialize':
            (async () => {
                try {
                    await adBlocker.initialize();
                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: (error as Error).message });
                }
            })();
            return true;

        case 'getCurrentTabStats':
            try {
                const ghosteryStats = GhosteryStats.getInstance();
                const currentTabStats = ghosteryStats.getCurrentTabStats();
                sendResponse({ success: true, stats: currentTabStats });
            } catch (error) {
                sendResponse({ success: false, error: (error as Error).message });
            }
            break;

        case 'getGlobalStats':
            try {
                const ghosteryStats = GhosteryStats.getInstance();
                const globalStats = ghosteryStats.getGlobalStats();
                sendResponse({ success: true, stats: globalStats });
            } catch (error) {
                sendResponse({ success: false, error: (error as Error).message });
            }
            break;

        case 'getTabStats':
            try {
                const ghosteryStats = GhosteryStats.getInstance();
                const tabStats = ghosteryStats.getTabStats(request.tabId);
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

        case 'recordBlockedRequest':
            (async () => {
                try {
                    const ghosteryStats = GhosteryStats.getInstance();
                    await ghosteryStats.recordBlockedRequest(
                        request.url,
                        request.type,
                        request.size || 0,
                        request.loadTime || 0,
                        request.tabId
                    );

                    // Actualizar badge después de registrar un bloqueo
                    updateBadge();

                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: (error as Error).message });
                }
            })();
            return true; // Indica que la respuesta será asíncrona

        default:
            sendResponse({ error: 'Unknown action' });
    }
});

// Manejar cambios en las pestañas para actualizar estadísticas
browser.tabs.onUpdated.addListener((tabId: number, changeInfo: any, tab: any) => {
    if (changeInfo.status === 'complete' && tab.url) {
        // Establecer la pestaña actual en el sistema de estadísticas
        const ghosteryStats = GhosteryStats.getInstance();
        ghosteryStats.setCurrentTab(tabId.toString());

        // Actualizar badge con estadísticas de la pestaña actual
        updateBadge();
    }
});

// Manejar cuando se activa una pestaña
browser.tabs.onActivated.addListener(async (activeInfo: any) => {
    const ghosteryStats = GhosteryStats.getInstance();
    ghosteryStats.setCurrentTab(activeInfo.tabId.toString());

    // Actualizar badge con estadísticas de la pestaña actual
    updateBadge();

    // Limpiar pestañas antiguas
    await ghosteryStats.cleanupOldTabs();
});

// Función para actualizar el badge de la extensión
async function updateBadge(): Promise<void> {
    try {
        // Obtener la pestaña activa actual
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });

        if (!tabs || !tabs[0]) {
            return;
        }

        const currentTabId = tabs[0].id.toString();
        const ghosteryStats = GhosteryStats.getInstance();
        const currentTabStats = ghosteryStats.getTabStats(currentTabId);

        // Mostrar número de bloqueos de la pestaña actual en el badge
        const blockedCount = currentTabStats ? currentTabStats.blocked : 0;

        if (blockedCount > 0) {
            await browser.browserAction.setBadgeText({
                text: blockedCount.toString()
            });
            await browser.browserAction.setBadgeBackgroundColor({
                color: '#FF5722'
            });
        } else {
            await browser.browserAction.setBadgeText({ text: '' });
        }
    } catch (error) {
        console.error('Error updating badge:', error);
    }
}

// Limpiar recursos cuando se desinstala la extensión
if (browser.runtime.onSuspend) {
    browser.runtime.onSuspend.addListener(() => {
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
import { WebExtensionBlocker } from '@ghostery/adblocker-webextension';
import { GhosteryStats } from './ghostery-stats';
import { AdBlockConfig } from './types';

export class AdBlocker {
    private static instance: AdBlocker;
    private blocker: WebExtensionBlocker | null = null;
    private statsManager: GhosteryStats;
    private config: AdBlockConfig;
    private isInitialized = false;
    private webRequestListener: ((details: any) => Promise<chrome.webRequest.BlockingResponse | undefined>) | null = null;

    private constructor() {
        this.statsManager = GhosteryStats.getInstance();
        this.config = this.getDefaultConfig();
        this.loadConfig();
    }

    public static getInstance(): AdBlocker {
        if (!AdBlocker.instance) {
            AdBlocker.instance = new AdBlocker();
        }
        return AdBlocker.instance;
    }

    private getDefaultConfig(): AdBlockConfig {
        return {
            enabled: true,
            blockAds: true,
            blockTrackers: true,
            blockSocial: false,
            whitelist: [],
            blacklist: [],
            updateInterval: 24, // 24 horas
            showStats: true,
            performanceMode: true
        };
    }

    private async loadConfig(): Promise<void> {
        try {
            const result = await new Promise<any>((resolve) => {
                chrome.storage.local.get(['adblockConfig'], resolve);
            });
            if (result.adblockConfig) {
                this.config = { ...this.getDefaultConfig(), ...result.adblockConfig };
            }
        } catch (error) {
            console.error('Error loading config:', error);
        }
    }

    private async saveConfig(): Promise<void> {
        try {
            await new Promise<void>((resolve) => {
                chrome.storage.local.set({ adblockConfig: this.config }, resolve);
            });
        } catch (error) {
            console.error('Error saving config:', error);
        }
    }

    public async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            console.log('Initializing AdBlocker...');

            // Crear el bloqueador de Ghostery
            this.blocker = await WebExtensionBlocker.fromPrebuiltAdsAndTracking();

            // Configurar el bloqueador (sin parámetros para evitar el error de WeakMap)
            try {
                await (this.blocker as any).enableBlockingInBrowser();
            } catch (blockerError) {
                console.warn('Ghostery blocker failed, using fallback method:', blockerError);
                // Continuar sin el bloqueador de Ghostery
            }

            // Configurar listeners para estadísticas
            this.setupStatsListeners();

            this.isInitialized = true;
            console.log('AdBlocker initialized successfully');
        } catch (error) {
            console.error('Failed to initialize AdBlocker:', error);
            // Continuar sin el bloqueador de Ghostery
            this.setupStatsListeners();
            this.isInitialized = true;
        }
    }

    private setupStatsListeners(): void {
        // Usar webRequest para Firefox con blocking
        this.setupWebRequestBlocking();
    }

    private setupWebRequestBlocking(): void {
        try {
            const webRequest = browser.webRequest;

            // Remover listeners existentes primero
            if (this.webRequestListener) {
                webRequest.onBeforeRequest.removeListener(this.webRequestListener);
            }

            // Crear nuevo listener
            this.webRequestListener = (details: any) => this.handleRequest(details);

            // Firefox: con blocking
            (webRequest.onBeforeRequest as any).addListener(
                this.webRequestListener,
                { urls: ['<all_urls>'] },
                ['blocking']
            );

            console.log('WebRequest blocking listener added');
        } catch (error) {
            console.warn('Could not setup webRequest blocking:', error);
        }
    }

    private async handleRequest(details: chrome.webRequest.WebRequestBodyDetails): Promise<chrome.webRequest.BlockingResponse | undefined> {
        try {
            const shouldBlock = await this.shouldBlockRequest(details.url);

            if (shouldBlock) {
                console.log('Blocking request:', details.url);
                await this.recordBlockedRequest(details);
                return { cancel: true };
            }

            return { cancel: false };
        } catch (error) {
            console.error('Error handling request:', error);
            return { cancel: false };
        }
    }

    private async shouldBlockRequest(url: string): Promise<boolean> {
        if (!this.config.enabled) {
            console.log('AdBlocker disabled, not blocking:', url);
            return false;
        }

        // Verificar si la URL está en la lista blanca
        if (this.config.whitelist.some(domain => url.includes(domain))) {
            console.log('URL whitelisted:', url);
            return false;
        }

        // Verificar si la URL está en la lista negra
        if (this.config.blacklist.some(domain => url.includes(domain))) {
            console.log('URL blacklisted:', url);
            return true;
        }

        // Patrones de anuncios y rastreadores comunes
        const adPatterns = [
            'doubleclick.net',
            'googlesyndication.com',
            'amazon-adsystem.com',
            'adsystem.amazon.com',
            'adnxs.com',
            'adsafeprotected.com',
            'outbrain.com',
            'taboola.com',
            'googleadservices.com',
            'googletagservices.com',
            'facebook.com/tr',
            'analytics.google.com',
            'googletagmanager.com',
            'quantserve.com',
            'scorecardresearch.com',
            'hotjar.com',
            'mixpanel.com',
            'segment.com',
            'amplitude.com'
        ];

        const urlLower = url.toLowerCase();
        const shouldBlock = adPatterns.some(pattern => urlLower.includes(pattern.toLowerCase()));

        if (shouldBlock) {
            console.log('Should block URL:', url);
        }

        return shouldBlock;
    }

    private async recordBlockedRequest(details: chrome.webRequest.WebRequestBodyDetails): Promise<void> {
        const url = details.url;
        const type = this.categorizeRequest(url);
        const estimatedSize = this.estimateRequestSize(details);
        const estimatedLoadTime = this.estimateLoadTime(details);
        const tabId = details.tabId?.toString();

        await this.statsManager.recordBlockedRequest(
            url,
            type,
            estimatedSize,
            estimatedLoadTime,
            tabId
        );

        // Notificar al background script para actualizar el badge
        try {
            const runtimeAPI = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
            runtimeAPI.sendMessage({ action: 'updateBadge' });
        } catch (error) {
            console.warn('Could not update badge:', error);
        }
    }

    private categorizeRequest(url: string): 'ads' | 'trackers' | 'social' | 'other' {
        const urlLower = url.toLowerCase();

        // Patrones para detectar tipos de contenido
        const adPatterns = [
            'ads', 'advertisement', 'banner', 'popup', 'sponsor',
            'doubleclick', 'googlesyndication', 'amazon-adsystem',
            'adsystem', 'adnxs', 'adsafeprotected', 'outbrain'
        ];

        const trackerPatterns = [
            'analytics', 'tracking', 'metrics', 'telemetry',
            'google-analytics', 'googletagmanager', 'facebook.com/tr',
            'doubleclick', 'googlesyndication', 'quantserve'
        ];

        const socialPatterns = [
            'facebook.com', 'twitter.com', 'instagram.com',
            'linkedin.com', 'pinterest.com', 'tiktok.com',
            'youtube.com', 'snapchat.com'
        ];

        // Verificar patrones de anuncios
        if (adPatterns.some(pattern => urlLower.includes(pattern))) {
            return 'ads';
        }

        // Verificar patrones de rastreadores
        if (trackerPatterns.some(pattern => urlLower.includes(pattern))) {
            return 'trackers';
        }

        // Verificar patrones de redes sociales
        if (socialPatterns.some(pattern => urlLower.includes(pattern))) {
            return 'social';
        }

        return 'other';
    }

    private estimateRequestSize(details: any): number {
        // Estimación básica del tamaño de la request
        const baseSize = 1024; // 1KB base
        const urlLength = details.url?.length || 0;
        const headersSize = 500; // Estimación de headers

        return baseSize + urlLength + headersSize;
    }

    private estimateLoadTime(details: any): number {
        // Estimación del tiempo de carga basada en el tipo de request
        const baseTime = 100; // 100ms base

        if (details.type === 'image') {
            return baseTime + 200; // Imágenes toman más tiempo
        } else if (details.type === 'script') {
            return baseTime + 300; // Scripts pueden ser pesados
        } else if (details.type === 'stylesheet') {
            return baseTime + 150; // CSS es más rápido
        }

        return baseTime;
    }

    public async toggle(): Promise<void> {
        this.config.enabled = !this.config.enabled;
        await this.saveConfig();

        if (this.config.enabled) {
            await this.initialize();
        } else {
            await this.disable();
        }
    }

    public async disable(): Promise<void> {
        if (this.blocker) {
            await (this.blocker as any).disableBlockingInBrowser();
        }
        this.config.enabled = false;
        await this.saveConfig();
        this.cleanupListeners();
    }

    private cleanupListeners(): void {
        try {
            if (this.webRequestListener) {
                browser.webRequest.onBeforeRequest.removeListener(this.webRequestListener);
                this.webRequestListener = null;
                console.log('WebRequest listeners cleaned up');
            }
        } catch (error) {
            console.warn('Error cleaning up listeners:', error);
        }
    }

    public isEnabled(): boolean {
        return this.config.enabled;
    }

    public getConfig(): AdBlockConfig {
        return { ...this.config };
    }

    public async updateConfig(newConfig: Partial<AdBlockConfig>): Promise<void> {
        this.config = { ...this.config, ...newConfig };
        await this.saveConfig();
    }

    public getStats(): any {
        return this.statsManager.getFormattedStats();
    }

    public async resetStats(): Promise<void> {
        await this.statsManager.resetStats();
    }

    public async reinitialize(): Promise<void> {
        this.isInitialized = false;
        await this.initialize();
    }
}
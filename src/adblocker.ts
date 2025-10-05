import { WebExtensionBlocker } from '@ghostery/adblocker-webextension';
import { GhosteryStats } from './ghostery-stats';
import { AdBlockConfig } from './types';

export class AdBlocker {
    private static instance: AdBlocker;
    private blocker: WebExtensionBlocker | null = null;
    private statsManager: GhosteryStats;
    private config: AdBlockConfig;
    private isInitialized = false;

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
        // Configurar listeners para estadísticas usando webRequest API
        const webRequest = (typeof browser !== 'undefined' ? browser : chrome).webRequest;
        (webRequest.onBeforeRequest as any).addListener(
            (details: any) => this.handleRequest(details),
            { urls: ['<all_urls>'] },
            ['blocking']
        );
    }

    private async handleRequest(details: chrome.webRequest.WebRequestBodyDetails): Promise<chrome.webRequest.BlockingResponse | undefined> {
        try {
            const shouldBlock = await this.shouldBlockRequest(details.url);

            if (shouldBlock) {
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
        if (!this.config.enabled) return false;

        // Verificar si la URL está en la lista blanca
        if (this.config.whitelist.some(domain => url.includes(domain))) {
            return false;
        }

        // Verificar si la URL está en la lista negra
        if (this.config.blacklist.some(domain => url.includes(domain))) {
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
        return adPatterns.some(pattern => urlLower.includes(pattern.toLowerCase()));
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
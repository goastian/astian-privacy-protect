import { WebExtensionBlocker } from '@ghostery/adblocker-webextension';
import { GhosteryStats } from './ghostery-stats';

export interface AdBlockerConfig {
    enabled: boolean;
    whitelist: string[];
    blacklist: string[];
    blockAds: boolean;
    blockTrackers: boolean;
    blockSocial: boolean;
    blockOther: boolean;
}

const defaultConfig: AdBlockerConfig = {
    enabled: true,
    whitelist: [],
    blacklist: [],
    blockAds: true,
    blockTrackers: true,
    blockSocial: true,
    blockOther: true
};

export class AdBlocker {
    private static instance: AdBlocker;
    private blocker: WebExtensionBlocker | null = null;
    private statsManager: GhosteryStats;
    private config: AdBlockerConfig = defaultConfig;
    private isInitialized = false;

    private constructor() {
        this.statsManager = GhosteryStats.getInstance();
        this.loadConfig().then(() => {
            if (this.config.enabled) {
                this.initialize();
            }
        });
    }

    public static getInstance(): AdBlocker {
        if (!AdBlocker.instance) {
            AdBlocker.instance = new AdBlocker();
        }
        return AdBlocker.instance;
    }

    private async loadConfig(): Promise<void> {
        try {
            const result = await browser.storage.local.get(['adBlockerConfig']);
            if (result.adBlockerConfig) {
                this.config = { ...defaultConfig, ...result.adBlockerConfig };
            }
        } catch (error) {
            console.error('Error loading config:', error);
        }
    }

    private async saveConfig(): Promise<void> {
        try {
            await browser.storage.local.set({ adBlockerConfig: this.config });
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

            // Configurar el bloqueador
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

            // Firefox: con blocking
            (webRequest.onBeforeRequest as any).addListener(
                (details: any) => this.handleRequest(details),
                { urls: ['<all_urls>'] },
                ['blocking']
            );
        } catch (error) {
            console.warn('Could not setup webRequest blocking:', error);
        }
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
            browser.runtime.sendMessage({ action: 'updateBadge' });
        } catch (error) {
            console.warn('Could not update badge:', error);
        }
    }

    private categorizeRequest(url: string): 'ads' | 'trackers' | 'social' | 'other' {
        const urlLower = url.toLowerCase();

        // Patrones para detectar tipos de contenido
        if (urlLower.includes('doubleclick') || urlLower.includes('googlesyndication') ||
            urlLower.includes('amazon-adsystem') || urlLower.includes('outbrain') ||
            urlLower.includes('taboola') || urlLower.includes('googleadservices') ||
            urlLower.includes('googletagservices')) {
            return 'ads';
        }

        if (urlLower.includes('analytics') || urlLower.includes('googletagmanager') ||
            urlLower.includes('quantserve') || urlLower.includes('scorecardresearch') ||
            urlLower.includes('hotjar') || urlLower.includes('mixpanel') ||
            urlLower.includes('segment') || urlLower.includes('amplitude')) {
            return 'trackers';
        }

        if (urlLower.includes('facebook.com/tr')) {
            return 'social';
        }

        return 'other';
    }

    private estimateRequestSize(details: any): number {
        // Estimación básica del tamaño de la request
        const urlLength = details.url.length;
        const headersSize = 200; // Tamaño estimado de headers
        return urlLength + headersSize;
    }

    private estimateLoadTime(details: any): number {
        // Estimación del tiempo de carga basada en el tipo de request
        const url = details.url.toLowerCase();
        if (url.includes('script') || url.includes('js')) {
            return 50; // Scripts suelen tardar más
        } else if (url.includes('image') || url.includes('img')) {
            return 30; // Imágenes medianas
        } else {
            return 20; // Otros recursos
        }
    }

    public async enable(): Promise<void> {
        if (this.blocker) {
            try {
                await (this.blocker as any).enableBlockingInBrowser();
            } catch (error) {
                console.warn('Ghostery blocker failed to enable, using fallback:', error);
            }
        }
        this.config.enabled = true;
        await this.saveConfig();
        this.setupStatsListeners(); // Re-setup listeners to ensure blocking is active
    }

    public async disable(): Promise<void> {
        if (this.blocker) {
            try {
                await (this.blocker as any).disableBlockingInBrowser();
            } catch (error) {
                console.warn('Ghostery blocker failed to disable, using fallback:', error);
            }
        }
        this.config.enabled = false;
        await this.saveConfig();
        // Remove listeners if needed, or ensure they don't block when disabled
    }

    public isEnabled(): boolean {
        return this.config.enabled;
    }

    public getConfig(): AdBlockerConfig {
        return { ...this.config };
    }

    public async updateConfig(newConfig: Partial<AdBlockerConfig>): Promise<void> {
        this.config = { ...this.config, ...newConfig };
        await this.saveConfig();
        // Re-initialize if enabled state changes
        if (newConfig.enabled !== undefined) {
            if (newConfig.enabled) {
                await this.enable();
            } else {
                await this.disable();
            }
        }
    }

    public getStats(): any {
        return this.statsManager.getFormattedStats();
    }
}
import { AstianStats } from './astian-stats';

export class RequestMonitor {
    private static instance: RequestMonitor;
    private statsManager: AstianStats;
    private isMonitoring = false;

    private constructor() {
        this.statsManager = AstianStats.getInstance();
    }

    public static getInstance(): RequestMonitor {
        if (!RequestMonitor.instance) {
            RequestMonitor.instance = new RequestMonitor();
        }
        return RequestMonitor.instance;
    }

    public startMonitoring(): void {
        if (this.isMonitoring) {
            return;
        }

        console.log('Starting request monitoring...');

        // Interceptar requests para estadísticas
        (chrome.webRequest.onBeforeRequest as any).addListener(
            (details: any) => this.handleRequest(details),
            { urls: ['<all_urls>'] },
            ['requestBody']
        );

        this.isMonitoring = true;
        console.log('Request monitoring started');
    }

    public stopMonitoring(): void {
        if (!this.isMonitoring) {
            return;
        }

        (chrome.webRequest.onBeforeRequest as any).removeListener(this.handleRequest);
        this.isMonitoring = false;
        console.log('Request monitoring stopped');
    }

    private async handleRequest(details: chrome.webRequest.WebRequestBodyDetails): Promise<void> {
        try {
            // Solo procesar requests que no sean de la extensión misma
            if (details.url.startsWith('chrome-extension://') ||
                details.url.startsWith('moz-extension://')) {
                return;
            }

            // Categorizar el request
            const type = this.categorizeRequest(details.url);

            // Solo registrar ciertos tipos de requests
            if (type === 'ads' || type === 'trackers' || type === 'social') {
                const estimatedSize = this.estimateRequestSize(details);
                const estimatedLoadTime = this.estimateLoadTime(details);
                const tabId = details.tabId?.toString();

                await this.statsManager.recordBlockedRequest(
                    details.url,
                    type,
                    estimatedSize,
                    estimatedLoadTime,
                    tabId
                );
            }
        } catch (error) {
            console.error('Error handling request:', error);
        }
    }

    private categorizeRequest(url: string): 'ads' | 'trackers' | 'social' | 'other' {
        const urlLower = url.toLowerCase();

        // Patrones para detectar anuncios
        const adPatterns = [
            'ads', 'advertisement', 'banner', 'popup', 'sponsor',
            'doubleclick', 'googlesyndication', 'amazon-adsystem',
            'adsystem', 'adnxs', 'adsafeprotected', 'outbrain',
            'googleadservices', 'googletagservices'
        ];

        // Patrones para detectar rastreadores
        const trackerPatterns = [
            'analytics', 'tracking', 'metrics', 'telemetry',
            'google-analytics', 'googletagmanager', 'facebook.com/tr',
            'doubleclick', 'googlesyndication', 'quantserve',
            'hotjar', 'mixpanel', 'segment', 'amplitude'
        ];

        // Patrones para detectar redes sociales
        const socialPatterns = [
            'facebook.com', 'twitter.com', 'instagram.com',
            'linkedin.com', 'pinterest.com', 'tiktok.com',
            'youtube.com', 'snapchat.com', 'reddit.com'
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

    private estimateRequestSize(details: chrome.webRequest.WebRequestBodyDetails): number {
        const baseSize = 1024; // 1KB base
        const urlLength = details.url?.length || 0;
        const headersSize = 500; // Estimación de headers

        // Agregar tamaño del body si existe
        let bodySize = 0;
        if (details.requestBody) {
            if (details.requestBody.formData) {
                bodySize = JSON.stringify(details.requestBody.formData).length;
            } else if (details.requestBody.raw) {
                bodySize = details.requestBody.raw.reduce((total, item) => {
                    return total + (item.bytes?.length || 0);
                }, 0);
            }
        }

        return baseSize + urlLength + headersSize + bodySize;
    }

    private estimateLoadTime(details: chrome.webRequest.WebRequestBodyDetails): number {
        const baseTime = 100; // 100ms base

        // Estimación basada en el tipo de request
        if (details.type === 'image') {
            return baseTime + 200; // Imágenes
        } else if (details.type === 'script') {
            return baseTime + 300; // Scripts
        } else if (details.type === 'stylesheet') {
            return baseTime + 150; // CSS
        } else if (details.type === 'xmlhttprequest') {
            return baseTime + 250; // AJAX requests
        }

        return baseTime;
    }
}


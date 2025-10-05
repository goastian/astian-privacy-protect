// Content script para detectar y reportar elementos bloqueados
class ContentAdBlocker {
    private blockedElements: Set<Element> = new Set();
    private observer: MutationObserver | null = null;

    constructor() {
        this.initialize();
    }

    private initialize(): void {
        console.log('Content AdBlocker initialized');

        // Detectar elementos de anuncios existentes
        this.detectExistingAds();

        // Observar cambios en el DOM
        this.observeDOMChanges();

        // Detectar elementos que se cargan dinámicamente
        this.detectDynamicAds();
    }

    private detectExistingAds(): void {
        const adSelectors = [
            '[class*="ad"]',
            '[class*="advertisement"]',
            '[class*="banner"]',
            '[id*="ad"]',
            '[id*="advertisement"]',
            '[id*="banner"]',
            'iframe[src*="doubleclick"]',
            'iframe[src*="googlesyndication"]',
            'iframe[src*="amazon-adsystem"]',
            'iframe[src*="adsystem"]',
            'iframe[src*="outbrain"]',
            'iframe[src*="taboola"]'
        ];

        adSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach((element: Element) => {
                this.blockElement(element);
            });
        });
    }

    private observeDOMChanges(): void {
        this.observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.checkElementForAds(node as Element);
                        }
                    });
                }
            });
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    private detectDynamicAds(): void {
        // Detectar scripts de anuncios que se cargan dinámicamente
        const scriptTags = document.querySelectorAll('script[src]');
        scriptTags.forEach((script: Element) => {
            const src = (script as HTMLScriptElement).src;
            if (this.isAdScript(src)) {
                this.blockElement(script);
            }
        });
    }

    private checkElementForAds(element: Element): void {
        // Verificar si el elemento es un anuncio
        if (this.isAdElement(element)) {
            this.blockElement(element);
        }

        // Verificar elementos hijos
        const children = element.querySelectorAll('*');
        children.forEach((child: Element) => {
            if (this.isAdElement(child)) {
                this.blockElement(child);
            }
        });
    }

    private isAdElement(element: Element): boolean {
        const className = element.className.toLowerCase();
        const id = element.id.toLowerCase();
        const tagName = element.tagName.toLowerCase();

        // Patrones de anuncios
        const adPatterns = [
            'ad', 'advertisement', 'banner', 'popup', 'sponsor',
            'doubleclick', 'googlesyndication', 'amazon-adsystem',
            'adsystem', 'adnxs', 'adsafeprotected', 'outbrain'
        ];

        // Verificar clases e IDs
        for (const pattern of adPatterns) {
            if (className.includes(pattern) || id.includes(pattern)) {
                return true;
            }
        }

        // Verificar iframes con fuentes de anuncios
        if (tagName === 'iframe') {
            const src = (element as HTMLIFrameElement).src;
            if (src && this.isAdScript(src)) {
                return true;
            }
        }

        return false;
    }

    private isAdScript(src: string): boolean {
        const adDomains = [
            'doubleclick.net',
            'googlesyndication.com',
            'amazon-adsystem.com',
            'adsystem.amazon.com',
            'adnxs.com',
            'adsafeprotected.com',
            'outbrain.com',
            'taboola.com',
            'googleadservices.com',
            'googletagservices.com'
        ];

        return adDomains.some(domain => src.includes(domain));
    }

    private blockElement(element: Element): void {
        if (this.blockedElements.has(element)) {
            return;
        }

        this.blockedElements.add(element);

        // Ocultar el elemento
        (element as HTMLElement).style.display = 'none';
        (element as HTMLElement).style.visibility = 'hidden';
        (element as HTMLElement).style.opacity = '0';
        (element as HTMLElement).style.height = '0';
        (element as HTMLElement).style.width = '0';
        (element as HTMLElement).style.overflow = 'hidden';

        // Agregar clase para identificación
        element.classList.add('adblock-blocked');

        // Reportar el bloqueo
        this.reportBlockedElement(element);
    }

    private reportBlockedElement(element: Element): void {
        const elementInfo = {
            tagName: element.tagName,
            className: element.className,
            id: element.id,
            src: (element as HTMLIFrameElement).src || '',
            url: window.location.href,
            timestamp: Date.now()
        };

        // Enviar mensaje al background script
        chrome.runtime.sendMessage({
            action: 'elementBlocked',
            element: elementInfo
        }).catch(error => {
            console.log('Could not send message to background:', error);
        });
    }

    public getBlockedCount(): number {
        return this.blockedElements.size;
    }

    public getBlockedElements(): Element[] {
        return Array.from(this.blockedElements);
    }

    public cleanup(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }

}

// Inicializar el content blocker
const contentBlocker = new ContentAdBlocker();

// Limpiar cuando se descarga la página
window.addEventListener('beforeunload', () => {
    contentBlocker.cleanup();
});

// Exponer para debugging
(window as any).contentAdBlocker = contentBlocker;


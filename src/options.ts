// Script de opciones para la página de configuración
class OptionsManager {
    private config: any = {};

    constructor() {
        this.initialize();
    }

    private async initialize(): Promise<void> {
        await this.loadConfig();
        this.setupEventListeners();
        this.updateUI();
    }

    private async loadConfig(): Promise<void> {
        try {
            const result = await new Promise<any>((resolve) => {
                chrome.storage.local.get(['adblockConfig'], resolve);
            });

            if (result.adblockConfig) {
                this.config = result.adblockConfig;
            } else {
                // Configuración por defecto
                this.config = {
                    enabled: true,
                    blockAds: true,
                    blockTrackers: true,
                    blockSocial: false,
                    whitelist: [],
                    blacklist: [],
                    updateInterval: 24,
                    showStats: true,
                    performanceMode: true
                };
            }
        } catch (error) {
            console.error('Error loading config:', error);
        }
    }

    private setupEventListeners(): void {
        // Botón guardar configuración
        const saveBtn = document.getElementById('saveSettings');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSettings());
        }

        // Botón resetear configuración
        const resetBtn = document.getElementById('resetSettings');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetSettings());
        }

        // Botón exportar configuración
        const exportBtn = document.getElementById('exportSettings');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportSettings());
        }

        // Botón importar configuración
        const importBtn = document.getElementById('importSettings');
        if (importBtn) {
            importBtn.addEventListener('click', () => this.importSettings());
        }

        // Agregar a lista blanca
        const addWhitelistBtn = document.getElementById('addWhitelist');
        const whitelistInput = document.getElementById('whitelistInput') as HTMLInputElement;
        if (addWhitelistBtn && whitelistInput) {
            addWhitelistBtn.addEventListener('click', () => this.addToWhitelist(whitelistInput.value));
            whitelistInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.addToWhitelist(whitelistInput.value);
                }
            });
        }

        // Agregar a lista negra
        const addBlacklistBtn = document.getElementById('addBlacklist');
        const blacklistInput = document.getElementById('blacklistInput') as HTMLInputElement;
        if (addBlacklistBtn && blacklistInput) {
            addBlacklistBtn.addEventListener('click', () => this.addToBlacklist(blacklistInput.value));
            blacklistInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.addToBlacklist(blacklistInput.value);
                }
            });
        }
    }

    private updateUI(): void {
        // Actualizar checkboxes
        this.updateCheckbox('enabled', this.config.enabled);
        this.updateCheckbox('blockAds', this.config.blockAds);
        this.updateCheckbox('blockTrackers', this.config.blockTrackers);
        this.updateCheckbox('blockSocial', this.config.blockSocial);
        this.updateCheckbox('performanceMode', this.config.performanceMode);
        this.updateCheckbox('showStats', this.config.showStats);

        // Actualizar select
        const updateIntervalSelect = document.getElementById('updateInterval') as HTMLSelectElement;
        if (updateIntervalSelect) {
            updateIntervalSelect.value = this.config.updateInterval.toString();
        }

        // Actualizar listas
        this.updateWhitelist();
        this.updateBlacklist();
    }

    private updateCheckbox(id: string, checked: boolean): void {
        const checkbox = document.getElementById(id) as HTMLInputElement;
        if (checkbox) {
            checkbox.checked = checked;
        }
    }

    private updateWhitelist(): void {
        const container = document.getElementById('whitelistItems');
        if (!container) return;

        container.innerHTML = '';
        this.config.whitelist.forEach((domain: string) => {
            this.createListItem(container, domain, 'whitelist');
        });
    }

    private updateBlacklist(): void {
        const container = document.getElementById('blacklistItems');
        if (!container) return;

        container.innerHTML = '';
        this.config.blacklist.forEach((domain: string) => {
            this.createListItem(container, domain, 'blacklist');
        });
    }

    private createListItem(container: HTMLElement, domain: string, type: 'whitelist' | 'blacklist'): void {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <span class="domain">${domain}</span>
            <button class="remove-btn" data-domain="${domain}" data-type="${type}">Eliminar</button>
        `;

        // Agregar event listener para el botón eliminar
        const removeBtn = item.querySelector('.remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => this.removeFromList(domain, type));
        }

        container.appendChild(item);
    }

    private addToWhitelist(domain: string): void {
        if (!domain.trim()) return;

        const cleanDomain = this.cleanDomain(domain);
        if (!this.config.whitelist.includes(cleanDomain)) {
            this.config.whitelist.push(cleanDomain);
            this.updateWhitelist();
            this.clearInput('whitelistInput');
            this.showNotification('Dominio agregado a la lista blanca', 'success');
        } else {
            this.showNotification('El dominio ya está en la lista blanca', 'error');
        }
    }

    private addToBlacklist(domain: string): void {
        if (!domain.trim()) return;

        const cleanDomain = this.cleanDomain(domain);
        if (!this.config.blacklist.includes(cleanDomain)) {
            this.config.blacklist.push(cleanDomain);
            this.updateBlacklist();
            this.clearInput('blacklistInput');
            this.showNotification('Dominio agregado a la lista negra', 'success');
        } else {
            this.showNotification('El dominio ya está en la lista negra', 'error');
        }
    }

    private removeFromList(domain: string, type: 'whitelist' | 'blacklist'): void {
        if (type === 'whitelist') {
            this.config.whitelist = this.config.whitelist.filter((d: string) => d !== domain);
            this.updateWhitelist();
        } else {
            this.config.blacklist = this.config.blacklist.filter((d: string) => d !== domain);
            this.updateBlacklist();
        }
        this.showNotification('Dominio eliminado', 'success');
    }

    private cleanDomain(domain: string): string {
        return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    }

    private clearInput(id: string): void {
        const input = document.getElementById(id) as HTMLInputElement;
        if (input) {
            input.value = '';
        }
    }

    private async saveSettings(): Promise<void> {
        try {
            // Recopilar configuración del formulario
            this.config.enabled = (document.getElementById('enabled') as HTMLInputElement).checked;
            this.config.blockAds = (document.getElementById('blockAds') as HTMLInputElement).checked;
            this.config.blockTrackers = (document.getElementById('blockTrackers') as HTMLInputElement).checked;
            this.config.blockSocial = (document.getElementById('blockSocial') as HTMLInputElement).checked;
            this.config.performanceMode = (document.getElementById('performanceMode') as HTMLInputElement).checked;
            this.config.showStats = (document.getElementById('showStats') as HTMLInputElement).checked;
            this.config.updateInterval = parseInt((document.getElementById('updateInterval') as HTMLSelectElement).value);

            // Guardar en storage
            await new Promise<void>((resolve) => {
                chrome.storage.local.set({ adblockConfig: this.config }, resolve);
            });

            // Enviar mensaje al background script
            chrome.runtime.sendMessage({
                action: 'updateConfig',
                config: this.config
            });

            this.showNotification('Configuración guardada exitosamente', 'success');
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showNotification('Error al guardar la configuración', 'error');
        }
    }

    private async resetSettings(): Promise<void> {
        if (confirm('¿Estás seguro de que quieres restaurar la configuración predeterminada?')) {
            this.config = {
                enabled: true,
                blockAds: true,
                blockTrackers: true,
                blockSocial: false,
                whitelist: [],
                blacklist: [],
                updateInterval: 24,
                showStats: true,
                performanceMode: true
            };

            await this.saveSettings();
            this.updateUI();
            this.showNotification('Configuración restaurada', 'success');
        }
    }

    private exportSettings(): void {
        const dataStr = JSON.stringify(this.config, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);

        const link = document.createElement('a') as HTMLAnchorElement;
        link.href = url;
        link.download = 'adblock-config.json';
        link.click();

        URL.revokeObjectURL(url);
        this.showNotification('Configuración exportada', 'success');
    }

    private importSettings(): void {
        const input = document.createElement('input') as HTMLInputElement;
        input.type = 'file';
        input.accept = '.json';

        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const importedConfig = JSON.parse(e.target?.result as string);
                        this.config = { ...this.config, ...importedConfig };
                        this.updateUI();
                        this.showNotification('Configuración importada exitosamente', 'success');
                    } catch (error) {
                        this.showNotification('Error al importar la configuración', 'error');
                    }
                };
                reader.readAsText(file);
            }
        };

        input.click();
    }

    private showNotification(message: string, type: 'success' | 'error'): void {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Inicializar cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    new OptionsManager();
});


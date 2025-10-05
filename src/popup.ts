// Popup script para la interfaz de usuario
class PopupManager {
    private stats: any = {};
    private currentTabStats: any = null;
    private globalStats: any = {};
    private config: any = {};
    private isEnabled = true;
    private currentView: 'currentTab' | 'global' = 'currentTab';

    constructor() {
        this.initialize();
    }

    private async initialize(): Promise<void> {
        await this.loadData();
        this.setupEventListeners();
        this.updateUI();

        // Forzar actualización del badge al abrir el popup
        await this.sendMessage({ action: 'updateBadge' });

        // Escuchar cambios de pestaña para actualizar inmediatamente
        this.setupTabChangeListener();

        // Actualizar datos cada 2 segundos
        setInterval(() => {
            this.loadData().then(() => this.updateUI());
        }, 2000);
    }

    private setupTabChangeListener(): void {
        // Escuchar cambios de pestaña desde el background script
        const runtimeAPI = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
        if (runtimeAPI && runtimeAPI.onMessage) {
            runtimeAPI.onMessage.addListener((message: any) => {
                if (message.action === 'tabChanged' || message.action === 'statsUpdated') {
                    // Actualizar inmediatamente cuando cambie la pestaña
                    this.forceRefresh();
                }
            });
        }

        // Detectar cuando el popup se vuelve visible para refrescar
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.forceRefresh();
            }
        });
    }

    private async forceRefresh(): Promise<void> {
        try {
            await this.loadData();
            this.updateUI();
        } catch (error) {
            console.warn('Error refreshing popup:', error);
            // Mostrar valores por defecto en caso de error
            this.showDefaultValues();
        }
    }

    private showDefaultValues(): void {
        this.updateElement('currentTabBlocked', '0');
        this.updateElement('currentTabDataSaved', '0 B');
        this.updateElement('currentTabTimeSaved', '0ms');
        this.updateElement('totalBlocked', '0');
        this.updateElement('dataSaved', '0 B');
        this.updateElement('timeSaved', '0ms');
    }

    private async loadData(): Promise<void> {
        try {
            // Obtener estadísticas desde el background script para sincronización
            const statsResponse = await this.sendMessage({ action: 'getStats' });
            if (statsResponse) {
                this.stats = statsResponse;
            }

            // Obtener estadísticas de la pestaña actual desde el background script
            const currentTabResponse = await this.sendMessage({ action: 'getCurrentTabStats' });
            if (currentTabResponse && currentTabResponse.success) {
                this.currentTabStats = currentTabResponse.stats;
            }

            // Obtener estadísticas globales desde el background script
            const globalResponse = await this.sendMessage({ action: 'getGlobalStats' });
            console.log('Global response:', globalResponse);
            if (globalResponse && globalResponse.success) {
                this.globalStats = globalResponse.stats;
                console.log('Global stats loaded:', this.globalStats);
            } else {
                console.warn('Failed to load global stats:', globalResponse);
            }

            // Cargar configuración
            const configResponse = await this.sendMessage({ action: 'getConfig' });
            if (configResponse) {
                this.config = configResponse;
                this.isEnabled = configResponse.enabled;
            }
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }

    private async getCurrentTabId(): Promise<string | null> {
        try {
            const tabsAPI = typeof browser !== 'undefined' ? browser.tabs : chrome.tabs;
            const tabs = await new Promise<any>((resolve) => {
                tabsAPI.query({ active: true, currentWindow: true }, resolve);
            });
            return tabs && tabs[0] ? tabs[0].id.toString() : null;
        } catch (error) {
            console.error('Error getting current tab:', error);
            return null;
        }
    }

    private setupEventListeners(): void {
        // Botón de toggle
        const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement;
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleAdBlocker());
        }

        // Botón de opciones
        const optionsBtn = document.getElementById('optionsBtn') as HTMLButtonElement;
        if (optionsBtn) {
            optionsBtn.addEventListener('click', () => this.openOptions());
        }

        // Botón de reset
        const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetStats());
        }

        // Botones de toggle de vista
        const currentTabToggle = document.getElementById('currentTabToggle') as HTMLButtonElement;
        const globalToggle = document.getElementById('globalToggle') as HTMLButtonElement;

        if (currentTabToggle) {
            currentTabToggle.addEventListener('click', () => this.switchView('currentTab'));
        }

        if (globalToggle) {
            globalToggle.addEventListener('click', () => this.switchView('global'));
        }
    }

    private updateUI(): void {
        this.updateStats();
        this.updateStatus();
        this.updateButtons();
        this.updateCharts();
    }

    private updateStats(): void {
        if (this.currentView === 'currentTab') {
            this.updateCurrentTabStats();
        } else {
            this.updateGlobalStats();
        }

        // Estadísticas de hoy (siempre globales)
        this.updateElement('blockedToday', this.stats.blockedToday || '0');
        this.updateElement('dataToday', this.stats.dataSavedToday || '0 B');
        this.updateElement('timeToday', this.stats.timeSavedToday || '0ms');

        // Rendimiento
        this.updateElement('memoryUsage', this.stats.performance?.memoryUsage || '0 MB');
        this.updateElement('cpuUsage', this.stats.performance?.cpuUsage || '0%');
        this.updateElement('filterTime', this.stats.performance?.filterUpdateTime || '0ms');

        // Tiempo promedio
        this.updateElement('avgBlockTime', this.stats.averageBlockTime || '0ms');
    }

    private updateCurrentTabStats(): void {
        if (this.currentTabStats && this.currentTabStats.blocked !== undefined) {
            this.updateElement('currentTabBlocked', this.currentTabStats.blocked?.toString() || '0');
            this.updateElement('currentTabDataSaved', this.formatBytes(this.currentTabStats.dataSaved || 0));
            this.updateElement('currentTabTimeSaved', this.formatTime(this.currentTabStats.timeSaved || 0));

            // Actualizar gráficos por tipo para pestaña actual
            this.updateCurrentTabTypeCharts();
        } else {
            // Mostrar valores por defecto cuando no hay datos
            this.updateElement('currentTabBlocked', '0');
            this.updateElement('currentTabDataSaved', '0 B');
            this.updateElement('currentTabTimeSaved', '0ms');

            // Limpiar gráficos
            this.updateElement('currentTabAdsCount', '0');
            this.updateElement('currentTabTrackersCount', '0');
            this.updateElement('currentTabSocialCount', '0');
            this.updateElement('currentTabOtherCount', '0');
        }
    }

    private updateGlobalStats(): void {
        if (this.globalStats) {
            this.updateElement('totalBlocked', this.globalStats.totalBlocked || '0');
            this.updateElement('dataSaved', this.globalStats.totalDataSaved || '0 B');
            this.updateElement('timeSaved', this.globalStats.totalTimeSaved || '0ms');

            // Actualizar gráficos por tipo globales
            this.updateGlobalTypeCharts();
        } else {
            this.updateElement('totalBlocked', '0');
            this.updateElement('dataSaved', '0 B');
            this.updateElement('timeSaved', '0ms');
        }
    }

    private updateStatus(): void {
        const statusIndicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement;

        if (this.isEnabled) {
            statusIndicator?.classList.remove('inactive');
            statusText!.textContent = 'Activo';
            toggleBtn!.textContent = 'Desactivar';
            toggleBtn!.classList.remove('inactive');
        } else {
            statusIndicator?.classList.add('inactive');
            statusText!.textContent = 'Inactivo';
            toggleBtn!.textContent = 'Activar';
            toggleBtn!.classList.add('inactive');
        }
    }

    private updateButtons(): void {
        const toggleBtn = document.getElementById('toggleBtn') as HTMLButtonElement;

        if (toggleBtn) {
            if (this.isEnabled) {
                toggleBtn.innerHTML = '<span class="btn-text">Desactivar</span>';
                toggleBtn.classList.remove('inactive');
            } else {
                toggleBtn.innerHTML = '<span class="btn-text">Activar</span>';
                toggleBtn.classList.add('inactive');
            }
        }
    }

    private updateCharts(): void {
        if (this.currentView === 'currentTab') {
            this.updateCurrentTabTypeCharts();
        } else {
            this.updateGlobalTypeCharts();
        }
    }

    private updateCurrentTabTypeCharts(): void {
        if (this.currentTabStats && this.currentTabStats.blockedByType) {
            const blockedByType = this.currentTabStats.blockedByType;
            const total = Object.values(blockedByType).reduce((sum: number, count: any) => sum + count, 0);

            if (total > 0) {
                this.updateTypeChart('currentTabAds', blockedByType.ads || 0, total);
                this.updateTypeChart('currentTabTrackers', blockedByType.trackers || 0, total);
                this.updateTypeChart('currentTabSocial', blockedByType.social || 0, total);
                this.updateTypeChart('currentTabOther', blockedByType.other || 0, total);
            } else {
                this.updateTypeChart('currentTabAds', 0, 0);
                this.updateTypeChart('currentTabTrackers', 0, 0);
                this.updateTypeChart('currentTabSocial', 0, 0);
                this.updateTypeChart('currentTabOther', 0, 0);
            }
        }
    }

    private updateGlobalTypeCharts(): void {
        const blockedByType = this.stats.blockedByType || {};
        const total = Object.values(blockedByType).reduce((sum: number, count: any) => sum + count, 0);

        if (total > 0) {
            this.updateTypeChart('ads', blockedByType.ads || 0, total);
            this.updateTypeChart('trackers', blockedByType.trackers || 0, total);
            this.updateTypeChart('social', blockedByType.social || 0, total);
            this.updateTypeChart('other', blockedByType.other || 0, total);
        } else {
            this.updateTypeChart('ads', 0, 0);
            this.updateTypeChart('trackers', 0, 0);
            this.updateTypeChart('social', 0, 0);
            this.updateTypeChart('other', 0, 0);
        }
    }

    private updateTypeChart(type: string, count: number, total: number): void {
        const percentage = total > 0 ? (count / total) * 100 : 0;
        const bar = document.getElementById(`${type}Bar`) as HTMLElement;
        const countElement = document.getElementById(`${type}Count`);

        if (bar) {
            bar.style.width = `${percentage}%`;
            bar.className = `type-fill ${type}`;
        }

        if (countElement) {
            countElement.textContent = count.toString();
        }
    }

    private updateElement(id: string, value: string): void {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    private async toggleAdBlocker(): Promise<void> {
        try {
            const response = await this.sendMessage({ action: 'toggle' });
            if (response && response.success) {
                this.isEnabled = response.enabled;
                this.updateUI();
            }
        } catch (error) {
            console.error('Error toggling adblocker:', error);
            this.showError('Error al cambiar el estado del bloqueador');
        }
    }

    private async resetStats(): Promise<void> {
        if (confirm('¿Estás seguro de que quieres resetear todas las estadísticas?')) {
            try {
                const response = await this.sendMessage({ action: 'resetStats' });
                if (response && response.success) {
                    this.loadData().then(() => this.updateUI());
                    this.showSuccess('Estadísticas reseteadas');
                }
            } catch (error) {
                console.error('Error resetting stats:', error);
                this.showError('Error al resetear las estadísticas');
            }
        }
    }

    private openOptions(): void {
        chrome.runtime.openOptionsPage();
    }

    private switchView(view: 'currentTab' | 'global'): void {
        console.log('Switching view to:', view);
        this.currentView = view;

        // Actualizar botones de toggle
        const currentTabToggle = document.getElementById('currentTabToggle') as HTMLButtonElement;
        const globalToggle = document.getElementById('globalToggle') as HTMLButtonElement;

        if (view === 'currentTab') {
            currentTabToggle?.classList.add('active');
            globalToggle?.classList.remove('active');

            // Mostrar estadísticas de pestaña actual
            document.getElementById('currentTabStats')?.classList.remove('hidden');
            document.getElementById('currentTabTypes')?.classList.remove('hidden');
            document.getElementById('globalStats')?.classList.add('hidden');
            document.getElementById('globalTypes')?.classList.add('hidden');
        } else {
            globalToggle?.classList.add('active');
            currentTabToggle?.classList.remove('active');

            // Mostrar estadísticas globales
            document.getElementById('globalStats')?.classList.remove('hidden');
            document.getElementById('globalTypes')?.classList.remove('hidden');
            document.getElementById('currentTabStats')?.classList.add('hidden');
            document.getElementById('currentTabTypes')?.classList.add('hidden');
        }

        console.log('Global stats available:', this.globalStats);
        this.updateUI();
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    private formatTime(milliseconds: number): string {
        if (milliseconds < 1000) {
            return milliseconds.toFixed(0) + 'ms';
        } else if (milliseconds < 60000) {
            return (milliseconds / 1000).toFixed(1) + 's';
        } else {
            const minutes = Math.floor(milliseconds / 60000);
            const seconds = Math.floor((milliseconds % 60000) / 1000);
            return `${minutes}m ${seconds}s`;
        }
    }

    private async sendMessage(message: any): Promise<any> {
        return new Promise((resolve) => {
            const runtimeAPI = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
            runtimeAPI.sendMessage(message, (response: any) => {
                if (runtimeAPI.lastError) {
                    console.error('Runtime error:', runtimeAPI.lastError);
                    resolve(null);
                } else {
                    resolve(response);
                }
            });
        });
    }

    private showError(message: string): void {
        // Crear notificación de error temporal
        this.showNotification(message, 'error');
    }

    private showSuccess(message: string): void {
        // Crear notificación de éxito temporal
        this.showNotification(message, 'success');
    }

    private showNotification(message: string, type: 'success' | 'error'): void {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: ${type === 'success' ? '#4CAF50' : '#f44336'};
      color: white;
      padding: 10px 15px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 1000;
      animation: slideIn 0.3s ease;
    `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }
}

// Inicializar el popup cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});

// Agregar estilos para las notificaciones
const popupStyle = document.createElement('style');
popupStyle.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(popupStyle);
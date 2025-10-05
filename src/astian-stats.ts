import { TabStats } from './types';

// Sistema de estadísticas compatible con Ghostery AdBlocker
export class AstianStats {
    private static instance: AstianStats;
    private stats: any = {};
    private blockedRequests: any[] = [];
    private currentTabId: string | null = null;

    private constructor() {
        this.initializeStats();
    }

    public static getInstance(): AstianStats {
        if (!AstianStats.instance) {
            AstianStats.instance = new AstianStats();
        }
        return AstianStats.instance;
    }

    private initializeStats(): void {
        this.stats = {
            totalBlocked: 0,
            totalDataSaved: 0,
            totalTimeSaved: 0,
            blockedToday: 0,
            dataSavedToday: 0,
            timeSavedToday: 0,
            lastReset: new Date().toISOString(),
            blockedByType: {
                ads: 0,
                trackers: 0,
                social: 0,
                other: 0
            },
            tabStats: {}
        };
    }

    public async recordBlockedRequest(url: string, type: string, size: number = 0, loadTime: number = 0, tabId?: string): Promise<void> {
        const request = {
            url,
            type,
            size,
            loadTime,
            timestamp: Date.now(),
            domain: this.extractDomain(url),
            tabId: tabId || this.currentTabId
        };

        this.blockedRequests.push(request);

        // Actualizar estadísticas globales
        this.stats.totalBlocked++;
        this.stats.blockedToday++;
        this.stats.totalDataSaved += size;
        this.stats.dataSavedToday += size;
        this.stats.totalTimeSaved += loadTime;
        this.stats.timeSavedToday += loadTime;
        this.stats.blockedByType[type]++;

        // Actualizar estadísticas por pestaña si tenemos tabId
        if (tabId || this.currentTabId) {
            const currentTabId = tabId || this.currentTabId!;
            await this.updateTabStats(currentTabId, url, type, size, loadTime);
        }

        // Guardar en storage
        await this.saveStats();
    }

    private extractDomain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return 'unknown';
        }
    }

    private async saveStats(): Promise<void> {
        try {
            await new Promise<void>((resolve) => {
                chrome.storage.local.set({ astianStats: this.stats }, resolve);
            });
        } catch (error) {
            console.error('Error saving stats:', error);
        }
    }

    public async loadStats(): Promise<void> {
        try {
            const result = await new Promise<any>((resolve) => {
                chrome.storage.local.get(['astianStats'], resolve);
            });
            if (result.astianStats) {
                this.stats = { ...this.stats, ...result.astianStats };
            }
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    public getStats() {
        return { ...this.stats };
    }

    public getFormattedStats() {
        return {
            totalBlocked: this.formatNumber(this.stats.totalBlocked),
            totalDataSaved: this.formatBytes(this.stats.totalDataSaved),
            totalTimeSaved: this.formatTime(this.stats.totalTimeSaved),
            blockedToday: this.formatNumber(this.stats.blockedToday),
            dataSavedToday: this.formatBytes(this.stats.dataSavedToday),
            timeSavedToday: this.formatTime(this.stats.timeSavedToday),
            blockedByType: this.stats.blockedByType
        };
    }

    private formatNumber(num: number): string {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
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

    public async resetStats(): Promise<void> {
        this.stats = this.initializeStats();
        this.blockedRequests = [];
        await this.saveStats();
    }

    // Métodos para manejar estadísticas por pestaña
    public setCurrentTab(tabId: string): void {
        this.currentTabId = tabId;
    }

    private async updateTabStats(tabId: string, url: string, type: string, size: number, loadTime: number): Promise<void> {
        if (!this.stats.tabStats[tabId]) {
            this.stats.tabStats[tabId] = {
                tabId,
                url,
                domain: this.extractDomain(url),
                blocked: 0,
                dataSaved: 0,
                timeSaved: 0,
                blockedByType: {
                    ads: 0,
                    trackers: 0,
                    social: 0,
                    other: 0
                },
                lastActivity: Date.now()
            };
        }

        const tabStats = this.stats.tabStats[tabId];
        tabStats.blocked++;
        tabStats.dataSaved += size;
        tabStats.timeSaved += loadTime;
        tabStats.blockedByType[type]++;
        tabStats.lastActivity = Date.now();
        tabStats.url = url;
        tabStats.domain = this.extractDomain(url);
    }

    public getCurrentTabStats(): TabStats | null {
        if (!this.currentTabId || !this.stats.tabStats[this.currentTabId]) {
            return null;
        }
        return { ...this.stats.tabStats[this.currentTabId] };
    }

    public getGlobalStats() {
        return {
            totalBlocked: this.formatNumber(this.stats.totalBlocked),
            totalDataSaved: this.formatBytes(this.stats.totalDataSaved),
            totalTimeSaved: this.formatTime(this.stats.totalTimeSaved),
            blockedToday: this.formatNumber(this.stats.blockedToday),
            dataSavedToday: this.formatBytes(this.stats.dataSavedToday),
            timeSavedToday: this.formatTime(this.stats.timeSavedToday),
            blockedByType: this.stats.blockedByType
        };
    }

    public getTabStats(tabId: string): TabStats | null {
        if (!this.stats.tabStats[tabId]) {
            return null;
        }
        return { ...this.stats.tabStats[tabId] };
    }

    public getAllTabStats(): { [tabId: string]: TabStats } {
        return { ...this.stats.tabStats };
    }

    public async cleanupOldTabs(): Promise<void> {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 horas

        for (const tabId in this.stats.tabStats) {
            if (now - this.stats.tabStats[tabId].lastActivity > maxAge) {
                delete this.stats.tabStats[tabId];
            }
        }
        await this.saveStats();
    }
}
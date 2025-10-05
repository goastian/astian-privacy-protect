export interface AdBlockStats {
    totalBlocked: number;
    totalTimeSaved: number; // en milisegundos
    totalDataSaved: number; // en bytes
    blockedToday: number;
    dataSavedToday: number; // en bytes
    timeSavedToday: number; // en milisegundos
    lastReset: string; // ISO date string
    averageBlockTime: number; // tiempo promedio de carga de anuncios bloqueados
    blockedByType: {
        ads: number;
        trackers: number;
        social: number;
        other: number;
    };
    performance: {
        memoryUsage: number; // en MB
        cpuUsage: number; // porcentaje estimado
        filterUpdateTime: number; // tiempo de actualización de filtros
    };
    // Estadísticas por pestaña
    tabStats: { [tabId: string]: TabStats };
}

export interface TabStats {
    tabId: string;
    url: string;
    domain: string;
    blocked: number;
    dataSaved: number;
    timeSaved: number;
    blockedByType: {
        ads: number;
        trackers: number;
        social: number;
        other: number;
    };
    lastActivity: number;
}

export interface BlockedRequest {
    url: string;
    type: 'ads' | 'trackers' | 'social' | 'other';
    size: number; // tamaño estimado en bytes
    loadTime: number; // tiempo estimado de carga en ms
    timestamp: number;
    domain: string;
}

export interface AdBlockConfig {
    enabled: boolean;
    blockAds: boolean;
    blockTrackers: boolean;
    blockSocial: boolean;
    whitelist: string[];
    blacklist: string[];
    updateInterval: number; // en horas
    showStats: boolean;
    performanceMode: boolean; // modo de alto rendimiento
}
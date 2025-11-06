/**
 * Astian Privacy - Cryptominer Controller
 * Controla la configuración y estadísticas del detector de cryptominers
 */

(function() {
  'use strict';

  // Configuración por defecto
  const DEFAULT_CONFIG = {
    enabled: true,
    cpuThreshold: 80,
    detectionTimeout: 5000,
    blockWebWorkers: true,
    blockWebAssembly: true,
    showNotifications: true,
    strictMode: false,
    whitelist: [],
    blacklist: []
  };

  // Estado del controlador
  let currentConfig = { ...DEFAULT_CONFIG };
  let stats = {
    totalBlocked: 0,
    blockedToday: 0,
    blockedThisWeek: 0,
    blockedThisMonth: 0,
    lastBlocked: null,
    topBlockedDomains: new Map(),
    blockedTypes: new Map()
  };

  /**
   * Inicializa el controlador de cryptominers
   */
  function initCryptominerController() {
    console.log('[Cryptominer Controller] Inicializando controlador...');

    // Cargar configuración desde storage
    loadConfiguration();
    
    // Configurar detector
    configureDetector();
    
    // Inicializar estadísticas
    initializeStats();
    
    // Configurar listeners
    setupEventListeners();
    
    console.log('[Cryptominer Controller] Controlador inicializado');
  }

  /**
   * Carga la configuración desde el storage
   */
  async function loadConfiguration() {
    try {
      const result = await chrome.storage.local.get(['cryptominerConfig']);
      if (result.cryptominerConfig) {
        currentConfig = { ...DEFAULT_CONFIG, ...result.cryptominerConfig };
        console.log('[Cryptominer Controller] Configuración cargada:', currentConfig);
      }
    } catch (error) {
      console.error('[Cryptominer Controller] Error cargando configuración:', error);
    }
  }

  /**
   * Guarda la configuración en el storage
   */
  async function saveConfiguration() {
    try {
      await chrome.storage.local.set({ cryptominerConfig: currentConfig });
      console.log('[Cryptominer Controller] Configuración guardada');
    } catch (error) {
      console.error('[Cryptominer Controller] Error guardando configuración:', error);
    }
  }

  /**
   * Configura el detector de cryptominers
   */
  function configureDetector() {
    if (window.CryptominerDetector) {
      window.CryptominerDetector.updateConfig(currentConfig);
    }
  }

  /**
   * Inicializa las estadísticas
   */
  async function initializeStats() {
    try {
      const result = await chrome.storage.local.get(['cryptominerStats']);
      if (result.cryptominerStats) {
        stats = { ...stats, ...result.cryptominerStats };
        console.log('[Cryptominer Controller] Estadísticas cargadas:', stats);
      }
    } catch (error) {
      console.error('[Cryptominer Controller] Error cargando estadísticas:', error);
    }
  }

  /**
   * Guarda las estadísticas en el storage
   */
  async function saveStats() {
    try {
      await chrome.storage.local.set({ cryptominerStats: stats });
    } catch (error) {
      console.error('[Cryptominer Controller] Error guardando estadísticas:', error);
    }
  }

  /**
   * Configura los event listeners
   */
  function setupEventListeners() {
    // Escuchar mensajes del detector
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch (request.action) {
        case 'cryptominerBlocked':
          handleCryptominerBlocked(request);
          break;
        case 'cryptominerDetected':
          handleCryptominerDetected(request);
          break;
        case 'updateCryptominerConfig':
          updateConfig(request.config);
          sendResponse({ success: true });
          break;
        case 'getCryptominerStats':
          sendResponse(getStats());
          break;
        case 'getCryptominerConfig':
          sendResponse(currentConfig);
          break;
        case 'resetCryptominerStats':
          resetStats();
          sendResponse({ success: true });
          break;
      }
    });
  }

  /**
   * Maneja cuando se bloquea un cryptominer
   */
  function handleCryptominerBlocked(data) {
    console.log('[Cryptominer Controller] Cryptominer bloqueado:', data);
    
    // Actualizar estadísticas
    stats.totalBlocked++;
    stats.blockedToday++;
    stats.lastBlocked = {
      source: data.source,
      type: data.type,
      url: data.url,
      timestamp: data.timestamp
    };
    
    // Actualizar dominios más bloqueados
    try {
      const domain = new URL(data.source).hostname;
      stats.topBlockedDomains.set(domain, (stats.topBlockedDomains.get(domain) || 0) + 1);
    } catch (e) {
      // Ignorar errores de URL parsing
    }
    
    // Actualizar tipos de bloqueo
    stats.blockedTypes.set(data.type, (stats.blockedTypes.get(data.type) || 0) + 1);
    
    // Guardar estadísticas
    saveStats();
    
    // Enviar evento al background script
    chrome.runtime.sendMessage({
      action: 'cryptominerStatsUpdated',
      stats: stats
    });
  }

  /**
   * Maneja cuando se detecta un cryptominer
   */
  function handleCryptominerDetected(data) {
    console.log('[Cryptominer Controller] Cryptominer detectado:', data);
    
    // Enviar evento al background script
    chrome.runtime.sendMessage({
      action: 'cryptominerDetected',
      data: data
    });
  }

  /**
   * Actualiza la configuración
   */
  async function updateConfig(newConfig) {
    currentConfig = { ...currentConfig, ...newConfig };
    await saveConfiguration();
    configureDetector();
    console.log('[Cryptominer Controller] Configuración actualizada:', currentConfig);
  }

  /**
   * Obtiene las estadísticas actuales
   */
  function getStats() {
    return {
      ...stats,
      topBlockedDomains: Array.from(stats.topBlockedDomains.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      blockedTypes: Array.from(stats.blockedTypes.entries())
        .sort((a, b) => b[1] - a[1])
    };
  }

  /**
   * Resetea las estadísticas
   */
  function resetStats() {
    stats = {
      totalBlocked: 0,
      blockedToday: 0,
      blockedThisWeek: 0,
      blockedThisMonth: 0,
      lastBlocked: null,
      topBlockedDomains: new Map(),
      blockedTypes: new Map()
    };
    saveStats();
    console.log('[Cryptominer Controller] Estadísticas reseteadas');
  }

  /**
   * Obtiene la configuración actual
   */
  function getConfig() {
    return { ...currentConfig };
  }

  /**
   * Habilita/deshabilita el detector
   */
  async function setEnabled(enabled) {
    await updateConfig({ enabled });
  }

  /**
   * Configura el modo estricto
   */
  async function setStrictMode(strict) {
    await updateConfig({ strictMode: strict });
  }

  /**
   * Agrega un dominio a la whitelist
   */
  async function addToWhitelist(domain) {
    const whitelist = [...currentConfig.whitelist];
    if (!whitelist.includes(domain)) {
      whitelist.push(domain);
      await updateConfig({ whitelist });
    }
  }

  /**
   * Remueve un dominio de la whitelist
   */
  async function removeFromWhitelist(domain) {
    const whitelist = currentConfig.whitelist.filter(d => d !== domain);
    await updateConfig({ whitelist });
  }

  /**
   * Agrega un dominio a la blacklist
   */
  async function addToBlacklist(domain) {
    const blacklist = [...currentConfig.blacklist];
    if (!blacklist.includes(domain)) {
      blacklist.push(domain);
      await updateConfig({ blacklist });
    }
  }

  /**
   * Remueve un dominio de la blacklist
   */
  async function removeFromBlacklist(domain) {
    const blacklist = currentConfig.blacklist.filter(d => d !== domain);
    await updateConfig({ blacklist });
  }

  /**
   * Verifica si un dominio está en la whitelist
   */
  function isWhitelisted(domain) {
    return currentConfig.whitelist.includes(domain);
  }

  /**
   * Verifica si un dominio está en la blacklist
   */
  function isBlacklisted(domain) {
    return currentConfig.blacklist.includes(domain);
  }

  /**
   * Obtiene el resumen de protección
   */
  function getProtectionSummary() {
    const today = new Date().toDateString();
    const thisWeek = getWeekStart();
    const thisMonth = new Date().getMonth();
    
    return {
      enabled: currentConfig.enabled,
      strictMode: currentConfig.strictMode,
      totalBlocked: stats.totalBlocked,
      blockedToday: stats.blockedToday,
      lastBlocked: stats.lastBlocked,
      protectionLevel: getProtectionLevel(),
      recommendations: getRecommendations()
    };
  }

  /**
   * Obtiene el nivel de protección actual
   */
  function getProtectionLevel() {
    if (!currentConfig.enabled) return 'disabled';
    if (currentConfig.strictMode) return 'maximum';
    if (currentConfig.blockWebWorkers && currentConfig.blockWebAssembly) return 'high';
    if (currentConfig.blockWebWorkers || currentConfig.blockWebAssembly) return 'medium';
    return 'basic';
  }

  /**
   * Obtiene recomendaciones basadas en el comportamiento
   */
  function getRecommendations() {
    const recommendations = [];
    
    if (stats.totalBlocked > 10 && !currentConfig.strictMode) {
      recommendations.push({
        type: 'enable_strict_mode',
        message: 'Se han detectado muchos cryptominers. Considera activar el modo estricto.',
        priority: 'high'
      });
    }
    
    if (stats.blockedToday > 5) {
      recommendations.push({
        type: 'high_activity',
        message: 'Alta actividad de cryptominers hoy. Mantén las protecciones activadas.',
        priority: 'medium'
      });
    }
    
    if (!currentConfig.blockWebWorkers) {
      recommendations.push({
        type: 'enable_webworkers',
        message: 'Habilita el bloqueo de Web Workers para mayor protección.',
        priority: 'low'
      });
    }
    
    return recommendations;
  }

  /**
   * Obtiene el inicio de la semana
   */
  function getWeekStart() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);
    return startOfWeek;
  }

  // Inicializar el controlador cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCryptominerController);
  } else {
    initCryptominerController();
  }

  // Exponer funciones para uso externo
  window.CryptominerController = {
    updateConfig,
    getConfig,
    getStats,
    resetStats,
    setEnabled,
    setStrictMode,
    addToWhitelist,
    removeFromWhitelist,
    addToBlacklist,
    removeFromBlacklist,
    isWhitelisted,
    isBlacklisted,
    getProtectionSummary,
    getProtectionLevel,
    getRecommendations
  };

})();



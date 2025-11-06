/**
 * Astian Privacy - Cryptominer Detector
 * Detecta y bloquea scripts de minería de criptomonedas
 */

(function() {
  'use strict';

  // Lista de dominios conocidos de cryptominers
  const KNOWN_MINER_DOMAINS = [
    'coinhive.com',
    'cryptonight.com',
    'webmine.cz',
    'webminepool.com',
    'miner.pr0gramm.com',
    'minemytraffic.com',
    'dashjs.org',
    'bitcoin.com',
    'monero-miner.com',
    'crypto-loot.com',
    'coin-hive.com',
    'coinhive.net',
    'authedmine.com',
    'cryptoloot.pro',
    'minero.cc',
    'miner.rocks',
    'api.inwemo.com',
    'rarenet.ru',
    'webmine.pro',
    'crypto-webminer.com'
  ];

  // Patrones de scripts de minería
  const MINER_PATTERNS = [
    // CoinHive y similares
    /coinhive\.min\.js/,
    /cryptonight.*\.js/,
    /webmine.*\.js/,
    /miner.*\.js/,
    
    // WebAssembly miners
    /wasm.*miner/i,
    /crypto.*wasm/i,
    /mining.*wasm/i,
    
    // Scripts obfuscados comunes
    /[a-f0-9]{32,}\.js/, // Hashes largos típicos de scripts minados
    /miner_[a-f0-9]+\.js/,
    /crypto_[a-f0-9]+\.js/,
    
    // URLs sospechosas
    /\/mining\//,
    /\/crypto\//,
    /\/coin\//,
    /\/mine\//
  ];

  // Patrones de comportamiento de minería
  const MINING_BEHAVIOR_PATTERNS = [
    // Uso excesivo de CPU
    'excessive-cpu-usage',
    // Llamadas a WebAssembly
    'webassembly-calls',
    // Uso de Web Workers para minería
    'mining-webworkers',
    // Patrones de hash criptográfico
    'crypto-hashing'
  ];

  // Configuración del detector
  const CONFIG = {
    enabled: true,
    cpuThreshold: 80, // Porcentaje de CPU para considerar minería
    detectionTimeout: 5000, // 5 segundos para detectar minería
    blockWebWorkers: true,
    blockWebAssembly: true,
    showNotifications: true
  };

  // Estado del detector
  let isDetecting = false;
  let miningDetected = false;
  let blockedMiners = new Set();
  let cpuUsageHistory = [];

  /**
   * Inicializa el detector de cryptominers
   */
  function initCryptominerDetector() {
    if (!CONFIG.enabled) return;

    console.log('[Cryptominer Detector] Inicializando detector...');

    // Interceptar requests de scripts sospechosos
    interceptSuspiciousRequests();
    
    // Monitorear uso de CPU
    monitorCPUUsage();
    
    // Bloquear Web Workers maliciosos
    blockMaliciousWebWorkers();
    
    // Bloquear WebAssembly malicioso
    blockMaliciousWebAssembly();
    
    // Detectar scripts de minería en el DOM
    detectMiningScripts();
    
    // Monitorear cambios en el DOM
    monitorDOMChanges();
  }

  /**
   * Intercepta requests de scripts sospechosos
   */
  function interceptSuspiciousRequests() {
    // Interceptar fetch requests
    const originalFetch = window.fetch;
    window.fetch = function(url, options) {
      if (isSuspiciousURL(url)) {
        console.log('[Cryptominer Detector] Bloqueando request sospechoso:', url);
        blockMiner(url, 'fetch-request');
        return Promise.reject(new Error('Request bloqueado por detector de cryptominers'));
      }
      return originalFetch.call(this, url, options);
    };

    // Interceptar XMLHttpRequest
    const originalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
      const xhr = new originalXHR();
      const originalOpen = xhr.open;
      
      xhr.open = function(method, url, ...args) {
        if (isSuspiciousURL(url)) {
          console.log('[Cryptominer Detector] Bloqueando XHR sospechoso:', url);
          blockMiner(url, 'xhr-request');
          return;
        }
        return originalOpen.call(this, method, url, ...args);
      };
      
      return xhr;
    };
  }

  /**
   * Verifica si una URL es sospechosa de minería
   */
  function isSuspiciousURL(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const pathname = urlObj.pathname;
      
      // Verificar dominios conocidos
      if (KNOWN_MINER_DOMAINS.some(domain => hostname.includes(domain))) {
        return true;
      }
      
      // Verificar patrones en la URL
      if (MINER_PATTERNS.some(pattern => pattern.test(url))) {
        return true;
      }
      
      // Verificar parámetros sospechosos
      const params = urlObj.searchParams;
      if (params.has('site_key') || params.has('authedmine') || params.has('cryptonight')) {
        return true;
      }
      
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Monitorea el uso de CPU para detectar minería
   */
  function monitorCPUUsage() {
    if (!window.performance || !window.performance.now) return;

    let lastTime = performance.now();
    let frameCount = 0;
    
    function measureCPUUsage() {
      const currentTime = performance.now();
      const deltaTime = currentTime - lastTime;
      
      // Si el frame tarda más de lo normal, podría ser minería
      if (deltaTime > 16.67) { // Más de 60 FPS
        frameCount++;
        
        if (frameCount > 10) { // 10 frames consecutivos lentos
          console.log('[Cryptominer Detector] Uso excesivo de CPU detectado');
          detectMiningBehavior('excessive-cpu-usage');
        }
      } else {
        frameCount = 0;
      }
      
      lastTime = currentTime;
      requestAnimationFrame(measureCPUUsage);
    }
    
    requestAnimationFrame(measureCPUUsage);
  }

  /**
   * Bloquea Web Workers maliciosos
   */
  function blockMaliciousWebWorkers() {
    if (!CONFIG.blockWebWorkers) return;

    const originalWorker = window.Worker;
    window.Worker = function(scriptURL, options) {
      // Verificar si el script del worker es sospechoso
      if (isSuspiciousURL(scriptURL)) {
        console.log('[Cryptominer Detector] Bloqueando Web Worker sospechoso:', scriptURL);
        blockMiner(scriptURL, 'web-worker');
        throw new Error('Web Worker bloqueado por detector de cryptominers');
      }
      
      const worker = new originalWorker(scriptURL, options);
      
      // Interceptar mensajes del worker
      const originalPostMessage = worker.postMessage;
      worker.postMessage = function(message) {
        // Verificar si el mensaje contiene datos de minería
        if (isMiningMessage(message)) {
          console.log('[Cryptominer Detector] Mensaje de minería detectado en Web Worker');
          blockMiner(scriptURL, 'web-worker-message');
          return;
        }
        return originalPostMessage.call(this, message);
      };
      
      return worker;
    };
  }

  /**
   * Bloquea WebAssembly malicioso
   */
  function blockMaliciousWebAssembly() {
    if (!CONFIG.blockWebAssembly) return;

    // Interceptar WebAssembly.instantiate
    if (window.WebAssembly && window.WebAssembly.instantiate) {
      const originalInstantiate = window.WebAssembly.instantiate;
      window.WebAssembly.instantiate = function(bytes, importObject) {
        // Verificar si el WASM es sospechoso
        if (isSuspiciousWASM(bytes)) {
          console.log('[Cryptominer Detector] Bloqueando WebAssembly sospechoso');
          blockMiner('webassembly', 'wasm-instantiate');
          throw new Error('WebAssembly bloqueado por detector de cryptominers');
        }
        return originalInstantiate.call(this, bytes, importObject);
      };
    }
  }

  /**
   * Verifica si un mensaje contiene datos de minería
   */
  function isMiningMessage(message) {
    const messageStr = JSON.stringify(message);
    const miningKeywords = ['cryptonight', 'hash', 'nonce', 'difficulty', 'target'];
    
    return miningKeywords.some(keyword => 
      messageStr.toLowerCase().includes(keyword)
    );
  }

  /**
   * Verifica si WebAssembly es sospechoso
   */
  function isSuspiciousWASM(bytes) {
    // Verificar patrones típicos de miners en WASM
    const wasmStr = new TextDecoder().decode(bytes);
    const miningPatterns = ['cryptonight', 'scrypt', 'sha256', 'mining'];
    
    return miningPatterns.some(pattern => 
      wasmStr.toLowerCase().includes(pattern)
    );
  }

  /**
   * Detecta scripts de minería en el DOM
   */
  function detectMiningScripts() {
    const scripts = document.querySelectorAll('script');
    
    scripts.forEach(script => {
      if (script.src && isSuspiciousURL(script.src)) {
        console.log('[Cryptominer Detector] Script de minería detectado:', script.src);
        blockMiner(script.src, 'dom-script');
        script.remove();
      }
      
      // Verificar contenido inline
      if (script.innerHTML && isMiningCode(script.innerHTML)) {
        console.log('[Cryptominer Detector] Código de minería inline detectado');
        blockMiner('inline-script', 'inline-mining-code');
        script.remove();
      }
    });
  }

  /**
   * Verifica si el código contiene minería
   */
  function isMiningCode(code) {
    const miningPatterns = [
      /cryptonight/i,
      /coinhive/i,
      /webmine/i,
      /mining/i,
      /hash.*function/i,
      /nonce.*increment/i,
      /difficulty.*target/i
    ];
    
    return miningPatterns.some(pattern => pattern.test(code));
  }

  /**
   * Monitorea cambios en el DOM
   */
  function monitorDOMChanges() {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Verificar scripts agregados dinámicamente
            if (node.tagName === 'SCRIPT') {
              if (node.src && isSuspiciousURL(node.src)) {
                console.log('[Cryptominer Detector] Script de minería agregado dinámicamente');
                blockMiner(node.src, 'dynamic-script');
                node.remove();
              }
            }
            
            // Verificar scripts dentro de elementos agregados
            const scripts = node.querySelectorAll('script');
            scripts.forEach(script => {
              if (script.src && isSuspiciousURL(script.src)) {
                console.log('[Cryptominer Detector] Script de minería en elemento agregado');
                blockMiner(script.src, 'nested-script');
                script.remove();
              }
            });
          }
        });
      });
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Detecta comportamiento de minería
   */
  function detectMiningBehavior(behaviorType) {
    if (miningDetected) return;
    
    miningDetected = true;
    console.log('[Cryptominer Detector] Comportamiento de minería detectado:', behaviorType);
    
    // Notificar al usuario
    if (CONFIG.showNotifications) {
      showMiningNotification(behaviorType);
    }
    
    // Enviar evento al background script
    chrome.runtime.sendMessage({
      action: 'cryptominerDetected',
      behaviorType: behaviorType,
      url: window.location.href,
      timestamp: Date.now()
    });
  }

  /**
   * Bloquea un miner detectado
   */
  function blockMiner(source, type) {
    if (blockedMiners.has(source)) return;
    
    blockedMiners.add(source);
    console.log('[Cryptominer Detector] Bloqueando miner:', source, 'Tipo:', type);
    
    // Enviar estadísticas al background script
    chrome.runtime.sendMessage({
      action: 'cryptominerBlocked',
      source: source,
      type: type,
      url: window.location.href,
      timestamp: Date.now()
    });
  }

  /**
   * Muestra notificación de minería detectada
   */
  function showMiningNotification(behaviorType) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ff4444;
      color: white;
      padding: 15px;
      border-radius: 8px;
      z-index: 10000;
      font-family: Arial, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      max-width: 300px;
    `;
    
    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="font-size: 20px;">⛏️</div>
        <div>
          <div style="font-weight: bold;">Cryptominer Detectado</div>
          <div style="font-size: 12px; opacity: 0.9;">Astian Privacy ha bloqueado un intento de minería</div>
        </div>
        <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; color: white; font-size: 18px; cursor: pointer; margin-left: auto;">×</button>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remover después de 5 segundos
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 5000);
  }

  /**
   * Actualiza la configuración del detector
   */
  function updateConfig(newConfig) {
    Object.assign(CONFIG, newConfig);
    console.log('[Cryptominer Detector] Configuración actualizada:', CONFIG);
  }

  /**
   * Obtiene estadísticas del detector
   */
  function getDetectorStats() {
    return {
      blockedMiners: blockedMiners.size,
      miningDetected: miningDetected,
      blockedSources: Array.from(blockedMiners),
      config: CONFIG
    };
  }

  // Inicializar el detector cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCryptominerDetector);
  } else {
    initCryptominerDetector();
  }

  // Exponer funciones para el controlador
  window.CryptominerDetector = {
    updateConfig,
    getDetectorStats,
    blockMiner,
    detectMiningBehavior
  };

  // Escuchar mensajes del background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateCryptominerConfig') {
      updateConfig(request.config);
      sendResponse({ success: true });
    } else if (request.action === 'getCryptominerStats') {
      sendResponse(getDetectorStats());
    }
  });

})();



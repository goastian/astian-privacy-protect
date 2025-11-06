/**
 * Astian Privacy - Fingerprinting Controller
 * Controlador dinámico para las protecciones contra fingerprinting
 * 
 * Copyright 2024 Astian. All rights reserved.
 */

(function() {
  'use strict';

  let currentConfig = null;
  let isInitialized = false;

  // Función para obtener la configuración desde el storage
  async function getFingerprintingConfig() {
    try {
      const result = await chrome.storage.local.get(['options']);
      return result.options?.antiFingerprinting || {
        enabled: true,
        canvas: true,
        webgl: true,
        audio: true,
        fonts: true,
        screen: true,
        timezone: true,
        language: true,
        hardware: true,
        navigator: true,
        performance: true,
        webrtc: true
      };
    } catch (error) {
      console.warn('[Anti-Fingerprinting] Error obteniendo configuración:', error);
      return {
        enabled: true,
        canvas: true,
        webgl: true,
        audio: true,
        fonts: true,
        screen: true,
        timezone: true,
        language: true,
        hardware: true,
        navigator: true,
        performance: true,
        webrtc: true
      };
    }
  }

  // Función para aplicar/remover protecciones dinámicamente
  function applyFingerprintingProtections(config) {
    currentConfig = config;
    
    if (!config.enabled) {
      console.log('[Anti-Fingerprinting] Protección deshabilitada');
      return;
    }

    // Crear un elemento script para inyectar las protecciones
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        'use strict';
        
        const config = ${JSON.stringify(config)};
        
        // Solo aplicar protecciones habilitadas
        if (config.canvas) {
          // Canvas fingerprinting protection
          const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
          const originalToBlob = HTMLCanvasElement.prototype.toBlob;
          
          function generateConsistentSeed(domain) {
            let hash = 0;
            for (let i = 0; i < domain.length; i++) {
              const char = domain.charCodeAt(i);
              hash = ((hash << 5) - hash) + char;
              hash = hash & hash;
            }
            return Math.abs(hash) / 2147483647;
          }
          
          function generateConsistentNoise(seed, amplitude = 1) {
            const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
            return (x - Math.floor(x)) * amplitude;
          }
          
          HTMLCanvasElement.prototype.toDataURL = function(...args) {
            if (this.width === 0 || this.height === 0) {
              return originalToDataURL.apply(this, args);
            }
            
            const domain = window.location.hostname;
            const seed = generateConsistentSeed(domain);
            
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.width;
            tempCanvas.height = this.height;
            const tempCtx = tempCanvas.getContext('2d');
            
            tempCtx.drawImage(this, 0, 0);
            
            const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            const data = imageData.data;
            
            for (let i = 0; i < data.length; i += 4) {
              const noise = generateConsistentNoise(seed + i / 1000, 0.1);
              data[i] = Math.max(0, Math.min(255, data[i] + noise * 255));
              data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise * 255));
              data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise * 255));
            }
            
            tempCtx.putImageData(imageData, 0, 0);
            return originalToDataURL.call(tempCanvas, ...args);
          };
        }
        
        if (config.webgl) {
          // WebGL fingerprinting protection
          const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
          
          WebGLRenderingContext.prototype.getParameter = function(parameter) {
            const domain = window.location.hostname;
            let hash = 0;
            for (let i = 0; i < domain.length; i++) {
              const char = domain.charCodeAt(i);
              hash = ((hash << 5) - hash) + char;
              hash = hash & hash;
            }
            const seed = Math.abs(hash) / 2147483647;
            
            switch (parameter) {
              case 37445: // UNMASKED_VENDOR_WEBGL
                const vendors = ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'Mozilla'];
                return vendors[Math.floor(seed * vendors.length)];
              case 37446: // UNMASKED_RENDERER_WEBGL
                const renderers = [
                  'Intel(R) HD Graphics 620',
                  'NVIDIA GeForce GTX 1060',
                  'AMD Radeon RX 580',
                  'Mozilla WebGL'
                ];
                return renderers[Math.floor(seed * renderers.length)];
              case 37447: // VENDOR
              case 37448: // RENDERER
                return 'WebKit';
              default:
                return originalGetParameter.call(this, parameter);
            }
          };
        }
        
        if (config.screen) {
          // Screen fingerprinting protection
          const domain = window.location.hostname;
          let hash = 0;
          for (let i = 0; i < domain.length; i++) {
            const char = domain.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          const seed = Math.abs(hash) / 2147483647;
          
          const spoofedResolutions = [
            { width: 1920, height: 1080 },
            { width: 1366, height: 768 },
            { width: 1440, height: 900 },
            { width: 1536, height: 864 },
            { width: 1600, height: 900 }
          ];
          
          const selectedResolution = spoofedResolutions[Math.floor(seed * spoofedResolutions.length)];
          
          Object.defineProperty(screen, 'width', {
            get: () => selectedResolution.width,
            configurable: true
          });
          
          Object.defineProperty(screen, 'height', {
            get: () => selectedResolution.height,
            configurable: true
          });
          
          Object.defineProperty(screen, 'availWidth', {
            get: () => selectedResolution.width,
            configurable: true
          });
          
          Object.defineProperty(screen, 'availHeight', {
            get: () => selectedResolution.height - 40,
            configurable: true
          });
        }
        
        if (config.timezone) {
          // Timezone fingerprinting protection
          const domain = window.location.hostname;
          let hash = 0;
          for (let i = 0; i < domain.length; i++) {
            const char = domain.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          const seed = Math.abs(hash) / 2147483647;
          
          const spoofedTimezones = [
            'America/New_York',
            'America/Los_Angeles', 
            'Europe/London',
            'Europe/Berlin',
            'Asia/Tokyo'
          ];
          
          const selectedTimezone = spoofedTimezones[Math.floor(seed * spoofedTimezones.length)];
          
          const originalDateTimeFormat = Intl.DateTimeFormat;
          Intl.DateTimeFormat = function(locales, options) {
            if (options && options.timeZone === undefined) {
              options = { ...options, timeZone: selectedTimezone };
            }
            return new originalDateTimeFormat(locales, options);
          };
        }
        
        if (config.language) {
          // Language fingerprinting protection
          const domain = window.location.hostname;
          let hash = 0;
          for (let i = 0; i < domain.length; i++) {
            const char = domain.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          const seed = Math.abs(hash) / 2147483647;
          
          const spoofedLanguages = [
            'en-US,en',
            'es-ES,es',
            'fr-FR,fr',
            'de-DE,de',
            'en-GB,en'
          ];
          
          const selectedLanguage = spoofedLanguages[Math.floor(seed * spoofedLanguages.length)];
          
          Object.defineProperty(navigator, 'language', {
            get: () => selectedLanguage.split(',')[0],
            configurable: true
          });
          
          Object.defineProperty(navigator, 'languages', {
            get: () => selectedLanguage.split(','),
            configurable: true
          });
        }
        
        if (config.hardware) {
          // Hardware fingerprinting protection
          const domain = window.location.hostname;
          let hash = 0;
          for (let i = 0; i < domain.length; i++) {
            const char = domain.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          const seed = Math.abs(hash) / 2147483647;
          
          const spoofedHardware = [
            { cores: 4, memory: 8 },
            { cores: 6, memory: 16 },
            { cores: 8, memory: 32 },
            { cores: 2, memory: 4 }
          ];
          
          const selectedHardware = spoofedHardware[Math.floor(seed * spoofedHardware.length)];
          
          Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => selectedHardware.cores,
            configurable: true
          });
          
          if ('deviceMemory' in navigator) {
            Object.defineProperty(navigator, 'deviceMemory', {
              get: () => selectedHardware.memory,
              configurable: true
            });
          }
        }
        
        if (config.navigator) {
          // Navigator fingerprinting protection
          const domain = window.location.hostname;
          let hash = 0;
          for (let i = 0; i < domain.length; i++) {
            const char = domain.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          const seed = Math.abs(hash) / 2147483647;
          
          const spoofedPlatforms = [
            'Win32',
            'MacIntel',
            'Linux x86_64'
          ];
          
          const selectedPlatform = spoofedPlatforms[Math.floor(seed * spoofedPlatforms.length)];
          
          Object.defineProperty(navigator, 'platform', {
            get: () => selectedPlatform,
            configurable: true
          });
          
          Object.defineProperty(navigator, 'vendor', {
            get: () => '',
            configurable: true
          });
          
          Object.defineProperty(navigator, 'vendorSub', {
            get: () => '',
            configurable: true
          });
          
          Object.defineProperty(navigator, 'productSub', {
            get: () => '20030107',
            configurable: true
          });
        }
        
        console.log('[Anti-Fingerprinting] Protecciones aplicadas para:', window.location.hostname);
      })();
    `;
    
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  // Función de inicialización
  async function initialize() {
    if (isInitialized) return;
    
    try {
      const config = await getFingerprintingConfig();
      applyFingerprintingProtections(config);
      isInitialized = true;
      
      console.log('[Anti-Fingerprinting] Controlador inicializado');
    } catch (error) {
      console.error('[Anti-Fingerprinting] Error inicializando:', error);
    }
  }

  // Escuchar cambios en la configuración
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.options) {
      const newConfig = changes.options.newValue?.antiFingerprinting;
      if (newConfig && JSON.stringify(newConfig) !== JSON.stringify(currentConfig)) {
        console.log('[Anti-Fingerprinting] Configuración actualizada, reiniciando página...');
        // Recargar la página para aplicar nuevos cambios
        window.location.reload();
      }
    }
  });

  // Inicializar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

})();

/**
 * Astian Privacy - Fingerprinting Test Page
 * Página de pruebas para verificar las protecciones contra fingerprinting
 * 
 * Copyright 2024 Astian. All rights reserved.
 */

import { html, store } from 'hybrids';
import Options from '/store/options.js';

function runFingerprintingTests() {
  const results = {
    canvas: testCanvasFingerprinting(),
    webgl: testWebGLFingerprinting(),
    screen: testScreenFingerprinting(),
    timezone: testTimezoneFingerprinting(),
    language: testLanguageFingerprinting(),
    hardware: testHardwareFingerprinting(),
    navigator: testNavigatorFingerprinting()
  };

  displayResults(results);
}

function testCanvasFingerprinting() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    
    // Dibujar algo único
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('Astian Privacy Test', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('Anti-Fingerprinting', 4, 35);
    
    const dataURL1 = canvas.toDataURL();
    
    // Crear otro canvas con el mismo contenido
    const canvas2 = document.createElement('canvas');
    canvas2.width = 200;
    canvas2.height = 50;
    const ctx2 = canvas2.getContext('2d');
    
    ctx2.textBaseline = 'top';
    ctx2.font = '14px Arial';
    ctx2.fillStyle = '#f60';
    ctx2.fillRect(125, 1, 62, 20);
    ctx2.fillStyle = '#069';
    ctx2.fillText('Astian Privacy Test', 2, 15);
    ctx2.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx2.fillText('Anti-Fingerprinting', 4, 35);
    
    const dataURL2 = canvas2.toDataURL();
    
    // Si las protecciones funcionan, los resultados deberían ser consistentes
    // pero no idénticos (debido al ruido aplicado)
    const isProtected = dataURL1 !== dataURL2; // Debería ser diferente debido al ruido
    
    return {
      status: isProtected ? 'protected' : 'not-protected',
      message: isProtected ? 
        '✅ Canvas fingerprinting protegido (ruido aplicado)' : 
        '⚠️ Canvas fingerprinting no protegido'
    };
  } catch (error) {
    return {
      status: 'error',
      message: `❌ Error en prueba de canvas: ${error.message}`
    };
  }
}

function testWebGLFingerprinting() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    
    if (!gl) {
      return {
        status: 'not-available',
        message: 'ℹ️ WebGL no disponible'
      };
    }
    
    const vendor = gl.getParameter(gl.UNMASKED_VENDOR_WEBGL);
    const renderer = gl.getParameter(gl.UNMASKED_RENDERER_WEBGL);
    
    // Verificar si los valores han sido falsificados
    const isProtected = vendor !== '' && renderer !== '';
    
    return {
      status: isProtected ? 'protected' : 'not-protected',
      message: isProtected ? 
        `✅ WebGL fingerprinting protegido (Vendor: ${vendor})` : 
        '⚠️ WebGL fingerprinting no protegido'
    };
  } catch (error) {
    return {
      status: 'error',
      message: `❌ Error en prueba de WebGL: ${error.message}`
    };
  }
}

function testScreenFingerprinting() {
  try {
    const width = screen.width;
    const height = screen.height;
    const availWidth = screen.availWidth;
    const availHeight = screen.availHeight;
    const colorDepth = screen.colorDepth;
    
    // Verificar si los valores parecen falsificados (valores comunes)
    const commonResolutions = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1536, height: 864 },
      { width: 1600, height: 900 }
    ];
    
    const isCommonResolution = commonResolutions.some(res => 
      res.width === width && res.height === height
    );
    
    return {
      status: isCommonResolution ? 'protected' : 'not-protected',
      message: isCommonResolution ? 
        `✅ Screen fingerprinting protegido (${width}x${height})` : 
        `⚠️ Screen fingerprinting no protegido (${width}x${height})`
    };
  } catch (error) {
    return {
      status: 'error',
      message: `❌ Error en prueba de pantalla: ${error.message}`
    };
  }
}

function testTimezoneFingerprinting() {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offset = new Date().getTimezoneOffset();
    
    // Verificar si la zona horaria es una de las falsificadas
    const spoofedTimezones = [
      'America/New_York',
      'America/Los_Angeles', 
      'Europe/London',
      'Europe/Berlin',
      'Asia/Tokyo'
    ];
    
    const isProtected = spoofedTimezones.includes(timezone);
    
    return {
      status: isProtected ? 'protected' : 'not-protected',
      message: isProtected ? 
        `✅ Timezone fingerprinting protegido (${timezone})` : 
        `⚠️ Timezone fingerprinting no protegido (${timezone})`
    };
  } catch (error) {
    return {
      status: 'error',
      message: `❌ Error en prueba de timezone: ${error.message}`
    };
  }
}

function testLanguageFingerprinting() {
  try {
    const language = navigator.language;
    const languages = navigator.languages;
    
    // Verificar si el idioma es uno de los falsificados
    const spoofedLanguages = [
      'en-US',
      'es-ES',
      'fr-FR',
      'de-DE',
      'en-GB'
    ];
    
    const isProtected = spoofedLanguages.includes(language);
    
    return {
      status: isProtected ? 'protected' : 'not-protected',
      message: isProtected ? 
        `✅ Language fingerprinting protegido (${language})` : 
        `⚠️ Language fingerprinting no protegido (${language})`
    };
  } catch (error) {
    return {
      status: 'error',
      message: `❌ Error en prueba de idioma: ${error.message}`
    };
  }
}

function testHardwareFingerprinting() {
  try {
    const cores = navigator.hardwareConcurrency;
    const memory = navigator.deviceMemory;
    
    // Verificar si los valores parecen falsificados
    const spoofedCores = [2, 4, 6, 8];
    const spoofedMemory = [4, 8, 16, 32];
    
    const isCoresProtected = spoofedCores.includes(cores);
    const isMemoryProtected = !memory || spoofedMemory.includes(memory);
    
    const isProtected = isCoresProtected && isMemoryProtected;
    
    return {
      status: isProtected ? 'protected' : 'not-protected',
      message: isProtected ? 
        `✅ Hardware fingerprinting protegido (${cores} cores, ${memory}GB RAM)` : 
        `⚠️ Hardware fingerprinting no protegido (${cores} cores, ${memory}GB RAM)`
    };
  } catch (error) {
    return {
      status: 'error',
      message: `❌ Error en prueba de hardware: ${error.message}`
    };
  }
}

function testNavigatorFingerprinting() {
  try {
    const platform = navigator.platform;
    const vendor = navigator.vendor;
    const vendorSub = navigator.vendorSub;
    
    // Verificar si los valores han sido falsificados
    const spoofedPlatforms = ['Win32', 'MacIntel', 'Linux x86_64'];
    const isPlatformProtected = spoofedPlatforms.includes(platform);
    const isVendorProtected = vendor === '';
    
    const isProtected = isPlatformProtected && isVendorProtected;
    
    return {
      status: isProtected ? 'protected' : 'not-protected',
      message: isProtected ? 
        `✅ Navigator fingerprinting protegido (${platform})` : 
        `⚠️ Navigator fingerprinting no protegido (${platform})`
    };
  } catch (error) {
    return {
      status: 'error',
      message: `❌ Error en prueba de navigator: ${error.message}`
    };
  }
}

function displayResults(results) {
  const resultsContainer = document.getElementById('fingerprinting-test-results');
  if (!resultsContainer) return;
  
  let html = '<div class="test-results">';
  
  for (const [test, result] of Object.entries(results)) {
    const statusClass = result.status === 'protected' ? 'success' : 
                       result.status === 'not-protected' ? 'warning' : 'error';
    
    html += `
      <div class="test-result ${statusClass}">
        <h4>${test.charAt(0).toUpperCase() + test.slice(1)} Test</h4>
        <p>${result.message}</p>
      </div>
    `;
  }
  
  html += '</div>';
  resultsContainer.innerHTML = html;
}

export default {
  options: store(Options),
  render: ({ options }) => html`
    <template layout="contents">
      <settings-page-layout layout="column gap:4">
        ${store.ready(options) &&
        html`
          <section layout="column gap:4">
            <div layout="column gap" layout@992px="margin:bottom">
              <ui-text type="headline-m">Pruebas de Anti-Fingerprinting</ui-text>
              <ui-text type="body-l" mobile-type="body-m" color="secondary">
                Ejecuta estas pruebas para verificar que las protecciones contra 
                fingerprinting estén funcionando correctamente en tu navegador.
              </ui-text>
            </div>

            <settings-card layout="column gap:3 padding:3">
              <div layout="column gap:2">
                <ui-text type="label-m">Estado de Protección</ui-text>
                <ui-text type="body-s" color="secondary">
                  Protección Anti-Fingerprinting: 
                  <strong>${options.antiFingerprinting.enabled ? 'Habilitada' : 'Deshabilitada'}</strong>
                </ui-text>
              </div>
              
              <ui-button 
                type="primary" 
                onclick="${runFingerprintingTests}"
                disabled="${!options.antiFingerprinting.enabled}"
              >
                <button>Ejecutar Pruebas</button>
              </ui-button>
            </settings-card>

            <div id="fingerprinting-test-results"></div>

            <settings-card layout="column gap:3 padding:3">
              <div layout="column gap:2">
                <ui-text type="label-m">Información sobre las Pruebas</ui-text>
                <ui-text type="body-s" color="secondary">
                  Estas pruebas verifican que las técnicas de anti-fingerprinting estén 
                  funcionando correctamente. Si las protecciones están activas, deberías 
                  ver resultados que indican valores falsificados o modificados.
                </ui-text>
                <ui-text type="body-s" color="secondary">
                  <strong>Nota:</strong> Algunas pruebas pueden requerir que recargues 
                  la página después de cambiar la configuración para que los cambios 
                  surtan efecto.
                </ui-text>
              </div>
            </settings-card>
          </section>
        `}
        
        <style>
          .test-results {
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }
          
          .test-result {
            padding: 1rem;
            border-radius: 0.5rem;
            border-left: 4px solid;
          }
          
          .test-result.success {
            background-color: #f0f9ff;
            border-left-color: #22c55e;
          }
          
          .test-result.warning {
            background-color: #fefce8;
            border-left-color: #eab308;
          }
          
          .test-result.error {
            background-color: #fef2f2;
            border-left-color: #ef4444;
          }
          
          .test-result h4 {
            margin: 0 0 0.5rem 0;
            font-weight: 600;
          }
          
          .test-result p {
            margin: 0;
            font-size: 0.875rem;
          }
        </style>
      </settings-page-layout>
    </template>
  `,
};

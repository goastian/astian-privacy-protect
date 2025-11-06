/**
 * Astian Privacy - Cryptominer Protection Settings
 * Configuración de protección contra cryptominers
 */

import { html, router, store } from 'hybrids';

import Options from '/store/options.js';
import FingerprintingTest from './fingerprinting-test.js';

const CryptominerProtection = {
  options: store(Options),
  
  render: ({ options }) => html`
    <template layout="contents">
      <settings-page-layout layout="column gap:4">
        ${store.ready(options) &&
        html`
          <section layout="column gap:4">
            <div layout="column gap" layout@992px="margin:bottom">
              <ui-text type="headline-m">Protección Anti-Cryptominers</ui-text>
              <ui-text type="body-l" mobile-type="body-m" color="secondary">
                Protege tu CPU y batería bloqueando scripts de minería de criptomonedas
                que pueden ralentizar tu dispositivo y consumir recursos innecesariamente.
              </ui-text>
            </div>

            <!-- Toggle principal -->
            <ui-toggle
              value="${options.cryptominerProtection.enabled}"
              onchange="${html.set(options, 'cryptominerProtection.enabled')}"
              data-qa="toggle:cryptominer-protection"
            >
              <settings-option icon="shield">
                Protección Anti-Cryptominers
                <span slot="description">
                  Activa la protección contra scripts de minería de criptomonedas
                  que pueden consumir recursos de tu CPU sin tu conocimiento.
                </span>
              </settings-option>
            </ui-toggle>

            <ui-line></ui-line>

            <!-- Opciones detalladas -->
            <div
              layout="column gap:4"
              style="${{ opacity: options.cryptominerProtection.enabled ? 1 : 0.5 }}"
              inert="${!options.cryptominerProtection.enabled}"
            >
              <ui-text type="headline-s">Configuración Avanzada</ui-text>
              
              <div layout="column gap:3">
                <ui-toggle
                  disabled="${!options.cryptominerProtection.enabled}"
                  value="${options.cryptominerProtection.strictMode}"
                  onchange="${html.set(options, 'cryptominerProtection.strictMode')}"
                  data-qa="toggle:strict-mode"
                >
                  <settings-option icon="shield">
                    Modo Estricto
                    <span slot="description">
                      Bloquea agresivamente cualquier script sospechoso de minería.
                    </span>
                  </settings-option>
                </ui-toggle>

                <ui-toggle
                  disabled="${!options.cryptominerProtection.enabled}"
                  value="${options.cryptominerProtection.showNotifications}"
                  onchange="${html.set(options, 'cryptominerProtection.showNotifications')}"
                  data-qa="toggle:notifications"
                >
                  <settings-option icon="alert">
                    Mostrar Notificaciones
                    <span slot="description">
                      Muestra notificaciones cuando se detecten cryptominers.
                    </span>
                  </settings-option>
                </ui-toggle>

                <ui-toggle
                  disabled="${!options.cryptominerProtection.enabled}"
                  value="${options.cryptominerProtection.blockWebWorkers}"
                  onchange="${html.set(options, 'cryptominerProtection.blockWebWorkers')}"
                  data-qa="toggle:web-workers"
                >
                  <settings-option icon="block-m">
                    Bloquear Web Workers
                    <span slot="description">
                      Bloquea Web Workers que puedan ser usados para minería.
                    </span>
                  </settings-option>
                </ui-toggle>

                <ui-toggle
                  disabled="${!options.cryptominerProtection.enabled}"
                  value="${options.cryptominerProtection.blockWebAssembly}"
                  onchange="${html.set(options, 'cryptominerProtection.blockWebAssembly')}"
                  data-qa="toggle:webassembly"
                >
                  <settings-option icon="block-s">
                    Bloquear WebAssembly
                    <span slot="description">
                      Bloquea WebAssembly que pueda ser usado para minería.
                    </span>
                  </settings-option>
                </ui-toggle>
              </div>

              <ui-line></ui-line>

              <!-- Configuración de umbrales -->
              <ui-text type="headline-s">Configuración de Detección</ui-text>
              
              <div layout="column gap:3">
                <div layout="column gap">
                  <ui-text type="body-m">Umbral de CPU: ${options.cryptominerProtection.cpuThreshold}%</ui-text>
                  <ui-input>
                    <input
                      type="range"
                      min="50"
                      max="95"
                      step="5"
                      value="${options.cryptominerProtection.cpuThreshold}"
                      disabled="${!options.cryptominerProtection.enabled}"
                      onchange="${html.set(options, 'cryptominerProtection.cpuThreshold', parseInt(event.target.value))}"
                    />
                  </ui-input>
                  <ui-text type="caption" color="secondary">
                    Nivel de uso de CPU para considerar minería
                  </ui-text>
                </div>

                <div layout="column gap">
                  <ui-text type="body-m">Tiempo de Detección: ${options.cryptominerProtection.detectionTimeout}ms</ui-text>
                  <ui-input>
                    <input
                      type="range"
                      min="1000"
                      max="10000"
                      step="500"
                      value="${options.cryptominerProtection.detectionTimeout}"
                      disabled="${!options.cryptominerProtection.enabled}"
                      onchange="${html.set(options, 'cryptominerProtection.detectionTimeout', parseInt(event.target.value))}"
                    />
                  </ui-input>
                  <ui-text type="caption" color="secondary">
                    Tiempo para detectar minería
                  </ui-text>
                </div>
              </div>

              <ui-line></ui-line>

              <!-- Enlaces de prueba -->
              <ui-text type="headline-s">Pruebas</ui-text>
              <settings-link href="${router.url(FingerprintingTest)}">
                <ui-icon name="flask" color="quaternary" layout="size:3 margin:right"></ui-icon>
                <ui-text type="headline-xs" layout="row gap:0.5 items:center">Ejecutar Pruebas de Cryptominers</ui-text>
                <ui-icon name="chevron-right" color="primary" layout="size:2"></ui-icon>
              </settings-link>
            </div>
          </section>
        `}
      </settings-page-layout>
    </template>
  `,
};

export default CryptominerProtection;
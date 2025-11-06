/**
 * Astian Privacy - Anti-Fingerprinting Settings
 * Configuración de protección contra fingerprinting
 * 
 * Copyright 2024 Astian. All rights reserved.
 */

import { html, router, store } from 'hybrids';
import Options from '/store/options.js';
import FingerprintingTest from './fingerprinting-test.js';
import assets from '../assets/index.js';

function toggleAntiFingerprinting({ options }) {
  store.set(options, {
    antiFingerprinting: {
      ...options.antiFingerprinting,
      enabled: !options.antiFingerprinting.enabled
    }
  });
}

function toggleFingerprintingOption({ options }, option) {
  store.set(options, {
    antiFingerprinting: {
      ...options.antiFingerprinting,
      [option]: !options.antiFingerprinting[option]
    }
  });
}

export default {
  [router.connect]: {
    stack: [FingerprintingTest],
  },
  options: store(Options),
  render: ({ options }) => html`
    <template layout="contents">
      <settings-page-layout layout="column gap:4">
        ${store.ready(options) &&
        html`
          <section layout="column gap:4">
            <div layout="column gap" layout@992px="margin:bottom">
              <ui-text type="headline-m">Protección Anti-Fingerprinting</ui-text>
              <ui-text type="body-l" mobile-type="body-m" color="secondary">
                La protección anti-fingerprinting previene que los sitios web 
                identifiquen tu dispositivo utilizando técnicas avanzadas como 
                canvas fingerprinting, WebGL, audio fingerprinting y más.
              </ui-text>
            </div>

            <!-- Toggle principal -->
            <ui-toggle
              value="${options.antiFingerprinting.enabled}"
              onchange="${toggleAntiFingerprinting}"
              data-qa="toggle:anti-fingerprinting"
            >
              <settings-option icon="shield">
                Protección Anti-Fingerprinting
                <span slot="description">
                  Activa la protección avanzada contra técnicas de fingerprinting 
                  que intentan identificar tu dispositivo de forma única.
                </span>
              </settings-option>
            </ui-toggle>

            <ui-line></ui-line>

            <!-- Opciones detalladas -->
            <div
              layout="column gap:4"
              style="${{ opacity: options.antiFingerprinting.enabled ? 1 : 0.5 }}"
              inert="${!options.antiFingerprinting.enabled}"
            >
              <ui-text type="headline-s">Técnicas de Protección</ui-text>
              
              <div layout="column gap:3">
                <ui-toggle
                  disabled="${!options.antiFingerprinting.enabled}"
                  value="${options.antiFingerprinting.canvas}"
                  onchange="${html.set(options, 'antiFingerprinting.canvas')}"
                  data-qa="toggle:canvas-protection"
                >
                  <settings-option icon="canvas">
                    Canvas Fingerprinting
                    <span slot="description">
                      Protege contra la identificación mediante el renderizado 
                      único de elementos canvas en diferentes dispositivos.
                    </span>
                  </settings-option>
                </ui-toggle>

                <ui-toggle
                  disabled="${!options.antiFingerprinting.enabled}"
                  value="${options.antiFingerprinting.webgl}"
                  onchange="${html.set(options, 'antiFingerprinting.webgl')}"
                  data-qa="toggle:webgl-protection"
                >
                  <settings-option icon="webgl">
                    WebGL Fingerprinting
                    <span slot="description">
                      Protege contra la identificación mediante las capacidades 
                      de renderizado 3D de tu tarjeta gráfica.
                    </span>
                  </settings-option>
                </ui-toggle>

                <ui-toggle
                  disabled="${!options.antiFingerprinting.enabled}"
                  value="${options.antiFingerprinting.audio}"
                  onchange="${html.set(options, 'antiFingerprinting.audio')}"
                  data-qa="toggle:audio-protection"
                >
                  <settings-option icon="audio">
                    Audio Fingerprinting
                    <span slot="description">
                      Protege contra la identificación mediante el procesamiento 
                      de audio y las características únicas de tu hardware de audio.
                    </span>
                  </settings-option>
                </ui-toggle>

                <ui-toggle
                  disabled="${!options.antiFingerprinting.enabled}"
                  value="${options.antiFingerprinting.fonts}"
                  onchange="${html.set(options, 'antiFingerprinting.fonts')}"
                  data-qa="toggle:font-protection"
                >
                  <settings-option icon="fonts">
                    Font Fingerprinting
                    <span slot="description">
                      Protege contra la identificación mediante la lista de 
                      fuentes instaladas en tu sistema.
                    </span>
                  </settings-option>
                </ui-toggle>

                <ui-toggle
                  disabled="${!options.antiFingerprinting.enabled}"
                  value="${options.antiFingerprinting.screen}"
                  onchange="${html.set(options, 'antiFingerprinting.screen')}"
                  data-qa="toggle:screen-protection"
                >
                  <settings-option icon="screen">
                    Screen Fingerprinting
                    <span slot="description">
                      Protege contra la identificación mediante la resolución 
                      y características de tu pantalla.
                    </span>
                  </settings-option>
                </ui-toggle>

                <ui-toggle
                  disabled="${!options.antiFingerprinting.enabled}"
                  value="${options.antiFingerprinting.timezone}"
                  onchange="${html.set(options, 'antiFingerprinting.timezone')}"
                  data-qa="toggle:timezone-protection"
                >
                  <settings-option icon="timezone">
                    Timezone Fingerprinting
                    <span slot="description">
                      Protege contra la identificación mediante tu zona horaria 
                      y configuración regional.
                    </span>
                  </settings-option>
                </ui-toggle>

                <ui-toggle
                  disabled="${!options.antiFingerprinting.enabled}"
                  value="${options.antiFingerprinting.language}"
                  onchange="${html.set(options, 'antiFingerprinting.language')}"
                  data-qa="toggle:language-protection"
                >
                  <settings-option icon="language">
                    Language Fingerprinting
                    <span slot="description">
                      Protege contra la identificación mediante tu configuración 
                      de idioma y preferencias regionales.
                    </span>
                  </settings-option>
                </ui-toggle>

                <ui-toggle
                  disabled="${!options.antiFingerprinting.enabled}"
                  value="${options.antiFingerprinting.hardware}"
                  onchange="${html.set(options, 'antiFingerprinting.hardware')}"
                  data-qa="toggle:hardware-protection"
                >
                  <settings-option icon="hardware">
                    Hardware Fingerprinting
                    <span slot="description">
                      Protege contra la identificación mediante las 
                      características de tu hardware (CPU, memoria RAM).
                    </span>
                  </settings-option>
                </ui-toggle>

                <ui-toggle
                  disabled="${!options.antiFingerprinting.enabled}"
                  value="${options.antiFingerprinting.navigator}"
                  onchange="${html.set(options, 'antiFingerprinting.navigator')}"
                  data-qa="toggle:navigator-protection"
                >
                  <settings-option icon="navigator">
                    Navigator Fingerprinting
                    <span slot="description">
                      Protege contra la identificación mediante propiedades 
                      del objeto navigator (plataforma, vendor).
                    </span>
                  </settings-option>
                </ui-toggle>

                <ui-toggle
                  disabled="${!options.antiFingerprinting.enabled}"
                  value="${options.antiFingerprinting.performance}"
                  onchange="${html.set(options, 'antiFingerprinting.performance')}"
                  data-qa="toggle:performance-protection"
                >
                  <settings-option icon="performance">
                    Performance Fingerprinting
                    <span slot="description">
                      Protege contra la identificación mediante timing attacks 
                      y mediciones de rendimiento.
                    </span>
                  </settings-option>
                </ui-toggle>

                <ui-toggle
                  disabled="${!options.antiFingerprinting.enabled}"
                  value="${options.antiFingerprinting.webrtc}"
                  onchange="${html.set(options, 'antiFingerprinting.webrtc')}"
                  data-qa="toggle:webrtc-protection"
                >
                  <settings-option icon="webrtc">
                    WebRTC Fingerprinting
                    <span slot="description">
                      Protege contra la identificación mediante WebRTC y 
                      detección de direcciones IP locales.
                    </span>
                  </settings-option>
                </ui-toggle>
              </div>
            </div>

            <!-- Enlace a pruebas -->
            <div layout="grid:1|max content:center gap">
              <settings-link href="${router.url(FingerprintingTest)}">
                <ui-icon
                  name="flask"
                  color="quaternary"
                  layout="size:3 margin:right"
                ></ui-icon>
                <ui-text
                  type="headline-xs"
                  layout="row gap:0.5 items:center"
                >
                  Pruebas de Anti-Fingerprinting
                </ui-text>
                <ui-icon
                  name="chevron-right"
                  color="primary"
                  layout="size:2"
                ></ui-icon>
              </settings-link>
            </div>

            <!-- Información adicional -->
            <settings-card layout="column gap:3 padding:3">
              <div layout="row gap:2 items:start">
                <ui-icon name="info" color="primary" layout="size:4 margin:top:0.5"></ui-icon>
                <div layout="column gap:2">
                  <ui-text type="label-m">¿Qué es el Fingerprinting?</ui-text>
                  <ui-text type="body-s" color="secondary">
                    El fingerprinting del navegador es una técnica utilizada por 
                    los sitios web para identificar y rastrear usuarios de forma 
                    única, incluso cuando se eliminan las cookies. Utiliza 
                    características específicas del dispositivo como resolución 
                    de pantalla, fuentes instaladas, capacidades de hardware y 
                    otras propiedades para crear una "huella digital" única.
                  </ui-text>
                  <ui-text type="body-s" color="secondary">
                    Nuestra protección anti-fingerprinting utiliza técnicas 
                    avanzadas de ofuscación y falsificación para mantener tu 
                    privacidad sin afectar la funcionalidad de los sitios web.
                  </ui-text>
                </div>
              </div>
            </settings-card>
          </section>
        `}
      </settings-page-layout>
    </template>
  `,
};

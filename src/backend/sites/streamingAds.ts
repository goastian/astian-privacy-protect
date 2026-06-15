const STREAMING_AD_SELECTORS = [
  '.ima-ad-container',
  '.ima-ad-container iframe',
  '.ima-controls-div',
  '.ima-countdown-div',
  '.video-ads',
  '.video-ad',
  '.vast-ad',
  '.vpaid-ad',
  '.ad-overlay',
  '.ads-overlay',
  '.player-ad-overlay',
  '.player-ads',
  '.ad-countdown',
  '.ad-container:not(video):not(canvas)',
  '[data-ad-container]',
  '[data-testid*="ad" i]',
  '[id^="google_ads_iframe_"]',
  '[id*="companion-ad" i]',
  '[class*="companion-ad" i]',
  '[class*="ad-break" i]',
  '[class*="adCountdown" i]',
  '[class*="ad-countdown" i]',
  '[class*="preroll" i]',
  '[class*="midroll" i]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="imasdk.googleapis.com"]',
]

const STREAMING_HOST_SELECTORS: Record<string, string[]> = {
  'amazon.com': ['[class*="ad-container" i]', '[class*="adCountdown" i]'],
  'twitch.tv': [
    '[data-a-target="video-ad-countdown"]',
    '[data-a-target="player-ad-banner"]',
    '.stream-display-ad__container',
    '.video-player__overlay[data-a-target*="ad"]',
  ],
  'netflix.com': ['[class*="adContainer" i]', '[class*="adCountdown" i]'],
  'hulu.com': ['[class*="adContainer" i]', '[class*="adCountdown" i]'],
  'disneyplus.com': ['[class*="adContainer" i]', '[class*="adCountdown" i]'],
  'primevideo.com': ['[class*="adContainer" i]', '[class*="adCountdown" i]'],
  'max.com': ['[class*="adContainer" i]', '[class*="adCountdown" i]'],
  'hbomax.com': ['[class*="adContainer" i]', '[class*="adCountdown" i]'],
  'pluto.tv': ['[class*="adContainer" i]', '[class*="adBreak" i]'],
  'tubi.tv': ['[class*="adContainer" i]', '[class*="adCountdown" i]'],
  'crackle.com': ['[class*="adContainer" i]', '[class*="adBreak" i]'],
  'peacocktv.com': ['[class*="adContainer" i]', '[class*="adCountdown" i]'],
  'paramountplus.com': ['[class*="adContainer" i]', '[class*="adCountdown" i]'],
  'crunchyroll.com': ['[class*="adContainer" i]', '[class*="adCountdown" i]'],
}

const HIDDEN_ATTRIBUTE = 'data-midori-streaming-ad-hidden'

export function getStreamingAdStyles(hostname = window.location.hostname) {
  const selectors = getStreamingSelectors(hostname)
  if (!selectors.length) return ''

  return `
${selectors.join(',\n')} {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
  min-height: 0 !important;
  height: 0 !important;
}
`.trim()
}

export function hideStreamingAdContainers(
  root: ParentNode = document,
  hostname = window.location.hostname
) {
  let hiddenCount = 0

  const hideElement = (element: HTMLElement) => {
    if (element.matches('video, canvas')) return
    if (element.getAttribute(HIDDEN_ATTRIBUTE) === 'true') return

    element.setAttribute(HIDDEN_ATTRIBUTE, 'true')
    element.style.setProperty('display', 'none', 'important')
    element.style.setProperty('visibility', 'hidden', 'important')
    element.style.setProperty('pointer-events', 'none', 'important')
    hiddenCount++
  }

  getStreamingSelectors(hostname).forEach((selector) => {
    try {
      if (root instanceof HTMLElement && root.matches(selector)) {
        hideElement(root)
      }

      root.querySelectorAll<HTMLElement>(selector).forEach(hideElement)
    } catch {
      // Ignore selectors unsupported by the current browser engine.
    }
  })

  return hiddenCount
}

const getStreamingSelectors = (hostname: string) => {
  const matchedSelectors = Object.entries(STREAMING_HOST_SELECTORS)
    .filter(
      ([domain]) => hostname === domain || hostname.endsWith(`.${domain}`)
    )
    .flatMap(([, selectors]) => selectors)

  if (!matchedSelectors.length) return []

  return [...STREAMING_AD_SELECTORS, ...matchedSelectors]
}

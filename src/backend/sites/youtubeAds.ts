const YOUTUBE_AD_CONTAINER_SELECTORS = [
  'ytd-ad-slot-renderer',
  'ytd-display-ad-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-promoted-video-renderer',
  'ytd-search-pyv-renderer',
  'ytd-in-feed-ad-layout-renderer',
  'ytd-action-companion-ad-renderer',
  'ytd-companion-slot-renderer',
  'ytm-promoted-sparkles-web-renderer',
  '#player-ads',
  '#masthead-ad',
]

const YOUTUBE_AD_CARD_SELECTORS = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-reel-item-renderer',
  'ytm-rich-item-renderer',
  'ytm-video-with-context-renderer',
]

const SPONSORED_LABELS = new Set([
  'ad',
  'ads',
  'anuncio',
  'anuncios',
  'annonce',
  'anzeige',
  'gesponsert',
  'patrocinado',
  'publicidad',
  'sponsored',
])

const HIDDEN_ATTRIBUTE = 'data-midori-ad-hidden'

export function getYoutubeAdStyles(): string {
  return `
${YOUTUBE_AD_CONTAINER_SELECTORS.join(',\n')} {
  display: none !important;
  visibility: hidden !important;
  min-height: 0 !important;
  height: 0 !important;
}
ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
ytd-rich-item-renderer:has(ytd-display-ad-renderer),
ytd-rich-item-renderer:has(ytd-promoted-sparkles-web-renderer),
ytd-video-renderer:has(ytd-ad-slot-renderer),
ytd-video-renderer:has(ytd-display-ad-renderer),
ytd-compact-video-renderer:has(ytd-ad-slot-renderer),
ytm-rich-item-renderer:has(ytm-promoted-sparkles-web-renderer) {
  display: none !important;
  visibility: hidden !important;
  min-height: 0 !important;
  height: 0 !important;
}
`.trim()
}

export function isSponsoredLabel(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[:\s]+$/g, '')
  return SPONSORED_LABELS.has(normalized)
}

export function findYoutubeAdContainers(root: ParentNode): HTMLElement[] {
  const matches = new Set<HTMLElement>()

  YOUTUBE_AD_CONTAINER_SELECTORS.forEach((selector) => {
    root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      matches.add(findCardContainer(element) || element)
    })
  })

  root
    .querySelectorAll<HTMLElement>(
      'ytd-badge-supported-renderer, ytd-ad-badge-renderer, .badge-shape-wiz__text, .ytd-badge-supported-renderer'
    )
    .forEach((element) => {
      if (!isSponsoredLabel(element.textContent || '')) return

      const card = findCardContainer(element)
      if (card) matches.add(card)
    })

  return Array.from(matches)
}

export function hideYoutubeAdContainers(root: ParentNode): number {
  let hiddenCount = 0

  findYoutubeAdContainers(root).forEach((element) => {
    if (element.getAttribute(HIDDEN_ATTRIBUTE) === 'true') return

    element.setAttribute(HIDDEN_ATTRIBUTE, 'true')
    element.style.setProperty('display', 'none', 'important')
    element.style.setProperty('visibility', 'hidden', 'important')
    element.style.setProperty('min-height', '0', 'important')
    element.style.setProperty('height', '0', 'important')
    hiddenCount++
  })

  return hiddenCount
}

function findCardContainer(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>(YOUTUBE_AD_CARD_SELECTORS.join(','))
}

import { getYoutubeAdStyles, isSponsoredLabel } from './youtubeAds'

describe('YouTube ad helpers', () => {
  it('recognizes sponsored labels used in YouTube ad badges', () => {
    expect(isSponsoredLabel('Sponsored')).toBe(true)
    expect(isSponsoredLabel('Patrocinado')).toBe(true)
    expect(isSponsoredLabel('Publicidad')).toBe(true)
    expect(isSponsoredLabel('Operating systems')).toBe(false)
  })

  it('ships CSS guards for YouTube ad renderers and containing cards', () => {
    const styles = getYoutubeAdStyles()

    expect(styles).toContain('ytd-ad-slot-renderer')
    expect(styles).toContain('ytd-rich-item-renderer:has(ytd-ad-slot-renderer)')
    expect(styles).toContain('ytd-display-ad-renderer')
    expect(styles).toContain('#player-ads')
  })
})

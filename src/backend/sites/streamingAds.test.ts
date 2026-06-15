/**
 * @jest-environment jsdom
 */

import { getStreamingAdStyles, hideStreamingAdContainers } from './streamingAds'

describe('streaming ad helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('ships generic streaming player ad selectors', () => {
    const styles = getStreamingAdStyles('www.tubi.tv')

    expect(styles).toContain('.ima-ad-container')
    expect(styles).toContain('iframe[src*="doubleclick.net"]')
  })

  it('adds platform selectors for known streaming hosts', () => {
    const styles = getStreamingAdStyles('www.twitch.tv')

    expect(styles).toContain('[data-a-target="video-ad-countdown"]')
  })

  it('hides ad containers without touching video elements', () => {
    document.body.innerHTML = `
      <div class="ima-ad-container"></div>
      <video class="video-ad"></video>
    `

    expect(hideStreamingAdContainers(document, 'www.tubi.tv')).toBe(1)
    expect(
      (document.querySelector('.ima-ad-container') as HTMLElement).style.display
    ).toBe('none')
    expect((document.querySelector('video') as HTMLElement).style.display).toBe(
      ''
    )
  })

  it('hides matching added root elements for observer reporting', () => {
    const banner = document.createElement('div')
    banner.setAttribute('data-a-target', 'player-ad-banner')

    expect(hideStreamingAdContainers(banner, 'www.twitch.tv')).toBe(1)
    expect(banner.getAttribute('data-midori-streaming-ad-hidden')).toBe('true')
    expect(banner.style.display).toBe('none')
  })

  it('does not apply the streaming layer to unrelated hosts', () => {
    document.body.innerHTML = '<div class="ima-ad-container"></div>'

    expect(getStreamingAdStyles('example.com')).toBe('')
    expect(hideStreamingAdContainers(document, 'example.com')).toBe(0)
  })
})

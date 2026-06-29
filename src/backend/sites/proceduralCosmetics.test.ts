/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://example.com/watch?episode=1"}
 */

import {
  applyProceduralFilters,
  parseProceduralFilter,
} from './proceduralCosmetics'

describe('procedural cosmetics', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('supports has-text filters and reports affected nodes once', () => {
    document.body.innerHTML = `
      <section class="card">Advertisement</section>
      <section class="card">Episode details</section>
    `

    const filter = parseProceduralFilter(
      JSON.stringify({
        selector: [
          { type: 'CssSelector', arg: '.card' },
          { type: 'HasText', arg: 'Advertisement' },
        ],
      })
    )

    expect(filter).toBeDefined()
    expect(applyProceduralFilters([filter!])).toBe(1)
    expect(document.querySelectorAll('.card')).toHaveLength(1)
  })

  it('supports matches-css filters with safe inline style actions', () => {
    document.body.innerHTML = `
      <div class="slot" style="position: fixed">Ad</div>
      <div class="slot" style="position: static">Content</div>
    `

    const filter = parseProceduralFilter(
      JSON.stringify({
        selector: [
          { type: 'css-selector', arg: '.slot' },
          { type: 'matches-css', arg: 'position: fixed' },
        ],
      })
    )

    expect(applyProceduralFilters([filter!])).toBe(1)
    expect(document.querySelectorAll('.slot')).toHaveLength(1)
  })

  it('supports tagged actions emitted by adblock-rust', () => {
    document.body.innerHTML = `
      <div id="remove-id">Ad</div>
      <div id="inline-css-id">Sponsored</div>
    `

    const removeFilter = parseProceduralFilter(
      JSON.stringify({
        selector: [{ type: 'css-selector', arg: '#remove-id' }],
        action: { type: 'remove' },
      })
    )
    const styleFilter = parseProceduralFilter(
      JSON.stringify({
        selector: [{ type: 'css-selector', arg: '#inline-css-id' }],
        action: { type: 'style', arg: 'display: none;' },
      })
    )

    expect(applyProceduralFilters([removeFilter!, styleFilter!])).toBe(2)
    expect(document.querySelector('#remove-id')).toBeNull()
    expect(
      (document.querySelector('#inline-css-id') as HTMLElement).style.display
    ).toBe('none')
  })

  it('supports xpath followed by upward', () => {
    document.body.innerHTML = `
      <article class="row"><span>Sponsored</span></article>
      <article class="row"><span>Movie</span></article>
    `

    const filter = parseProceduralFilter(
      JSON.stringify({
        selector: [
          { type: 'xpath', arg: './/span[contains(., "Sponsored")]' },
          { type: 'upward', arg: 'article' },
        ],
      })
    )

    expect(applyProceduralFilters([filter!])).toBe(1)
    expect(document.querySelectorAll('article')).toHaveLength(1)
  })

  it('rejects unsafe style actions', () => {
    document.body.innerHTML = '<div class="ad">Ad</div>'

    const filter = parseProceduralFilter(
      JSON.stringify({
        selector: [{ type: 'css-selector', arg: '.ad' }],
        action: {
          type: 'style',
          arg: 'background: url(https://tracker.example/pixel)',
        },
      })
    )

    expect(applyProceduralFilters([filter!])).toBe(0)
    expect(document.querySelector('.ad')).not.toBeNull()
  })

  it('supports matches-path filters', () => {
    document.body.innerHTML = '<div class="overlay">Ad</div>'

    const filter = parseProceduralFilter(
      JSON.stringify({
        selector: [
          { type: 'css-selector', arg: '.overlay' },
          { type: 'matches-path', arg: '/watch' },
        ],
      })
    )

    expect(applyProceduralFilters([filter!])).toBe(1)
    expect(document.querySelector('.overlay')).toBeNull()
  })
})

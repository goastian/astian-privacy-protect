import { getAppContrast, rgbaToHex } from './contrast'

describe('RGB(A) to Hex', () => {
  // Make sure that non-rgb(a) types are passed through
  test('Ignore non-rgb: color', () => expect(rgbaToHex('white')).toBe('white'))
  test('Ignore non-rgb: hex', () =>
    expect(rgbaToHex('#000000')).toBe('#000000'))

  // Test conversions
  test('Convert rgb: black', () =>
    expect(rgbaToHex('rgb(0, 0, 0)')).toBe('#000000'))
  test('Convert rgb: green', () =>
    expect(rgbaToHex('rgb(83, 198, 33)')).toBe('#53c621'))

  // Test alpha striping
  test('Strip alpha: black', () =>
    expect(rgbaToHex('rgba(0, 0, 0, 34)')).toBe('#000000'))
  test('Strip alpha: green', () =>
    expect(rgbaToHex('rgba(83, 198, 33, 45)')).toBe('#53c621'))
})

describe('Contrasting color', () => {
  const colorPairs = [
    ['white', '#000000'],
    ['black', '#FFFFFF'],
    ['#256ef5', '#FFFFFF'],
    ['#00ffb7', '#000000'],
  ]

  colorPairs.forEach((pair) => {
    test(`Enabled ${pair[0]}`, () =>
      expect(getAppContrast(false, pair[0])).toBe(pair[1]))
    test(`Disabled ${pair[0]}`, () =>
      expect(getAppContrast(true, pair[0])).toBe('#000000'))
  })
})

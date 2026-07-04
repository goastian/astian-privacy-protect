export const rgbaToHex = (rgba: string): string => {
  if (rgba.includes('rgb')) {
    const clean = rgba.replace('rgb(', '').replace('rgba(', '').replace(')', '')
    const [red, green, blue] = clean.split(',').map((x) => parseInt(x, 10))

    return `#${[red, green, blue]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')}`.toLowerCase()
  }

  return rgba
}

const hexToRgb = (color: string) => {
  const normalized = rgbaToHex(color).toLowerCase()
  if (normalized === 'white') return [255, 255, 255]
  if (normalized === 'black') return [0, 0, 0]
  if (!/^#[0-9a-f]{6}$/.test(normalized)) return [255, 255, 255]

  return [1, 3, 5].map((index) =>
    parseInt(normalized.slice(index, index + 2), 16)
  )
}

export const getContrast = (bg: string) => {
  const [red, green, blue] = hexToRgb(bg)
  const yiq = (red * 299 + green * 587 + blue * 114) / 1000

  return yiq >= 128 ? '#000000' : '#FFFFFF'
}

const getAccentDisabledColor = () => {
  if (
    typeof getComputedStyle === 'undefined' ||
    typeof document === 'undefined'
  ) {
    return '#fbfbfb'
  }

  return (
    getComputedStyle(document.documentElement).getPropertyValue(
      '--background-color-secondary'
    ) || '#fbfbfb'
  )
}

export const getAppContrast = (whitelisted: boolean, stateColor: string) =>
  getContrast(whitelisted ? getAccentDisabledColor() : stateColor)

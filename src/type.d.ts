declare module '*.rs'
declare module '*.css'
declare module '*.module.css'
declare module '*.svg'
declare module 'contrast-color' {
  type ContrastColorOptions = {
    bgColor?: string
    fgDarkColor?: string
    fgLightColor?: string
    defaultColor?: string
    threshold?: number
  }

  class ContrastColor {
    constructor(options?: ContrastColorOptions)
    contrastColor(options?: ContrastColorOptions): string
  }

  export = ContrastColor
}

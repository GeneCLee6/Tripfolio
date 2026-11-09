// The only source of colors (CLAUDE.md rule 6), seeded from docs/DESIGN.md §2. A2 (e10-t01) adds
// fonts, the theme switch and the rest of the scale.

export const palette = {
  light: {
    paper: '#EDEFEA',
    card: '#F8F9F6',
    ink: '#17262B',
    muted: '#5F6E72',
    line: '#D5DCD6',
    fjord: '#0F6E74',
    fjordInk: '#0A4F54',
    glacier: '#CDE7EA',
    tussock: '#B88A1E',
    tussockSoft: '#F1E7C8',
    success: '#3C8C5A',
    warning: '#C9892B',
    danger: '#B9483A',
  },
  dark: {
    paper: '#121A1D',
    card: '#1A2427',
    ink: '#E6ECE8',
    muted: '#97A6A9',
    line: '#2A373B',
    fjord: '#5FB6BC',
    fjordInk: '#9ADCE0',
    glacier: '#173B40',
    tussock: '#D9AE4A',
    tussockSoft: '#3A3217',
    success: '#6BC08A',
    warning: '#E0A552',
    danger: '#E07A6C',
  },
} as const

export type ColorName = keyof typeof palette.light

/** Colors for components: CSS variables that follow the light/dark scheme (see GlobalStyle) */
export const color = Object.fromEntries(
  Object.keys(palette.light).map((name) => [name, `var(--color-${name})`]),
) as Record<ColorName, string>

/** The CSS custom properties for one scheme, written into :root by GlobalStyle */
export const colorVariables = (scheme: keyof typeof palette): string =>
  Object.entries(palette[scheme])
    .map(([name, value]) => `--color-${name}: ${value};`)
    .join('\n')

/** One color per day of a trip, in order (DESIGN.md §2) */
export const dayColors = [
  '#0F6E74',
  '#B5654A',
  '#5B7B4A',
  '#4C6A92',
  '#8B5E83',
  '#3F8F8A',
  '#A64B4B',
  '#C99A3B',
  '#6E8B3D',
  '#7A6A5A',
] as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, huge: 64 } as const
export const radius = { control: 10, card: 14, cover: 22 } as const
export const fontSize = { sm: 13, body: 15, md: 17, lg: 20, xl: 26, xxl: 34 } as const

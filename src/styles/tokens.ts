// The only source of colors, spacing, radii and type (CLAUDE.md rule 6, docs/DESIGN.md §2). Components
// use `color.*` (CSS variables that follow the light/dark theme, written by GlobalStyle), never hex.

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
    /** Text on a fjord or danger fill */
    onFjord: '#FFFFFF',
    /** Behind a dialog or sheet */
    scrim: 'rgba(23, 38, 43, 0.45)',
    /** The one hover shadow cards get (DESIGN.md §2) */
    shadow: 'rgba(23, 38, 43, 0.12)',
    /** Skeleton shimmer highlight */
    shimmer: 'rgba(255, 255, 255, 0.55)',
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
    onFjord: '#0B1F22',
    scrim: 'rgba(0, 0, 0, 0.6)',
    shadow: 'rgba(0, 0, 0, 0.4)',
    shimmer: 'rgba(255, 255, 255, 0.06)',
  },
} as const

export type ColorName = keyof typeof palette.light
export type Scheme = keyof typeof palette

const cssName = (name: string): string =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/** Colors for components: CSS variables that follow the light/dark theme (see GlobalStyle) */
export const color = Object.fromEntries(
  Object.keys(palette.light).map((name) => [name, `var(--color-${cssName(name)})`]),
) as Record<ColorName, string>

/** The CSS custom properties for one scheme, written by GlobalStyle */
export const colorVariables = (scheme: Scheme): string =>
  Object.entries(palette[scheme])
    .map(([name, value]) => `--color-${cssName(name)}: ${value};`)
    .join('\n')

/** One color per day of a trip, in order; the same in both themes (DESIGN.md §2) */
export const dayColors = [
  '#0F6E74', // fjord
  '#B5654A', // ochre
  '#5B7B4A', // moss
  '#4C6A92', // indigo
  '#8B5E83', // mauve
  '#3F8F8A', // lake
  '#A64B4B', // brick
  '#C99A3B', // mustard
  '#6E8B3D', // olive
  '#7A6A5A', // rock
] as const

/** The color of day `index` (0-based), cycling after ten; also used for member avatars */
export const dayColor = (index: number): string =>
  dayColors[((index % dayColors.length) + dayColors.length) % dayColors.length]

/** Text on a day color (all ten take white, in both themes) */
export const onDayColor = '#FFFFFF'

/** Multiples of 4 (DESIGN.md §2) */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, huge: 64 } as const
/** control 10 (inputs, buttons), card 14, cover 22 (covers, bottom sheets), pill for chips */
export const radius = { control: 10, card: 14, cover: 22, pill: 999 } as const
export const fontSize = { sm: 13, body: 15, md: 17, lg: 20, xl: 26, xxl: 34 } as const
export const lineHeight = { body: 1.55, heading: 1.15 } as const
export const fontWeight = { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 } as const

/** Font stacks with real fallbacks; the faces are loaded by src/styles/fonts.ts */
export const font = {
  display:
    "'Bricolage Grotesque', 'Noto Sans TC', system-ui, -apple-system, 'Segoe UI', 'PingFang TC', 'Microsoft JhengHei', sans-serif",
  body: "'IBM Plex Sans', 'Noto Sans TC', system-ui, -apple-system, 'Segoe UI', 'PingFang TC', 'Microsoft JhengHei', sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
} as const

/** Layout breakpoints in px (DESIGN.md §4): below `tablet` is mobile, from `desktop` three columns */
export const breakpoint = { tablet: 768, desktop: 1200 } as const
export const media = {
  mobile: `(max-width: ${breakpoint.tablet - 1}px)`,
  tablet: `(min-width: ${breakpoint.tablet}px)`,
  desktop: `(min-width: ${breakpoint.desktop}px)`,
  coarse: '(pointer: coarse)',
  motion: '(prefers-reduced-motion: no-preference)',
} as const

/** Minimum touch target on coarse pointers (DESIGN.md §6) */
export const touchTarget = 44
export const duration = { fast: 120, base: 200, slow: 320 } as const
export const zIndex = { sticky: 10, overlay: 100, toast: 200 } as const

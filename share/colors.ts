import { dayColor, palette } from '../src/styles/tokens.ts'

// Trip and day colours are user data (a CSS colour the editor stored), not styling constants: they
// are checked with CSS.supports and set as a custom property through the style attribute, so a
// stored value can never inject CSS. Without one, the tokens decide.

const isCssColor = (value: string | null | undefined): value is string =>
  !!value && typeof CSS !== 'undefined' && CSS.supports('color', value)

/** The day's colour: the stored one, else the token colour for its 1-based index */
export const colorOfDay = (index: number, stored: string | null): string =>
  isCssColor(stored) ? stored : dayColor(index - 1)

/** The cover's base colour: the trip's cover colour, else deep fjord */
export const colorOfCover = (stored: string | null): string =>
  isCssColor(stored) ? stored : palette.light.fjordInk

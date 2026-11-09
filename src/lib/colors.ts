import { dayColor, dayColors } from '../styles/tokens.ts'

// Trips and members store a colour as one of the ten day colours (hex, shared/schema colorValue).
// What comes back from the API is user data, so it only reaches CSS when it is one of ours.

/** The token names of the day colours, in palette order (i18n keys `color.<name>`) */
export const DAY_COLOR_NAMES = [
  'fjord',
  'ochre',
  'moss',
  'indigo',
  'mauve',
  'lake',
  'brick',
  'mustard',
  'olive',
  'rock',
] as const

/** Index of `value` in the day palette, or -1 */
export function colorIndexOf(value: string | null | undefined): number {
  if (!value) return -1
  const upper = value.trim().toUpperCase()
  return dayColors.findIndex((hex) => hex === upper)
}

/** A stable palette slot for any string (a member id) when its stored colour is not ours */
export function hashIndex(seed: string): number {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return Math.abs(hash) % dayColors.length
}

/** The palette slot to draw `value` with; unknown values fall back to a slot derived from `seed` */
export function paletteIndex(value: string | null | undefined, seed: string): number {
  const index = colorIndexOf(value)
  return index >= 0 ? index : hashIndex(seed)
}

/** A day colour safe to put in CSS */
export const safeColor = (value: string | null | undefined, seed: string): string =>
  dayColor(paletteIndex(value, seed))

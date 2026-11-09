import type { LegMode } from '../shared/itinerary/types.ts'
import type { StopType } from '../shared/schema/stop.ts'

// Pictograms for stop types and leg modes. Decorative (aria-hidden): the text next to them, or a
// visually hidden label, carries the meaning.

export const stopGlyph: Record<StopType, string> = {
  sight: '🏞',
  food: '🍽',
  shopping: '🛍',
  lodging: '🏕',
  transport: '🚏',
  fuel: '⛽',
  supplies: '🛒',
  rest: '☕',
  other: '📍',
}

export const modeGlyph: Record<LegMode, string> = {
  drive: '🚗',
  campervan: '🚐',
  walk: '🚶',
  cycle: '🚲',
  transit: '🚆',
  flight: '✈',
  ferry: '⛴',
  other: '➜',
}

import { dayColor, onDayColor, palette } from '../styles/tokens.ts'
import type { MapLayerKey, MapScheme } from './types.ts'

// Pin images, generated in code (docs/ARCHITECTURE.md §4.5): an itinerary pin is a circle in the
// day colour with the stop's order; other layers get a circle in their layer colour with a line
// glyph (Lucide-style 24-grid paths drawn by hand, docs/ASSETS.md). Each image has an id that
// encodes everything needed to draw it, so the map can create exactly the images its data uses.

/** Images are drawn at this many device pixels per CSS pixel */
export const PIN_PIXEL_RATIO = 2
/** Diameter in CSS px */
export const PIN_SIZE = 30
export const GLYPH_PIN_SIZE = 26

export type GlyphKind = Exclude<MapLayerKey, 'itinerary'>

/** Hand-drawn 24-grid line glyphs (2 px stroke, round caps) */
export const GLYPHS: Record<GlyphKind, string> = {
  // Bookmark
  pocket: 'M18 21l-6-4-6 4V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z',
  // Bed
  lodging: 'M3 19v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8M3 15h18M7 9V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2',
  // Star
  picks: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  // Fuel pump
  fuel: 'M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M3 21h13M4 11h11M15 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-3-3',
}

/** The fill of each glyph layer, per scheme (tokens only) */
export const glyphFill = (kind: GlyphKind, scheme: MapScheme): string => {
  const p = palette[scheme]
  return { pocket: p.muted, lodging: p.fjord, picks: p.tussock, fuel: p.warning }[kind]
}

export const itineraryPinId = (scheme: MapScheme, dayIndex: number, order: number): string =>
  `tf-pin:${scheme}:${dayIndex}:${order}`

export const glyphPinId = (scheme: MapScheme, kind: GlyphKind): string => `tf-glyph:${scheme}:${kind}`

export interface PinImage {
  svg: string
  /** Device pixels (CSS size × PIN_PIXEL_RATIO) */
  width: number
  height: number
}

const escapeXml = (text: string) =>
  text.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`)

/** Circle with a ring in the card colour, so pins read on any basemap */
function circleSvg(size: number, fill: string, ring: string, inner: string): PinImage {
  const px = size * PIN_PIXEL_RATIO
  const r = size / 2
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${r}" cy="${r}" r="${r - 1.5}" fill="${fill}" stroke="${ring}" stroke-width="3"/>` +
    inner +
    `</svg>`
  return { svg, width: px, height: px }
}

export function itineraryPin(scheme: MapScheme, dayIndex: number, order: number): PinImage {
  const label = String(order)
  const fontSize = label.length >= 3 ? 9 : label.length === 2 ? 11.5 : 13
  const r = PIN_SIZE / 2
  const text =
    `<text x="${r}" y="${r}" dy="0.36em" text-anchor="middle" font-family="IBM Plex Mono, ui-monospace, Menlo, Consolas, monospace" ` +
    `font-size="${fontSize}" font-weight="600" fill="${onDayColor}">${escapeXml(label)}</text>`
  return circleSvg(PIN_SIZE, dayColor(dayIndex), palette[scheme].card, text)
}

export function glyphPin(scheme: MapScheme, kind: GlyphKind): PinImage {
  const glyph = 14
  const offset = (GLYPH_PIN_SIZE - glyph) / 2
  const inner =
    `<g transform="translate(${offset} ${offset}) scale(${glyph / 24})" fill="none" stroke="${palette[scheme].card}" ` +
    `stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${GLYPHS[kind]}"/></g>`
  return circleSvg(GLYPH_PIN_SIZE, glyphFill(kind, scheme), palette[scheme].card, inner)
}

const isScheme = (value: string): value is MapScheme => value === 'light' || value === 'dark'
const isGlyph = (value: string): value is GlyphKind => value in GLYPHS

/** Draws the image an id names, or null for ids that are not ours */
export function pinImageFromId(id: string): PinImage | null {
  const [prefix, scheme, ...rest] = id.split(':')
  if (!scheme || !isScheme(scheme)) return null
  if (prefix === 'tf-pin' && rest.length === 2) {
    const [day, order] = rest.map(Number)
    if (!Number.isInteger(day) || !Number.isInteger(order)) return null
    return itineraryPin(scheme, day, order)
  }
  if (prefix === 'tf-glyph' && rest.length === 1 && isGlyph(rest[0])) return glyphPin(scheme, rest[0])
  return null
}

export const svgDataUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/** Data URL of the image an id names (null when the id is not ours) */
export function pinDataUrl(id: string): string | null {
  const image = pinImageFromId(id)
  return image ? svgDataUrl(image.svg) : null
}

/** One sample pin per day colour (ten), e.g. for a legend */
export const dayPinDataUrls = (scheme: MapScheme, order = 1): string[] =>
  Array.from({ length: 10 }, (_, day) => svgDataUrl(itineraryPin(scheme, day, order).svg))

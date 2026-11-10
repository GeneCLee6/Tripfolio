import type { LegMode } from '../shared/itinerary/types.ts'
import type { ShareDay, SharePoint } from '../shared/api/share.ts'
import { fitProjection, type Box, type GeoPoint } from './projection.ts'

// The printed day map (e8-t02): a day's stops as numbered pins and its legs as lines, projected
// with the route sketch's projection (share/projection.ts) into a small box. Pure geometry from the
// payload, no tiles and no MapLibre, so every day of a long trip draws at once when printing.
// Pins are numbered like the printed stops table: the day's stops that are not rainy-day backups,
// in order, whether or not they have a place.

export interface SketchPin {
  x: number
  y: number
  /** 1-based number in the day's stops table */
  n: number
  name: string
}

export interface SketchLine {
  x1: number
  y1: number
  x2: number
  y2: number
  mode: LegMode
  /** A straight-line estimate, drawn dashed */
  estimate: boolean
}

export interface DaySketch {
  width: number
  height: number
  pins: SketchPin[]
  lines: SketchLine[]
  /** Tonight's lodging, when it has a place */
  lodging?: { x: number; y: number }
  /** Positions of the light background grid's vertical and horizontal lines */
  gridX: number[]
  gridY: number[]
}

/** Grid spacing, in sketch units */
export const GRID_STEP = 40

const gridLines = (size: number): number[] => {
  const out: number[] = []
  for (let at = GRID_STEP; at < size; at += GRID_STEP) out.push(at)
  return out
}

/**
 * The day's sketch, or null when nothing of the day has a place. `lodging` is where the day sleeps
 * (the overnight line's lodging end); it joins the fit so the pin is inside the box.
 */
export function buildDaySketch(
  day: Pick<ShareDay, 'stops' | 'legs'>,
  box: Box,
  lodging?: SharePoint,
): DaySketch | null {
  const numbered = day.stops.filter((s) => !s.isBackup).map((stop, i) => ({ stop, n: i + 1 }))
  const located = numbered.filter(({ stop }) => stop.lat !== undefined && stop.lng !== undefined)
  const points: GeoPoint[] = located.map(({ stop }) => ({ lat: stop.lat ?? 0, lng: stop.lng ?? 0 }))
  if (lodging) points.push(lodging)
  if (points.length === 0) return null
  const project = fitProjection(points, box)
  const at = new Map(
    located.map(({ stop }) => [stop.order, project({ lat: stop.lat ?? 0, lng: stop.lng ?? 0 })]),
  )
  const lines: SketchLine[] = []
  for (const leg of day.legs) {
    const a = at.get(leg.fromOrder)
    const b = at.get(leg.toOrder)
    if (!a || !b || (a.x === b.x && a.y === b.y)) continue
    lines.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      mode: leg.mode,
      estimate: leg.source === 'estimate',
    })
  }
  const sketch: DaySketch = {
    width: box.width,
    height: box.height,
    pins: located.map(({ stop, n }) => ({ ...at.get(stop.order)!, n, name: stop.name })),
    lines,
    gridX: gridLines(box.width),
    gridY: gridLines(box.height),
  }
  if (lodging) sketch.lodging = project(lodging)
  return sketch
}

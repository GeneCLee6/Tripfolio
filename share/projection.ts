// A tiny equirectangular projection for the share page's static route sketch (e8-t01b): the
// placeholder shown before MapLibre loads, without JavaScript-heavy maps, and in print. Longitude is
// scaled by the cosine of the mean latitude so a trip's shape is not stretched; the points are
// fitted into a box with padding, keeping the aspect ratio, and centred.

export interface GeoPoint {
  lat: number
  lng: number
}

export interface ScreenPoint {
  x: number
  y: number
}

export interface Box {
  width: number
  height: number
  /** Kept free on every side */
  padding: number
}

/**
 * Longitudes made continuous across the antimeridian: when the points span more than half the
 * world, negative longitudes move up by 360 (a trip around Fiji or the Chatham Islands).
 */
export function unwrapLongitudes(lngs: readonly number[]): number[] {
  if (lngs.length === 0) return []
  const min = Math.min(...lngs)
  const max = Math.max(...lngs)
  if (max - min <= 180) return [...lngs]
  return lngs.map((lng) => (lng < 0 ? lng + 360 : lng))
}

/** A projector for the given points: every point (and any other near them) maps into the box */
export function fitProjection(points: readonly GeoPoint[], box: Box): (p: GeoPoint) => ScreenPoint {
  const centre = { x: box.width / 2, y: box.height / 2 }
  if (points.length === 0) return () => centre
  const unwrapped = unwrapLongitudes(points.map((p) => p.lng))
  const shift = unwrapped.some((lng, i) => lng !== points[i]!.lng)
  const lngOf = (lng: number) => (shift && lng < 0 ? lng + 360 : lng)
  const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
  const kx = Math.cos((meanLat * Math.PI) / 180)
  const xs = unwrapped.map((lng) => lng * kx)
  const ys = points.map((p) => -p.lat)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = maxX - minX
  const spanY = maxY - minY
  const innerW = Math.max(0, box.width - 2 * box.padding)
  const innerH = Math.max(0, box.height - 2 * box.padding)
  // One point (or all at one place): everything in the middle
  if (spanX === 0 && spanY === 0) return () => centre
  const scale = Math.min(
    spanX > 0 ? innerW / spanX : Number.POSITIVE_INFINITY,
    spanY > 0 ? innerH / spanY : Number.POSITIVE_INFINITY,
  )
  const offsetX = centre.x - ((minX + maxX) / 2) * scale
  const offsetY = centre.y - ((minY + maxY) / 2) * scale
  return (p) => ({
    x: lngOf(p.lng) * kx * scale + offsetX,
    y: -p.lat * scale + offsetY,
  })
}

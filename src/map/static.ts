import type { Map as MapLibreMap } from 'maplibre-gl'

// Static map PNG for printing (E8, E3 設計方向): renders the same style, overlay data and pin
// images into an off-screen map of the requested size and returns its canvas as a PNG. Uses the
// running map's own class, so this module adds nothing to whichever chunk imports it.

export interface StaticPngOptions {
  /** CSS px */
  width: number
  height: number
  /** Device pixels per CSS px of the output (default 2, print quality) */
  pixelRatio?: number
  /** Give up after this many ms waiting for tiles (default 15 s) */
  timeoutMs?: number
}

export async function exportStaticPng(map: MapLibreMap, options: StaticPngOptions): Promise<Blob> {
  const { width, height, pixelRatio = 2, timeoutMs = 15_000 } = options
  const MapClass = map.constructor as typeof MapLibreMap
  const container = document.createElement('div')
  container.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;`
  document.body.append(container)
  const copy = new MapClass({
    container,
    style: map.getStyle(),
    bounds: map.getBounds(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    interactive: false,
    attributionControl: false,
    pixelRatio,
    fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  })
  try {
    // Pin images are added at runtime (addImage), not part of the style: copy them across
    for (const id of map.listImages()) {
      const image = map.getImage(id)
      if (image && !copy.hasImage(id)) copy.addImage(id, image.data, { pixelRatio: image.pixelRatio, sdf: image.sdf })
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Static map timed out waiting for tiles')), timeoutMs)
      copy.once('idle', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    return await new Promise<Blob>((resolve, reject) =>
      copy.getCanvas().toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))), 'image/png'),
    )
  } finally {
    copy.remove()
    container.remove()
  }
}

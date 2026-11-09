// Browser-side resizing (e6-t01, ARCHITECTURE.md §4.4): createImageBitmap → canvas → WebP. The
// re-encode drops every EXIF field (location, camera, time), so only exif.ts ever sees them.
// Falls back to JPEG where the canvas cannot encode WebP (Safari before 16 returns a PNG instead).
// DOM-only and deliberately thin: the size math is `fitWithin`, which is tested; the rest needs a
// real browser (covered by e6-t02's Playwright run).

export interface ResizedImage {
  blob: Blob
  width: number
  height: number
}

export interface ResizeOptions {
  /** Longest edge in px; never upscales */
  maxEdge?: number
  /** 0–1 encoder quality */
  quality?: number
}

/** Scales (width, height) so the longer edge is at most maxEdge, keeping the ratio */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

async function encode(canvas: AnyCanvas, type: string, quality: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality }).catch(() => null)
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** Decodes `file`, draws it at most `maxEdge` on its long side, and encodes WebP (else JPEG) */
export async function resizeImage(
  file: Blob,
  { maxEdge = 2048, quality = 0.82 }: ResizeOptions = {},
): Promise<ResizedImage> {
  // Orientation from EXIF is applied by the decoder, so width/height are as displayed
  const source = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { width, height } = fitWithin(source.width, source.height, maxEdge)
    const canvas = makeCanvas(width, height)
    const context = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!context) throw new Error('canvas 2d context unavailable')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, 0, 0, width, height)
    let blob = await encode(canvas, 'image/webp', quality)
    // An encoder without WebP silently returns PNG: re-encode as JPEG to stay small
    if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', quality)
    if (!blob) throw new Error('image encoding failed')
    return { blob, width, height }
  } finally {
    source.close()
  }
}

/** The 400 px thumbnail */
export const makeThumb = (file: Blob, maxEdge = 400): Promise<ResizedImage> =>
  resizeImage(file, { maxEdge, quality: 0.75 })

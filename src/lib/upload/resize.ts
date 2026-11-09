// Browser-side resizing (e6-t01, ARCHITECTURE.md §4.4): createImageBitmap → canvas → WebP. The
// re-encode drops every EXIF field (location, camera, time), so only exif.ts ever sees them.
// Falls back to JPEG where the canvas cannot encode WebP (Safari before 16 returns a PNG instead).
// DOM-only and deliberately thin: the size math is `fitWithin`, which is tested; the rest needs a
// real browser (covered by e6-t02's Playwright run). Memory: see decodeAtMost.

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

/**
 * The displayed (EXIF-oriented) size of an image without decoding its pixels: an <img> fires
 * `load` once the header is parsed, and Chromium and Safari only decode the bitmap when it is
 * painted, so this costs the encoded bytes, not width × height × 4. null where there is no DOM or
 * the browser cannot read the format (the caller then decodes at full size, which fails the same
 * way for HEIC outside Safari and is reported as such).
 */
export function probeSize(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function')
    return Promise.resolve(null)
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    const done = (size: { width: number; height: number } | null) => {
      img.onload = null
      img.onerror = null
      img.removeAttribute('src')
      URL.revokeObjectURL(url)
      resolve(size)
    }
    img.onload = () =>
      done(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null)
    img.onerror = () => done(null)
    img.decoding = 'async'
    img.src = url
  })
}

/** Whether a decoded bitmap kept the aspect ratio we asked for (to within rounding) */
export function sameAspect(a: { width: number; height: number }, b: { width: number; height: number }): boolean {
  return Math.abs(a.width / a.height - b.width / b.height) <= 0.02 * (b.width / b.height)
}

/**
 * Decodes `file` straight to the target size where the browser can, so a 12 MP phone photo never
 * exists as a 48 MB full-size bitmap:
 * 1. `probeSize` reads the displayed size from the header (no pixel decode);
 * 2. `createImageBitmap(file, { resizeWidth, resizeHeight, resizeQuality: 'high' })` decodes at
 *    (or close to) the 2048 size; Chromium scales while decoding JPEG/WebP;
 * 3. if the browser ignored the resize options or returned the other orientation (the spec once
 *    resized before applying EXIF orientation), we still draw onto a canvas sized from the bitmap's
 *    own aspect ratio, so the output is never stretched; at worst it costs one full decode, released
 *    in `finally`. Safari without resize support lands here and behaves like before.
 */
async function decodeAtMost(file: Blob, maxEdge: number): Promise<ImageBitmap> {
  const size = await probeSize(file)
  if (size) {
    const target = fitWithin(size.width, size.height, maxEdge)
    if (target.width < size.width) {
      try {
        const bitmap = await createImageBitmap(file, {
          imageOrientation: 'from-image',
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'high',
        })
        if (sameAspect(bitmap, target)) return bitmap
        bitmap.close()
      } catch {
        // Fall through to a plain decode (it throws the real error if the format is unreadable)
      }
    }
  }
  // Orientation from EXIF is applied by the decoder, so width/height are as displayed
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

/** Decodes `file`, draws it at most `maxEdge` on its long side, and encodes WebP (else JPEG) */
export async function resizeImage(
  file: Blob,
  { maxEdge = 2048, quality = 0.82 }: ResizeOptions = {},
): Promise<ResizedImage> {
  const source = await decodeAtMost(file, maxEdge)
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

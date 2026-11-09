// The upload pipeline (e6-t01): EXIF → resize + thumbnail (photos) → sign → PUT the bytes (and the
// thumbnail) through the Worker with progress → complete. PUTs are retried with backoff; files run
// at most three at a time through uploadQueue. The component (e6-t02) only renders progress.

import type { Attachment, AttachmentSignResponse } from '../../../shared/api/media.ts'
import {
  attachmentLimits,
  mimeAllowed,
  maxBytesFor,
  type AttachmentKind,
  type AttachmentSignBody,
  type AttachmentVisibility,
} from '../../../shared/schema/attachment.ts'
import { ApiError } from '../api.ts'
import { mediaApi } from './api.ts'
import { readExif, type ExifInfo } from './exif.ts'
import { makeThumb, resizeImage, type ResizedImage } from './resize.ts'

export type UploadPhase = 'preparing' | 'uploading' | 'completing' | 'done'

export interface UploadProgress {
  phase: UploadPhase
  /** Bytes sent so far across the main object and its thumbnail */
  loaded: number
  total: number
}

export interface UploadOptions {
  kind: AttachmentKind
  /** false: do not send the photo's GPS position (the time is still used) */
  usePhotoLocation?: boolean
  visibility?: AttachmentVisibility
  dayId?: string | null
  stopId?: string | null
  placeId?: string | null
  bookingId?: string | null
  lodgingId?: string | null
  wishlistItemId?: string | null
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal
}

export interface PutOptions {
  token: string
  contentType: string
  onProgress?: (loaded: number) => void
  signal?: AbortSignal
}

/** The seams tests replace (no XHR, canvas or network in Node) */
export interface UploadDeps {
  readExif: (buffer: ArrayBuffer) => ExifInfo
  resize: (file: Blob) => Promise<ResizedImage>
  thumb: (file: Blob) => Promise<ResizedImage>
  sign: (
    tripId: string,
    body: AttachmentSignBody,
    signal?: AbortSignal,
  ) => Promise<AttachmentSignResponse>
  complete: (
    tripId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ) => Promise<{ attachment: Attachment }>
  put: (url: string, body: Blob, options: PutOptions) => Promise<void>
  token: (tripId: string) => string
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** Retries after the first PUT attempt */
export const PUT_RETRIES = 3
const BACKOFF_MS = 800

/** A file the pipeline refuses before any network call */
export class UploadRejected extends Error {
  readonly code: 'too_large' | 'unsupported_type'

  constructor(code: 'too_large' | 'unsupported_type', message: string) {
    super(message)
    this.name = 'UploadRejected'
    this.code = code
  }
}

/** PUT with XMLHttpRequest, for upload progress (fetch has none) */
export function xhrPut(
  url: string,
  body: Blob,
  { token, contentType, onProgress, signal }: PutOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('authorization', `Bearer ${token}`)
    xhr.setRequestHeader('content-type', contentType)
    xhr.upload.onprogress = (event) => onProgress?.(event.loaded)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      let code = 'http_error'
      let message = `HTTP ${xhr.status}`
      try {
        const parsed = JSON.parse(xhr.responseText) as {
          error?: { code?: string; message?: string }
        }
        code = parsed.error?.code ?? code
        message = parsed.error?.message ?? message
      } catch {
        // not JSON
      }
      reject(new ApiError(xhr.status, code, message))
    }
    xhr.onerror = () => reject(new ApiError(0, 'network', 'upload failed'))
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

export const defaultDeps: UploadDeps = {
  readExif,
  resize: (file) => resizeImage(file, { maxEdge: 2048, quality: 0.82 }),
  thumb: (file) => makeThumb(file, 400),
  sign: mediaApi.sign,
  complete: mediaApi.complete,
  put: xhrPut,
  token: mediaApi.tokenFor,
  sleep,
}

/** Network failures, timeouts, rate limits and 5xx are worth another try; other 4xx are not */
export function isRetryable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false
  if (!(error instanceof ApiError)) return true
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500
}

async function putWithRetry(
  deps: UploadDeps,
  url: string,
  body: Blob,
  options: PutOptions,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await deps.put(url, body, options)
      return
    } catch (error) {
      if (attempt >= PUT_RETRIES || !isRetryable(error)) throw error
      options.onProgress?.(0)
      await deps.sleep(BACKOFF_MS * 2 ** attempt, options.signal)
    }
  }
}

/** Uploads one file as an attachment of `tripId`; resolves with the ready attachment */
export async function uploadAttachment(
  tripId: string,
  file: File,
  options: UploadOptions,
  deps: UploadDeps = defaultDeps,
): Promise<Attachment> {
  const { kind, signal, onProgress } = options
  const isPhoto = kind === 'photo'
  if (isPhoto ? file.size > attachmentLimits.originalBytes : file.size > maxBytesFor(kind))
    throw new UploadRejected('too_large', `${file.name} is too large`)
  if (!isPhoto && !mimeAllowed(kind, file.type))
    throw new UploadRejected('unsupported_type', `${file.type || 'unknown type'} is not accepted`)
  if (isPhoto && file.type && !file.type.startsWith('image/'))
    throw new UploadRejected('unsupported_type', `${file.type} is not an image`)
  onProgress?.({ phase: 'preparing', loaded: 0, total: 0 })

  let main: Blob = file
  let thumb: Blob | null = null
  let width: number | null = null
  let height: number | null = null
  let exif: ExifInfo | null = null
  if (isPhoto) {
    exif = deps.readExif(await file.arrayBuffer())
    const resized = await deps.resize(file)
    main = resized.blob
    width = resized.width
    height = resized.height
    thumb = (await deps.thumb(resized.blob)).blob
    if (main.size > attachmentLimits.photoBytes)
      throw new UploadRejected('too_large', `${file.name} is too large`)
  }
  signal?.throwIfAborted()

  const useLocation = options.usePhotoLocation !== false
  const signed = await deps.sign(
    tripId,
    {
      kind,
      mime: main.type,
      bytes: main.size,
      width,
      height,
      takenAt: exif?.takenAt ?? null,
      lat: useLocation ? (exif?.lat ?? null) : null,
      lng: useLocation ? (exif?.lng ?? null) : null,
      hasThumb: thumb !== null,
      visibility: options.visibility,
      dayId: options.dayId ?? null,
      stopId: options.stopId ?? null,
      placeId: options.placeId ?? null,
      bookingId: options.bookingId ?? null,
      lodgingId: options.lodgingId ?? null,
      wishlistItemId: options.wishlistItemId ?? null,
    },
    signal,
  )

  const token = deps.token(tripId)
  const total = main.size + (thumb?.size ?? 0)
  let mainLoaded = 0
  let thumbLoaded = 0
  const report = () => onProgress?.({ phase: 'uploading', loaded: mainLoaded + thumbLoaded, total })
  report()
  await putWithRetry(deps, signed.uploadUrl, main, {
    token,
    contentType: main.type,
    signal,
    onProgress: (loaded) => {
      mainLoaded = loaded
      report()
    },
  })
  mainLoaded = main.size
  if (thumb && signed.thumbUploadUrl) {
    await putWithRetry(deps, signed.thumbUploadUrl, thumb, {
      token,
      contentType: thumb.type,
      signal,
      onProgress: (loaded) => {
        thumbLoaded = loaded
        report()
      },
    })
    thumbLoaded = thumb.size
  }
  report()
  onProgress?.({ phase: 'completing', loaded: total, total })
  const { attachment } = await deps.complete(tripId, signed.attachmentId, signal)
  onProgress?.({ phase: 'done', loaded: total, total })
  return attachment
}

export type QueueResult<R> = { ok: true; value: R } | { ok: false; error: unknown }

/**
 * Runs `task` over `items` with at most `concurrency` at once (E6: three uploads at a time); one
 * failure does not stop the others. Results are in input order.
 */
export async function uploadQueue<T, R>(
  items: readonly T[],
  task: (item: T, index: number) => Promise<R>,
  { concurrency = 3 }: { concurrency?: number } = {},
): Promise<QueueResult<R>[]> {
  const results: QueueResult<R>[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      try {
        results[index] = { ok: true, value: await task(items[index], index) }
      } catch (error) {
        results[index] = { ok: false, error }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker),
  )
  return results
}

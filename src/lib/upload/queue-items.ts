import type { MessageKey } from '../../../shared/i18n/t.ts'
import { isApiError } from '../api.ts'
import { errorMessageKey } from '../errors.ts'
import type { Translate } from '../i18n.ts'
import { isRetryable, UploadRejected } from './upload.ts'

// The uploader's queue rows (e6-t02): their states, the overall progress, and what a failure means
// for the person (too large, not an image, HEIC the browser cannot decode, a network error to retry).

/** Uploads in flight at once (E6: three) */
export const UPLOAD_CONCURRENCY = 3
/** localStorage key for the "use photo location" switch */
export const USE_LOCATION_KEY = 'tripfolio.photos.useLocation'

export type ItemStatus =
  | 'queued'
  | 'preparing'
  | 'uploading'
  | 'completing'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface ItemError {
  key: MessageKey
  code?: string
  retryable: boolean
}

export interface UploadItem {
  id: string
  name: string
  /** Object URL of the picked file for the row's preview (null when the browser cannot show it) */
  previewUrl: string | null
  status: ItemStatus
  loaded: number
  total: number
  error: ItemError | null
}

export const isHeic = (file: { name: string; type: string }) =>
  /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)

export const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/** What to tell people about a failed file, and whether trying again could help */
export function describeUploadError(error: unknown, file: { name: string; type: string }): ItemError {
  if (error instanceof UploadRejected) {
    if (error.code === 'too_large') return { key: 'photos.upload.error.tooLarge', retryable: false }
    return {
      key: isHeic(file) ? 'photos.upload.error.heic' : 'photos.upload.error.unsupported',
      retryable: false,
    }
  }
  if (isApiError(error)) {
    if (error.status === 413) return { key: 'photos.upload.error.tooLarge', retryable: false }
    const { key, code } = errorMessageKey(error)
    return { key, code, retryable: isRetryable(error) }
  }
  // createImageBitmap or the canvas could not read the file (HEIC outside Safari, a broken file)
  return {
    key: isHeic(file) ? 'photos.upload.error.heic' : 'photos.upload.error.decode',
    retryable: !isHeic(file),
  }
}

export const ACTIVE: ReadonlySet<ItemStatus> = new Set(['queued', 'preparing', 'uploading', 'completing'])

/** Share of one item that is done, 0–1 */
export function itemFraction(item: UploadItem): number {
  if (item.status === 'done' || item.status === 'completing') return 1
  if (item.status === 'uploading' && item.total > 0) return Math.min(1, item.loaded / item.total)
  return 0
}

/** Files finished, files counted (failed and cancelled are left out) and the overall percent */
export function overallProgress(items: readonly UploadItem[]): {
  done: number
  total: number
  percent: number
} {
  const counted = items.filter((item) => item.status !== 'failed' && item.status !== 'cancelled')
  const done = counted.filter((item) => item.status === 'done').length
  const sum = counted.reduce((acc, item) => acc + itemFraction(item), 0)
  return {
    done,
    total: counted.length,
    percent: counted.length ? Math.round((sum / counted.length) * 100) : 0,
  }
}

export function phaseText(t: Translate, item: UploadItem): string {
  if (item.status === 'uploading')
    return t('photos.upload.phase.uploading', { percent: Math.round(itemFraction(item) * 100) })
  return t(`photos.upload.phase.${item.status}`)
}

export function readUseLocation(): boolean {
  try {
    return globalThis.localStorage?.getItem(USE_LOCATION_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeUseLocation(value: boolean) {
  try {
    globalThis.localStorage?.setItem(USE_LOCATION_KEY, value ? '1' : '0')
  } catch {
    // private mode: the switch still works for this page
  }
}

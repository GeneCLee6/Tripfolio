import { mediaApi } from './api.ts'

// Object URLs for trip photos (e6-t02). <img> cannot send the member's Bearer token, so the bytes
// are fetched with mediaApi.fetchBlob and shown through an object URL (ARCHITECTURE.md §4.4). One
// module-level cache: every PhotoThumb showing the same photo shares one fetch and one URL; when
// nothing shows it any more the URL stays around (a grid scrolled back, the viewer reopened) until it
// falls out of a small LRU, and only then is it revoked. A deleted photo is evicted (and revoked) at
// once. The browser's private HTTP cache (one day + ETag) sits underneath.

export type PhotoVariant = 'thumb' | 'full'

export interface PhotoUrlCacheDeps {
  fetchBlob: (tripId: string, url: string, signal?: AbortSignal) => Promise<Blob>
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
  /** Unused URLs kept for reuse before the oldest is revoked */
  maxIdle?: number
}

interface Entry {
  promise: Promise<string>
  url: string | null
  refs: number
  controller: AbortController
}

export const mediaUrl = (attachmentId: string, variant: PhotoVariant): string =>
  `/api/media/${encodeURIComponent(attachmentId)}${variant === 'thumb' ? '/thumb' : ''}`

const keyOf = (attachmentId: string, variant: PhotoVariant) => `${variant}:${attachmentId}`

export class PhotoUrlCache {
  private readonly deps: PhotoUrlCacheDeps
  private readonly maxIdle: number
  private readonly entries = new Map<string, Entry>()
  /** Keys nobody holds, oldest first */
  private readonly idle: string[] = []

  constructor(deps: PhotoUrlCacheDeps) {
    this.deps = deps
    this.maxIdle = deps.maxIdle ?? 120
  }

  /** The object URL if it is already loaded (lets a remount skip the skeleton) */
  peek(attachmentId: string, variant: PhotoVariant): string | null {
    return this.entries.get(keyOf(attachmentId, variant))?.url ?? null
  }

  /** Takes a reference and resolves with the object URL; pair every call with release() */
  acquire(tripId: string, attachmentId: string, variant: PhotoVariant): Promise<string> {
    const key = keyOf(attachmentId, variant)
    const existing = this.entries.get(key)
    if (existing) {
      existing.refs++
      this.unidle(key)
      return existing.promise
    }
    const controller = new AbortController()
    const entry: Entry = { promise: Promise.resolve(''), url: null, refs: 1, controller }
    entry.promise = this.deps
      .fetchBlob(tripId, mediaUrl(attachmentId, variant), controller.signal)
      .then((blob) => {
        // Evicted while loading: do not leak a URL nobody will revoke
        if (this.entries.get(key) !== entry) throw new DOMException('evicted', 'AbortError')
        entry.url = this.deps.createObjectURL(blob)
        return entry.url
      })
      .catch((error: unknown) => {
        // A failure is not cached: the next acquire tries again
        if (this.entries.get(key) === entry) {
          this.entries.delete(key)
          this.unidle(key)
        }
        throw error
      })
    this.entries.set(key, entry)
    return entry.promise
  }

  /** Drops a reference; an unused URL is kept for reuse until the LRU pushes it out */
  release(attachmentId: string, variant: PhotoVariant): void {
    const key = keyOf(attachmentId, variant)
    const entry = this.entries.get(key)
    if (!entry || entry.refs === 0) return
    entry.refs--
    if (entry.refs > 0) return
    this.idle.push(key)
    while (this.idle.length > this.maxIdle) this.drop(this.idle.shift() as string)
  }

  /** Forgets both variants of a photo now (after it is deleted), revoking its URLs */
  evict(attachmentId: string): void {
    for (const variant of ['thumb', 'full'] as const) {
      const key = keyOf(attachmentId, variant)
      this.unidle(key)
      this.drop(key)
    }
  }

  /** Revokes everything (tests, leaving the app) */
  clear(): void {
    for (const key of [...this.entries.keys()]) this.drop(key)
    this.idle.length = 0
  }

  /** Entries held or idle (for tests) */
  get size(): number {
    return this.entries.size
  }

  private unidle(key: string) {
    const at = this.idle.indexOf(key)
    if (at >= 0) this.idle.splice(at, 1)
  }

  private drop(key: string) {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    if (entry.url) this.deps.revokeObjectURL(entry.url)
    else entry.controller.abort()
  }
}

/** The app's one cache */
export const photoCache = /* @__PURE__ */ new PhotoUrlCache({
  fetchBlob: mediaApi.fetchBlob,
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
})

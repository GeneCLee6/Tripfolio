import { describe, expect, it } from 'vitest'
import { mediaUrl, PhotoUrlCache } from '../../../src/lib/upload/photo-cache.ts'

// The object-URL cache behind PhotoThumb (e6-t02): one fetch per photo and variant, URLs revoked
// only when they fall out of the idle LRU or the photo is deleted, failures not cached.

function setup(maxIdle = 2) {
  const fetched: string[] = []
  const revoked: string[] = []
  const pending = new Map<string, { resolve: (b: Blob) => void; reject: (e: unknown) => void }>()
  let n = 0
  const cache = new PhotoUrlCache({
    maxIdle,
    fetchBlob: (tripId, url, signal) => {
      fetched.push(`${tripId} ${url}`)
      return new Promise<Blob>((resolve, reject) => {
        pending.set(url, { resolve, reject })
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    },
    createObjectURL: () => `blob:${++n}`,
    revokeObjectURL: (url) => revoked.push(url),
  })
  const settle = (url: string) => pending.get(url)?.resolve(new Blob(['x']))
  const fail = (url: string) => pending.get(url)?.reject(new Error('404'))
  return { cache, fetched, revoked, settle, fail }
}

describe('mediaUrl', () => {
  it('points at the Worker media routes', () => {
    expect(mediaUrl('a1', 'full')).toBe('/api/media/a1')
    expect(mediaUrl('a1', 'thumb')).toBe('/api/media/a1/thumb')
  })
})

describe('PhotoUrlCache', () => {
  it('shares one fetch and one URL between holders of the same photo', async () => {
    const { cache, fetched, settle } = setup()
    const a = cache.acquire('t1', 'p1', 'thumb')
    const b = cache.acquire('t1', 'p1', 'thumb')
    settle('/api/media/p1/thumb')
    expect(await a).toBe('blob:1')
    expect(await b).toBe('blob:1')
    expect(fetched).toEqual(['t1 /api/media/p1/thumb'])
    expect(cache.peek('p1', 'thumb')).toBe('blob:1')
    expect(cache.peek('p1', 'full')).toBeNull()
  })

  it('keeps released URLs for reuse and revokes the oldest beyond the idle limit', async () => {
    const { cache, revoked, settle, fetched } = setup(2)
    for (const id of ['p1', 'p2', 'p3']) {
      const promise = cache.acquire('t1', id, 'thumb')
      settle(`/api/media/${id}/thumb`)
      await promise
    }
    cache.release('p1', 'thumb')
    cache.release('p2', 'thumb')
    expect(revoked).toEqual([])
    // Reacquiring an idle URL needs no fetch and takes it off the idle list
    expect(await cache.acquire('t1', 'p1', 'thumb')).toBe('blob:1')
    expect(fetched).toHaveLength(3)
    cache.release('p3', 'thumb')
    cache.release('p1', 'thumb')
    // idle: p2, p3, p1 → over the limit of 2, p2 goes
    expect(revoked).toEqual(['blob:2'])
    expect(cache.peek('p2', 'thumb')).toBeNull()
    expect(cache.size).toBe(2)
  })

  it('does not revoke a URL that is still held', async () => {
    const { cache, revoked, settle } = setup(0)
    const promise = cache.acquire('t1', 'p1', 'full')
    void cache.acquire('t1', 'p1', 'full')
    settle('/api/media/p1')
    await promise
    cache.release('p1', 'full')
    expect(revoked).toEqual([])
    cache.release('p1', 'full')
    expect(revoked).toEqual(['blob:1'])
    // An extra release is ignored
    cache.release('p1', 'full')
    expect(revoked).toEqual(['blob:1'])
  })

  it('evicts both variants of a deleted photo, held or not', async () => {
    const { cache, revoked, settle } = setup()
    const thumb = cache.acquire('t1', 'p1', 'thumb')
    const full = cache.acquire('t1', 'p1', 'full')
    settle('/api/media/p1/thumb')
    settle('/api/media/p1')
    await Promise.all([thumb, full])
    cache.evict('p1')
    expect(revoked.sort()).toEqual(['blob:1', 'blob:2'])
    expect(cache.size).toBe(0)
  })

  it('aborts a load evicted before it finishes and never creates its URL', async () => {
    const { cache, revoked } = setup()
    const promise = cache.acquire('t1', 'p1', 'thumb')
    cache.evict('p1')
    await expect(promise).rejects.toThrow()
    expect(revoked).toEqual([])
    expect(cache.size).toBe(0)
  })

  it('does not cache a failure: the next acquire fetches again', async () => {
    const { cache, fetched, fail, settle } = setup()
    const first = cache.acquire('t1', 'p1', 'thumb')
    fail('/api/media/p1/thumb')
    await expect(first).rejects.toThrow('404')
    expect(cache.size).toBe(0)
    const second = cache.acquire('t1', 'p1', 'thumb')
    settle('/api/media/p1/thumb')
    expect(await second).toBe('blob:1')
    expect(fetched).toHaveLength(2)
  })

  it('clear() revokes everything', async () => {
    const { cache, revoked, settle } = setup()
    const promise = cache.acquire('t1', 'p1', 'thumb')
    settle('/api/media/p1/thumb')
    await promise
    cache.clear()
    expect(revoked).toEqual(['blob:1'])
    expect(cache.size).toBe(0)
  })
})

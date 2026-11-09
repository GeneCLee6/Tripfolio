import { describe, expect, it } from 'vitest'
import type { Attachment, AttachmentSignResponse } from '../../../shared/api/media.ts'
import type { AttachmentSignBody } from '../../../shared/schema/attachment.ts'
import { ApiError } from '../../../src/lib/api.ts'
import {
  PUT_RETRIES,
  UploadRejected,
  uploadAttachment,
  uploadQueue,
  type UploadDeps,
  type UploadProgress,
} from '../../../src/lib/upload/upload.ts'

// The pipeline with its seams mocked: no canvas, XHR or network in Node (resize.ts itself is
// browser-only and exercised by e6-t02's Playwright run).

interface Log {
  signed: AttachmentSignBody[]
  puts: { url: string; type: string; size: number; token: string }[]
  completed: string[]
  sleeps: number[]
}

function deps(overrides: Partial<UploadDeps> = {}) {
  const log: Log = { signed: [], puts: [], completed: [], sleeps: [] }
  const d: UploadDeps = {
    readExif: () => ({
      takenAtLocal: '2026-12-20T14:33:05',
      offset: '+09:00',
      takenAt: '2026-12-20T05:33:05Z',
      lat: 35.68,
      lng: 139.76,
      orientation: 1,
    }),
    resize: async () => ({
      blob: new Blob([new Uint8Array(300)], { type: 'image/webp' }),
      width: 2048,
      height: 1536,
    }),
    thumb: async () => ({
      blob: new Blob([new Uint8Array(20)], { type: 'image/webp' }),
      width: 400,
      height: 300,
    }),
    sign: async (tripId, body): Promise<AttachmentSignResponse> => {
      log.signed.push(body)
      return {
        attachmentId: 'a1',
        uploadUrl: `/api/trips/${tripId}/attachments/a1/content`,
        thumbUploadUrl: body.hasThumb ? `/api/trips/${tripId}/attachments/a1/thumb` : null,
        key: 'k',
        expiresAt: '2026-12-20T00:15:00Z',
      }
    },
    put: async (url, body, options) => {
      log.puts.push({ url, type: options.contentType, size: body.size, token: options.token })
      options.onProgress?.(body.size)
    },
    complete: async (_tripId, attachmentId) => {
      log.completed.push(attachmentId)
      return { attachment: { id: attachmentId, status: 'ready' } as Attachment }
    },
    token: () => 'tok',
    sleep: async (ms) => {
      log.sleeps.push(ms)
    },
    ...overrides,
  }
  return { d, log }
}

const photo = (size = 1000, type = 'image/jpeg') =>
  new File([new Uint8Array(size)], 'IMG_1.jpg', { type })

describe('uploadAttachment', () => {
  it('reads EXIF, resizes, signs, PUTs content and thumbnail with progress, completes', async () => {
    const { d, log } = deps()
    const progress: UploadProgress[] = []
    const attachment = await uploadAttachment(
      't1',
      photo(),
      { kind: 'photo', dayId: 'd1', onProgress: (p) => progress.push(p) },
      d,
    )
    expect(attachment).toMatchObject({ id: 'a1', status: 'ready' })
    expect(log.signed[0]).toMatchObject({
      kind: 'photo',
      mime: 'image/webp',
      bytes: 300,
      width: 2048,
      height: 1536,
      takenAt: '2026-12-20T05:33:05Z',
      lat: 35.68,
      lng: 139.76,
      hasThumb: true,
      dayId: 'd1',
    })
    expect(log.puts).toEqual([
      { url: '/api/trips/t1/attachments/a1/content', type: 'image/webp', size: 300, token: 'tok' },
      { url: '/api/trips/t1/attachments/a1/thumb', type: 'image/webp', size: 20, token: 'tok' },
    ])
    expect(log.completed).toEqual(['a1'])
    expect(progress[0].phase).toBe('preparing')
    expect(progress.at(-1)).toEqual({ phase: 'done', loaded: 320, total: 320 })
    const uploading = progress.filter((p) => p.phase === 'uploading').map((p) => p.loaded)
    expect(uploading).toEqual([...uploading].sort((a, b) => a - b))
    expect(uploading).toContain(300)
  })

  it('drops the position when usePhotoLocation is false', async () => {
    const { d, log } = deps()
    await uploadAttachment('t1', photo(), { kind: 'photo', usePhotoLocation: false }, d)
    expect(log.signed[0]).toMatchObject({ lat: null, lng: null, takenAt: '2026-12-20T05:33:05Z' })
  })

  it('sends documents as they are: no EXIF, resize or thumbnail', async () => {
    let touched = false
    const { d, log } = deps({
      resize: async () => {
        touched = true
        throw new Error('no')
      },
    })
    const pdf = new File([new Uint8Array(50)], 'policy.pdf', { type: 'application/pdf' })
    await uploadAttachment('t1', pdf, { kind: 'document' }, d)
    expect(touched).toBe(false)
    expect(log.signed[0]).toMatchObject({
      kind: 'document',
      mime: 'application/pdf',
      bytes: 50,
      hasThumb: false,
      lat: null,
    })
    expect(log.puts).toHaveLength(1)
  })

  it('retries failed PUTs with backoff, then gives up; other 4xx are not retried', async () => {
    let failures = 2
    const flaky = deps({
      put: async (url, body, options) => {
        if (url.endsWith('/content') && failures-- > 0) throw new ApiError(0, 'network', 'offline')
        options.onProgress?.(body.size)
      },
    })
    await uploadAttachment('t1', photo(), { kind: 'photo' }, flaky.d)
    expect(flaky.log.sleeps).toEqual([800, 1600])
    expect(flaky.log.completed).toEqual(['a1'])

    let calls = 0
    const down = deps({
      put: async () => {
        calls++
        throw new ApiError(503, 'http_error', 'HTTP 503')
      },
    })
    await expect(uploadAttachment('t1', photo(), { kind: 'photo' }, down.d)).rejects.toMatchObject({
      status: 503,
    })
    expect(calls).toBe(PUT_RETRIES + 1)
    expect(down.log.completed).toEqual([])

    calls = 0
    const refused = deps({
      put: async () => {
        calls++
        throw new ApiError(413, 'too_large', 'too large')
      },
    })
    await expect(
      uploadAttachment('t1', photo(), { kind: 'photo' }, refused.d),
    ).rejects.toMatchObject({ status: 413 })
    expect(calls).toBe(1)
  })

  it('rejects oversized and unsupported files before any network call', async () => {
    const { d, log } = deps()
    await expect(
      uploadAttachment('t1', photo(51 * 1024 * 1024), { kind: 'photo' }, d),
    ).rejects.toBeInstanceOf(UploadRejected)
    const html = new File(['<b>'], 'x.html', { type: 'text/html' })
    await expect(uploadAttachment('t1', html, { kind: 'receipt' }, d)).rejects.toMatchObject({
      code: 'unsupported_type',
    })
    await expect(uploadAttachment('t1', html, { kind: 'photo' }, d)).rejects.toMatchObject({
      code: 'unsupported_type',
    })
    expect(log.signed).toEqual([])
  })

  it('stops when aborted', async () => {
    const { d, log } = deps()
    const controller = new AbortController()
    controller.abort()
    await expect(
      uploadAttachment('t1', photo(), { kind: 'photo', signal: controller.signal }, d),
    ).rejects.toThrow()
    expect(log.signed).toEqual([])
  })
})

describe('uploadQueue', () => {
  it('runs at most `concurrency` tasks at once, keeps order and isolates failures', async () => {
    let running = 0
    let peak = 0
    const results = await uploadQueue(
      [1, 2, 3, 4, 5, 6, 7],
      async (n) => {
        running++
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, 5 * (n % 3)))
        running--
        if (n === 4) throw new Error('boom')
        return n * 10
      },
      { concurrency: 3 },
    )
    expect(peak).toBe(3)
    expect(results.map((r) => (r.ok ? r.value : 'x'))).toEqual([10, 20, 30, 'x', 50, 60, 70])
    expect(await uploadQueue([], async () => 1)).toEqual([])
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import type {
  AttachmentListResponse,
  AttachmentResponse,
  AttachmentSignResponse,
  AttachmentUsageResponse,
} from '../../shared/api/media.ts'
import type {
  CreateInviteResponse,
  CreateShareResponse,
  CreateTripResponse,
  MemberTokenResponse,
} from '../../shared/api/types.ts'
import type { MemberCreate } from '../../shared/schema/member.ts'
import { attachmentLimits } from '../../shared/schema/attachment.ts'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'
import { DOCUMENT_CACHE, mediaKey, PHOTO_CACHE } from '../../worker/media.ts'
import { createFakeD1 } from './fake-d1.ts'

// Attachments (e6-t01): sign → PUT content (+ thumb) → complete, list/patch/delete, usage, and
// GET /api/media/:aid with its auth matrix, cache headers and ETag. R2 is an in-memory stand-in.

interface Stored {
  body: Uint8Array
  contentType?: string
  customMetadata?: Record<string, string>
  etag: string
}

function fakeR2() {
  const objects = new Map<string, Stored>()
  let n = 0
  const meta = (key: string, o: Stored) => ({
    key,
    size: o.body.byteLength,
    etag: o.etag,
    httpEtag: `"${o.etag}"`,
    customMetadata: o.customMetadata,
    httpMetadata: { contentType: o.contentType },
    writeHttpMetadata(headers: Headers) {
      if (o.contentType) headers.set('content-type', o.contentType)
    },
  })
  const bucket = {
    async put(key: string, body: ReadableStream | ArrayBuffer, options?: R2PutOptions) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer())
      const httpMetadata = options?.httpMetadata as R2HTTPMetadata | undefined
      const stored: Stored = {
        body: bytes,
        contentType: httpMetadata?.contentType,
        customMetadata: options?.customMetadata as Record<string, string> | undefined,
        etag: `e${++n}`,
      }
      objects.set(key, stored)
      return meta(key, stored)
    },
    async head(key: string) {
      const o = objects.get(key)
      return o ? meta(key, o) : null
    },
    async get(key: string) {
      const o = objects.get(key)
      return o ? { ...meta(key, o), body: new Response(o.body).body } : null
    },
    async delete(key: string) {
      objects.delete(key)
    },
  }
  return { bucket: bucket as unknown as R2Bucket, objects }
}

let env: Env
let r2: ReturnType<typeof fakeR2>

beforeEach(() => {
  r2 = fakeR2()
  env = { DB: createFakeD1().db, MEDIA: r2.bucket, APP_VERSION: 'test' } as unknown as Env
})

async function raw(
  method: string,
  path: string,
  {
    token,
    body,
    headers = {},
  }: { token?: string; body?: BodyInit; headers?: Record<string, string> } = {},
) {
  const h: Record<string, string> = { ...headers }
  if (token) h.authorization = `Bearer ${token}`
  return handleRequest(new Request(`https://x.test${path}`, { method, headers: h, body }), env)
}

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await raw(method, path, {
    token,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  })
  expect(response.headers.get('cache-control')).toBe('no-store')
  return { status: response.status, body: (await response.json()) as T }
}

async function setup() {
  const trip = await call<CreateTripResponse>('POST', '/api/trips', undefined, {
    name: 'Tokyo',
    startDate: '2026-12-20',
    endDate: '2026-12-22',
    tz: 'Asia/Tokyo',
    owner: { name: 'Gene', color: 'teal' },
  })
  expect(trip.status).toBe(201)
  const owner = trip.body.memberToken
  const tripId = trip.body.trip.id
  const base = `/api/trips/${tripId}`
  const invite = await call<CreateInviteResponse>('POST', `${base}/invites`, owner)
  const editor = await call<MemberTokenResponse>(
    'POST',
    `/api/join/${invite.body.inviteToken}`,
    undefined,
    {
      name: 'Amy',
      color: 'rose',
    },
  )
  const viewerBody: MemberCreate = { name: 'Kid', color: 'sky', email: null, role: 'viewer' }
  const added = await call<{ member: { id: string } }>('POST', `${base}/members`, owner, viewerBody)
  const invite2 = await call<CreateInviteResponse>('POST', `${base}/invites`, owner)
  const viewer = await call<MemberTokenResponse>(
    'POST',
    `/api/join/${invite2.body.inviteToken}`,
    undefined,
    {
      memberId: added.body.member.id,
    },
  )
  const share = await call<CreateShareResponse>('POST', `${base}/shares`, owner, { options: {} })
  return {
    tripId,
    base,
    owner,
    editor: editor.body.memberToken,
    viewer: viewer.body.memberToken,
    shareToken: share.body.shareToken,
    dayIds: trip.body.days.map((d) => d.id),
  }
}

const bytesOf = (n: number, fill = 7) => new Uint8Array(n).fill(fill)

const put = (
  url: string,
  token: string,
  body: Uint8Array,
  type: string,
  length = body.byteLength,
) =>
  raw('PUT', url, {
    token,
    body,
    headers: { 'content-type': type, 'content-length': String(length) },
  })

/** sign + content (+ thumb) + complete */
async function upload(
  s: Awaited<ReturnType<typeof setup>>,
  {
    kind = 'photo',
    mime = 'image/webp',
    size = 100,
    thumb = kind === 'photo',
    extra = {},
    token = s.editor,
  }: {
    kind?: string
    mime?: string
    size?: number
    thumb?: boolean
    extra?: object
    token?: string
  } = {},
) {
  const signed = await call<AttachmentSignResponse>('POST', `${s.base}/attachments/sign`, token, {
    kind,
    mime,
    bytes: size,
    hasThumb: thumb,
    width: 2048,
    height: 1536,
    ...extra,
  })
  expect(signed.status).toBe(201)
  const content = await put(signed.body.uploadUrl, token, bytesOf(size), mime)
  expect(content.status).toBe(200)
  if (thumb) {
    expect(signed.body.thumbUploadUrl).toBeTruthy()
    const t = await put(signed.body.thumbUploadUrl ?? '', token, bytesOf(10, 1), 'image/webp')
    expect(t.status).toBe(200)
  }
  const done = await call<AttachmentResponse>(
    'POST',
    `${s.base}/attachments/${signed.body.attachmentId}/complete`,
    token,
  )
  expect(done.status).toBe(200)
  return { signed: signed.body, attachment: done.body.attachment }
}

describe('sign', () => {
  it('validates kind, mime and size per kind, and needs an editor', async () => {
    const s = await setup()
    const sign = (body: object, token = s.editor) =>
      call('POST', `${s.base}/attachments/sign`, token, body)
    expect((await sign({ kind: 'video', mime: 'video/mp4', bytes: 10 })).status).toBe(422)
    expect((await sign({ kind: 'photo', mime: 'image/gif', bytes: 10 })).status).toBe(422)
    expect((await sign({ kind: 'photo', mime: 'image/heic', bytes: 10 })).status).toBe(422)
    expect(
      (await sign({ kind: 'photo', mime: 'image/webp', bytes: attachmentLimits.photoBytes + 1 }))
        .status,
    ).toBe(422)
    expect(
      (await sign({ kind: 'photo', mime: 'image/webp', bytes: attachmentLimits.photoBytes }))
        .status,
    ).toBe(201)
    expect((await sign({ kind: 'document', mime: 'image/svg+xml', bytes: 10 })).status).toBe(422)
    expect((await sign({ kind: 'document', mime: 'text/html', bytes: 10 })).status).toBe(422)
    expect(
      (await sign({ kind: 'document', mime: 'application/pdf', bytes: 20 * 1024 * 1024 })).status,
    ).toBe(201)
    expect((await sign({ kind: 'receipt', mime: 'image/heic', bytes: 10 })).status).toBe(201)
    expect(
      (await sign({ kind: 'document', mime: 'application/pdf', bytes: 20 * 1024 * 1024 + 1 }))
        .status,
    ).toBe(422)
    expect(
      (await sign({ kind: 'document', mime: 'application/pdf', bytes: 10, hasThumb: true })).status,
    ).toBe(422)
    expect((await sign({ kind: 'photo', mime: 'image/webp', bytes: 0 })).status).toBe(422)
    expect((await sign({ kind: 'photo', mime: 'image/webp', bytes: 10, lat: 1 })).status).toBe(422)
    expect(
      (await sign({ kind: 'photo', mime: 'image/webp', bytes: 10, dayId: 'nope' })).status,
    ).toBe(422)
    expect((await sign({ kind: 'photo', mime: 'image/webp', bytes: 10 }, s.viewer)).status).toBe(
      403,
    )
    expect(
      (await sign({ kind: 'photo', mime: 'image/webp', bytes: 10 }, 'x'.repeat(22))).status,
    ).toBe(401)
  })

  it('returns proxied upload urls and an APP_ENV-prefixed key; documents are members-only', async () => {
    const s = await setup()
    const photo = await call<AttachmentSignResponse>(
      'POST',
      `${s.base}/attachments/sign`,
      s.editor,
      {
        kind: 'photo',
        mime: 'image/webp',
        bytes: 10,
        hasThumb: true,
        takenAt: '2026-12-20T14:33:00',
        lat: 35.68,
        lng: 139.76,
      },
    )
    const id = photo.body.attachmentId
    expect(photo.body).toMatchObject({
      uploadUrl: `${s.base}/attachments/${id}/content`,
      thumbUploadUrl: `${s.base}/attachments/${id}/thumb`,
      key: `production/trips/${s.tripId}/photo/${id}.webp`,
    })
    expect(Date.parse(photo.body.expiresAt)).toBeGreaterThan(Date.now())
    env.APP_ENV = 'preview'
    const doc = await call<AttachmentSignResponse>('POST', `${s.base}/attachments/sign`, s.editor, {
      kind: 'document',
      mime: 'application/pdf',
      bytes: 10,
      visibility: 'trip',
    })
    expect(doc.body.key).toBe(`preview/trips/${s.tripId}/document/${doc.body.attachmentId}.pdf`)
    expect(doc.body.thumbUploadUrl).toBeNull()
    expect(mediaKey({}, 't', 'receipt', 'u', 'image/jpeg')).toBe('production/trips/t/receipt/u.jpg')
    await put(doc.body.uploadUrl, s.editor, bytesOf(10), 'application/pdf')
    const done = await call<AttachmentResponse>(
      'POST',
      `${s.base}/attachments/${doc.body.attachmentId}/complete`,
      s.editor,
    )
    expect(done.body.attachment.visibility).toBe('members-only')
  })
})

describe('content upload', () => {
  it('enforces length, declared size, type and the uploader, and stores metadata', async () => {
    const s = await setup()
    const signed = await call<AttachmentSignResponse>(
      'POST',
      `${s.base}/attachments/sign`,
      s.editor,
      {
        kind: 'photo',
        mime: 'image/webp',
        bytes: 50,
      },
    )
    const url = signed.body.uploadUrl
    // No Content-Length
    const noLength = await raw('PUT', url, {
      token: s.editor,
      body: bytesOf(50),
      headers: { 'content-type': 'image/webp' },
    })
    expect(noLength.status).toBe(411)
    expect((await put(url, s.editor, bytesOf(51), 'image/webp')).status).toBe(422)
    expect(
      (await put(url, s.editor, bytesOf(10), 'image/webp', attachmentLimits.photoBytes + 1)).status,
    ).toBe(413)
    expect((await put(url, s.editor, bytesOf(50), 'image/png')).status).toBe(415)
    expect((await put(url, s.owner, bytesOf(50), 'image/webp')).status).toBe(403)
    expect((await put(url, s.viewer, bytesOf(50), 'image/webp')).status).toBe(403)
    // A body that lies about its length never sticks
    expect((await put(url, s.editor, bytesOf(40), 'image/webp', 50)).status).toBe(422)
    expect(r2.objects.size).toBe(0)
    // Complete before upload
    expect(
      (await call('POST', `${s.base}/attachments/${signed.body.attachmentId}/complete`, s.editor))
        .status,
    ).toBe(409)
    // No thumbnail was signed
    expect(
      (
        await put(
          `${s.base}/attachments/${signed.body.attachmentId}/thumb`,
          s.editor,
          bytesOf(5),
          'image/webp',
        )
      ).status,
    ).toBe(422)

    const ok = await put(url, s.editor, bytesOf(50), 'image/webp')
    expect(ok.status).toBe(200)
    const stored = r2.objects.get(signed.body.key)
    expect(stored?.body.byteLength).toBe(50)
    expect(stored?.contentType).toBe('image/webp')
    expect(stored?.customMetadata).toEqual({
      tripId: s.tripId,
      attachmentId: signed.body.attachmentId,
    })

    // Pending rows are not listed; complete flips the status, after which uploads are refused
    expect(
      (await call<AttachmentListResponse>('GET', `${s.base}/attachments`, s.viewer)).body
        .attachments,
    ).toEqual([])
    const done = await call<AttachmentResponse>(
      'POST',
      `${s.base}/attachments/${signed.body.attachmentId}/complete`,
      s.editor,
    )
    expect(done.body.attachment).toMatchObject({ status: 'ready', bytes: 50, thumbUrl: null })
    expect((await put(url, s.editor, bytesOf(50), 'image/webp')).status).toBe(409)
  })

  it('caps the thumbnail, accepts a JPEG fallback, and requires it before complete', async () => {
    const s = await setup()
    const signed = await call<AttachmentSignResponse>(
      'POST',
      `${s.base}/attachments/sign`,
      s.editor,
      {
        kind: 'photo',
        mime: 'image/jpeg',
        bytes: 20,
        hasThumb: true,
      },
    )
    await put(signed.body.uploadUrl, s.editor, bytesOf(20), 'image/jpeg')
    const thumbUrl = signed.body.thumbUploadUrl ?? ''
    expect(
      (await call('POST', `${s.base}/attachments/${signed.body.attachmentId}/complete`, s.editor))
        .status,
    ).toBe(409)
    expect(
      (await put(thumbUrl, s.editor, bytesOf(5), 'image/webp', attachmentLimits.thumbBytes + 1))
        .status,
    ).toBe(413)
    expect((await put(thumbUrl, s.editor, bytesOf(5), 'image/png')).status).toBe(415)
    expect((await put(thumbUrl, s.editor, bytesOf(5), 'image/jpeg')).status).toBe(200)
    const done = await call<AttachmentResponse>(
      'POST',
      `${s.base}/attachments/${signed.body.attachmentId}/complete`,
      s.editor,
    )
    expect(done.body.attachment).toMatchObject({ status: 'ready', thumbBytes: 5 })
    expect(done.body.attachment.thumbUrl).toBe(`/api/media/${signed.body.attachmentId}/thumb`)
  })
})

describe('list, patch, delete, usage', () => {
  it('filters by bookingId / lodgingId (e4-t04 confirmations)', async () => {
    const s = await setup()
    const forBooking = await upload(s, {
      kind: 'document',
      mime: 'application/pdf',
      size: 30,
      extra: { bookingId: 'bk_1' },
    })
    const forLodging = await upload(s, {
      kind: 'document',
      mime: 'image/png',
      size: 20,
      extra: { lodgingId: 'lg_1' },
    })
    await upload(s)
    const list = (q: string) =>
      call<AttachmentListResponse>('GET', `${s.base}/attachments${q}`, s.viewer).then((r) =>
        r.body.attachments.map((x) => x.id),
      )
    expect(await list('?bookingId=bk_1')).toEqual([forBooking.attachment.id])
    expect(await list('?lodgingId=lg_1')).toEqual([forLodging.attachment.id])
    expect(await list('?kind=document&lodgingId=lg_1')).toEqual([forLodging.attachment.id])
    expect(await list('?lodgingId=other')).toEqual([])
    expect((await call('GET', `${s.base}/attachments?bookingId=`, s.viewer)).status).toBe(422)
  })

  it('filters by kind/day/stop, moves, changes visibility and soft-deletes', async () => {
    const s = await setup()
    const [day1, day2] = s.dayIds
    const a = await upload(s, { extra: { dayId: day1, takenAt: '2026-12-20T05:00:00Z' } })
    const b = await upload(s, { extra: { dayId: day2 } })
    const d = await upload(s, { kind: 'document', mime: 'application/pdf', size: 30 })
    const list = (q = '') =>
      call<AttachmentListResponse>('GET', `${s.base}/attachments${q}`, s.viewer).then((r) =>
        r.body.attachments.map((x) => x.id),
      )
    expect(await list()).toHaveLength(3)
    // Ordered by takenAt, falling back to the upload time (b has no EXIF time, so it is earlier)
    expect(await list('?kind=photo')).toEqual([b.attachment.id, a.attachment.id])
    expect(await list(`?dayId=${day2}`)).toEqual([b.attachment.id])
    expect((await call('GET', `${s.base}/attachments?kind=video`, s.viewer)).status).toBe(422)

    const stop = await call<{ stop: { id: string } }>('POST', `${s.base}/stops`, s.owner, {
      dayId: day1,
      title: 'Senso-ji',
      type: 'sight',
    })
    const moved = await call<AttachmentResponse>(
      'PATCH',
      `${s.base}/attachments/${b.attachment.id}`,
      s.editor,
      {
        stopId: stop.body.stop.id,
        dayId: day1,
        visibility: 'members-only',
      },
    )
    expect(moved.status).toBe(200)
    expect(moved.body.attachment).toMatchObject({
      stopId: stop.body.stop.id,
      dayId: day1,
      visibility: 'members-only',
    })
    expect(await list(`?stopId=${stop.body.stop.id}`)).toEqual([b.attachment.id])
    expect(
      (
        await call('PATCH', `${s.base}/attachments/${b.attachment.id}`, s.editor, {
          stopId: 'nope',
        })
      ).status,
    ).toBe(422)
    expect(
      (
        await call('PATCH', `${s.base}/attachments/${d.attachment.id}`, s.editor, {
          visibility: 'trip',
        })
      ).status,
    ).toBe(422)
    expect(
      (await call('PATCH', `${s.base}/attachments/${b.attachment.id}`, s.viewer, { dayId: null }))
        .status,
    ).toBe(403)

    // The trip cover is cleared with the photo it pointed at
    await call('PATCH', s.base, s.owner, { coverAttachmentId: a.attachment.id })
    const usage = await call<AttachmentUsageResponse>(
      'GET',
      `${s.base}/attachments/usage`,
      s.viewer,
    )
    expect(usage.body).toEqual({
      bytes: 100 + 10 + 100 + 10 + 30,
      count: 3,
      warnAtBytes: 1.5 * 1024 ** 3,
    })

    expect(
      (await call('DELETE', `${s.base}/attachments/${a.attachment.id}`, s.viewer)).status,
    ).toBe(403)
    expect(
      (await call('DELETE', `${s.base}/attachments/${a.attachment.id}`, s.editor)).status,
    ).toBe(200)
    expect(await list()).toHaveLength(2)
    expect(
      (await call('DELETE', `${s.base}/attachments/${a.attachment.id}`, s.editor)).status,
    ).toBe(404)
    const trip = await call<{ trip: { coverAttachmentId: string | null } }>('GET', s.base, s.viewer)
    expect(trip.body.trip.coverAttachmentId).toBeNull()
    expect(
      (await call<AttachmentUsageResponse>('GET', `${s.base}/attachments/usage`, s.viewer)).body,
    ).toMatchObject({
      bytes: 140,
      count: 2,
    })
    // The R2 objects stay for the e11-t06 cleanup
    expect(r2.objects.has(a.signed.key)).toBe(true)
  })
})

describe('GET /api/media/:aid', () => {
  it('serves photos to members and share links, documents to members only', async () => {
    const s = await setup()
    const photo = await upload(s)
    const doc = await upload(s, { kind: 'document', mime: 'application/pdf', size: 30 })
    const hidden = await upload(s, { extra: { visibility: 'members-only' } })
    const get = (path: string, token?: string, headers: Record<string, string> = {}) =>
      raw('GET', path, { token, headers })

    const asMember = await get(`/api/media/${photo.attachment.id}`, s.viewer)
    expect(asMember.status).toBe(200)
    expect(asMember.headers.get('cache-control')).toBe(PHOTO_CACHE)
    expect(asMember.headers.get('content-type')).toBe('image/webp')
    expect(asMember.headers.get('etag')).toBeTruthy()
    expect(new Uint8Array(await asMember.arrayBuffer())).toEqual(bytesOf(100))

    const thumb = await get(`/api/media/${photo.attachment.id}/thumb?s=${s.shareToken}`)
    expect(thumb.status).toBe(200)
    expect(new Uint8Array(await thumb.arrayBuffer())).toEqual(bytesOf(10, 1))
    expect((await get(`/api/media/${photo.attachment.id}?s=${s.shareToken}`)).status).toBe(200)

    // ETag revalidation
    const etag = asMember.headers.get('etag') ?? ''
    const again = await get(`/api/media/${photo.attachment.id}`, s.viewer, {
      'if-none-match': etag,
    })
    expect(again.status).toBe(304)
    expect(again.headers.get('cache-control')).toBe(PHOTO_CACHE)
    expect(
      (await get(`/api/media/${photo.attachment.id}`, s.viewer, { 'if-none-match': '"other"' }))
        .status,
    ).toBe(200)

    const docRes = await get(`/api/media/${doc.attachment.id}`, s.viewer)
    expect(docRes.status).toBe(200)
    expect(docRes.headers.get('cache-control')).toBe(DOCUMENT_CACHE)
    expect(docRes.headers.get('content-type')).toBe('application/pdf')
    expect((await get(`/api/media/${doc.attachment.id}?s=${s.shareToken}`)).status).toBe(403)
    expect((await get(`/api/media/${doc.attachment.id}/thumb`, s.viewer)).status).toBe(404)
    expect((await get(`/api/media/${hidden.attachment.id}?s=${s.shareToken}`)).status).toBe(403)

    // No token, bad tokens, another trip's token
    expect((await get(`/api/media/${photo.attachment.id}`)).status).toBe(401)
    expect((await get(`/api/media/${photo.attachment.id}`, 'x'.repeat(22))).status).toBe(401)
    expect((await get(`/api/media/${photo.attachment.id}?s=${'y'.repeat(22)}`)).status).toBe(401)
    const other = await setup()
    expect((await get(`/api/media/${photo.attachment.id}`, other.owner)).status).toBe(404)
    expect((await get(`/api/media/${photo.attachment.id}?s=${other.shareToken}`)).status).toBe(404)

    // Pending and deleted are 404
    const pending = await call<AttachmentSignResponse>(
      'POST',
      `${s.base}/attachments/sign`,
      s.editor,
      {
        kind: 'photo',
        mime: 'image/webp',
        bytes: 5,
      },
    )
    await put(pending.body.uploadUrl, s.editor, bytesOf(5), 'image/webp')
    expect((await get(`/api/media/${pending.body.attachmentId}`, s.viewer)).status).toBe(404)
    await call('DELETE', `${s.base}/attachments/${photo.attachment.id}`, s.editor)
    expect((await get(`/api/media/${photo.attachment.id}`, s.viewer)).status).toBe(404)

    // A revoked share stops working
    const shares = await call<{ shares: { id: string }[] }>('GET', `${s.base}/shares`, s.owner)
    await call('DELETE', `${s.base}/shares/${shares.body.shares[0].id}`, s.owner)
    expect((await get(`/api/media/${hidden.attachment.id}/thumb?s=${s.shareToken}`)).status).toBe(
      401,
    )
  })
})

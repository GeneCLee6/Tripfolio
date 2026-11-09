import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AttachmentResponse, AttachmentSignResponse } from '../../../shared/api/media.ts'
import { attachmentLimits } from '../../../shared/schema/attachment.ts'
import { DOCUMENT_CACHE } from '../../../worker/media.ts'
import { bytesOf, createHarness, restoreClock, setupTrip, type Harness } from './helpers.ts'

// e11-t04: upload limits (type, size) and document reads (members only, never cached, never via a
// share link). docs/PRD/e11-platform-security-ops.md 需求「安全」, CLAUDE.md rule 5.

let h: Harness
beforeEach(() => {
  h = createHarness()
})
afterEach(restoreClock)

const put = (
  url: string,
  token: string,
  body: Uint8Array,
  type: string,
  length = body.byteLength,
) =>
  h.raw('PUT', url, {
    token,
    body,
    headers: { 'content-type': type, 'content-length': String(length) },
  })

async function sign(s: Awaited<ReturnType<typeof setupTrip>>, body: object) {
  return h.call<AttachmentSignResponse>('POST', `${s.base}/attachments/sign`, {
    token: s.editor,
    body,
  })
}

describe('upload limits', () => {
  it('refuses SVG for every kind, at signing and at upload', async () => {
    const s = await setupTrip(h)
    for (const kind of ['photo', 'document', 'receipt'])
      expect((await sign(s, { kind, mime: 'image/svg+xml', bytes: 10 })).status).toBe(422)
    // A signed PDF cannot be uploaded as SVG
    const pdf = await sign(s, { kind: 'document', mime: 'application/pdf', bytes: 10 })
    expect(pdf.status).toBe(201)
    const svg = await put(pdf.body.uploadUrl, s.editor, bytesOf(10), 'image/svg+xml')
    expect(svg.status).toBe(415)
    expect(h.r2.objects.size).toBe(0)
  })

  it('refuses sizes over the limit at signing and an oversize Content-Length at upload', async () => {
    const s = await setupTrip(h)
    const tooBigPhoto = {
      kind: 'photo',
      mime: 'image/webp',
      bytes: attachmentLimits.photoBytes + 1,
    }
    expect((await sign(s, tooBigPhoto)).status).toBe(422)
    const tooBigDoc = {
      kind: 'document',
      mime: 'application/pdf',
      bytes: attachmentLimits.documentBytes + 1,
    }
    expect((await sign(s, tooBigDoc)).status).toBe(422)
    expect(attachmentLimits.documentBytes).toBe(20 * 1024 * 1024)

    const doc = await sign(s, { kind: 'document', mime: 'application/pdf', bytes: 10 })
    const declared = attachmentLimits.documentBytes + 1
    const oversize = await put(
      doc.body.uploadUrl,
      s.editor,
      bytesOf(10),
      'application/pdf',
      declared,
    )
    expect(oversize.status).toBe(413)
    expect(((await oversize.json()) as { error: { code: string } }).error.code).toBe('too_large')
    expect(h.r2.objects.size).toBe(0)
  })
})

describe('document reads', () => {
  it('are members only and no-store; a share token gets 403', async () => {
    const s = await setupTrip(h)
    for (const kind of ['document', 'receipt']) {
      const signed = await sign(s, { kind, mime: 'application/pdf', bytes: 12 })
      expect(signed.status).toBe(201)
      expect(
        (await put(signed.body.uploadUrl, s.editor, bytesOf(12), 'application/pdf')).status,
      ).toBe(200)
      const done = await h.call<AttachmentResponse>(
        'POST',
        `${s.base}/attachments/${signed.body.attachmentId}/complete`,
        { token: s.editor },
      )
      expect(done.body.attachment.visibility).toBe('members-only')
      const url = `/api/media/${signed.body.attachmentId}`

      const member = await h.raw('GET', url, { token: s.viewer })
      expect(member.status).toBe(200)
      expect(member.headers.get('cache-control')).toBe(DOCUMENT_CACHE)
      expect(member.headers.get('cache-control')).toContain('no-store')
      expect(member.headers.get('x-content-type-options')).toBe('nosniff')

      const shared = await h.raw('GET', `${url}?s=${s.shareToken}`)
      expect(shared.status).toBe(403)
      expect((await h.raw('GET', url)).status).toBe(401)
      // Documents cannot be made shareable afterwards either
      const patched = await h.call('PATCH', `${s.base}/attachments/${signed.body.attachmentId}`, {
        token: s.editor,
        body: { visibility: 'trip' },
      })
      expect(patched.status).toBe(422)
    }
  })
})

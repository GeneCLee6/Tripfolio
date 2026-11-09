import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashToken, isTokenShaped, timingSafeEqual } from '../../../worker/auth.ts'
import { createHarness, restoreClock, setupTrip, type Harness } from './helpers.ts'

// e11-t04 token spec (ARCHITECTURE.md §4.1): memberToken, inviteToken and shareToken are 128-bit
// base64url (22 characters), only their SHA-256 is stored, the hash is compared in constant time,
// and a malformed token is refused before any lookup.

const BASE64URL_128 = /^[A-Za-z0-9_-]{22}$/

let h: Harness
beforeEach(() => {
  h = createHarness()
})
afterEach(restoreClock)

/** Tables a token lookup reads; the limiter's own rateLimits writes are not lookups */
const lookups = () =>
  h.dbCalls.prepared.filter((sql) => !/rateLimits/.test(sql) && !/^\s*$/.test(sql))

describe('token format and storage', () => {
  it('issues 22-character base64url tokens (16 random bytes) for all three kinds', async () => {
    const s = await setupTrip(h)
    for (const token of [s.owner, s.editor, s.viewer, s.inviteToken, s.shareToken]) {
      expect(token).toMatch(BASE64URL_128)
      // 22 base64url characters carry 132 bits; the last one only uses its top 2 bits for 128
      // (the low 4 bits are zero padding), so it is one of A, Q, g, w
      expect('AQgw').toContain(token[21])
    }
    expect(new Set([s.owner, s.editor, s.viewer]).size).toBe(3)
  })

  it('stores only the SHA-256 hex of each token, never the token', async () => {
    const s = await setupTrip(h)
    const memberHashes = h.sqlite.prepare('SELECT tokenHash FROM memberTokens').all()
    const inviteHashes = h.sqlite.prepare('SELECT tokenHash FROM invites').all()
    const shareHashes = h.sqlite.prepare('SELECT tokenHash FROM shares').all()
    const all = [...memberHashes, ...inviteHashes, ...shareHashes].map((r) => String(r.tokenHash))
    for (const hash of all) expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(all).toContain(await hashToken(s.owner))
    expect(all).toContain(await hashToken(s.inviteToken))
    expect(all).toContain(await hashToken(s.shareToken))
    // No table holds a raw token anywhere
    const dump = JSON.stringify(
      ['trips', 'members', 'memberTokens', 'invites', 'shares'].flatMap((t) =>
        h.sqlite.prepare(`SELECT * FROM ${t}`).all(),
      ),
    )
    for (const token of [s.owner, s.editor, s.viewer, s.inviteToken, s.shareToken])
      expect(dump).not.toContain(token)
  })

  it('checks the shape and compares hashes in constant time', () => {
    expect(isTokenShaped('A'.repeat(22))).toBe(true)
    for (const bad of [
      '',
      'A'.repeat(21),
      'A'.repeat(23),
      `${'A'.repeat(21)}=`,
      `${'A'.repeat(21)}+`,
    ])
      expect(isTokenShaped(bad)).toBe(false)
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('malformed tokens short-circuit without a lookup', () => {
  const malformed = ['short', 'A'.repeat(23), `${'A'.repeat(21)}*`, '%00'.repeat(8)]

  it('member token → 401, no D1 at all', async () => {
    const s = await setupTrip(h)
    for (const token of malformed) {
      h.dbCalls.prepared.length = 0
      const read = await h.call('GET', s.base, { token })
      expect(read.status).toBe(401)
      const write = await h.call('PATCH', s.base, { token, body: { name: 'x' } })
      expect(write.status).toBe(401)
      expect(h.dbCalls.prepared).toEqual([])
    }
  })

  it('invite token → 404, share token → 404, media share token → 401; only the limiter runs', async () => {
    await setupTrip(h)
    for (const token of malformed) {
      const path = encodeURIComponent(token)
      h.dbCalls.prepared.length = 0
      expect((await h.call('GET', `/api/join/${path}`)).status).toBe(404)
      expect((await h.call('POST', `/api/join/${path}`, { body: { name: 'A' } })).status).toBe(404)
      expect((await h.call('GET', `/api/share/${path}`)).status).toBe(404)
      expect(lookups().every((sql) => !/invites|shares|memberTokens/.test(sql))).toBe(true)
    }
  })

  it('a well-shaped but unknown token is looked up and refused', async () => {
    const s = await setupTrip(h)
    h.dbCalls.prepared.length = 0
    expect((await h.call('GET', s.base, { token: 'A'.repeat(22) })).status).toBe(401)
    expect(lookups().some((sql) => /memberTokens/.test(sql))).toBe(true)
    expect((await h.call('GET', `/api/share/${'A'.repeat(22)}`)).status).toBe(404)
    expect((await h.call('GET', `/api/join/${'A'.repeat(22)}`)).status).toBe(404)
  })
})

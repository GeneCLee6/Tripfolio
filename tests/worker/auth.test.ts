import { describe, expect, it } from 'vitest'
import {
  bearerToken,
  bytesToBase64Url,
  generateToken,
  hashToken,
  isTokenShaped,
  roleAtLeast,
  timingSafeEqual,
} from '../../worker/auth.ts'

describe('tokens', () => {
  it('generates 128-bit base64url tokens', () => {
    const token = generateToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(isTokenShaped(token)).toBe(true)
    expect(generateToken()).not.toBe(token)
  })

  it('encodes bytes as unpadded base64url', () => {
    expect(bytesToBase64Url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-')
    const fixed = generateToken((b) => b.fill(0))
    expect(fixed).toBe('AAAAAAAAAAAAAAAAAAAAAA')
  })

  it('hashes with SHA-256 as hex', async () => {
    expect(await hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('compares in constant time, including length differences', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
    expect(timingSafeEqual('', '')).toBe(true)
  })

  it('reads Bearer tokens', () => {
    const r = (h?: string) =>
      new Request('https://x.test', h ? { headers: { authorization: h } } : undefined)
    expect(bearerToken(r('Bearer abc'))).toBe('abc')
    expect(bearerToken(r('bearer abc'))).toBe('abc')
    expect(bearerToken(r('Basic abc'))).toBeNull()
    expect(bearerToken(r())).toBeNull()
  })

  it('orders roles owner > editor > viewer', () => {
    expect(roleAtLeast('owner', 'editor')).toBe(true)
    expect(roleAtLeast('editor', 'editor')).toBe(true)
    expect(roleAtLeast('viewer', 'editor')).toBe(false)
    expect(roleAtLeast('editor', 'owner')).toBe(false)
  })
})

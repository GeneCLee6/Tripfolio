import { describe, expect, it } from 'vitest'
import { handleRequest } from '../../../worker/app.ts'
import type { Env } from '../../../worker/env.ts'
import {
  CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
  withSecurityHeaders,
} from '../../../worker/security/headers.ts'
import { createFakeD1 } from '../fake-d1.ts'

// e11-t04: security headers on every Worker response, the CSP on HTML (DEPLOY.md §12)

function env(): Env {
  const ASSETS = {
    fetch: async (input: Request) => {
      const path = new URL(input.url).pathname
      if (path.endsWith('.js'))
        return new Response('export {}', { headers: { 'content-type': 'text/javascript' } })
      // Asset responses have immutable headers in the Workers runtime
      const response = new Response('<!doctype html><html></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
      return response
    },
  } as unknown as Fetcher
  return { ASSETS, DB: createFakeD1().db, APP_VERSION: 'test' } as unknown as Env
}

const get = (path: string) => handleRequest(new Request(`https://x.test${path}`), env())

function expectBaseHeaders(response: Response) {
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  expect(response.headers.get('permissions-policy')).toBe(
    'camera=(self), geolocation=(self), microphone=()',
  )
  expect(response.headers.get('x-robots-tag')).toBe('noindex')
}

describe('security headers', () => {
  it('are on JSON API responses, without a CSP', async () => {
    for (const path of ['/api/health', '/api/nope', '/ws/x', '/api/share/bad']) {
      const response = await get(path)
      expect(response.headers.get('content-type')).toContain('application/json')
      expectBaseHeaders(response)
      expect(response.headers.has('content-security-policy')).toBe(false)
    }
  })

  it('are on HTML (app and share page) with the CSP', async () => {
    for (const path of ['/', '/trips/abc/map', '/s/AAAAAAAAAAAAAAAAAAAAAA']) {
      const response = await get(path)
      expectBaseHeaders(response)
      expect(response.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY)
    }
  })

  it('are on other static assets, without a CSP', async () => {
    const response = await get('/assets/app.js')
    expectBaseHeaders(response)
    expect(response.headers.has('content-security-policy')).toBe(false)
  })

  it('keep a CSP the handler set and the status, body and other headers', async () => {
    const inner = new Response('img', {
      status: 203,
      headers: {
        'content-type': 'text/html',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'private, no-store',
      },
    })
    const out = withSecurityHeaders(inner)
    expect(out.status).toBe(203)
    expect(await out.text()).toBe('img')
    expect(out.headers.get('cache-control')).toBe('private, no-store')
    expect(out.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(Object.keys(SECURITY_HEADERS).every((name) => out.headers.has(name))).toBe(true)
  })
})

describe('CSP', () => {
  const directives = new Map(
    CONTENT_SECURITY_POLICY.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/)
      return [name, values] as const
    }),
  )

  it('allows no inline or third-party script', () => {
    expect(directives.get('script-src')).toEqual(["'self'"])
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval')
    expect(directives.get('default-src')).toEqual(["'self'"])
  })

  it('allows what the app loads: styled-components, fonts, OpenFreeMap, MapLibre workers', () => {
    expect(directives.get('style-src')).toEqual([
      "'self'",
      "'unsafe-inline'",
      'https://fonts.googleapis.com',
    ])
    expect(directives.get('font-src')).toContain('https://fonts.gstatic.com')
    expect(directives.get('connect-src')).toContain('https://tiles.openfreemap.org')
    expect(directives.get('worker-src')).toEqual(["'self'", 'blob:'])
    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:'])
  })

  it('cannot be framed, rebased or post forms elsewhere', () => {
    expect(directives.get('frame-ancestors')).toEqual(["'none'"])
    expect(directives.get('base-uri')).toEqual(["'self'"])
    expect(directives.get('form-action')).toEqual(["'self'"])
  })
})

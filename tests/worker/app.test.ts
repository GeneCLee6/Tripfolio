import { describe, expect, it } from 'vitest'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'

// Only ASSETS is used by the router; the other bindings are never touched here
function fakeEnv(version?: string): { env: Env; assetPaths: string[] } {
  const assetPaths: string[] = []
  const ASSETS = {
    fetch: async (input: Request) => {
      assetPaths.push(new URL(input.url).pathname)
      return new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
    },
  } as unknown as Fetcher
  return { env: { ASSETS, APP_VERSION: version } as unknown as Env, assetPaths }
}

describe('handleRequest', () => {
  it('answers /api/health with the deployed version', async () => {
    const { env } = fakeEnv('abc123')
    const response = await handleRequest(new Request('https://x.test/api/health'), env)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: true, version: 'abc123' })
  })

  it('reports version local when none is set', async () => {
    const { env } = fakeEnv()
    const response = await handleRequest(new Request('https://x.test/api/health'), env)
    expect(await response.json()).toEqual({ ok: true, version: 'local' })
  })

  it('answers other /api paths with a JSON 404', async () => {
    const { env, assetPaths } = fakeEnv()
    const response = await handleRequest(new Request('https://x.test/api/nope'), env)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } })
    expect(assetPaths).toEqual([])
  })

  it('serves the share entry for /s/<token>, marked noindex', async () => {
    const { env, assetPaths } = fakeEnv()
    const response = await handleRequest(new Request('https://x.test/s/abc'), env)
    expect(assetPaths).toEqual(['/share'])
    expect(response.headers.get('x-robots-tag')).toBe('noindex')
  })

  it('hands everything else to the static assets', async () => {
    const { env, assetPaths } = fakeEnv()
    await handleRequest(new Request('https://x.test/trips/1'), env)
    expect(assetPaths).toEqual(['/trips/1'])
  })
})

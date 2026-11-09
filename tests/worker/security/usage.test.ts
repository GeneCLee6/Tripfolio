import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createTrip, restoreDeps, type Harness } from '../proxy/helpers.ts'

// e11-t04: every external call is counted in apiUsage. geocode/route/fx count inside
// worker/proxy/* (their own tests); the link preview is counted by worker/security/usage.ts.

let h: Harness
beforeEach(() => {
  h = createHarness()
})
afterEach(restoreDeps)

const ogCount = (tripId: string) =>
  Number(
    h.sqlite
      .prepare(
        "SELECT COALESCE(SUM(count), 0) AS n FROM apiUsage WHERE provider = 'og' AND tripId = ?",
      )
      .all(tripId)[0]?.n,
  )

describe('apiUsage for og', () => {
  it('counts previews that reached the network, not refused ones', async () => {
    const { tripId, owner } = await createTrip(h)
    h.on(
      'ok.example.com',
      () =>
        new Response('<html><head><title>Fergburger</title></head></html>', {
          headers: { 'content-type': 'text/html' },
        }),
    )
    h.on('down.example.com', () => new Response('nope', { status: 500 }))
    const og = (url: string) =>
      h.call('POST', `/api/trips/${tripId}/og`, { token: owner, body: { url } })

    expect((await og('https://ok.example.com/')).status).toBe(200)
    expect(ogCount(tripId)).toBe(1)
    expect((await og('https://down.example.com/')).status).toBe(502)
    expect(ogCount(tripId)).toBe(2)
    // Refused before any fetch: a local host, a bad body, no token
    expect((await og('http://localhost/')).status).toBe(422)
    expect((await og('not a url')).status).toBe(422)
    expect(
      (
        await h.call('POST', `/api/trips/${tripId}/og`, {
          body: { url: 'https://ok.example.com/' },
        })
      ).status,
    ).toBe(401)
    expect(ogCount(tripId)).toBe(2)
  })
})

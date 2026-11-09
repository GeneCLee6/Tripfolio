// Shared setup for the proxy tests: a fake D1 with the proxy migration, a trip with an owner and a
// viewer, a scripted fetch, and a controllable clock.

import { expect } from 'vitest'
import migration0003 from '../../../migrations/0003_proxy.sql?raw'
import type {
  CreateInviteResponse,
  CreateTripResponse,
  MemberTokenResponse,
} from '../../../shared/api/types.ts'
import { handleRequest } from '../../../worker/app.ts'
import type { Env } from '../../../worker/env.ts'
import { proxyDeps, type ProxyDeps } from '../../../worker/proxy/deps.ts'
import { createFakeD1 } from '../fake-d1.ts'

export interface FetchCall {
  url: string
  init?: RequestInit
}

type Responder = (call: FetchCall) => Response | Promise<Response>

export interface Harness {
  env: Env
  sqlite: { prepare(sql: string): { all(...p: unknown[]): Record<string, unknown>[] } }
  calls: FetchCall[]
  /** Answers fetches whose URL contains the pattern (first match wins) */
  on(pattern: string, responder: Responder): void
  clock: { now: number }
  call<T = Record<string, unknown>>(
    method: string,
    path: string,
    opts?: { token?: string; body?: unknown },
  ): Promise<{ status: number; body: T; headers: Headers }>
}

const original: ProxyDeps = { ...proxyDeps }

export function restoreDeps(): void {
  Object.assign(proxyDeps, original)
}

export function createHarness(extraEnv: Partial<Env> = {}): Harness {
  const { db, sqlite } = createFakeD1()
  sqlite.exec(migration0003)
  const env = { DB: db, APP_VERSION: 'test', ...extraEnv } as unknown as Env
  const calls: FetchCall[] = []
  const responders: [string, Responder][] = []
  const clock = { now: Date.parse('2026-11-09T10:00:00Z') }
  Object.assign(proxyDeps, {
    fetch: async (url: string, init?: RequestInit) => {
      const c = { url, init }
      calls.push(c)
      const hit = responders.find(([p]) => url.includes(p))
      if (!hit) throw new Error(`unexpected fetch ${url}`)
      return hit[1](c)
    },
    now: () => clock.now,
    sleep: async (ms: number) => {
      clock.now += ms
    },
  } satisfies ProxyDeps)
  return {
    env,
    sqlite: sqlite as unknown as Harness['sqlite'],
    calls,
    clock,
    on: (pattern, responder) => responders.push([pattern, responder]),
    async call(method, path, { token, body } = {}) {
      const headers: Record<string, string> = {}
      if (token) headers.authorization = `Bearer ${token}`
      if (body !== undefined) headers['content-type'] = 'application/json'
      const response = await handleRequest(
        new Request(`https://trip.test${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        env,
      )
      expect(response.headers.get('cache-control')).toBe('no-store')
      return { status: response.status, body: await response.json(), headers: response.headers }
    },
  }
}

export async function createTrip(h: Harness) {
  const res = await h.call<CreateTripResponse>('POST', '/api/trips', {
    body: {
      name: 'NZ South Island',
      destination: 'New Zealand',
      startDate: '2026-12-20',
      endDate: '2026-12-22',
      tz: 'Pacific/Auckland',
      localCurrencies: ['NZD'],
      style: 'campervan',
      owner: { name: 'Gene', color: 'teal' },
    },
  })
  expect(res.status).toBe(201)
  const invite = await h.call<CreateInviteResponse>(
    'POST',
    `/api/trips/${res.body.trip.id}/invites`,
    {
      token: res.body.memberToken,
    },
  )
  const joined = await h.call<MemberTokenResponse>('POST', `/api/join/${invite.body.inviteToken}`, {
    body: { name: 'Amy', color: 'rose' },
  })
  expect(joined.status).toBe(201)
  return { tripId: res.body.trip.id, owner: res.body.memberToken, member: joined.body.memberToken }
}

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

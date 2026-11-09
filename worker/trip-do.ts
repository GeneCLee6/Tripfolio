import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env.ts'

/**
 * One object per trip (ARCHITECTURE.md §1): WebSocket, patch broadcast and rev, with D1 staying the
 * source of truth. A placeholder in the skeleton (e11-t01) so that the binding and the SQLite-backed
 * migration exist from the first deploy; it only answers a ping.
 */
export class TripDO extends DurableObject<Env> {
  /** RPC: `env.TRIP.get(id).ping()` */
  async ping(): Promise<'pong'> {
    return 'pong'
  }

  async fetch(): Promise<Response> {
    return Response.json({ pong: true }, { headers: { 'cache-control': 'no-store' } })
  }
}

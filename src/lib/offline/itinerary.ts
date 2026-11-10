import { ApiError, request, type StopCreateBody } from '../api.ts'
import type {
  DayPatch,
  LegOverrideInput,
  StopMove,
  StopPatch,
} from '../../../shared/schema/index.ts'
import { getToken } from '../tokens.ts'
import { newPendingId, type PendingMutation } from './queue.ts'
import { isNetworkError, offlineQueue, replayNow } from './sync.ts'
import { isOnline, reportNetworkFailure } from './useOnline.ts'

// Itinerary writes that survive a dead connection (e2-t08b). Every write of the itinerary page goes
// through writeItinerary(): online it is the plain REST call; offline, after a network error, or
// while earlier writes of the same trip still wait, it joins the offline queue (src/lib/offline/
// queue.ts) and resolves at once with `{ queued: true }`, the page keeping its optimistic state.
// A stop created offline gets a provisional id (`pending-…`) that later writes may use; the queue
// swaps in the server's id once the create went through.

export type ItineraryOp =
  | { kind: 'stop.create'; body: StopCreateBody }
  | { kind: 'stop.patch'; stopId: string; body: StopPatch }
  | { kind: 'stop.delete'; stopId: string }
  | { kind: 'stop.move'; stopId: string; body: StopMove }
  | { kind: 'leg.put'; fromStopId: string; toStopId: string; body: LegOverrideInput }
  | { kind: 'leg.delete'; fromStopId: string; toStopId: string }
  | { kind: 'day.patch'; dayId: string; body: DayPatch }

export type WriteResult<T> =
  | { queued: false; response: T }
  /** Waiting in the offline queue; `tempId` is the provisional id of a created stop */
  | { queued: true; tempId?: string }

const enc = encodeURIComponent

/** The REST call an op stands for */
export function opRequest(
  tripId: string,
  op: ItineraryOp,
): { method: PendingMutation['method']; url: string; body?: unknown } {
  const base = `/api/trips/${enc(tripId)}`
  switch (op.kind) {
    case 'stop.create':
      return { method: 'POST', url: `${base}/stops`, body: op.body }
    case 'stop.patch':
      return { method: 'PATCH', url: `${base}/stops/${enc(op.stopId)}`, body: op.body }
    case 'stop.delete':
      return { method: 'DELETE', url: `${base}/stops/${enc(op.stopId)}` }
    case 'stop.move':
      return { method: 'POST', url: `${base}/stops/${enc(op.stopId)}/move`, body: op.body }
    case 'leg.put':
      return {
        method: 'PUT',
        url: `${base}/legs/${enc(op.fromStopId)}/${enc(op.toStopId)}`,
        body: op.body,
      }
    case 'leg.delete':
      return { method: 'DELETE', url: `${base}/legs/${enc(op.fromStopId)}/${enc(op.toStopId)}` }
    case 'day.patch':
      return { method: 'PATCH', url: `${base}/days/${enc(op.dayId)}`, body: op.body }
  }
}

/** The op with provisional ids that were already sent replaced by the server's ids */
export function resolveOp(op: ItineraryOp, resolve: (id: string) => string): ItineraryOp {
  return JSON.parse(
    JSON.stringify(op).replace(/pending-[0-9a-f-]{36}/g, (id) => resolve(id)),
  ) as ItineraryOp
}

/** Provisional ids the op still needs that the server has not assigned yet */
export const unresolvedIds = (op: ItineraryOp): string[] =>
  JSON.stringify(op).match(/pending-[0-9a-f-]{36}/g) ?? []

/** Itinerary mutations of a trip still waiting, oldest first */
export function queuedItineraryOps(
  tripId: string,
  mutations: readonly PendingMutation[] = offlineQueue.list(),
): { op: ItineraryOp; tempId?: string; failed: boolean }[] {
  return mutations
    .filter((item) => item.entity.type === 'itinerary' && item.entity.tripId === tripId)
    .filter((item) => item.entity.op !== undefined)
    .map((item) => ({
      op: item.entity.op as ItineraryOp,
      tempId: item.entity.tempId,
      failed: Boolean(item.failure),
    }))
}

const hasQueued = (tripId: string) =>
  offlineQueue.list().some((item) => item.entity.tripId === tripId)

/**
 * Sends an itinerary write, or queues it (see above). Errors other than the network's (a 4xx,
 * a 5xx) are thrown as before, so the page can put its state back and say so.
 */
export async function writeItinerary<T>(
  tripId: string,
  input: ItineraryOp,
  label?: string,
): Promise<WriteResult<T>> {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  const op = resolveOp(input, offlineQueue.resolve)
  const mustQueue = !isOnline() || hasQueued(tripId) || unresolvedIds(op).length > 0
  if (!mustQueue) {
    const { method, url, body } = opRequest(tripId, op)
    try {
      return { queued: false, response: await request<T>(method, url, { token, body }) }
    } catch (error) {
      if (!isNetworkError(error)) throw error
      reportNetworkFailure()
    }
  }
  const tempId = op.kind === 'stop.create' ? newPendingId() : undefined
  const { method, url, body } = opRequest(tripId, op)
  await offlineQueue.enqueue({
    method,
    url,
    body,
    token,
    entity: { type: 'itinerary', tripId, tempId, kind: op.kind, label, op },
  })
  if (isOnline()) void replayNow()
  return tempId ? { queued: true, tempId } : { queued: true }
}

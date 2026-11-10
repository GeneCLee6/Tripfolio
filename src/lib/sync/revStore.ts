// The last trip rev this browser has seen, per trip (e2-t08a): what a reconnecting TripSocket sends
// as `sinceRev`. Pages that fetch a trip's data should record the `rev` of the response here too
// (e2-t08b), so that events between the fetch and the socket's hello are not lost.
//
// Kept in localStorage when it works (private mode or tests: memory only for this page's life).

const PREFIX = 'tripfolio.rev.'

const memory = new Map<string, number>()

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The last rev seen for this trip, or null */
export function getRev(tripId: string): number | null {
  const remembered = memory.get(tripId)
  if (remembered !== undefined) return remembered
  try {
    const raw = storage()?.getItem(PREFIX + tripId)
    const rev = raw == null ? NaN : Number(raw)
    return Number.isInteger(rev) && rev >= 0 ? rev : null
  } catch {
    return null
  }
}

/** Records a rev; only ever moves forward. Returns the rev now remembered */
export function noteRev(tripId: string, rev: number): number {
  const current = getRev(tripId)
  if (current !== null && current >= rev) return current
  memory.set(tripId, rev)
  try {
    storage()?.setItem(PREFIX + tripId, String(rev))
  } catch {
    // Memory only
  }
  return rev
}

/** Forgets a trip (it was left or deleted), or every trip */
export function forgetRev(tripId?: string): void {
  const s = storage()
  if (tripId === undefined) {
    for (const id of memory.keys()) forgetRev(id)
    return
  }
  memory.delete(tripId)
  try {
    s?.removeItem(PREFIX + tripId)
  } catch {
    // Nothing stored
  }
}

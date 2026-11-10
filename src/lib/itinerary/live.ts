import type { TripEvent } from '../../../shared/protocol.ts'

// What the itinerary page refetches when another member changes the trip (e2-t08b). Events only
// say what changed (entity, id); the page reloads the smallest thing that covers it. The API has
// no per-day endpoint, so any change to stops, days, leg overrides, lodgings, bookings (they create
// stops) or picks (scheduled ones are stops) reloads GET /days; places reload GET /places; picks,
// places and stops also refresh the pocket list. Own events are skipped: this tab already shows
// them. Bursts (a drag renumbering, a booking creating several stops) are folded into one refetch
// after a short quiet period.

export interface RefetchPlan {
  days: boolean
  places: boolean
  pocket: boolean
}

export const NOTHING: RefetchPlan = { days: false, places: false, pocket: false }
export const EVERYTHING: RefetchPlan = { days: true, places: true, pocket: true }

/** Quiet period before a refetch */
export const REFETCH_DEBOUNCE_MS = 300

const DAYS_ENTITIES = new Set(['stop', 'day', 'legOverride', 'lodging', 'booking', 'wishlist'])
const POCKET_ENTITIES = new Set(['stop', 'wishlist', 'place'])

/** What one event asks the itinerary to refetch; nothing for own events and other entities */
export function planFor(event: TripEvent, me: string | null): RefetchPlan {
  if (me !== null && event.byMemberId === me) return NOTHING
  return {
    days: DAYS_ENTITIES.has(event.entity),
    places: event.entity === 'place',
    pocket: POCKET_ENTITIES.has(event.entity),
  }
}

export const mergePlans = (a: RefetchPlan, b: RefetchPlan): RefetchPlan => ({
  days: a.days || b.days,
  places: a.places || b.places,
  pocket: a.pocket || b.pocket,
})

const isEmpty = (plan: RefetchPlan) => !plan.days && !plan.places && !plan.pocket

export interface RefetchScheduler {
  /** Asks for a refetch; runs `delayMs` after the last request, with everything asked since */
  request(plan: RefetchPlan): void
  /** Runs what is waiting now */
  flush(): void
  cancel(): void
}

export function createRefetchScheduler(
  run: (plan: RefetchPlan) => void,
  {
    delayMs = REFETCH_DEBOUNCE_MS,
    setTimer = (fn: () => void, ms: number): unknown => globalThis.setTimeout(fn, ms),
    clearTimer = (handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  }: {
    delayMs?: number
    setTimer?: (fn: () => void, ms: number) => unknown
    clearTimer?: (handle: unknown) => void
  } = {},
): RefetchScheduler {
  let waiting: RefetchPlan = NOTHING
  let timer: unknown = null
  const flush = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
    const plan = waiting
    waiting = NOTHING
    if (!isEmpty(plan)) run(plan)
  }
  return {
    request(plan) {
      if (isEmpty(plan)) return
      waiting = mergePlans(waiting, plan)
      if (timer !== null) clearTimer(timer)
      timer = setTimer(flush, delayMs)
    },
    flush,
    cancel() {
      if (timer !== null) clearTimer(timer)
      timer = null
      waiting = NOTHING
    },
  }
}

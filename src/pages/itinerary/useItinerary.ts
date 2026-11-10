import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RouteRequest } from '../../../shared/api/geo.ts'
import type {
  Day,
  DayWithStops,
  LegOverride,
  Place,
  Stop,
  Trip,
} from '../../../shared/api/types.ts'
import type { DayPatch } from '../../../shared/schema/index.ts'
import { useToast } from '../../components/index.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { itineraryApi, wishlistApi } from '../../lib/api.ts'
import { errorMessageKey } from '../../lib/errors.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import {
  assembleDay,
  overridesByKey,
  routeBatches,
  routeKey,
  type CachedRoute,
  type DayLegs,
  type OverrideMode,
} from '../../lib/itinerary/legs.ts'
import { applyBackupChanges, type BackupChange } from '../../lib/itinerary/backup.ts'
import {
  createRefetchScheduler,
  EVERYTHING,
  planFor,
  type RefetchPlan,
  type RefetchScheduler,
} from '../../lib/itinerary/live.ts'
import { applyMove, applyMoveResult, type MoveTarget } from '../../lib/itinerary/order.ts'
import { applyPending } from '../../lib/itinerary/pending.ts'
import { withNewStop, type PocketRequest } from '../../lib/itinerary/pocket.ts'
import {
  queuedItineraryOps,
  writeItinerary,
  type ItineraryOp,
} from '../../lib/offline/itinerary.ts'
import { offlineQueue, onMutationSent } from '../../lib/offline/sync.ts'
import { noteRev } from '../../lib/sync/revStore.ts'
import { useTripEvents } from '../../lib/sync/trip-sync-context.ts'
import type { StopValues } from './StopEditor.tsx'

// The itinerary page's data: days with stops, leg overrides and the trip's places, loaded once and
// then updated optimistically by every write (a failed write puts the old state back and says so).
// Routed legs are fetched in batches as they appear; until then, and for modes that are never
// routed, the legs are estimates.
//
// Live (e2-t08b): other members' changes arrive as events on the trip's socket (TripSyncContext)
// and reload GET /days or /places after a 300 ms quiet period (src/lib/itinerary/live.ts); every
// fetch records its rev for the socket's catch-up. Writes go through writeItinerary(): offline they
// wait in the offline queue, and what still waits is laid over every fetch (applyPending), so a
// refetch or a reload never hides an edit that was not sent yet.

export interface ItineraryData {
  days: DayWithStops[]
  legs: LegOverride[]
  places: Place[]
}

let tempCounter = 0
const tempId = () => `tmp-${Date.now().toString(36)}-${++tempCounter}`
export const isTempId = (id: string) => id.startsWith('tmp-')

/** The latest stops, for an editor that stays open in the detail pane (outside the page's tree) */
export interface StopSource {
  subscribe(listener: () => void): () => void
  /** The stop as the page has it now; null once it is gone; undefined before the data loaded */
  get(stopId: string): Stop | null | undefined
}

export interface ItineraryOptions {
  /** Another member changed picks, places or stops: the pocket list may be out of date */
  onPocketStale?: () => void
}

type Changed = Partial<StopValues>
type MoveAnswer = { stop: Stop; renumbered: { id: string; order: number }[] }

export function useItinerary(trip: Trip, options: ItineraryOptions = {}) {
  const t = useT()
  const toast = useToast()
  const { me } = useTripContext()
  const key = `itinerary:${trip.id}:${trip.startDate}:${trip.endDate}`
  const withPending = useCallback(
    <T extends Pick<ItineraryData, 'days' | 'legs'>>(view: T): T =>
      applyPending(view, trip.id, queuedItineraryOps(trip.id)),
    [trip.id],
  )
  const resource = useResource<ItineraryData>(key, async (signal) => {
    const [days, places] = await Promise.all([
      itineraryApi.listDays(trip.id, signal),
      itineraryApi.listPlaces(trip.id, signal),
    ])
    noteRev(trip.id, days.rev)
    noteRev(trip.id, places.rev)
    return withPending({ days: days.days, legs: days.legs, places: places.places })
  })
  const { set } = resource
  const data = resource.status === 'ready' ? resource.data : null
  const latest = useRef<ItineraryData | null>(data)
  const stopListeners = useRef(new Set<() => void>())
  useLayoutEffect(() => {
    latest.current = data
    for (const listener of [...stopListeners.current]) listener()
  }, [data])

  const stopSource = useMemo<StopSource>(
    () => ({
      subscribe(listener) {
        stopListeners.current.add(listener)
        return () => {
          stopListeners.current.delete(listener)
        }
      },
      get(stopId) {
        const current = latest.current
        if (!current) return undefined
        // A stop created offline keeps its provisional id until the next fetch
        const ids = new Set([stopId, offlineQueue.resolve(stopId)])
        for (const day of current.days) {
          const found = day.stops.find((stop) => ids.has(stop.id))
          if (found) return found
        }
        return null
      },
    }),
    [],
  )

  const update = useCallback(
    (change: (current: ItineraryData) => ItineraryData) => {
      if (latest.current) {
        latest.current = change(latest.current)
        set(latest.current)
      }
    },
    [set],
  )

  const fail = useCallback(
    (error: unknown, snapshot: ItineraryData | null) => {
      if (snapshot) {
        latest.current = snapshot
        set(snapshot)
      }
      const { key: messageKey, code } = errorMessageKey(error)
      toast.show(t('itinerary.error.save', { reason: t(messageKey, { code }) }), { tone: 'danger' })
    },
    [set, t, toast],
  )

  const write = useCallback(
    <T>(op: ItineraryOp, label?: string) => writeItinerary<T>(trip.id, op, label),
    [trip.id],
  )

  const replaceStop = (days: DayWithStops[], id: string, stop: Stop) =>
    days.map((day) => ({ ...day, stops: day.stops.map((s) => (s.id === id ? stop : s)) }))

  /**
   * Saves the editor: an existing stop sends only `changed` (the fields the person changed, so a
   * field someone else changed meanwhile is not overwritten); a new stop sends everything.
   */
  const saveStop = useCallback(
    async (dayId: string, stopId: string | null, values: StopValues, changed?: Changed) => {
      const snapshot = latest.current
      if (!snapshot) return
      if (stopId) {
        const patch: Changed = changed ?? values
        if (Object.keys(patch).length === 0) return
        update((current) => ({
          ...current,
          days: current.days.map((day) => ({
            ...day,
            stops: day.stops.map((s) => (s.id === stopId ? { ...s, ...patch } : s)),
          })),
        }))
        try {
          const result = await write<{ stop: Stop }>(
            { kind: 'stop.patch', stopId, body: patch },
            values.title || undefined,
          )
          if (!result.queued) {
            const { stop } = result.response
            update((current) => ({ ...current, days: replaceStop(current.days, stopId, stop) }))
          }
        } catch (error) {
          fail(error, snapshot)
        }
        return
      }
      const id = tempId()
      const now = new Date().toISOString()
      const draft: Stop = {
        id,
        tripId: trip.id,
        dayId,
        order: Number.MAX_SAFE_INTEGER,
        wishlistItemId: null,
        bookingId: null,
        rev: 0,
        updatedAt: now,
        ...values,
      }
      update((current) => ({
        ...current,
        days: current.days.map((day) =>
          day.id === dayId ? { ...day, stops: [...day.stops, draft] } : day,
        ),
      }))
      try {
        const result = await write<{ stop: Stop }>(
          { kind: 'stop.create', body: { dayId, ...values } },
          values.title || undefined,
        )
        const stop = result.queued ? { ...draft, id: result.tempId ?? id } : result.response.stop
        update((current) => ({ ...current, days: replaceStop(current.days, id, stop) }))
      } catch (error) {
        fail(error, snapshot)
      }
    },
    [trip.id, update, fail, write],
  )

  const deleteStop = useCallback(
    async (stopId: string, name: string) => {
      const snapshot = latest.current
      update((current) => ({
        ...current,
        days: current.days.map((day) => ({
          ...day,
          stops: day.stops.filter((s) => s.id !== stopId),
        })),
        legs: current.legs.filter((leg) => leg.fromStopId !== stopId && leg.toStopId !== stopId),
      }))
      try {
        await write({ kind: 'stop.delete', stopId }, name)
        toast.show(t('itinerary.deleted', { name }))
        return true
      } catch (error) {
        fail(error, snapshot)
        return false
      }
    },
    [update, fail, toast, t, write],
  )

  const moveStop = useCallback(
    async (stopId: string, target: MoveTarget) => {
      const snapshot = latest.current
      update((current) => ({ ...current, days: applyMove(current.days, stopId, target) }))
      try {
        const result = await write<MoveAnswer>({ kind: 'stop.move', stopId, body: target })
        if (!result.queued) {
          const { stop, renumbered } = result.response
          update((current) => ({
            ...current,
            days: applyMoveResult(current.days, stop, renumbered),
          }))
        }
        return true
      } catch (error) {
        fail(error, snapshot)
        return false
      }
    },
    [update, fail, write],
  )

  /**
   * Into or out of the rainy-day group (e2-t07). A drag between the lists may also move the stop:
   * the move goes first, then the flag (both optimistic, both put back when one fails).
   */
  const placeStop = useCallback(
    async (stopId: string, target: MoveTarget | null, isBackup: boolean) => {
      const snapshot = latest.current
      update((current) => {
        const moved = target ? applyMove(current.days, stopId, target) : current.days
        return { ...current, days: applyBackupChanges(moved, [{ stopId, isBackup }]) }
      })
      try {
        if (target) {
          const moved = await write<MoveAnswer>({ kind: 'stop.move', stopId, body: target })
          if (!moved.queued) {
            const { stop, renumbered } = moved.response
            update((current) => ({
              ...current,
              days: applyMoveResult(current.days, { ...stop, isBackup }, renumbered),
            }))
          }
        }
        const patched = await write<{ stop: Stop }>({
          kind: 'stop.patch',
          stopId,
          body: { isBackup },
        })
        if (!patched.queued) {
          const { stop } = patched.response
          update((current) => ({ ...current, days: replaceStop(current.days, stopId, stop) }))
        }
        return true
      } catch (error) {
        fail(error, snapshot)
        return false
      }
    },
    [update, fail, write],
  )

  /** 「全部換上」／「只加入」 and the menu's 移到備案／移回主行程: one PATCH per changed stop */
  const setBackup = useCallback(
    async (changes: readonly BackupChange[]) => {
      if (changes.length === 0) return true
      const snapshot = latest.current
      update((current) => ({ ...current, days: applyBackupChanges(current.days, changes) }))
      try {
        // One after the other: offline they join the queue in this order
        const saved: Stop[] = []
        for (const change of changes) {
          const result = await write<{ stop: Stop }>({
            kind: 'stop.patch',
            stopId: change.stopId,
            body: { isBackup: change.isBackup },
          })
          if (!result.queued) saved.push(result.response.stop)
        }
        update((current) => ({
          ...current,
          days: saved.reduce((days, stop) => replaceStop(days, stop.id, stop), current.days),
        }))
        return true
      } catch (error) {
        fail(error, snapshot)
        return false
      }
    },
    [update, fail, write],
  )

  /** Days and leg overrides again, without the loading state (after the server placed a stop) */
  const refreshDays = useCallback(async () => {
    try {
      const response = await itineraryApi.listDays(trip.id)
      noteRev(trip.id, response.rev)
      const { days, legs } = withPending({ days: response.days, legs: response.legs })
      update((current) => ({ ...current, days, legs }))
    } catch {
      // The optimistic state stays; the next load corrects it
    }
  }, [trip.id, update, withPending])

  /** The trip's places again (another member added or changed one) */
  const refreshPlaces = useCallback(async () => {
    try {
      const response = await itineraryApi.listPlaces(trip.id)
      noteRev(trip.id, response.rev)
      update((current) => ({ ...current, places: response.places }))
    } catch {
      // Keep what is shown
    }
  }, [trip.id, update])

  // ---- live sync ----
  const onPocketStale = useRef(options.onPocketStale)
  const refetch = useRef<(plan: RefetchPlan) => void>(() => {})
  useLayoutEffect(() => {
    onPocketStale.current = options.onPocketStale
    refetch.current = (plan) => {
      if (plan.days) void refreshDays()
      if (plan.places) void refreshPlaces()
      if (plan.pocket) onPocketStale.current?.()
    }
  })
  const scheduler = useRef<RefetchScheduler | null>(null)
  useEffect(() => {
    const created = createRefetchScheduler((plan) => refetch.current(plan))
    scheduler.current = created
    return () => {
      created.cancel()
      scheduler.current = null
    }
  }, [])

  useTripEvents((event, memberId) => {
    if (event.type === 'resync') {
      scheduler.current?.request(EVERYTHING)
      scheduler.current?.flush()
    } else if (event.type === 'event') {
      scheduler.current?.request(planFor(event.event, memberId ?? me.id))
    }
  })

  // A queued write reached the server: its echo is skipped like any own event, so fetch here
  // (provisional ids become real ones, what still waits is laid over again)
  useEffect(
    () =>
      onMutationSent((mutation) => {
        if (mutation.entity.type === 'itinerary' && mutation.entity.tripId === trip.id) {
          scheduler.current?.request({ days: true, places: false, pocket: false })
        }
      }),
    [trip.id],
  )

  /**
   * A pocket-list entry into a day (e2-t07): an item through /schedule (linked both ways), a place
   * through POST /stops. Resolves to the new stop, or null when the call failed (already said).
   * Online only: the pocket list itself comes from the server.
   */
  const addFromPocket = useCallback(
    async (pocket: PocketRequest): Promise<Stop | null> => {
      try {
        let stop: Stop
        if (pocket.kind === 'schedule') {
          stop = (await wishlistApi.schedule(trip.id, pocket.itemId, pocket.body)).stop
          if (pocket.isBackup) {
            stop = (await itineraryApi.patchStop(trip.id, stop.id, { isBackup: true })).stop
          }
        } else {
          stop = (await itineraryApi.createStop(trip.id, pocket.body)).stop
        }
        update((current) => ({ ...current, days: withNewStop(current.days, stop) }))
        void refreshDays()
        return stop
      } catch (error) {
        fail(error, null)
        return null
      }
    },
    [trip.id, update, fail, refreshDays],
  )

  const patchDay = useCallback(
    async (dayId: string, patch: DayPatch) => {
      const snapshot = latest.current
      update((current) => ({
        ...current,
        days: current.days.map((day) => (day.id === dayId ? { ...day, ...patch } : day)),
      }))
      try {
        const result = await write<{ day: Day }>({ kind: 'day.patch', dayId, body: patch })
        if (!result.queued) {
          const { day } = result.response
          update((current) => ({
            ...current,
            days: current.days.map((d) => (d.id === dayId ? { ...d, ...day, stops: d.stops } : d)),
          }))
        }
      } catch (error) {
        if (snapshot) {
          latest.current = snapshot
          set(snapshot)
        }
        const { key: messageKey, code } = errorMessageKey(error)
        toast.show(t('itinerary.day.saveError', { reason: t(messageKey, { code }) }), {
          tone: 'danger',
        })
      }
    },
    [update, set, toast, t, write],
  )

  const addPlace = useCallback(
    (place: Place) =>
      update((current) =>
        current.places.some((p) => p.id === place.id)
          ? current
          : { ...current, places: [...current.places, place] },
      ),
    [update],
  )

  /** Set a leg's mode and, optionally, its minutes by hand (PUT /legs/:from/:to) */
  const setLeg = useCallback(
    async (fromStopId: string, toStopId: string, mode: OverrideMode, minutes: number | null) => {
      const snapshot = latest.current
      const same = (leg: LegOverride) => leg.fromStopId === fromStopId && leg.toStopId === toStopId
      const draft: LegOverride = {
        tripId: trip.id,
        fromStopId,
        toStopId,
        mode,
        minutes,
        rev: 0,
        updatedAt: new Date().toISOString(),
      }
      update((current) => ({ ...current, legs: [...current.legs.filter((l) => !same(l)), draft] }))
      try {
        const result = await write<{ leg: LegOverride | null }>({
          kind: 'leg.put',
          fromStopId,
          toStopId,
          body: { mode, minutes },
        })
        const leg = result.queued ? null : result.response.leg
        if (leg) {
          update((current) => ({
            ...current,
            legs: current.legs.map((l) => (same(l) ? leg : l)),
          }))
        }
      } catch (error) {
        fail(error, snapshot)
      }
    },
    [trip.id, update, fail, write],
  )

  /** Back to the routed / estimated leg (DELETE /legs/:from/:to) */
  const resetLeg = useCallback(
    async (fromStopId: string, toStopId: string) => {
      const snapshot = latest.current
      update((current) => ({
        ...current,
        legs: current.legs.filter((l) => !(l.fromStopId === fromStopId && l.toStopId === toStopId)),
      }))
      try {
        await write({ kind: 'leg.delete', fromStopId, toStopId })
      } catch (error) {
        fail(error, snapshot)
      }
    },
    [update, fail, write],
  )

  // ---- legs ----
  const [cache, setCache] = useState<ReadonlyMap<string, CachedRoute>>(() => new Map())
  const requested = useRef(new Set<string>())

  const placesById = useMemo(
    () => new Map((data?.places ?? []).map((place) => [place.id, place])),
    [data?.places],
  )
  const overrides = useMemo(
    () => overridesByKey(data?.legs ?? [], trip.style),
    [data?.legs, trip.style],
  )
  const dayLegs = useMemo(() => {
    const out = new Map<string, DayLegs>()
    for (const day of data?.days ?? []) {
      out.set(
        day.id,
        assembleDay(day.stops, placesById, {
          style: trip.style,
          limitMinutes: trip.driveLimitMin,
          overrides,
          cache,
        }),
      )
    }
    return out
  }, [data?.days, placesById, overrides, cache, trip.style, trip.driveLimitMin])

  useEffect(() => {
    const wanted: RouteRequest[] = []
    for (const legs of dayLegs.values()) {
      for (const request of legs.missing) {
        const k = routeKey(request.from, request.to, request.mode)
        if (requested.current.has(k)) continue
        requested.current.add(k)
        wanted.push(request)
      }
    }
    if (wanted.length === 0) return
    for (const batch of routeBatches(wanted)) {
      itineraryApi.geoRoutes(trip.id, batch).then(
        ({ routes }) =>
          setCache((current) => {
            const next = new Map(current)
            batch.forEach((request, index) => {
              const route = routes[index]
              if (!route) return
              next.set(routeKey(request.from, request.to, request.mode), {
                distanceM: route.distanceM,
                durationS: route.durationS,
                source: route.source,
              })
            })
            return next
          }),
        () => {
          // Leave them as client-side estimates (already marked 「估」)
        },
      )
    }
  }, [dayLegs, trip.id])

  return {
    resource,
    data,
    stopSource,
    placesById,
    dayLegs,
    saveStop,
    deleteStop,
    moveStop,
    placeStop,
    setBackup,
    addFromPocket,
    patchDay,
    addPlace,
    setLeg,
    resetLeg,
  }
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RouteRequest } from '../../../shared/api/geo.ts'
import type { DayWithStops, LegOverride, Place, Stop, Trip } from '../../../shared/api/types.ts'
import type { DayPatch } from '../../../shared/schema/index.ts'
import { useToast } from '../../components/index.ts'
import { itineraryApi } from '../../lib/api.ts'
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
} from '../../lib/itinerary/legs.ts'
import { applyMove, type MoveTarget } from '../../lib/itinerary/order.ts'
import type { StopValues } from './StopEditor.tsx'

// The itinerary page's data: days with stops, leg overrides and the trip's places, loaded once and
// then updated optimistically by every write (a failed write puts the old state back and says so).
// Routed legs are fetched in batches as they appear; until then, and for modes that are never
// routed, the legs are estimates.

export interface ItineraryData {
  days: DayWithStops[]
  legs: LegOverride[]
  places: Place[]
}

let tempCounter = 0
const tempId = () => `tmp-${Date.now().toString(36)}-${++tempCounter}`
export const isTempId = (id: string) => id.startsWith('tmp-')

export function useItinerary(trip: Trip) {
  const t = useT()
  const toast = useToast()
  const key = `itinerary:${trip.id}:${trip.startDate}:${trip.endDate}`
  const resource = useResource<ItineraryData>(key, async (signal) => {
    const [days, places] = await Promise.all([
      itineraryApi.listDays(trip.id, signal),
      itineraryApi.listPlaces(trip.id, signal),
    ])
    return { days: days.days, legs: days.legs, places: places.places }
  })
  const { set } = resource
  const data = resource.status === 'ready' ? resource.data : null
  const latest = useRef<ItineraryData | null>(data)
  useLayoutEffect(() => {
    latest.current = data
  }, [data])

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

  /** Re-read days and legs (after a move: the server's order and renumbering) */
  const refreshDays = useCallback(async () => {
    try {
      const fresh = await itineraryApi.listDays(trip.id)
      update((current) => ({ ...current, days: fresh.days, legs: fresh.legs }))
    } catch {
      // The optimistic state stays; the next load corrects it
    }
  }, [trip.id, update])

  const replaceStop = (days: DayWithStops[], id: string, stop: Stop) =>
    days.map((day) => ({ ...day, stops: day.stops.map((s) => (s.id === id ? stop : s)) }))

  const saveStop = useCallback(
    async (dayId: string, stopId: string | null, values: StopValues) => {
      const snapshot = latest.current
      if (!snapshot) return
      if (stopId) {
        update((current) => ({
          ...current,
          days: current.days.map((day) => ({
            ...day,
            stops: day.stops.map((s) => (s.id === stopId ? { ...s, ...values } : s)),
          })),
        }))
        try {
          const { stop } = await itineraryApi.patchStop(trip.id, stopId, values)
          update((current) => ({ ...current, days: replaceStop(current.days, stopId, stop) }))
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
        const { stop } = await itineraryApi.createStop(trip.id, { dayId, ...values })
        update((current) => ({ ...current, days: replaceStop(current.days, id, stop) }))
      } catch (error) {
        fail(error, snapshot)
      }
    },
    [trip.id, update, fail],
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
        await itineraryApi.deleteStop(trip.id, stopId)
        toast.show(t('itinerary.deleted', { name }))
      } catch (error) {
        fail(error, snapshot)
      }
    },
    [trip.id, update, fail, toast, t],
  )

  const moveStop = useCallback(
    async (stopId: string, target: MoveTarget) => {
      const snapshot = latest.current
      update((current) => ({ ...current, days: applyMove(current.days, stopId, target) }))
      try {
        await itineraryApi.moveStop(trip.id, stopId, target)
        await refreshDays()
        return true
      } catch (error) {
        fail(error, snapshot)
        return false
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
        const { day } = await itineraryApi.patchDay(trip.id, dayId, patch)
        update((current) => ({
          ...current,
          days: current.days.map((d) => (d.id === dayId ? { ...d, ...day, stops: d.stops } : d)),
        }))
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
    [trip.id, update, set, toast, t],
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

  // ---- legs ----
  const [cache, setCache] = useState<ReadonlyMap<string, CachedRoute>>(() => new Map())
  const requested = useRef(new Set<string>())

  const placesById = useMemo(
    () => new Map((data?.places ?? []).map((place) => [place.id, place])),
    [data?.places],
  )
  const overrides = useMemo(() => overridesByKey(data?.legs ?? []), [data?.legs])
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
    placesById,
    dayLegs,
    saveStop,
    deleteStop,
    moveStop,
    patchDay,
    addPlace,
  }
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RouteRequest } from '../../../shared/api/geo.ts'
import type { DayWithStops, LegOverride, Place, Stop, Trip } from '../../../shared/api/types.ts'
import type { DayPatch } from '../../../shared/schema/index.ts'
import { useToast } from '../../components/index.ts'
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
import { applyMove, applyMoveResult, type MoveTarget } from '../../lib/itinerary/order.ts'
import { withNewStop, type PocketRequest } from '../../lib/itinerary/pocket.ts'
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
        return true
      } catch (error) {
        fail(error, snapshot)
        return false
      }
    },
    [trip.id, update, fail, toast, t],
  )

  const moveStop = useCallback(
    async (stopId: string, target: MoveTarget) => {
      const snapshot = latest.current
      update((current) => ({ ...current, days: applyMove(current.days, stopId, target) }))
      try {
        const { stop, renumbered } = await itineraryApi.moveStop(trip.id, stopId, target)
        update((current) => ({ ...current, days: applyMoveResult(current.days, stop, renumbered) }))
        return true
      } catch (error) {
        fail(error, snapshot)
        return false
      }
    },
    [trip.id, update, fail],
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
          const { stop, renumbered } = await itineraryApi.moveStop(trip.id, stopId, target)
          update((current) => ({
            ...current,
            days: applyMoveResult(current.days, { ...stop, isBackup }, renumbered),
          }))
        }
        const { stop } = await itineraryApi.patchStop(trip.id, stopId, { isBackup })
        update((current) => ({ ...current, days: replaceStop(current.days, stopId, stop) }))
        return true
      } catch (error) {
        fail(error, snapshot)
        return false
      }
    },
    [trip.id, update, fail],
  )

  /** 「全部換上」／「只加入」 and the menu's 移到備案／移回主行程: one PATCH per changed stop */
  const setBackup = useCallback(
    async (changes: readonly BackupChange[]) => {
      if (changes.length === 0) return true
      const snapshot = latest.current
      update((current) => ({ ...current, days: applyBackupChanges(current.days, changes) }))
      try {
        const saved = await Promise.all(
          changes.map((change) =>
            itineraryApi.patchStop(trip.id, change.stopId, { isBackup: change.isBackup }),
          ),
        )
        update((current) => ({
          ...current,
          days: saved.reduce((days, { stop }) => replaceStop(days, stop.id, stop), current.days),
        }))
        return true
      } catch (error) {
        fail(error, snapshot)
        return false
      }
    },
    [trip.id, update, fail],
  )

  /** Days and leg overrides again, without the loading state (after the server placed a stop) */
  const refreshDays = useCallback(async () => {
    try {
      const { days, legs } = await itineraryApi.listDays(trip.id)
      update((current) => ({ ...current, days, legs }))
    } catch {
      // The optimistic state stays; the next load corrects it
    }
  }, [trip.id, update])

  /**
   * A pocket-list entry into a day (e2-t07): an item through /schedule (linked both ways), a place
   * through POST /stops. Resolves to the new stop, or null when the call failed (already said).
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
        const { leg } = await itineraryApi.putLeg(trip.id, fromStopId, toStopId, { mode, minutes })
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
    [trip.id, update, fail],
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
        await itineraryApi.deleteLeg(trip.id, fromStopId, toStopId)
      } catch (error) {
        fail(error, snapshot)
      }
    },
    [trip.id, update, fail],
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

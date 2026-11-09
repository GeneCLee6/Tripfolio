import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DayWithStops,
  LegOverride,
  Place,
  Trip,
  WishlistItemView,
} from '../../../shared/api/types.ts'
import type { Locale } from '../../../shared/i18n/t.ts'
import type { MapMode, MapRoute } from '../../map/types.ts'
import { wishlistApi } from '../api.ts'
import { useResource } from '../hooks.ts'
import {
  buildTripMapData,
  resolveRoutes,
  routesFromCache,
  sessionRouteCache,
  type TripMapData,
} from './assemble.ts'
import { mapApi } from './map-api.ts'

// The map page's data (e3-t04 frontend): days with stops and places from the API, assembled into
// TripMap's props, and the shown day's routes from POST /geo/routes with a session cache.

interface Loaded {
  days: DayWithStops[]
  legs: LegOverride[]
  places: Place[]
  /** For the picks layer (e5-t03); empty when the wishlist could not be loaded */
  wishlist: WishlistItemView[]
}

export interface TripMapDataState {
  status: 'loading' | 'ready' | 'error'
  error: unknown
  data: TripMapData | null
  reload: () => void
  /** A place created on this page (manual pin): it joins the pocket list without a reload */
  addPlace: (place: Place) => void
}

export function useTripMapData(
  trip: Pick<Trip, 'id' | 'tz' | 'style'>,
  locale: Locale,
): TripMapDataState {
  const resource = useResource<Loaded>(`map:${trip.id}`, async (signal) => {
    const [days, places, wishlist] = await Promise.all([
      mapApi.listDays(trip.id, signal),
      mapApi.listPlaces(trip.id, signal),
      // The picks layer is extra: the map still opens without it
      wishlistApi.list(trip.id, signal).then(
        (response) => response.items,
        () => [] as WishlistItemView[],
      ),
    ])
    return { days: days.days, legs: days.legs, places: places.places, wishlist }
  })
  const { status, data: loaded, error, reload, set } = resource

  const data = useMemo(
    () =>
      loaded
        ? buildTripMapData(
            loaded.days,
            loaded.places,
            loaded.legs,
            { tz: trip.tz, locale, style: trip.style },
            loaded.wishlist,
          )
        : null,
    [loaded, trip.tz, trip.style, locale],
  )

  const addPlace = useCallback(
    (place: Place) => {
      if (loaded) set({ ...loaded, places: [...loaded.places, place] })
    },
    [loaded, set],
  )

  return { status, error: error ?? null, data, reload, addPlace }
}

/**
 * The lines of the shown day. The whole-trip view draws only night-to-night links (TripMap leaves
 * day routes out there, E3 需求 路線), so nothing is requested for it; a day's legs are asked for
 * once per session. Until the answer comes, and when it fails, legs are straight dotted estimates.
 */
export function useDayRoutes(
  tripId: string,
  data: TripMapData | null,
  mode: MapMode,
  onError: (error: unknown) => void,
): MapRoute[] {
  const day = mode === 'trip' ? null : mode.day
  const legs = useMemo(
    () => (data && day !== null ? data.legs.filter((leg) => leg.dayIndex === day) : []),
    [data, day],
  )
  const signature = legs
    .map(
      (leg) =>
        `${leg.key}:${leg.routeMode ?? leg.mode}:${leg.from.lat},${leg.from.lng}:${leg.to.lat},${leg.to.lng}`,
    )
    .join('|')
  const [resolved, setResolved] = useState<{ signature: string; routes: MapRoute[] } | null>(null)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  })

  useEffect(() => {
    if (legs.length === 0) return
    const controller = new AbortController()
    void resolveRoutes(legs, (batch) =>
      mapApi.geoRoutes(tripId, batch, controller.signal).then((response) => response.routes),
    ).then(({ routes, error }) => {
      if (controller.signal.aborted) return
      setResolved({ signature, routes })
      if (error && !(error instanceof DOMException && error.name === 'AbortError'))
        onErrorRef.current(error)
    })
    return () => controller.abort()
    // `signature` says when the legs changed; `legs` is rebuilt with it
  }, [tripId, signature]) // oxlint-disable-line react-hooks/exhaustive-deps

  return useMemo(
    () =>
      resolved && resolved.signature === signature
        ? resolved.routes
        : routesFromCache(legs, sessionRouteCache),
    [resolved, signature, legs],
  )
}

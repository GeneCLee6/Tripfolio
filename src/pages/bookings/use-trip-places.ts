import { useMemo, useState } from 'react'
import type { Place } from '../../../shared/api/types.ts'
import { itineraryApi } from '../../lib/api.ts'
import { useResource } from '../../lib/hooks.ts'

/** The trip's places for PlacePicker (fetched once per sheet), plus the ones created meanwhile */
export function useTripPlaces(tripId: string): { places: Place[]; add: (place: Place) => void } {
  const resource = useResource(`booking-places:${tripId}`, (signal) =>
    itineraryApi.listPlaces(tripId, signal).then((res) => res.places),
  )
  const [added, setAdded] = useState<Place[]>([])
  const loaded = resource.status === 'ready' ? resource.data : null
  const places = useMemo(() => {
    const base = loaded ?? []
    return [...base, ...added.filter((p) => !base.some((b) => b.id === p.id))]
  }, [loaded, added])
  return { places, add: (place) => setAdded((list) => [...list, place]) }
}

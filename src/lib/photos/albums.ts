import type { Attachment } from '../../../shared/api/media.ts'
import type { DayWithStops } from '../../../shared/api/types.ts'

// Albums (e6-t04): the trip's photos grouped by the day they are filed under, plus the photos no
// day claims yet. Pure; the photos page renders it.

/** Capture time first (wall-clock and UTC strings both sort well enough), then upload time */
export function sortPhotos(photos: readonly Attachment[]): Attachment[] {
  const key = (photo: Attachment) => photo.takenAt ?? photo.createdAt
  return [...photos].sort((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id))
}

export interface DayAlbum {
  day: DayWithStops
  /** Index of the day among the assigned days (for its colour) */
  position: number
  /** In the order given (capture order) */
  photos: Attachment[]
  /** The day's cover: the one picked for it when it is still in the album, else the first photo */
  coverId: string | null
}

export interface Albums {
  /** Every assigned day, by Day number, empty ones included */
  days: DayAlbum[]
  /** Photos on no day, on a day that is gone, or on a day outside the trip's dates */
  unassigned: Attachment[]
}

/** The day a photo is filed under: its dayId, else the day of its stop */
export function dayIdOf(
  photo: Pick<Attachment, 'dayId' | 'stopId'>,
  stopDay: ReadonlyMap<string, string>,
): string | null {
  if (photo.dayId) return photo.dayId
  return photo.stopId ? (stopDay.get(photo.stopId) ?? null) : null
}

export function groupByDay(
  photos: readonly Attachment[],
  days: readonly DayWithStops[],
  covers: Readonly<Record<string, string>> = {},
): Albums {
  const assigned = days
    .filter((day) => day.idx !== null)
    .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))
  const stopDay = new Map(days.flatMap((day) => day.stops.map((stop) => [stop.id, day.id] as const)))
  const byDay = new Map<string, Attachment[]>(assigned.map((day) => [day.id, []]))
  const unassigned: Attachment[] = []
  for (const photo of photos) {
    const dayId = dayIdOf(photo, stopDay)
    const album = dayId ? byDay.get(dayId) : undefined
    if (album) album.push(photo)
    else unassigned.push(photo)
  }
  return {
    days: assigned.map((day, position) => {
      const list = byDay.get(day.id) ?? []
      const picked = covers[day.id]
      const coverId = picked && list.some((p) => p.id === picked) ? picked : (list[0]?.id ?? null)
      return { day, position, photos: list, coverId }
    }),
    unassigned,
  }
}

/** Photos per stop id, in the order given */
export function photosByStop(photos: readonly Attachment[]): Map<string, Attachment[]> {
  const out = new Map<string, Attachment[]>()
  for (const photo of photos) {
    if (!photo.stopId) continue
    const list = out.get(photo.stopId)
    if (list) list.push(photo)
    else out.set(photo.stopId, [photo])
  }
  return out
}

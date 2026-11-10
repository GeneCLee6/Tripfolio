import { formatDate, formatTime } from '../../../shared/i18n/format.ts'
import type { Locale } from '../../../shared/i18n/t.ts'
import type { Attachment } from '../../../shared/api/media.ts'
import type { DayWithStops, Place } from '../../../shared/api/types.ts'
import type { Translate } from '../../lib/i18n.ts'
import { stopName } from '../itinerary/labels.ts'

// Ordering and captions for the photo page (e6-t02)

export { sortPhotos } from '../../lib/photos/albums.ts'

/** "Mon, Dec 20 14:33": UTC values in the trip's zone, wall-clock values as recorded */
export function takenAtText(takenAt: string, tz: string, locale: Locale): string {
  if (takenAt.endsWith('Z')) {
    const instant = new Date(takenAt)
    return `${formatDate(instant, locale, { timeZone: tz })} ${formatTime(instant, locale, { timeZone: tz })}`
  }
  return `${formatDate(takenAt.slice(0, 10), locale)} ${formatTime(takenAt.slice(11, 16), locale)}`
}

/** 「Day 1」 */
export const dayLabel = (day: Pick<DayWithStops, 'idx'>, t: Translate) =>
  t('day.short', { n: day.idx ?? 0 })

/** 「Day 1 · 12月20日」 */
export function dayHeading(day: Pick<DayWithStops, 'idx' | 'date'>, t: Translate): string {
  return day.date
    ? t('photos.album.heading', { day: dayLabel(day, t), date: formatDate(day.date, t.locale) })
    : dayLabel(day, t)
}

/** Where a photo is filed: 「Day 1 · Fergburger」, 「Day 1 · 12月20日」, or null */
export function filedText(
  photo: Pick<Attachment, 'dayId' | 'stopId'>,
  days: readonly DayWithStops[],
  places: ReadonlyMap<string, Place>,
  t: Translate,
): string | null {
  for (const day of days) {
    if (day.idx === null) continue
    const stop = photo.stopId ? day.stops.find((s) => s.id === photo.stopId) : undefined
    if (stop)
      return t('photos.viewer.place', {
        day: dayLabel(day, t),
        stop: stopName(stop, stop.placeId ? places.get(stop.placeId) : undefined, t),
      })
    if (photo.dayId === day.id && !photo.stopId) return dayHeading(day, t)
  }
  // A stop that is gone, but its day is still here
  const day = days.find((d) => d.id === photo.dayId && d.idx !== null)
  return day ? dayHeading(day, t) : null
}

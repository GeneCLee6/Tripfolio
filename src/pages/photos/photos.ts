import type { Attachment } from '../../../shared/api/media.ts'
import { formatDate, formatTime } from '../../../shared/i18n/format.ts'
import type { Locale } from '../../../shared/i18n/t.ts'

// Ordering and captions for the photo page (e6-t02)

/** Capture time first (wall-clock and UTC strings both sort well enough), then upload time */
export function sortPhotos(photos: readonly Attachment[]): Attachment[] {
  const key = (photo: Attachment) => photo.takenAt ?? photo.createdAt
  return [...photos].sort((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id))
}

/** "Mon, Dec 20 14:33": UTC values in the trip's zone, wall-clock values as recorded */
export function takenAtText(takenAt: string, tz: string, locale: Locale): string {
  if (takenAt.endsWith('Z')) {
    const instant = new Date(takenAt)
    return `${formatDate(instant, locale, { timeZone: tz })} ${formatTime(instant, locale, { timeZone: tz })}`
  }
  return `${formatDate(takenAt.slice(0, 10), locale)} ${formatTime(takenAt.slice(11, 16), locale)}`
}

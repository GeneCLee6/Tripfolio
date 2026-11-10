// Day covers (e6-t04). The days table has no cover column and the Worker is out of this batch's
// reach, so the pick lives in this browser's localStorage, per trip: { [dayId]: attachmentId }.
// Other devices fall back to the day's first photo. Move it to `days.coverAttachmentId` later.

const key = (tripId: string) => `tripfolio.photos.dayCovers.${tripId}`

export function readDayCovers(tripId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key(tripId))
    if (!raw) return {}
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const out: Record<string, string> = {}
    for (const [dayId, id] of Object.entries(value)) if (typeof id === 'string') out[dayId] = id
    return out
  } catch {
    return {}
  }
}

export function writeDayCovers(tripId: string, covers: Record<string, string>): void {
  try {
    localStorage.setItem(key(tripId), JSON.stringify(covers))
  } catch {
    // Storage unavailable (private mode): the pick lasts for this page only
  }
}

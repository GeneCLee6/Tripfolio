import type { Stop } from '../../../shared/api/types.ts'

// The rainy-day plan of a day (e2-t07, E2 需求「備案」): stops flagged isBackup sit in their own
// group under the day's rail and are left out of legs, totals and time checks (summarizeDay and
// checkDay already skip them). These helpers stay pure so the swap can be tested without a DOM.

/** Droppable id of a day's backup group (an empty or collapsed group) */
export const BACKUP_DROP_PREFIX = 'backup:'
export const backupDropId = (dayId: string) => `${BACKUP_DROP_PREFIX}${dayId}`
export const dayIdOfBackupDrop = (id: string): string | null =>
  id.startsWith(BACKUP_DROP_PREFIX) ? id.slice(BACKUP_DROP_PREFIX.length) : null

/** The day's main rail and its backup group, each in day order */
export function splitBackup<T extends Pick<Stop, 'isBackup'>>(
  stops: readonly T[],
): { main: T[]; backup: T[] } {
  const main: T[] = []
  const backup: T[] = []
  for (const stop of stops) (stop.isBackup ? backup : main).push(stop)
  return { main, backup }
}

export interface BackupChange {
  stopId: string
  isBackup: boolean
}

/**
 * 「換上這些備案」: `add` puts the backups into the main plan (「只加入」); `swap` also moves the
 * current main stops into the backup group (「全部換上」). Only stops that change are listed.
 */
export function swapInChanges(
  stops: readonly Pick<Stop, 'id' | 'isBackup'>[],
  mode: 'swap' | 'add',
): BackupChange[] {
  const changes: BackupChange[] = []
  for (const stop of stops) {
    if (stop.isBackup) changes.push({ stopId: stop.id, isBackup: false })
    else if (mode === 'swap') changes.push({ stopId: stop.id, isBackup: true })
  }
  return changes
}

/** The days with the changes applied (the optimistic update) */
export function applyBackupChanges<T extends { stops: Stop[] }>(
  days: readonly T[],
  changes: readonly BackupChange[],
): T[] {
  if (changes.length === 0) return [...days]
  const next = new Map(changes.map((change) => [change.stopId, change.isBackup]))
  return days.map((day) => {
    if (!day.stops.some((stop) => next.has(stop.id))) return day
    return {
      ...day,
      stops: day.stops.map((stop) => {
        const isBackup = next.get(stop.id)
        return isBackup === undefined || isBackup === stop.isBackup ? stop : { ...stop, isBackup }
      }),
    }
  })
}

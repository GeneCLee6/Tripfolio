import type { Translate } from '../i18n.ts'
import type { Countdown } from '../trip-groups.ts'

// The trip home's countdown text (e9-t06, AC-9.5): 「還有 N 天」 before departure, 「第 N 天／共 M 天」
// while the trip runs (both in the trip's own time zone), nothing once it is over or archived.

export function countdownLabel(t: Translate, value: Countdown): string | null {
  if (value.kind === 'upcoming') return t.plural('count.daysToGo', value.days)
  if (value.kind === 'ongoing') return t('trips.dayOf', { day: value.day, total: value.of })
  return null
}

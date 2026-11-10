import type { Trip } from '../../../shared/api/types.ts'
import { useT } from '../../lib/i18n.ts'
import { countdownLabel } from '../../lib/today/countdown.ts'
import { countdown } from '../../lib/trip-groups.ts'

// The trip home's countdown (e9-t06): nothing after the trip (see countdownLabel)

export function Countdown({
  trip,
  nowMs,
}: {
  trip: Pick<Trip, 'startDate' | 'endDate' | 'tz' | 'archivedAt'>
  nowMs: number
}) {
  const t = useT()
  const value = countdown(trip, nowMs)
  const text = countdownLabel(t, value)
  return text ? <span data-countdown={value.kind}>{text}</span> : null
}

import styled from 'styled-components'
import type {
  ShareBooking,
  ShareDay,
  ShareLeg,
  SharePoint,
  ShareStop,
  ShareTrip,
} from '../../shared/api/share.ts'
import {
  formatDistance,
  formatDuration,
  formatMoney,
  formatTime,
} from '../../shared/i18n/format.ts'
import type { Locale } from '../../shared/i18n/core.ts'
import type { Translate } from '../../src/lib/i18n.ts'
import { color, font, fontSize, fontWeight, space } from '../../src/styles/tokens.ts'
import { modeGlyph, stopGlyph } from '../glyphs.ts'
import { PrintDayMap } from './PrintDayMap.tsx'

// A day's printed page body (e8-t02): the static day map, the stops table (number, time, name,
// type, notes, the leg to the next stop) and the day's bookings. Rendered by DayCard only while the
// page prepares to print, inside a data-print="only" block, so the screen never shows it.

/** Shorter legs (two stops at one place) get no leg cell, as on screen */
const MIN_LEG_M = 50

const Wrap = styled.div`
  display: grid;
  gap: ${space.sm}px;
  margin-top: ${space.sm}px;
`

const MapBox = styled.div`
  break-inside: avoid;
  max-height: 95mm;
  svg {
    max-height: 95mm;
  }
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 9pt;
  th,
  td {
    padding: 3px ${space.xs}px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid ${color.line};
  }
  thead th {
    font-weight: ${fontWeight.medium};
    color: ${color.muted};
    border-bottom: 1.5px solid ${color.ink};
  }
  tr {
    break-inside: avoid;
  }
  .num {
    font-family: ${font.mono};
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  tbody th {
    font-weight: ${fontWeight.semibold};
  }
  small {
    display: block;
    font-weight: ${fontWeight.regular};
    color: ${color.muted};
  }
  tr.backup th,
  tr.backup td {
    color: ${color.muted};
  }
`

const Notes = styled.span`
  white-space: pre-line;
`

const Extra = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  b {
    font-weight: ${fontWeight.semibold};
  }
`

const stopName = (stop: ShareStop, locale: Locale) =>
  locale === 'en' && stop.nameEn ? stop.nameEn : stop.name

function legText(leg: ShareLeg, t: Translate): string {
  const summary = t('share.leg.summary', {
    duration: formatDuration((leg.durationS ?? 0) / 60, t.locale),
    distance: formatDistance(leg.distanceM ?? 0, t.locale),
  })
  const mode = t(`share.mode.${leg.mode}`)
  const parts = [`${modeGlyph[leg.mode]} ${mode}`, summary]
  if (leg.source === 'estimate') parts.push(t('share.leg.estimate'))
  if (leg.source === 'manual') parts.push(t('share.leg.manual'))
  return parts.join(' · ')
}

function noteParts(stop: ShareStop, t: Translate): string[] {
  const parts: string[] = []
  if (stop.booking === 'booked') parts.push(t('share.stop.booked'))
  if (stop.booking === 'todo') parts.push(t('share.stop.todo'))
  if (stop.durationMin !== undefined && stop.durationMin > 0) {
    parts.push(formatDuration(stop.durationMin, t.locale))
  }
  if (stop.costMinor !== undefined && stop.currency) {
    parts.push(formatMoney(stop.costMinor, stop.currency, t.locale))
  }
  return parts
}

export interface PrintDayProps {
  day: ShareDay
  trip: ShareTrip
  dayColor: string
  dayLabel: string
  /** Where the day sleeps, when its lodging has a place */
  lodging?: SharePoint
  /** Transport and activity bookings starting this day */
  bookings: readonly ShareBooking[]
  t: Translate
}

export function PrintDay({ day, trip, dayColor, dayLabel, lodging, bookings, t }: PrintDayProps) {
  const at = (iso: string) => formatTime(new Date(iso), t.locale, { timeZone: trip.tz })
  const legFrom = new Map(day.legs.map((leg) => [leg.fromOrder, leg]))
  const main = day.stops.filter((s) => !s.isBackup)
  const backups = day.stops.filter((s) => s.isBackup)
  const row = (stop: ShareStop, n: number | null) => {
    const leg = n === null ? undefined : legFrom.get(stop.order)
    const showLeg = leg && (leg.distanceM ?? 0) >= MIN_LEG_M
    const tags = noteParts(stop, t)
    if (n === null) tags.unshift(t('share.stop.backup'))
    const time = stop.startAt
      ? stop.endAt
        ? t('share.stop.timeRange', { start: at(stop.startAt), end: at(stop.endAt) })
        : at(stop.startAt)
      : ''
    return (
      <tr key={stop.order} className={n === null ? 'backup' : undefined}>
        <td className="num">{n ?? ''}</td>
        <td className="num">{time}</td>
        <th scope="row">
          {stopName(stop, t.locale)}
          {stop.address && <small>{stop.address}</small>}
        </th>
        <td>
          <span aria-hidden="true">{stopGlyph[stop.type]}</span> {t(`share.stopType.${stop.type}`)}
        </td>
        <td>
          {tags.length > 0 && <small>{tags.join(' · ')}</small>}
          {stop.note && <Notes>{stop.note}</Notes>}
        </td>
        <td>{showLeg && leg ? legText(leg, t) : ''}</td>
      </tr>
    )
  }

  return (
    <Wrap>
      <MapBox>
        <PrintDayMap
          day={day}
          lodging={lodging}
          dayColor={dayColor}
          label={t('share.print.dayMap', { day: dayLabel })}
        />
      </MapBox>
      {day.stops.length > 0 && (
        <Table aria-label={t('share.print.stops', { day: dayLabel })}>
          <thead>
            <tr>
              <th scope="col">{t('share.print.col.n')}</th>
              <th scope="col">{t('share.print.col.time')}</th>
              <th scope="col">{t('share.print.col.stop')}</th>
              <th scope="col">{t('share.print.col.type')}</th>
              <th scope="col">{t('share.print.col.note')}</th>
              <th scope="col">{t('share.print.col.next')}</th>
            </tr>
          </thead>
          <tbody>
            {main.map((stop, i) => row(stop, i + 1))}
            {backups.map((stop) => row(stop, null))}
          </tbody>
        </Table>
      )}
      {bookings.length > 0 && (
        <Extra>
          <b>{t('share.print.dayBookings')}</b>{' '}
          {bookings
            .map((b) =>
              [t(`share.print.kind.${b.kind}`), b.title, b.startTime, b.ref]
                .filter(Boolean)
                .join(' · '),
            )
            .join(' / ')}
        </Extra>
      )}
      {day.note && (
        <Extra>
          <b>{t('share.day.note')}</b> <Notes>{day.note}</Notes>
        </Extra>
      )}
    </Wrap>
  )
}

import styled from 'styled-components'
import type { ShareBooking, ShareBookingKind } from '../../shared/api/share.ts'
import type { ShareOptions } from '../../shared/schema/share.ts'
import { formatDate, formatMoney } from '../../shared/i18n/format.ts'
import { useT, type Translate } from '../../src/lib/i18n.ts'
import { color, font, fontSize, fontWeight, space } from '../../src/styles/tokens.ts'
import { modeGlyph, stopGlyph } from '../glyphs.ts'

// The bookings summary (e8-t02), printed on the last page: lodgings and transport / activity
// bookings by start, with the reference and the price when the share shows them. The Worker leaves
// hidden fields out (CLAUDE.md rule 4); the columns follow the share's options so a hidden column
// is not drawn empty.

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${fontSize.sm}px;
  th,
  td {
    padding: ${space.xs}px ${space.sm}px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid ${color.line};
  }
  thead th {
    font-size: 12px;
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
  .right {
    text-align: right;
  }
`

const Heading = styled.h2`
  margin: 0 0 ${space.md}px;
  font-size: ${fontSize.lg}px;
`

const kindGlyph: Record<ShareBookingKind, string> = {
  lodging: stopGlyph.lodging,
  flight: modeGlyph.flight,
  rental: modeGlyph.drive,
  driver: modeGlyph.drive,
  ferry: modeGlyph.ferry,
  rail: modeGlyph.transit,
  bus: stopGlyph.transport,
  activity: stopGlyph.sight,
}

/** 「12月20日（日） 07:05 → 12月22日（二） 10:00」, one date when both ends share it */
function bookingWhen(b: ShareBooking, t: Translate): string {
  if (!b.startDate) return ''
  const at = (date: string, time?: string) => {
    const day = formatDate(date, t.locale)
    return time ? t('share.print.dateTime', { date: day, time }) : day
  }
  if (!b.endDate) return at(b.startDate, b.startTime)
  if (b.endDate === b.startDate) {
    if (!b.startTime || !b.endTime) return at(b.startDate, b.startTime)
    const times = t('share.stop.timeRange', { start: b.startTime, end: b.endTime })
    return at(b.startDate, times)
  }
  return t('share.print.range', {
    start: at(b.startDate, b.startTime),
    end: at(b.endDate, b.endTime),
  })
}

export function BookingsTable({
  bookings,
  options,
}: {
  bookings: readonly ShareBooking[]
  options: ShareOptions
}) {
  const t = useT()
  const showRef = !options.hideAddresses
  const showPrice = !options.hideMoney
  return (
    <section aria-labelledby="share-bookings" data-testid="share-bookings">
      <Heading id="share-bookings">{t('share.print.bookings.heading')}</Heading>
      <Table>
        <thead>
          <tr>
            <th scope="col">{t('share.print.bookings.kind')}</th>
            <th scope="col">{t('share.print.bookings.date')}</th>
            <th scope="col">{t('share.print.bookings.title')}</th>
            {showRef && <th scope="col">{t('share.print.bookings.ref')}</th>}
            {showPrice && (
              <th scope="col" className="right">
                {t('share.print.bookings.price')}
              </th>
            )}
            <th scope="col">{t('share.print.bookings.status')}</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b, i) => (
            <tr key={i}>
              <td>
                <span aria-hidden="true">{kindGlyph[b.kind]}</span>{' '}
                {t(`share.print.kind.${b.kind}`)}
              </td>
              <td className="num">{bookingWhen(b, t)}</td>
              <th scope="row">{b.title}</th>
              {showRef && <td className="num">{b.ref ?? ''}</td>}
              {showPrice && (
                <td className="num right">
                  {b.priceMinor !== undefined && b.currency
                    ? formatMoney(b.priceMinor, b.currency, t.locale)
                    : ''}
                </td>
              )}
              <td>{t(`share.print.pay.${b.payStatus}`)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  )
}

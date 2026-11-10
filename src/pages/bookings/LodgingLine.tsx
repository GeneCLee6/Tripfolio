import { lazy, Suspense, useState } from 'react'
import styled, { css } from 'styled-components'
import type { DayCheckout, DayLodgingSummary } from '../../../shared/api/bookings.ts'
import type { DayWithStops, Trip } from '../../../shared/api/types.ts'
import { formatMoney, formatTime } from '../../../shared/i18n/format.ts'
import { BookingTypeIcon } from '../../components/BookingTypeIcon.tsx'
import { daysBetween } from '../../lib/bookings/form.ts'
import { useTripLodgings } from '../../lib/bookings/lodging-store.ts'
import { useT } from '../../lib/i18n.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'

// The day header's 「今晚住」 line (e4-t02, mockup Screen 2): tonight's lodging with its check-in
// time, the campsite type and facilities on a campervan trip and the price; 「退房 10:00」 on the
// morning someone checks out; 「還沒安排住宿」 otherwise. Tapping it opens the lodging form for
// that night (a lazy chunk). Kept small: it renders in every day of the itinerary.

const LodgingSheet = lazy(() => import('./LodgingSheet.tsx'))

const Wrap = styled.div`
  display: grid;
  gap: ${space.xs}px;
  margin: 0 0 ${space.sm}px;
`

const lineStyle = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.xs}px ${space.sm}px;
  width: 100%;
  padding: ${space.sm}px ${space.md - 2}px;
  border: 0;
  border-radius: ${radius.control}px;
  background: ${color.paper};
  color: ${color.muted};
  font: inherit;
  font-size: ${fontSize.sm}px;
  text-align: left;
  > svg {
    flex: none;
    color: ${color.fjord};
  }
`

const Line = styled.div`
  ${lineStyle}
`

const LineButton = styled.button.attrs({ type: 'button' })`
  ${lineStyle}
  cursor: pointer;
  &:hover {
    color: ${color.ink};
  }
  ${focusRing}
`

const Name = styled.span`
  color: ${color.ink};
  font-weight: ${fontWeight.semibold};
  overflow-wrap: anywhere;
`

const Bit = styled.span`
  &::before {
    content: '·';
    margin-right: ${space.sm}px;
  }
`

const Add = styled.span`
  color: ${color.fjord};
  font-weight: ${fontWeight.semibold};
`

const Price = styled.span`
  margin-left: auto;
  padding: 0 ${space.sm}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill}px;
  font-variant-numeric: tabular-nums;
`

export interface LodgingLineProps {
  /** The day, with the E4 `lodging` / `checkout` fields when the days response has them */
  day: DayWithStops & { lodging?: DayLodgingSummary | null; checkout?: DayCheckout | null }
  trip: Trip
  /** May add or edit the lodging (editor and up) */
  editable?: boolean
}

export function LodgingLine({ day, trip, editable = false }: LodgingLineProps) {
  const t = useT()
  const store = useTripLodgings(day.idx === null ? null : trip.id)
  const [open, setOpen] = useState<null | { lodgingId: string | null }>(null)
  if (day.idx === null) return null

  const fresh = store.days?.get(day.id)
  const summary = fresh ? fresh.lodging : (day.lodging ?? null)
  const checkoutSummary = fresh ? fresh.checkout : (day.checkout ?? null)
  // `lodging` is the morning's checkout when nobody stays that night
  const tonight = summary && !summary.isCheckoutDay ? summary : null
  const checkout: DayCheckout | null =
    checkoutSummary ??
    (summary?.isCheckoutDay
      ? { id: summary.id, name: summary.name, checkOutTime: summary.checkOutTime }
      : null)
  const full = tonight ? store.lodgings?.find((l) => l.id === tonight.id) : undefined
  const campervan = trip.style === 'campervan'
  const lastDay = day.date !== null && day.date === trip.endDate

  let tonightLine = null
  if (tonight) {
    const nights = full ? daysBetween(full.checkIn, full.checkOut) : 0
    const night = full && day.date ? daysBetween(full.checkIn, day.date) + 1 : 0
    const content = (
      <>
        <BookingTypeIcon type="lodging" />
        <span>
          {t('bookings.line.tonight')}
          <Name>{tonight.name}</Name>
        </span>
        {nights > 1 && night > 0 && (
          <Bit>{t('bookings.line.night', { n: night, total: nights })}</Bit>
        )}
        {full?.checkInTime && tonight.isCheckinDay && (
          <Bit>{t('bookings.line.checkInFrom', { time: formatTime(full.checkInTime, t.locale) })}</Bit>
        )}
        {campervan && tonight.campType && <Bit>{t(`bookings.camp.${tonight.campType}`)}</Bit>}
        {campervan && full?.campFacilities?.power && <Bit>{t('bookings.facility.power')}</Bit>}
        {campervan && full?.campFacilities?.water && <Bit>{t('bookings.facility.water')}</Bit>}
        {campervan && full?.campFacilities?.dump && <Bit>{t('bookings.facility.dump')}</Bit>}
        {full?.priceMinor != null && full.currency && (
          <Price>{formatMoney(full.priceMinor, full.currency, t.locale)}</Price>
        )}
      </>
    )
    tonightLine = editable ? (
      <LineButton
        aria-label={t('bookings.line.edit', { name: tonight.name })}
        onClick={() => setOpen({ lodgingId: tonight.id })}
        data-lodging-line="tonight"
      >
        {content}
      </LineButton>
    ) : (
      <Line data-lodging-line="tonight">{content}</Line>
    )
  } else if (!(lastDay && checkout)) {
    tonightLine = editable ? (
      <LineButton onClick={() => setOpen({ lodgingId: null })} data-lodging-line="empty">
        <BookingTypeIcon type="lodging" />
        <span>{t('bookings.line.empty')}</span>
        <Add>{t('bookings.line.add')}</Add>
      </LineButton>
    ) : (
      <Line data-lodging-line="empty">
        <BookingTypeIcon type="lodging" />
        <span>{t('bookings.line.empty')}</span>
        <span>{t('bookings.line.none')}</span>
      </Line>
    )
  }

  const checkoutLine =
    checkout && checkout.id !== tonight?.id ? (
      <Line data-lodging-line="checkout">
        <span>
          {checkout.checkOutTime
            ? t('bookings.line.checkout', { time: formatTime(checkout.checkOutTime, t.locale) })
            : t('bookings.line.checkoutToday')}
        </span>
        <Bit>{checkout.name}</Bit>
      </Line>
    ) : null

  return (
    <Wrap>
      {checkoutLine}
      {tonightLine}
      {open && day.date && (
        <Suspense fallback={null}>
          <LodgingSheet
            trip={trip}
            lodgingId={open.lodgingId}
            date={day.date}
            onClose={() => setOpen(null)}
          />
        </Suspense>
      )}
    </Wrap>
  )
}

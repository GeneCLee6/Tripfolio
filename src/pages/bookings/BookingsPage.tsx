import { lazy, Suspense, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import type { Booking, Lodging } from '../../../shared/api/bookings.ts'
import { formatDate, formatDateRange, formatMoney, formatTime } from '../../../shared/i18n/format.ts'
import '../../../shared/i18n/pages/bookings.ts'
import { convertMinor } from '../../../shared/money/fx.ts'
import {
  BookingTypeIcon,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  PayStatusChip,
  Skeleton,
  useToast,
} from '../../components/index.ts'
import { TrashIcon } from '../../components/icons.tsx'
import { useTripContext } from '../../app/trip-context.ts'
import { balancesApi } from '../../lib/balances/api.ts'
import { bookingsApi } from '../../lib/bookings/api.ts'
import { daysBetween, dualTimes, groupOf, type BookingGroup } from '../../lib/bookings/form.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT, type Translate } from '../../lib/i18n.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { errorMessageKey } from '../../lib/errors.ts'
import { color, font, fontSize, fontWeight, media, radius, space } from '../../styles/tokens.ts'
import { Count, PageHeading, SectionTitle, Stack } from '../parts.tsx'
import { listText, slotLabelText } from './labels.ts'

// /trips/:id/bookings — 預訂總覽 (e4-t02, e4-t03): every lodging, transport and activity booking
// grouped 住宿／交通／活動, with its date, amount (and the base-currency approximation), payment
// state, who pays first and the cancel-by. Editors add, edit and delete; deleting a booking asks
// whether to keep the stops it created. The one-click expense from 「誰先付」 is e4-t06.

const LodgingSheet = lazy(() => import('./LodgingSheet.tsx'))
const BookingSheet = lazy(() => import('./BookingSheet.tsx'))

interface Data {
  lodgings: Lodging[]
  bookings: Booking[]
}

const List = styled.ul`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Row = styled.li`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: ${space.xs}px ${space.md}px;
  align-items: start;
  padding: ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  > svg {
    margin-top: 2px;
    color: ${color.fjord};
  }
  @media ${media.tablet} {
    grid-template-columns: auto minmax(0, 1fr) minmax(180px, auto) auto;
  }
`

const Main = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
`

const Title = styled.span`
  font-weight: ${fontWeight.semibold};
  overflow-wrap: anywhere;
`

const Sub = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: 0 ${space.sm}px;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const Mono = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
`

const Money = styled.div`
  display: grid;
  gap: ${space.xs}px;
  justify-items: start;
  font-size: ${fontSize.sm}px;
  grid-column: 2 / 3;
  @media ${media.tablet} {
    grid-column: auto;
    justify-items: end;
    text-align: right;
  }
`

const Amount = styled.span`
  font-weight: ${fontWeight.semibold};
  font-variant-numeric: tabular-nums;
`

const Actions = styled.div`
  display: flex;
  gap: ${space.xs}px;
  grid-column: 3 / 4;
  grid-row: 1 / 2;
  @media ${media.tablet} {
    grid-column: auto;
  }
`

const Muted = styled.span`
  color: ${color.muted};
`

type Sheet =
  | { kind: 'lodging'; lodging: Lodging | null }
  | { kind: 'booking'; booking: Booking | null }
  | null

type Pending = { kind: 'lodging'; lodging: Lodging } | { kind: 'booking'; booking: Booking } | null

/** The amount, with the base-currency approximation when a rate is known */
function amountText(
  minor: number | null,
  currency: string | null,
  base: string,
  rates: ReadonlyMap<string, number>,
  t: Translate,
): string | null {
  if (minor === null || !currency) return null
  const rate = currency === base ? null : rates.get(currency)
  if (!rate) return formatMoney(minor, currency, t.locale)
  return formatMoney(minor, currency, t.locale, {
    secondary: { minor: convertMinor(minor, currency, base, rate), currency: base },
  })
}

export default function BookingsPage() {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const { trip, members } = useTripContext()
  const can = useCan()
  const canEdit = can('editContent')
  const resource = useResource<Data>(`bookings:${trip.id}`, async (signal) => {
    const [lodgings, bookings] = await Promise.all([
      bookingsApi.listLodgings(trip.id, signal),
      bookingsApi.listBookings(trip.id, signal),
    ])
    return { lodgings: lodgings.lodgings, bookings: bookings.bookings }
  })
  const data = resource.status === 'ready' ? resource.data : null
  const currencies = data
    ? [...new Set([...data.lodgings, ...data.bookings].map((x) => x.currency).filter((c): c is string => !!c && c !== trip.baseCurrency))].sort()
    : []
  const fx = useResource<Map<string, number>>(`bookings-fx:${trip.id}:${currencies.join(',')}`, async (signal) => {
    const out = new Map<string, number>()
    await Promise.all(
      currencies.map((quote) =>
        balancesApi
          .getFx(trip.id, quote, signal)
          .then((res) => {
            const rate = res.overrides[quote] ?? res.rates.find((r) => r.quote === quote)?.rate
            if (rate) out.set(quote, rate)
          })
          .catch(() => {}),
      ),
    )
    return out
  })
  const rates = fx.status === 'ready' ? fx.data : new Map<string, number>()
  const [sheet, setSheet] = useState<Sheet>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const memberName = (id: string | null) => (id ? members.find((m) => m.id === id)?.name : undefined)

  const cancelText = (iso: string | null) =>
    iso
      ? t('bookings.row.cancelBy', {
          when: `${formatDate(new Date(iso), t.locale, { timeZone: trip.tz })} ${formatTime(new Date(iso), t.locale, { timeZone: trip.tz })}`,
        })
      : null

  const remove = async (keepStops: boolean) => {
    if (!pending) return
    setBusy(true)
    try {
      if (pending.kind === 'lodging') {
        await bookingsApi.deleteLodging(trip.id, pending.lodging.id)
        toast.show(t('bookings.deleted', { title: pending.lodging.name }))
      } else {
        await bookingsApi.deleteBooking(trip.id, pending.booking.id, keepStops)
        toast.show(t('bookings.deleted', { title: pending.booking.title }))
      }
      setPending(null)
      resource.reload()
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  const actions = (label: string, onEdit: () => void, onDelete: () => void): ReactNode =>
    canEdit ? (
      <Actions>
        <IconButton label={t('bookings.row.edit', { title: label })} size="sm" onClick={onEdit} icon={<EditGlyph />} />
        <IconButton label={t('bookings.row.delete', { title: label })} size="sm" onClick={onDelete} icon={<TrashIcon size={16} />} />
      </Actions>
    ) : null

  const lodgingRow = (lodging: Lodging) => {
    const nights = daysBetween(lodging.checkIn, lodging.checkOut)
    const amount = amountText(lodging.priceMinor, lodging.currency, trip.baseCurrency, rates, t)
    return (
      <Row key={lodging.id} data-booking-row={lodging.id}>
        <BookingTypeIcon type="lodging" size={20} />
        <Main>
          <Title>{lodging.name}</Title>
          <Sub>
            <Mono>{formatDateRange(lodging.checkIn, lodging.checkOut, t.locale)}</Mono>
            <span>{t.plural('bookings.nights', nights)}</span>
            {lodging.checkInTime && <span>{t('bookings.line.checkInFrom', { time: lodging.checkInTime })}</span>}
            {lodging.checkOutTime && <span>{t('bookings.line.checkout', { time: lodging.checkOutTime })}</span>}
            {lodging.campType && <span>{t(`bookings.camp.${lodging.campType}`)}</span>}
          </Sub>
        </Main>
        <Money>
          {amount && <Amount>{amount}</Amount>}
          <PayStatusChip status={lodging.payStatus} />
          {cancelText(lodging.cancelBy) && <Muted>{cancelText(lodging.cancelBy)}</Muted>}
        </Money>
        {actions(
          lodging.name,
          () => setSheet({ kind: 'lodging', lodging }),
          () => setPending({ kind: 'lodging', lodging }),
        )}
      </Row>
    )
  }

  const bookingRow = (booking: Booking) => {
    const times = dualTimes(booking, trip.tz)
    const amount = amountText(booking.priceMinor, booking.currency, trip.baseCurrency, rates, t)
    const payer = memberName(booking.payerMemberId)
    const flight = booking.type === 'flight'
    return (
      <Row key={booking.id} data-booking-row={booking.id}>
        <BookingTypeIcon type={booking.type} size={20} />
        <Main>
          <Title>{booking.title}</Title>
          <Sub>
            <span>{t(`bookings.type.${booking.type}`)}</span>
            {times ? (
              <Mono data-booking-times="">
                {flight
                  ? t('bookings.row.flightTimes', {
                      start: `${formatDate(times.start.date, t.locale)} ${times.start.time} ${times.start.abbrev}`,
                      end: times.end
                        ? `${times.end.time}${times.dayShift ? ` (${t('bookings.row.dayShift', { n: times.dayShift > 0 ? `+${times.dayShift}` : String(times.dayShift) })})` : ''} ${times.end.abbrev}`
                        : '—',
                    })
                  : `${formatDate(times.start.date, t.locale)} ${times.start.time}${
                      times.end
                        ? ` – ${times.end.date !== times.start.date ? `${formatDate(times.end.date, t.locale)} ` : ''}${times.end.time}`
                        : ''
                    }`}
              </Mono>
            ) : (
              <span>{t('bookings.row.noDate')}</span>
            )}
          </Sub>
          {booking.stops.length > 0 && (
            <Sub>
              {t('bookings.row.stops', {
                slots: listText(booking.stops.map((stop) => slotLabelText(stop.slot, t)), t.locale),
              })}
            </Sub>
          )}
        </Main>
        <Money>
          {amount && <Amount>{amount}</Amount>}
          <PayStatusChip status={booking.payStatus} />
          <Muted>{payer ? t('bookings.row.payer', { name: payer }) : t('bookings.row.noPayer')}</Muted>
          {payer && (
            <Button size="sm" variant="ghost" disabled title={t('bookings.row.expenseSoon')}>
              {t('bookings.row.toExpense')}
            </Button>
          )}
          {cancelText(booking.cancelBy) && <Muted>{cancelText(booking.cancelBy)}</Muted>}
        </Money>
        {actions(
          booking.title,
          () => setSheet({ kind: 'booking', booking }),
          () => setPending({ kind: 'booking', booking }),
        )}
      </Row>
    )
  }

  let body: ReactNode
  if (resource.status === 'loading') {
    body = <Skeleton $height={200} />
  } else if (resource.status === 'error') {
    const { key, code } = errorMessageKey(resource.error)
    body = (
      <EmptyState
        illustration="suitcase"
        title={t('bookings.loadError')}
        body={t(key, { code })}
        action={<Button onClick={resource.reload}>{t('bookings.retry')}</Button>}
      />
    )
  } else if (data && data.lodgings.length === 0 && data.bookings.length === 0) {
    body = (
      <EmptyState illustration="suitcase" title={t('bookings.empty.title')} body={t('bookings.empty.body')} />
    )
  } else if (data) {
    const groups: { id: BookingGroup; rows: ReactNode[] }[] = [
      { id: 'lodging', rows: data.lodgings.map(lodgingRow) },
      { id: 'transport', rows: data.bookings.filter((b) => groupOf(b.type) === 'transport').map(bookingRow) },
      { id: 'activity', rows: data.bookings.filter((b) => groupOf(b.type) === 'activity').map(bookingRow) },
    ]
    body = groups.map((group) => (
      <Stack key={group.id} as="section" $gap="md" aria-labelledby={`bookings-${group.id}`}>
        <SectionTitle id={`bookings-${group.id}`}>
          {t(`bookings.group.${group.id}`)} <Count>{group.rows.length}</Count>
        </SectionTitle>
        {group.rows.length > 0 ? <List>{group.rows}</List> : <Muted>{t('bookings.groupEmpty')}</Muted>}
      </Stack>
    ))
  }

  return (
    <Stack>
      <PageHeading
        title={t('bookings.title')}
        lead={t('bookings.lead')}
        actions={
          canEdit ? (
            <Sub>
              <Button onClick={() => setSheet({ kind: 'lodging', lodging: null })}>{t('bookings.addLodging')}</Button>
              <Button variant="primary" onClick={() => setSheet({ kind: 'booking', booking: null })}>
                {t('bookings.add')}
              </Button>
            </Sub>
          ) : undefined
        }
      />
      {body}
      <Suspense fallback={null}>
        {sheet?.kind === 'lodging' && (
          <LodgingSheet
            trip={trip}
            lodgingId={sheet.lodging?.id ?? null}
            lodging={sheet.lodging ?? undefined}
            date={trip.startDate}
            onClose={() => setSheet(null)}
            onSaved={resource.reload}
          />
        )}
        {sheet?.kind === 'booking' && (
          <BookingSheet
            trip={trip}
            members={members}
            booking={sheet.booking}
            onClose={() => setSheet(null)}
            onSaved={resource.reload}
          />
        )}
      </Suspense>
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={t('bookings.delete.title', {
          title: pending ? (pending.kind === 'lodging' ? pending.lodging.name : pending.booking.title) : '',
        })}
        actions={
          pending?.kind === 'booking' && pending.booking.stops.length > 0 ? (
            <>
              <Button onClick={() => setPending(null)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={() => void remove(false)} disabled={busy}>
                {t('bookings.delete.remove')}
              </Button>
              <Button variant="primary" onClick={() => void remove(true)} disabled={busy}>
                {t('bookings.delete.keep')}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setPending(null)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={() => void remove(false)} disabled={busy}>
                {t('common.delete')}
              </Button>
            </>
          )
        }
      >
        <p>
          {pending?.kind === 'lodging'
            ? t('bookings.delete.lodgingBody')
            : pending && pending.booking.stops.length > 0
              ? t('bookings.delete.keepQuestion')
              : t('bookings.delete.body')}
        </p>
      </Dialog>
    </Stack>
  )
}

function EditGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 20h4L19 9l-4-4L4 16Z" />
      <path d="m13 7 4 4" />
    </svg>
  )
}

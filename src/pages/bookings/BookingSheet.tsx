import { useId, useState, type FormEvent } from 'react'
import styled from 'styled-components'
import type { Booking, BookingWriteResponse } from '../../../shared/api/bookings.ts'
import type { Member, Trip } from '../../../shared/api/types.ts'
import { formatDate } from '../../../shared/i18n/format.ts'
import type { CurrencyCode } from '../../../shared/money/currencies.ts'
import { bookingCreateSchema, bookingTypes, type BookingType } from '../../../shared/schema/booking.ts'
import { payStatuses } from '../../../shared/schema/lodging.ts'
import {
  BookingTypeIcon,
  Button,
  DateField,
  Input,
  MoneyField,
  Select,
  Sheet,
  TimeField,
  useToast,
} from '../../components/index.ts'
import { bookingsApi } from '../../lib/bookings/api.ts'
import {
  BOOKING_REQUIRED,
  BOOKING_TEXT_FIELDS,
  bookingBody,
  bookingPatch,
  bookingToForm,
  dualTimes,
  DRIVER_INCLUDES,
  emptyBookingForm,
  suggestedTitle,
  type BookingForm,
  type BookingTextField,
} from '../../lib/bookings/form.ts'
import { useT, type Translate } from '../../lib/i18n.ts'
import { useApiErrorToast } from '../../lib/role.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { Stack } from '../parts.tsx'
import { listText, slotLabelText, tripCurrencies } from './labels.ts'
import { BookingAttachments } from './Attachments.tsx'
import { Check, Checks, Folded, Group, Hint, Pair, PlaceField, TzSelect } from './parts.tsx'
import { useTripPlaces } from './use-trip-places.ts'

// Add or edit a transport or activity booking (e4-t03): pick the type, then its fields (the epic's
// list per type). Times are local wall-clock: a flight's departure and arrival each in their own
// airport's zone (default the trip's), everything else in the trip's zone. The body is checked with
// bookingCreateSchema before it goes; the answer's auto-created stops and any dates outside the trip
// are reported.

const TypeGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: ${space.sm}px;
`

const TypeOption = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs}px;
  min-height: 40px;
  padding: 0 ${space.md}px;
  border: 1px solid ${({ $active }) => ($active ? color.fjord : color.line)};
  border-radius: ${radius.pill}px;
  background: ${({ $active }) => ($active ? color.fjord : color.card)};
  color: ${({ $active }) => ($active ? color.card : color.ink)};
  font: inherit;
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
  cursor: pointer;
  ${focusRing}
`

/** Field label of a details text field (a driver's pickup is the daily one) */
const fieldLabel = (type: BookingType, key: BookingTextField, t: Translate): string =>
  type === 'driver' && key === 'pickupText'
    ? t('bookings.field.dailyPickup')
    : t(`bookings.field.${key}`)

/** Which date/time labels a type uses */
function timeLabels(type: BookingType, t: Translate) {
  switch (type) {
    case 'flight':
      return {
        startDate: t('bookings.form.departDate'),
        startTime: t('bookings.form.departTime'),
        endDate: t('bookings.form.arriveDate'),
        endTime: t('bookings.form.arriveTime'),
      }
    case 'rental':
      return {
        startDate: t('bookings.form.pickupDate'),
        startTime: t('bookings.form.pickupTime'),
        endDate: t('bookings.form.dropoffDate'),
        endTime: t('bookings.form.dropoffTime'),
      }
    case 'driver':
      return {
        startDate: t('bookings.form.driverFrom'),
        startTime: t('bookings.form.driverPickupTime'),
        endDate: t('bookings.form.driverTo'),
        endTime: '',
      }
    case 'activity':
      return {
        startDate: t('bookings.form.date'),
        startTime: t('bookings.form.startTime'),
        endDate: t('bookings.form.endDate'),
        endTime: t('bookings.form.endTime'),
      }
    default:
      return {
        startDate: t('bookings.form.departDate'),
        startTime: t('bookings.form.departTime'),
        endDate: t('bookings.form.arriveDate'),
        endTime: t('bookings.form.arriveTime'),
      }
  }
}

export interface BookingSheetProps {
  trip: Trip
  members: readonly Member[]
  /** null: a new booking (the type picker shows) */
  booking: Booking | null
  onClose: () => void
  onSaved: (res: BookingWriteResponse) => void
}

export default function BookingSheet({ trip, members, booking, onClose, onSaved }: BookingSheetProps) {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const formId = useId()
  const currencies = tripCurrencies(trip)
  const { places, add } = useTripPlaces(trip.id)
  const [form, setForm] = useState<BookingForm>(() =>
    booking
      ? bookingToForm(booking, trip.tz, currencies[0]!)
      : emptyBookingForm('flight', trip.tz, currencies[0]!, trip.startDate),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof BookingForm>(key: K, value: BookingForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))
  const setText = (key: BookingTextField, value: string) =>
    setForm((current) => ({ ...current, text: { ...current.text, [key]: value } }))
  const bias =
    trip.centerLat !== null && trip.centerLng !== null ? { lat: trip.centerLat, lng: trip.centerLng } : null
  const labels = timeLabels(form.type, t)
  const flight = form.type === 'flight'
  const preview = flight ? previewShift(form, trip.tz) : 0

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const body = bookingBody(form, trip.tz)
    const parsed = bookingCreateSchema.safeParse(body)
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.')
        if (!next[key]) next[key] = issue.code === 'too_small' ? t('bookings.form.required') : t('bookings.form.invalid')
      }
      setErrors(next)
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const res = booking
        ? await bookingsApi.patchBooking(trip.id, booking.id, bookingPatch(booking, form, trip.tz))
        : await bookingsApi.createBooking(trip.id, body)
      toast.show(t('bookings.saved', { title: res.booking.title }), { tone: 'success' })
      if (res.booking.stops.length > 0) {
        toast.show(
          t('bookings.stopsCreated', {
            slots: listText(res.booking.stops.map((stop) => slotLabelText(stop.slot, t)), t.locale),
          }),
        )
      }
      if (res.skippedDates.length > 0) {
        toast.show(
          t('bookings.skipped', {
            dates: listText(res.skippedDates.map((date) => formatDate(date, t.locale)), t.locale),
          }),
          { duration: 8000 },
        )
      }
      onSaved(res)
      onClose()
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  const textInput = (key: BookingTextField) => (
    <Input
      key={key}
      label={fieldLabel(form.type, key, t)}
      optional={!BOOKING_REQUIRED[form.type].includes(key)}
      error={errors[`details.${key}`]}
      value={form.text[key] ?? ''}
      onChange={(event) => setText(key, event.target.value)}
    />
  )
  const fields = BOOKING_TEXT_FIELDS[form.type] as readonly BookingTextField[]
  const has = (key: BookingTextField) => fields.includes(key)

  return (
    <Sheet
      open
      onClose={onClose}
      title={booking ? t('bookings.form.editTitle') : t('bookings.form.addTitle')}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={busy}>
            {busy ? t('bookings.form.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <Stack $gap="lg">
          {!booking && (
            <Group>
              <legend>{t('bookings.form.type')}</legend>
              <TypeGrid role="radiogroup" aria-label={t('bookings.form.type')}>
                {bookingTypes.map((type) => (
                  <TypeOption
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={form.type === type}
                    $active={form.type === type}
                    onClick={() => {
                      setErrors({})
                      setForm((current) => ({ ...current, type }))
                    }}
                  >
                    <BookingTypeIcon type={type} size={14} />
                    {t(`bookings.type.${type}`)}
                  </TypeOption>
                ))}
              </TypeGrid>
            </Group>
          )}

          {/* What it is */}
          {flight && (
            <>
              <Pair>
                {textInput('airline')}
                {textInput('flightNo')}
              </Pair>
              <Pair>
                {textInput('fromAirport')}
                {textInput('fromTerminal')}
              </Pair>
              <Pair>
                {textInput('toAirport')}
                {textInput('toTerminal')}
              </Pair>
            </>
          )}
          {form.type === 'rental' && (
            <Pair>
              {textInput('company')}
              {textInput('vehicle')}
            </Pair>
          )}
          {form.type === 'driver' && (
            <>
              <Pair>
                {textInput('driverName')}
                {textInput('phone')}
              </Pair>
              <Pair>
                {textInput('messenger')}
                {textInput('vehicle')}
              </Pair>
            </>
          )}
          {(form.type === 'ferry' || form.type === 'rail' || form.type === 'bus') && (
            <>
              {textInput('operator')}
              <Pair>
                {textInput('fromText')}
                {textInput('toText')}
              </Pair>
            </>
          )}
          {form.type === 'activity' && textInput('operator')}

          <Input
            label={t('bookings.form.title')}
            optional={form.type !== 'activity'}
            hint={suggestedTitle(form) ? t('bookings.form.titleHint', { title: suggestedTitle(form) }) : undefined}
            error={errors.title}
            value={form.title}
            maxLength={200}
            onChange={(event) => set('title', event.target.value)}
          />

          {/* When */}
          <Pair>
            <DateField
              label={labels.startDate}
              value={form.startDate}
              onChange={(event) => set('startDate', event.target.value)}
            />
            {form.type === 'driver' ? (
              <TimeField
                label={labels.startTime}
                value={form.pickupTime}
                onChange={(event) => set('pickupTime', event.target.value)}
              />
            ) : (
              <TimeField
                label={labels.startTime}
                value={form.startTime}
                onChange={(event) => set('startTime', event.target.value)}
              />
            )}
          </Pair>
          {flight && (
            <TzSelect
              label={t('bookings.form.departTz')}
              value={form.startTz}
              tripTz={trip.tz}
              onChange={(tz) => set('startTz', tz)}
            />
          )}
          <Pair>
            <DateField
              label={labels.endDate}
              optional
              value={form.endDate}
              onChange={(event) => set('endDate', event.target.value)}
            />
            {form.type !== 'driver' && (
              <TimeField
                label={labels.endTime}
                optional
                value={form.endTime}
                onChange={(event) => set('endTime', event.target.value)}
              />
            )}
          </Pair>
          {flight && (
            <TzSelect
              label={t('bookings.form.arriveTz')}
              value={form.endTz}
              tripTz={trip.tz}
              onChange={(tz) => set('endTz', tz)}
            />
          )}
          {flight && preview > 0 && <Hint>{t('bookings.form.overnight', { n: preview })}</Hint>}
          {!flight && <Hint>{t('bookings.form.tripTzHint', { tz: trip.tz })}</Hint>}

          {/* Where (and the type's extras) */}
          {form.type === 'rental' && (
            <>
              <PlaceField
                label={t('bookings.field.pickupPlace')}
                tripId={trip.id}
                places={places}
                bias={bias}
                placeId={form.pickupPlaceId}
                onPlaceCreated={add}
                onChange={(place) => set('pickupPlaceId', place?.id ?? null)}
              />
              {textInput('pickupText')}
              <PlaceField
                label={t('bookings.field.dropoffPlace')}
                tripId={trip.id}
                places={places}
                bias={bias}
                placeId={form.dropoffPlaceId}
                onPlaceCreated={add}
                onChange={(place) => set('dropoffPlaceId', place?.id ?? null)}
              />
              {textInput('dropoffText')}
              {trip.style === 'campervan' && (
                <Checks>
                  <Check
                    label={t('bookings.field.selfContained')}
                    checked={form.selfContained}
                    onChange={(v) => set('selfContained', v)}
                  />
                </Checks>
              )}
            </>
          )}
          {form.type === 'driver' && (
            <>
              {textInput('pickupText')}
              <MoneyField
                label={t('bookings.field.dailyRate')}
                optional
                value={form.dailyRateMinor}
                currency={form.currency as CurrencyCode}
                currencies={currencies}
                onChange={(minor) => set('dailyRateMinor', minor)}
                onCurrencyChange={(currency) => set('currency', currency)}
              />
              <Group>
                <legend>{t('bookings.field.includes')}</legend>
                <Checks>
                  {DRIVER_INCLUDES.map((item) => (
                    <Check
                      key={item}
                      label={t(`bookings.include.${item}`)}
                      checked={form.includes.includes(item)}
                      onChange={(on) =>
                        set(
                          'includes',
                          on ? [...form.includes, item] : form.includes.filter((x) => x !== item),
                        )
                      }
                    />
                  ))}
                </Checks>
              </Group>
            </>
          )}
          {form.type === 'activity' && (
            <>
              <PlaceField
                label={t('bookings.field.meetingPlace')}
                tripId={trip.id}
                places={places}
                bias={bias}
                placeId={form.meetingPlaceId}
                onPlaceCreated={add}
                onChange={(place) => set('meetingPlaceId', place?.id ?? null)}
              />
              {textInput('meetingText')}
              <Input
                label={t('bookings.field.checkInMinutes')}
                optional
                inputMode="numeric"
                error={errors['details.checkInMinutesBefore']}
                value={form.checkInMinutes}
                onChange={(event) => set('checkInMinutes', event.target.value.replace(/\D/g, ''))}
              />
            </>
          )}

          {/* Money */}
          <Pair>
            <MoneyField
              label={t('bookings.form.price')}
              optional
              error={errors.currency}
              value={form.priceMinor}
              currency={form.currency as CurrencyCode}
              currencies={currencies}
              onChange={(minor) => set('priceMinor', minor)}
              onCurrencyChange={(currency) => set('currency', currency)}
            />
            <Select
              label={t('bookings.form.payStatus')}
              value={form.payStatus}
              onChange={(event) => set('payStatus', event.target.value as BookingForm['payStatus'])}
            >
              {payStatuses.map((status) => (
                <option key={status} value={status}>
                  {t(`bookings.pay.${status}`)}
                </option>
              ))}
            </Select>
          </Pair>
          <Select
            label={t('bookings.form.payer')}
            hint={t('bookings.form.payerHint')}
            value={form.payerMemberId}
            onChange={(event) => set('payerMemberId', event.target.value)}
          >
            <option value="">{t('bookings.form.payerNone')}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
          <Pair>
            <DateField
              label={t('bookings.form.cancelDate')}
              optional
              hint={t('bookings.form.cancelHint', { tz: trip.tz })}
              value={form.cancelDate}
              onChange={(event) => set('cancelDate', event.target.value)}
            />
            <TimeField
              label={t('bookings.form.cancelTime')}
              optional
              value={form.cancelTime}
              onChange={(event) => set('cancelTime', event.target.value)}
            />
          </Pair>

          <Folded open={Boolean(booking)}>
            {has('baggage') && textInput('baggage')}
            {form.type === 'rental' && (
              <>
                {textInput('insurance')}
                <Pair>
                  <MoneyField
                    label={t('bookings.field.excess')}
                    optional
                    value={form.excessMinor}
                    currency={form.currency as CurrencyCode}
                    currencies={currencies}
                    onChange={(minor) => set('excessMinor', minor)}
                    onCurrencyChange={(currency) => set('currency', currency)}
                  />
                  <MoneyField
                    label={t('bookings.field.deposit')}
                    optional
                    value={form.depositMinor}
                    currency={form.currency as CurrencyCode}
                    currencies={currencies}
                    onChange={(minor) => set('depositMinor', minor)}
                    onCurrencyChange={(currency) => set('currency', currency)}
                  />
                </Pair>
                {textInput('mileageLimit')}
              </>
            )}
            {has('vehicleLength') && textInput('vehicleLength')}
            {has('weatherPolicy') && textInput('weatherPolicy')}
            <Input
              label={t('bookings.form.ref')}
              optional
              value={form.ref}
              maxLength={100}
              onChange={(event) => set('ref', event.target.value)}
            />
            <Input
              label={t('bookings.form.note')}
              optional
              value={form.note}
              maxLength={5000}
              onChange={(event) => set('note', event.target.value)}
            />
          </Folded>
          <BookingAttachments tripId={trip.id} owner={booking ? { bookingId: booking.id } : null} />
          {Object.keys(errors).length > 0 && <Hint $tone="danger">{t('bookings.form.fixErrors')}</Hint>}
        </Stack>
      </form>
    </Sheet>
  )
}

/** The arrival's local day minus the departure's, from the form (0 when incomplete) */
function previewShift(form: BookingForm, tripTz: string): number {
  const body = bookingBody(form, tripTz)
  if (!body.startAt || !body.endAt) return 0
  const times = dualTimes(
    { startAt: body.startAt, endAt: body.endAt, startTz: body.startTz ?? null, endTz: body.endTz ?? null },
    tripTz,
  )
  return times?.dayShift ?? 0
}

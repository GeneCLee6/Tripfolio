import { useId, useState, type FormEvent } from 'react'
import type { Lodging } from '../../../shared/api/bookings.ts'
import type { Trip } from '../../../shared/api/types.ts'
import type { CurrencyCode } from '../../../shared/money/currencies.ts'
import { campTypes, lodgingCreateSchema, payStatuses } from '../../../shared/schema/lodging.ts'
import {
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
  daysBetween,
  emptyLodgingForm,
  lodgingBody,
  lodgingPatch,
  lodgingToForm,
  type LodgingForm,
} from '../../lib/bookings/form.ts'
import { refreshLodgings, useTripLodgings } from '../../lib/bookings/lodging-store.ts'
import { useT } from '../../lib/i18n.ts'
import { useApiErrorToast } from '../../lib/role.ts'
import { Stack } from '../parts.tsx'
import { tripCurrencies } from './labels.ts'
import { Check, Checks, Folded, Group, Hint, Pair, PlaceField } from './parts.tsx'
import { useTripPlaces } from './use-trip-places.ts'

// Add or edit a lodging (e4-t02): one row for several nights [checkIn, checkOut). Name and dates
// first (prefilled to the night it was opened from), the campsite type and facilities on a
// campervan trip, price, payment and the cancel-by in the trip's zone; the rest folded under
// 「更多欄位」. Saving re-reads the days so every 「今晚住」 line follows; nights that belonged to
// another lodging are reported.

export interface LodgingSheetProps {
  trip: Trip
  /** null: a new lodging */
  lodgingId: string | null
  /** The lodging itself when the caller has it (the bookings page) */
  lodging?: Lodging
  /** The night it was opened for (a new lodging starts here) */
  date?: string
  onClose: () => void
  onSaved?: () => void
}

export default function LodgingSheet({ trip, lodgingId, lodging: given, date, onClose, onSaved }: LodgingSheetProps) {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const formId = useId()
  const store = useTripLodgings(trip.id)
  const existing = given ?? (lodgingId ? store.lodgings?.find((l) => l.id === lodgingId) : undefined)
  const currencies = tripCurrencies(trip)
  const campervan = trip.style === 'campervan'
  const { places, add } = useTripPlaces(trip.id)
  const [form, setForm] = useState<LodgingForm>(() =>
    existing
      ? lodgingToForm(existing, trip.tz, currencies[0]!)
      : emptyLodgingForm(date ?? trip.startDate, currencies[0]!),
  )
  // The store may still be loading when an existing lodging is opened from a line
  const [seen, setSeen] = useState(existing?.id ?? null)
  if (existing && seen !== existing.id) {
    setSeen(existing.id)
    setForm(lodgingToForm(existing, trip.tz, currencies[0]!))
  }
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof LodgingForm>(key: K, value: LodgingForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const nights = form.checkIn && form.checkOut ? daysBetween(form.checkIn, form.checkOut) : 0
  const nameError = touched && !form.name.trim() ? t('bookings.form.required') : undefined
  const dateError = touched && nights < 1 ? t('bookings.lodging.checkOutAfter') : undefined
  const waiting = lodgingId !== null && !existing

  const done = async () => {
    await refreshLodgings(trip.id).catch(() => {})
    onSaved?.()
    onClose()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    const body = lodgingBody(form, campervan)
    if (!lodgingCreateSchema.safeParse(body).success || nights < 1) return
    setBusy(true)
    try {
      const res = existing
        ? await bookingsApi.patchLodging(trip.id, existing.id, lodgingPatch(form, campervan))
        : await bookingsApi.createLodging(trip.id, body)
      toast.show(t('bookings.lodging.saved', { name: res.lodging.name }), { tone: 'success' })
      if (res.conflicts.length > 0) {
        toast.show(t.plural('bookings.lodging.conflicts', res.conflicts.length), { duration: 8000 })
      }
      await done()
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    setBusy(true)
    try {
      await bookingsApi.deleteLodging(trip.id, existing.id)
      toast.show(t('bookings.lodging.deleted', { name: existing.name }))
      await done()
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? t('bookings.lodging.editTitle') : t('bookings.lodging.addTitle')}
      actions={
        <>
          {existing && (
            <Button variant="danger" onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))} disabled={busy}>
              {confirmDelete ? t('bookings.lodging.deleteConfirm') : t('bookings.lodging.delete')}
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={busy || waiting}>
            {busy ? t('bookings.form.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <Stack $gap="lg">
          <Input
            label={t('bookings.lodging.name')}
            error={nameError}
            value={form.name}
            maxLength={200}
            onChange={(event) => set('name', event.target.value)}
          />
          <PlaceField
            label={t('bookings.lodging.place')}
            tripId={trip.id}
            places={places}
            bias={trip.centerLat !== null && trip.centerLng !== null ? { lat: trip.centerLat, lng: trip.centerLng } : null}
            placeId={form.placeId}
            onPlaceCreated={add}
            onChange={(place) =>
              setForm((current) => ({
                ...current,
                placeId: place?.id ?? null,
                name: current.name || (place ? place.nameLocal : ''),
              }))
            }
          />
          <Pair>
            <DateField
              label={t('bookings.lodging.checkIn')}
              value={form.checkIn}
              onChange={(event) => set('checkIn', event.target.value)}
            />
            <DateField
              label={t('bookings.lodging.checkOut')}
              error={dateError}
              hint={nights > 0 ? t.plural('bookings.nights', nights) : undefined}
              value={form.checkOut}
              onChange={(event) => set('checkOut', event.target.value)}
            />
          </Pair>
          <Pair>
            <TimeField
              label={t('bookings.lodging.checkInTime')}
              optional
              value={form.checkInTime}
              onChange={(event) => set('checkInTime', event.target.value)}
            />
            <TimeField
              label={t('bookings.lodging.checkOutTime')}
              optional
              value={form.checkOutTime}
              onChange={(event) => set('checkOutTime', event.target.value)}
            />
          </Pair>
          {campervan && (
            <>
              <Select
                label={t('bookings.lodging.campType')}
                value={form.campType}
                onChange={(event) => set('campType', event.target.value as LodgingForm['campType'])}
              >
                <option value="">{t('bookings.lodging.campTypeNone')}</option>
                {campTypes.map((type) => (
                  <option key={type} value={type}>
                    {t(`bookings.camp.${type}`)}
                  </option>
                ))}
              </Select>
              <Group>
                <legend>{t('bookings.lodging.facilities')}</legend>
                <Checks>
                  <Check label={t('bookings.facility.power')} checked={form.power} onChange={(v) => set('power', v)} />
                  <Check label={t('bookings.facility.water')} checked={form.water} onChange={(v) => set('water', v)} />
                  <Check label={t('bookings.facility.dump')} checked={form.dump} onChange={(v) => set('dump', v)} />
                </Checks>
              </Group>
            </>
          )}
          <Pair>
            <MoneyField
              label={t('bookings.form.price')}
              optional
              value={form.priceMinor}
              currency={form.currency as CurrencyCode}
              currencies={currencies}
              onChange={(minor) => set('priceMinor', minor)}
              onCurrencyChange={(currency) => set('currency', currency)}
            />
            <Select
              label={t('bookings.form.payStatus')}
              value={form.payStatus}
              onChange={(event) => set('payStatus', event.target.value as LodgingForm['payStatus'])}
            >
              {payStatuses.map((status) => (
                <option key={status} value={status}>
                  {t(`bookings.pay.${status}`)}
                </option>
              ))}
            </Select>
          </Pair>
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
          <Folded open={Boolean(existing)}>
            <Pair>
              <Input
                label={t('bookings.lodging.roomType')}
                optional
                value={form.roomType}
                onChange={(event) => set('roomType', event.target.value)}
              />
              <Input
                label={t('bookings.lodging.guests')}
                optional
                inputMode="numeric"
                value={form.guests}
                onChange={(event) => set('guests', event.target.value.replace(/\D/g, ''))}
              />
            </Pair>
            <Pair>
              <Input
                label={t('bookings.lodging.platform')}
                optional
                value={form.platform}
                onChange={(event) => set('platform', event.target.value)}
              />
              <Input
                label={t('bookings.form.ref')}
                optional
                value={form.ref}
                onChange={(event) => set('ref', event.target.value)}
              />
            </Pair>
            <Input
              label={t('bookings.lodging.phone')}
              optional
              type="tel"
              value={form.phone}
              onChange={(event) => set('phone', event.target.value)}
            />
            <Input
              label={t('bookings.form.note')}
              optional
              value={form.note}
              maxLength={5000}
              onChange={(event) => set('note', event.target.value)}
            />
          </Folded>
          {waiting && <Hint>{t('common.loading')}</Hint>}
        </Stack>
      </form>
    </Sheet>
  )
}

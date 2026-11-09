import { useId, useState } from 'react'
import styled from 'styled-components'
import type { GeoPoint } from '../../../shared/api/geo.ts'
import type { Place, Stop, Trip } from '../../../shared/api/types.ts'
import { isCurrencyCode, type CurrencyCode } from '../../../shared/money/currencies.ts'
import {
  bookingStates,
  stopPatchSchema,
  stopTypes,
  type BookingState,
  type StopType,
} from '../../../shared/schema/index.ts'
import {
  Button,
  Dialog,
  IconButton,
  Input,
  MoneyField,
  PlacePicker,
  SegmentedControl,
  StopTypeIcon,
  TimeField,
  type PlacePick,
} from '../../components/index.ts'
import { CloseIcon, PlusIcon, TrashIcon } from '../../components/icons.tsx'
import { rovingKeyDown } from '../../components/roving.ts'
import { controlBox } from '../../components/styles.ts'
import { useT } from '../../lib/i18n.ts'
import { placeName } from '../../lib/itinerary/places.ts'
import { draftToInstants, localTime } from '../../lib/itinerary/time.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { BOOKING_LABEL, costCurrencies, STOP_TYPE_LABEL } from './labels.ts'

// The stop editor (e2-t03): in the detail pane on desktop and a Sheet below (the trip layout decides).
// Times are typed as the trip's local wall clock on the stop's day and stored as UTC instants.

/** The editable fields of a stop, as PATCH / POST take them */
export type StopValues = Pick<
  Stop,
  | 'type'
  | 'title'
  | 'placeId'
  | 'startAt'
  | 'endAt'
  | 'durationMin'
  | 'costMinor'
  | 'currency'
  | 'booking'
  | 'note'
  | 'links'
  | 'isBackup'
>

export interface StopEditorProps {
  trip: Trip
  /** The stop's day date (YYYY-MM-DD) that the local times belong to */
  date: string
  /** null: a new stop */
  stop: Stop | null
  places: readonly Place[]
  /** Search bias: the previous stop's place or the trip centre */
  bias: GeoPoint | null
  onSubmit: (values: StopValues) => void
  onDelete?: () => void
  onPlaceCreated: (place: Place) => void
  onClose: () => void
}

const Form = styled.form`
  display: grid;
  gap: ${space.lg}px;
`

const Group = styled.fieldset`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
  > legend {
    padding: 0;
    margin-bottom: ${space.xs}px;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.medium};
  }
`

const TypeGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs + 2}px;
`

const TypeOption = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs + 2}px;
  min-height: 36px;
  padding: 0 ${space.md}px;
  border: 1px solid ${({ $active }) => ($active ? color.fjord : color.line)};
  border-radius: ${radius.pill}px;
  background: ${({ $active }) => ($active ? color.glacier : color.card)};
  color: ${({ $active }) => ($active ? color.fjordInk : color.ink)};
  font: inherit;
  font-size: ${fontSize.sm}px;
  cursor: pointer;
  ${focusRing}
`

const Two = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${space.md}px;
`

const PlaceBox = styled.div`
  display: grid;
  gap: 2px;
  padding: ${space.sm}px ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.paper};
`

const PlaceTitle = styled.span`
  font-weight: ${fontWeight.semibold};
  overflow-wrap: anywhere;
`

const Muted = styled.span`
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
  overflow-wrap: anywhere;
`

const Mono = styled(Muted)`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
  align-items: center;
`

const LinkRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: ${space.xs}px;
  align-items: end;
`

const Textarea = styled.textarea`
  ${controlBox}
  min-height: 96px;
  padding: ${space.sm}px ${space.md}px;
  resize: vertical;
  font: inherit;
`

const Label = styled.label`
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
`

const Check = styled.label`
  display: flex;
  gap: ${space.sm}px;
  align-items: center;
  font-size: ${fontSize.sm}px;
  > input {
    width: 18px;
    height: 18px;
    accent-color: ${color.fjord};
  }
`

const Hint = styled.p<{ $error?: boolean }>`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${({ $error }) => ($error ? color.danger : color.muted)};
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
  justify-content: space-between;
  padding-top: ${space.sm}px;
  border-top: 1px solid ${color.line};
`

const isHttp = (url: string) => /^https?:\/\/\S+$/i.test(url.trim())

export function StopEditor({
  trip,
  date,
  stop,
  places,
  bias,
  onSubmit,
  onDelete,
  onPlaceCreated,
  onClose,
}: StopEditorProps) {
  const t = useT()
  const currencies = costCurrencies(trip, stop?.currency ?? null)
  const [type, setType] = useState<StopType>(stop?.type ?? 'sight')
  const [typeTouched, setTypeTouched] = useState(Boolean(stop))
  const [title, setTitle] = useState(stop?.title ?? '')
  const [placeId, setPlaceId] = useState<string | null>(stop?.placeId ?? null)
  const [picking, setPicking] = useState(!stop?.placeId)
  const [manual, setManual] = useState(false)
  const [known, setKnown] = useState<readonly Place[]>(places)
  const [start, setStart] = useState(localTime(stop?.startAt ?? null, trip.tz))
  const [end, setEnd] = useState(localTime(stop?.endAt ?? null, trip.tz))
  const [duration, setDuration] = useState(stop?.durationMin?.toString() ?? '')
  const [costMinor, setCostMinor] = useState<number | null>(stop?.costMinor ?? null)
  const [currency, setCurrency] = useState<CurrencyCode>(
    (stop?.currency && isCurrencyCode(stop.currency) ? stop.currency : currencies[0]) ?? 'AUD',
  )
  const [booking, setBooking] = useState<BookingState>(stop?.booking ?? 'none')
  const [note, setNote] = useState(stop?.note ?? '')
  const [links, setLinks] = useState<string[]>(stop?.links.map((link) => link.url) ?? [])
  const [isBackup, setIsBackup] = useState(stop?.isBackup ?? false)
  const [showErrors, setShowErrors] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const noteId = useId()

  const place = placeId ? known.find((item) => item.id === placeId) : undefined
  const durationValue = duration.trim() === '' ? null : Number(duration)
  const durationInvalid =
    durationValue !== null && (!Number.isInteger(durationValue) || durationValue < 0)
  const linkErrors = links.map((url) => (url.trim() && !isHttp(url) ? true : false))
  const endsNextDay = Boolean(start && end && end <= start)

  const pickPlace = (pick: PlacePick) => {
    if (pick.manual) {
      setManual(true)
      return
    }
    setManual(false)
    setKnown((list) => (list.some((item) => item.id === pick.placeId) ? list : [...list, pick.place]))
    setPlaceId(pick.placeId)
    setPicking(false)
    if (!typeTouched) setType(pick.suggestedType)
  }

  const submit = () => {
    const { startAt, endAt } = draftToInstants({ start, end }, date, trip.tz)
    const values: StopValues = {
      type,
      title: title.trim(),
      placeId,
      startAt,
      endAt,
      durationMin: durationInvalid ? null : durationValue,
      costMinor,
      currency: costMinor === null ? null : currency,
      booking,
      note,
      links: links.filter((url) => url.trim()).map((url) => ({ url: url.trim() })),
      isBackup,
    }
    const parsed = stopPatchSchema.safeParse(values)
    if (!parsed.success || durationInvalid || linkErrors.some(Boolean)) {
      setShowErrors(true)
      return
    }
    onSubmit(values)
    onClose()
  }

  const name = title.trim() || (place ? placeName(place, t.locale) : t('itinerary.stop.untitled'))

  return (
    <Form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Group>
        <legend>{t('itinerary.editor.type')}</legend>
        <TypeGrid
          role="radiogroup"
          aria-label={t('itinerary.editor.type')}
          onKeyDown={(event) =>
            rovingKeyDown(event, stopTypes, type, (value) => {
              setType(value)
              setTypeTouched(true)
            })
          }
        >
          {stopTypes.map((value) => (
            <TypeOption
              key={value}
              type="button"
              role="radio"
              aria-checked={type === value}
              tabIndex={type === value ? 0 : -1}
              data-roving=""
              $active={type === value}
              onClick={() => {
                setType(value)
                setTypeTouched(true)
              }}
            >
              <StopTypeIcon type={value} size={14} />
              {t(STOP_TYPE_LABEL[value])}
            </TypeOption>
          ))}
        </TypeGrid>
      </Group>

      <Group>
        <legend>{t('itinerary.editor.place')}</legend>
        {place && !picking && (
          <PlaceBox>
            <PlaceTitle>{placeName(place, t.locale)}</PlaceTitle>
            {place.address && <Muted>{place.address}</Muted>}
            <Mono>
              {t('place.coords', { lat: place.lat.toFixed(5), lng: place.lng.toFixed(5) })}
            </Mono>
            <Row>
              <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
                {t('itinerary.editor.changePlace')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPlaceId(null)
                  setPicking(true)
                }}
              >
                {t('itinerary.editor.removePlace')}
              </Button>
            </Row>
          </PlaceBox>
        )}
        {picking && (
          <PlacePicker
            tripId={trip.id}
            places={known}
            bias={bias}
            onPick={pickPlace}
            onPlaceCreated={onPlaceCreated}
          />
        )}
        {manual && <Hint role="status">{t('itinerary.editor.manualPin')}</Hint>}
      </Group>

      <Input
        label={t('itinerary.editor.name')}
        hint={t('itinerary.editor.nameHint')}
        placeholder={t('itinerary.editor.namePlaceholder')}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
      />

      <Group>
        <Two>
          <TimeField
            label={t('itinerary.editor.start')}
            optional
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
          <TimeField
            label={t('itinerary.editor.end')}
            optional
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </Two>
        <Hint>
          {endsNextDay
            ? t('itinerary.editor.endNextDay')
            : t('itinerary.editor.timeHint', { tz: trip.tz })}
        </Hint>
        <Input
          label={t('itinerary.editor.duration')}
          hint={t('itinerary.editor.durationHint')}
          error={showErrors && durationInvalid ? t('itinerary.editor.invalidDuration') : undefined}
          optional
          type="number"
          inputMode="numeric"
          min={0}
          step={5}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
        />
      </Group>

      <MoneyField
        label={t('itinerary.editor.cost')}
        optional
        value={costMinor}
        currency={currency}
        currencies={currencies}
        onChange={setCostMinor}
        onCurrencyChange={setCurrency}
      />

      <Group>
        <legend>{t('itinerary.editor.booking')}</legend>
        <SegmentedControl
          label={t('itinerary.editor.booking')}
          options={bookingStates.map((value) => ({ value, label: t(BOOKING_LABEL[value]) }))}
          value={booking}
          onChange={setBooking}
          size="sm"
        />
      </Group>

      <Check>
        <input type="checkbox" checked={isBackup} onChange={(event) => setIsBackup(event.target.checked)} />
        {t('itinerary.editor.backup')}
      </Check>

      <Group>
        <Label htmlFor={noteId}>{t('itinerary.editor.note')}</Label>
        <Textarea
          id={noteId}
          value={note}
          maxLength={5000}
          onChange={(event) => setNote(event.target.value)}
        />
      </Group>

      <Group>
        <legend>{t('itinerary.editor.links')}</legend>
        {links.map((url, index) => (
          <LinkRow key={index}>
            <Input
              label={t('itinerary.editor.link', { n: index + 1 })}
              type="url"
              inputMode="url"
              placeholder={t('itinerary.editor.linkPlaceholder')}
              value={url}
              error={
                showErrors && linkErrors[index] ? t('itinerary.editor.invalidLink') : undefined
              }
              onChange={(event) =>
                setLinks((list) => list.map((item, i) => (i === index ? event.target.value : item)))
              }
            />
            <IconButton
              label={t('itinerary.editor.removeLink', { n: index + 1 })}
              icon={<CloseIcon size={18} />}
              onClick={() => setLinks((list) => list.filter((_, i) => i !== index))}
            />
          </LinkRow>
        ))}
        {links.length < 20 && (
          <Row>
            <Button size="sm" variant="ghost" onClick={() => setLinks((list) => [...list, ''])}>
              <PlusIcon size={16} />
              {t('itinerary.editor.addLink')}
            </Button>
          </Row>
        )}
      </Group>

      {showErrors && (
        <Hint role="alert" $error>
          {t('itinerary.editor.invalid')}
        </Hint>
      )}

      <Actions>
        {stop && onDelete ? (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <TrashIcon size={16} />
            {t('itinerary.editor.delete')}
          </Button>
        ) : (
          <span />
        )}
        <Row>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit">
            {t('common.save')}
          </Button>
        </Row>
      </Actions>

      {stop && onDelete && (
        <Dialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title={t('itinerary.editor.deleteTitle', { name })}
          actions={
            <>
              <Button onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmDelete(false)
                  onDelete()
                  onClose()
                }}
              >
                {t('common.delete')}
              </Button>
            </>
          }
        >
          <p>{t('itinerary.editor.deleteBody')}</p>
        </Dialog>
      )}
    </Form>
  )
}

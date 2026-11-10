import { useId, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import type { GeoPoint } from '../../../shared/api/geo.ts'
import type { Place, Stop, Trip } from '../../../shared/api/types.ts'
import { bookingStates, stopPatchSchema, stopTypes } from '../../../shared/schema/index.ts'
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
import { carryConflicts, changedFields, mergeFields, sameValue } from '../../lib/itinerary/merge.ts'
import { placeName } from '../../lib/itinerary/places.ts'
import {
  draftValues,
  toDraft,
  type StopDraft,
  type StopValues,
} from '../../lib/itinerary/stop-draft.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { BOOKING_LABEL, costCurrencies, STOP_TYPE_LABEL } from './labels.ts'

// The stop editor (e2-t03): in the detail pane on desktop and a Sheet below (the trip layout decides).
// Times are typed as the trip's local wall clock on the stop's day and stored as UTC instants.
//
// Live (e2-t08b): `stop` is the stop as the page has it now. When someone else changes it while
// the editor is open, fields the person has not touched take the new value silently; a field they
// are editing keeps their value and shows 「其他人剛改了這個欄位」 with 「使用他們的版本」
// (src/lib/itinerary/merge.ts). Saving sends only the fields the person changed.

export type { StopValues } from '../../lib/itinerary/stop-draft.ts'

export interface StopEditorProps {
  trip: Trip
  /** The stop's day date (YYYY-MM-DD) that the local times belong to */
  date: string
  /** null: a new stop. May change while open (another member's edit): merged field by field */
  stop: Stop | null
  /** The stop was deleted (by someone else) while the editor was open */
  removed?: boolean
  places: readonly Place[]
  /** Search bias: the previous stop's place or the trip centre */
  bias: GeoPoint | null
  /** `changed`: for an existing stop, only the fields the person changed */
  onSubmit: (values: StopValues, changed: Partial<StopValues>) => void
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

const ConflictBox = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
  align-items: center;
  padding: ${space.xs}px ${space.sm}px;
  border-left: 3px solid ${color.warning};
  background: ${color.paper};
  font-size: ${fontSize.sm}px;
`

export function StopEditor({
  trip,
  date,
  stop,
  removed = false,
  places,
  bias,
  onSubmit,
  onDelete,
  onPlaceCreated,
  onClose,
}: StopEditorProps) {
  const t = useT()
  const currencies = costCurrencies(trip, stop?.currency ?? null)
  // base: the stop as last seen (what "untouched" means); draft: the form
  const [base, setBase] = useState<StopDraft>(() => toDraft(stop, trip.tz, currencies))
  const [draft, setDraft] = useState<StopDraft>(base)
  const [conflicts, setConflicts] = useState<Partial<StopDraft>>({})
  const [typeTouched, setTypeTouched] = useState(Boolean(stop))
  const [picking, setPicking] = useState(!stop?.placeId)
  const [manual, setManual] = useState(false)
  const [known, setKnown] = useState<readonly Place[]>(places)
  const [showErrors, setShowErrors] = useState(false)

  // Someone else changed the stop: merge field by field (during render, before anything paints)
  if (stop) {
    const remote = toDraft(stop, trip.tz, currencies)
    if (!sameValue(remote, base)) {
      const result = mergeFields(base, draft, remote)
      setBase(remote)
      setDraft(result.merged)
      setConflicts(carryConflicts(conflicts, result.conflicts, result.merged))
      if (result.updated.includes('placeId') && result.merged.placeId) setPicking(false)
    }
  }
  for (const place of places) {
    if (!known.some((item) => item.id === place.id)) {
      setKnown([...known, ...places.filter((p) => !known.some((item) => item.id === p.id))])
      break
    }
  }

  const {
    type,
    title,
    placeId,
    start,
    end,
    duration,
    costMinor,
    currency,
    booking,
    note,
    links,
    isBackup,
  } = draft
  const field =
    <K extends keyof StopDraft>(key: K) =>
    (value: StopDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value }))
  const setType = field('type')
  const setTitle = field('title')
  const setPlaceId = field('placeId')
  const setStart = field('start')
  const setEnd = field('end')
  const setDuration = field('duration')
  const setCostMinor = field('costMinor')
  const setCurrency = field('currency')
  const setBooking = field('booking')
  const setNote = field('note')
  const setIsBackup = field('isBackup')
  const setLinks = (change: (list: string[]) => string[]) =>
    setDraft((current) => ({ ...current, links: change(current.links) }))

  /** 「其他人剛改了這個欄位」 under a field group, while their value differs from the form's */
  const conflictFor = (keys: (keyof StopDraft)[]): ReactNode => {
    const open = keys.filter((key) => key in conflicts && !sameValue(conflicts[key], draft[key]))
    if (open.length === 0) return null
    return (
      <ConflictBox role="status" data-testid="stop-conflict">
        <span>{t('itinerary.editor.remoteChanged')}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft((current) => {
              const next = { ...current }
              for (const key of open) next[key] = conflicts[key] as never
              return next
            })
            setConflicts((current) => {
              const next = { ...current }
              for (const key of open) delete next[key]
              return next
            })
          }}
        >
          {t('itinerary.editor.useTheirs')}
        </Button>
      </ConflictBox>
    )
  }
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
    setKnown((list) =>
      list.some((item) => item.id === pick.placeId) ? list : [...list, pick.place],
    )
    setPlaceId(pick.placeId)
    setPicking(false)
    if (!typeTouched) setType(pick.suggestedType)
  }

  const submit = () => {
    const values = draftValues(draft, date, trip.tz)
    const parsed = stopPatchSchema.safeParse(values)
    if (!parsed.success || durationInvalid || linkErrors.some(Boolean)) {
      setShowErrors(true)
      return
    }
    onSubmit(values, stop ? changedFields(draftValues(base, date, trip.tz), values) : values)
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
        {conflictFor(['type'])}
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
        {conflictFor(['placeId'])}
      </Group>

      <Input
        label={t('itinerary.editor.name')}
        hint={t('itinerary.editor.nameHint')}
        placeholder={t('itinerary.editor.namePlaceholder')}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
      />
      {conflictFor(['title'])}

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
        {conflictFor(['start', 'end', 'duration'])}
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
      {conflictFor(['costMinor', 'currency'])}

      <Group>
        <legend>{t('itinerary.editor.booking')}</legend>
        <SegmentedControl
          label={t('itinerary.editor.booking')}
          options={bookingStates.map((value) => ({ value, label: t(BOOKING_LABEL[value]) }))}
          value={booking}
          onChange={setBooking}
          size="sm"
        />
        {conflictFor(['booking'])}
      </Group>

      <Check>
        <input
          type="checkbox"
          checked={isBackup}
          onChange={(event) => setIsBackup(event.target.checked)}
        />
        {t('itinerary.editor.backup')}
      </Check>
      {conflictFor(['isBackup'])}

      <Group>
        <Label htmlFor={noteId}>{t('itinerary.editor.note')}</Label>
        <Textarea
          id={noteId}
          value={note}
          maxLength={5000}
          onChange={(event) => setNote(event.target.value)}
        />
        {conflictFor(['note'])}
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
        {conflictFor(['links'])}
      </Group>

      {removed && (
        <Hint role="alert" $error>
          {t('itinerary.editor.removedRemote')}
        </Hint>
      )}

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
          <Button variant="primary" type="submit" disabled={removed}>
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

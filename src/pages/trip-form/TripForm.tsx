import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import styled from 'styled-components'
import type { Trip } from '../../../shared/api/types.ts'
import { CURRENCIES, CURRENCY_CODES } from '../../../shared/money/currencies.ts'
import { tripStyles } from '../../../shared/schema/trip.ts'
import {
  Button,
  Chip,
  ColorSwatches,
  DateField,
  Input,
  Select,
  useToast,
} from '../../components/index.ts'
import { api, isApiError } from '../../lib/api.ts'
import { errorMessageKey } from '../../lib/errors.ts'
import { useT, type Translate } from '../../lib/i18n.ts'
import {
  emptyTripForm,
  issuesToErrors,
  tripToForm,
  validateCreate,
  validatePatch,
  type FieldErrors,
  type TripFormField,
  type TripFormValues,
} from '../../lib/trip-form.ts'
import { browserTimeZone, guessFromDestination, timeZoneOptions } from '../../lib/trip-prefill.ts'
import { color, fontSize, fontWeight, media, space } from '../../styles/tokens.ts'

// Create and edit a trip (e1-t02, AC-1.1). The same form is a page on phones and the body of a
// Dialog from tablet width. While the time zone and local currencies have not been touched by hand,
// they follow the destination text.

const Form = styled.form`
  display: grid;
  gap: ${space.xl}px;
`

const Group = styled.fieldset`
  display: grid;
  gap: ${space.lg}px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
`

const Legend = styled.legend`
  padding: 0;
  margin-bottom: ${space.md}px;
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${color.muted};
`

const Pair = styled.div`
  display: grid;
  gap: ${space.lg}px;
  @media ${media.tablet} {
    grid-template-columns: 1fr 1fr;
  }
`

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
`

const SubGroup = styled.fieldset`
  display: grid;
  gap: ${space.xs}px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
`

const SubLegend = styled.legend`
  padding: 0;
  margin-bottom: ${space.xs}px;
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
`

const Hint = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const FormError = styled.p`
  margin: 0;
  color: ${color.danger};
  font-size: ${fontSize.sm}px;
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: ${space.sm}px;
`

const message = (t: Translate, errors: FieldErrors, field: TripFormField): string | undefined => {
  const error = errors[field]
  return error ? t(error.key, error.params) : undefined
}

export interface TripFormProps {
  /** Edit this trip; without it the form creates one */
  trip?: Trip
  onDone: (trip: Trip) => void
  onCancel?: () => void
}

export function TripForm({ trip, onDone, onCancel }: TripFormProps) {
  const t = useT()
  const toast = useToast()
  const editing = Boolean(trip)
  const [values, setValues] = useState<TripFormValues>(() =>
    trip ? tripToForm(trip) : emptyTripForm(browserTimeZone()),
  )
  // Editing starts "touched": a saved choice is never overwritten by the destination guess
  const [touched, setTouched] = useState({ tz: editing, localCurrencies: editing })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const localHintId = useId()

  const zones = useMemo(() => timeZoneOptions(values.tz, browserTimeZone()), [values.tz])
  const currencies = useMemo(() => {
    const codes: string[] = [...CURRENCY_CODES]
    for (const code of [values.baseCurrency, values.secondaryCurrency, ...values.localCurrencies])
      if (code && !codes.includes(code)) codes.push(code)
    return codes
  }, [values.baseCurrency, values.secondaryCurrency, values.localCurrencies])
  const currencyLabel = (code: string) =>
    code in CURRENCIES
      ? `${code} · ${CURRENCIES[code as keyof typeof CURRENCIES].name[t.locale]}`
      : code

  // After a failed submit, take the person to the first field that needs fixing
  useEffect(() => {
    if (Object.keys(errors).length === 0) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  const set = <K extends TripFormField>(field: K, value: TripFormValues[K]) => {
    setValues((previous) => ({ ...previous, [field]: value }))
    if (errors[field]) setErrors(({ [field]: _cleared, ...rest }) => rest)
  }

  const setDestination = (destination: string) => {
    const guess = guessFromDestination(destination)
    setValues((previous) => ({
      ...previous,
      destination,
      tz: !touched.tz && guess.tz ? guess.tz : previous.tz,
      localCurrencies: touched.localCurrencies ? previous.localCurrencies : guess.localCurrencies,
    }))
  }

  const toggleLocal = (code: string) => {
    setTouched((previous) => ({ ...previous, localCurrencies: true }))
    set(
      'localCurrencies',
      values.localCurrencies.includes(code)
        ? values.localCurrencies.filter((c) => c !== code)
        : [...values.localCurrencies, code],
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const checked = trip ? validatePatch(values) : validateCreate(values)
    if (!checked.ok) {
      setErrors(checked.errors)
      return
    }
    setErrors({})
    setSaving(true)
    try {
      let saved: Trip
      if (trip) {
        const patch = validatePatch(values)
        if (!patch.ok) return
        saved = (await api.patchTrip(trip.id, patch.body)).trip
        toast.show(t('tripForm.saved'), { tone: 'success' })
      } else {
        const create = validateCreate(values)
        if (!create.ok) return
        saved = (await api.createTrip(create.body)).trip
        toast.show(t('tripForm.created'), { tone: 'success' })
      }
      onDone(saved)
    } catch (error) {
      if (isApiError(error) && error.status === 422) setErrors(issuesToErrors(error.details))
      const { key, code } = errorMessageKey(error)
      setFormError(t(key, { code }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Form ref={formRef} onSubmit={submit} noValidate>
      <Group>
        <Legend>{t('tripForm.basics')}</Legend>
        <Input
          label={t('tripForm.name')}
          placeholder={t('tripForm.namePlaceholder')}
          value={values.name}
          maxLength={120}
          required
          autoFocus={!editing}
          error={message(t, errors, 'name')}
          onChange={(event) => set('name', event.target.value)}
        />
        <Input
          label={t('tripForm.destination')}
          placeholder={t('tripForm.destinationPlaceholder')}
          hint={t('tripForm.destinationHint')}
          value={values.destination}
          maxLength={200}
          optional
          error={message(t, errors, 'destination')}
          onChange={(event) => setDestination(event.target.value)}
        />
        <Pair>
          <DateField
            label={t('tripForm.startDate')}
            value={values.startDate}
            required
            error={message(t, errors, 'startDate')}
            onChange={(event) => {
              const startDate = event.target.value
              set('startDate', startDate)
              // A new start after the end moves the end along, so the range stays valid
              if (startDate && (!values.endDate || values.endDate < startDate))
                set('endDate', startDate)
            }}
          />
          <DateField
            label={t('tripForm.endDate')}
            value={values.endDate}
            min={values.startDate || undefined}
            required
            error={message(t, errors, 'endDate')}
            onChange={(event) => set('endDate', event.target.value)}
          />
        </Pair>
        <Select
          label={t('tripForm.tz')}
          hint={t('tripForm.tzHint')}
          value={values.tz}
          error={message(t, errors, 'tz')}
          onChange={(event) => {
            setTouched((previous) => ({ ...previous, tz: true }))
            set('tz', event.target.value)
          }}
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      </Group>

      <Group>
        <Legend>{t('tripForm.money')}</Legend>
        <Pair>
          <Select
            label={t('tripForm.baseCurrency')}
            value={values.baseCurrency}
            error={message(t, errors, 'baseCurrency')}
            onChange={(event) => set('baseCurrency', event.target.value)}
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {currencyLabel(code)}
              </option>
            ))}
          </Select>
          <Select
            label={t('tripForm.secondaryCurrency')}
            value={values.secondaryCurrency}
            error={message(t, errors, 'secondaryCurrency')}
            onChange={(event) => set('secondaryCurrency', event.target.value)}
          >
            <option value="">{t('tripForm.secondaryNone')}</option>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {currencyLabel(code)}
              </option>
            ))}
          </Select>
        </Pair>
        <SubGroup aria-describedby={localHintId}>
          <SubLegend>{t('tripForm.localCurrencies')}</SubLegend>
          <ChipRow>
            {currencies.map((code) => (
              <Chip
                key={code}
                tone="fjord"
                selected={values.localCurrencies.includes(code)}
                onClick={() => toggleLocal(code)}
              >
                {code}
              </Chip>
            ))}
          </ChipRow>
          <Hint id={localHintId}>{t('tripForm.localCurrenciesHint')}</Hint>
        </SubGroup>
      </Group>

      <Group>
        <Legend>{t('tripForm.look')}</Legend>
        <Select
          label={t('tripForm.style')}
          value={values.style}
          onChange={(event) => set('style', event.target.value as TripFormValues['style'])}
        >
          {tripStyles.map((style) => (
            <option key={style} value={style}>
              {t(`tripStyle.${style}`)}
            </option>
          ))}
        </Select>
        <ColorSwatches
          label={t('tripForm.cover')}
          value={values.coverColor}
          onChange={(hex) => set('coverColor', hex)}
        />
        <Input
          label={t('tripForm.summary')}
          placeholder={t('tripForm.summaryPlaceholder')}
          value={values.summary}
          maxLength={300}
          optional
          error={message(t, errors, 'summary')}
          onChange={(event) => set('summary', event.target.value)}
        />
      </Group>

      {!editing && (
        <Group>
          <Legend>{t('member.you')}</Legend>
          <Input
            label={t('tripForm.you')}
            hint={t('tripForm.youHint')}
            value={values.ownerName}
            maxLength={60}
            required
            autoComplete="nickname"
            error={message(t, errors, 'ownerName')}
            onChange={(event) => set('ownerName', event.target.value)}
          />
          <ColorSwatches
            label={t('tripForm.youColor')}
            value={values.ownerColor}
            onChange={(hex) => set('ownerColor', hex)}
          />
        </Group>
      )}

      {formError && <FormError role="alert">{formError}</FormError>}
      <Actions>
        {onCancel && (
          <Button onClick={onCancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? t('tripForm.saving') : editing ? t('common.save') : t('tripForm.create')}
        </Button>
      </Actions>
    </Form>
  )
}

export default TripForm

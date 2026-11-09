import type { Trip } from '../../shared/api/types.ts'
import type { MessageKey, MessageParams } from '../../shared/i18n/t.ts'
import { DEFAULT_BASE_CURRENCY, DEFAULT_SECONDARY_CURRENCY } from '../../shared/money/currencies.ts'
import {
  MAX_TRIP_DAYS,
  tripCreateSchema,
  tripPatchSchema,
  type TripCreate,
  type TripPatch,
  type TripStyle,
} from '../../shared/schema/trip.ts'
import { dayColors } from '../styles/tokens.ts'
import { daysBetween } from './trip-groups.ts'

// The trip form's model (e1-t02), kept apart from the React form so it is unit-tested: the values
// the inputs hold, the request bodies they become, and the zod issues mapped back onto fields.

export interface TripFormValues {
  name: string
  destination: string
  startDate: string
  endDate: string
  tz: string
  baseCurrency: string
  /** '' = no second currency */
  secondaryCurrency: string
  localCurrencies: string[]
  style: TripStyle
  coverColor: string
  summary: string
  /** Create only: the owner member */
  ownerName: string
  ownerColor: string
}

export type TripFormField = keyof TripFormValues

export interface FieldError {
  key: MessageKey
  params?: MessageParams
}

export type FieldErrors = Partial<Record<TripFormField, FieldError>>

export function emptyTripForm(tz: string): TripFormValues {
  return {
    name: '',
    destination: '',
    startDate: '',
    endDate: '',
    tz,
    baseCurrency: DEFAULT_BASE_CURRENCY,
    secondaryCurrency: DEFAULT_SECONDARY_CURRENCY,
    localCurrencies: [],
    style: 'other',
    coverColor: dayColors[0],
    summary: '',
    ownerName: '',
    ownerColor: dayColors[0],
  }
}

export function tripToForm(trip: Trip): TripFormValues {
  return {
    ...emptyTripForm(trip.tz),
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    baseCurrency: trip.baseCurrency,
    secondaryCurrency: trip.secondaryCurrency ?? '',
    localCurrencies: [...trip.localCurrencies],
    style: trip.style,
    coverColor: trip.coverColor ?? dayColors[0],
    summary: trip.summary,
  }
}

const tripFields = (values: TripFormValues) => ({
  name: values.name,
  destination: values.destination,
  startDate: values.startDate,
  endDate: values.endDate,
  tz: values.tz,
  baseCurrency: values.baseCurrency,
  secondaryCurrency: values.secondaryCurrency === '' ? null : values.secondaryCurrency,
  localCurrencies: values.localCurrencies,
  style: values.style,
  coverColor: values.coverColor,
  summary: values.summary,
})

const FIELD_ERRORS: Partial<Record<TripFormField, MessageKey>> = {
  name: 'tripForm.error.name',
  destination: 'tripForm.error.destination',
  startDate: 'tripForm.error.startDate',
  endDate: 'tripForm.error.endDate',
  tz: 'tripForm.error.tz',
  baseCurrency: 'tripForm.error.currency',
  secondaryCurrency: 'tripForm.error.currency',
  localCurrencies: 'tripForm.error.currency',
  summary: 'tripForm.error.summary',
  ownerName: 'tripForm.error.owner',
  ownerColor: 'tripForm.error.generic',
}

const FIELDS = new Set<string>(Object.keys(emptyTripForm('UTC')))

/** The form field a zod issue path points at (owner.name → ownerName); null for others */
export function fieldOfPath(path: readonly PropertyKey[]): TripFormField | null {
  const [head, next] = path
  if (head === 'owner') return next === 'color' ? 'ownerColor' : 'ownerName'
  return typeof head === 'string' && FIELDS.has(head) ? (head as TripFormField) : null
}

/** Field errors from zod issues (ours, or the `details` of a 422 from the Worker) */
export function issuesToErrors(issues: unknown): FieldErrors {
  const errors: FieldErrors = {}
  if (!Array.isArray(issues)) return errors
  for (const issue of issues) {
    const path: unknown =
      issue && typeof issue === 'object' ? (issue as { path?: unknown }).path : null
    if (!Array.isArray(path)) continue
    const field = fieldOfPath(path as PropertyKey[])
    if (field && !errors[field])
      errors[field] = { key: FIELD_ERRORS[field] ?? 'tripForm.error.generic' }
  }
  return errors
}

/** The trip length check the Worker also makes (every date gets a Day row) */
function lengthError(values: TripFormValues): FieldErrors {
  if (!values.startDate || !values.endDate || values.endDate < values.startDate) return {}
  return daysBetween(values.startDate, values.endDate) + 1 > MAX_TRIP_DAYS
    ? { endDate: { key: 'tripForm.error.tooLong', params: { max: MAX_TRIP_DAYS } } }
    : {}
}

export type Validated<T> = { ok: true; body: T } | { ok: false; errors: FieldErrors }

export function validateCreate(values: TripFormValues): Validated<TripCreate> {
  const parsed = tripCreateSchema.safeParse({
    ...tripFields(values),
    owner: { name: values.ownerName, color: values.ownerColor },
  })
  const tooLong = lengthError(values)
  if (!parsed.success)
    return { ok: false, errors: { ...issuesToErrors(parsed.error.issues), ...tooLong } }
  if (Object.keys(tooLong).length) return { ok: false, errors: tooLong }
  return { ok: true, body: parsed.data }
}

export function validatePatch(values: TripFormValues): Validated<TripPatch> {
  const fields = tripFields(values)
  const parsed = tripPatchSchema.safeParse(fields)
  const errors: FieldErrors = {
    ...(parsed.success ? {} : issuesToErrors(parsed.error.issues)),
    ...lengthError(values),
  }
  // The patch schema has no cross-field rule; the create schema's is the one that matters
  if (fields.startDate && fields.endDate && fields.endDate < fields.startDate)
    errors.endDate = { key: 'tripForm.error.endDate' }
  if (!parsed.success || Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, body: parsed.data }
}

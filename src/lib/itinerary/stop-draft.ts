import type { Stop } from '../../../shared/api/types.ts'
import { isCurrencyCode, type CurrencyCode } from '../../../shared/money/currencies.ts'
import type { BookingState, StopType } from '../../../shared/schema/index.ts'
import { draftToInstants, localTime } from './time.ts'

// The stop editor's form state (e2-t03, e2-t08b): a stop as the form holds it, and back. Kept
// apart from the editor so the live merge (merge.ts) and tests can use it.

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

/** The form's own copy of a stop: times as local `HH:mm`, the duration as typed, links as text */
export interface StopDraft {
  [field: string]: unknown
  type: StopType
  title: string
  placeId: string | null
  start: string
  end: string
  duration: string
  costMinor: number | null
  currency: CurrencyCode
  booking: BookingState
  note: string
  links: string[]
  isBackup: boolean
}

export function toDraft(
  stop: Stop | null,
  tz: string,
  currencies: readonly CurrencyCode[],
): StopDraft {
  return {
    type: stop?.type ?? 'sight',
    title: stop?.title ?? '',
    placeId: stop?.placeId ?? null,
    start: localTime(stop?.startAt ?? null, tz),
    end: localTime(stop?.endAt ?? null, tz),
    duration: stop?.durationMin?.toString() ?? '',
    costMinor: stop?.costMinor ?? null,
    currency:
      (stop?.currency && isCurrencyCode(stop.currency) ? stop.currency : currencies[0]) ?? 'AUD',
    booking: stop?.booking ?? 'none',
    note: stop?.note ?? '',
    links: stop?.links.map((link) => link.url) ?? [],
    isBackup: stop?.isBackup ?? false,
  }
}

const durationOf = (text: string): number | null => {
  const value = text.trim() === '' ? null : Number(text)
  return value !== null && Number.isInteger(value) && value >= 0 ? value : null
}

/** What PATCH / POST take for a draft on `date` in `tz` */
export function draftValues(draft: StopDraft, date: string, tz: string): StopValues {
  const { startAt, endAt } = draftToInstants({ start: draft.start, end: draft.end }, date, tz)
  return {
    type: draft.type,
    title: draft.title.trim(),
    placeId: draft.placeId,
    startAt,
    endAt,
    durationMin: durationOf(draft.duration),
    costMinor: draft.costMinor,
    currency: draft.costMinor === null ? null : draft.currency,
    booking: draft.booking,
    note: draft.note,
    links: draft.links.filter((url) => url.trim()).map((url) => ({ url: url.trim() })),
    isBackup: draft.isBackup,
  }
}

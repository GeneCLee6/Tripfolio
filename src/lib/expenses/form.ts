import type { ExpenseView } from '../../../shared/api/expenses.ts'
import type { Member, Trip } from '../../../shared/api/types.ts'
import {
  CURRENCY_CODES,
  isCurrencyCode,
  minorUnitsOf,
  type CurrencyCode,
} from '../../../shared/money/currencies.ts'
import { convertMinor, invertRate } from '../../../shared/money/fx.ts'
import {
  SplitError,
  splitExpense,
  type Share,
  type SplitMethod,
  type SplitParticipant,
} from '../../../shared/money/split.ts'
import type { ExpenseCategory } from '../../../shared/schema/expense.ts'
import { amountText, parseAmount } from '../../components/text.ts'
import { todayIn } from '../trip-groups.ts'
import type { ExpenseCreateBody, ExpensePatchBody } from './api.ts'
import type { RecentExpenseChoices } from './recent.ts'

// The 記一筆 form as plain data (e7-t02): its defaults, the request body it maps to, the live split
// preview, and the list page's filtering and grouping (e7-t08). Pure functions, tested without a DOM.
// Amounts are integer minor units (CLAUDE.md rule 2); typed text is parsed by string, never floats.

/** The categories in the order the form shows them (shared/schema/expense.ts, without zod) */
export const CATEGORIES = [
  'food',
  'lodging',
  'transport',
  'fuel',
  'tickets',
  'shopping',
  'misc',
  'other',
] as const satisfies readonly ExpenseCategory[]
const everyCategory: [Exclude<ExpenseCategory, (typeof CATEGORIES)[number]>] extends [never]
  ? true
  : never = true
void everyCategory

export const SPLIT_METHODS = [
  'equal',
  'shares',
  'percent',
  'exact',
  'self',
] as const satisfies readonly SplitMethod[]

/** The payer value that means the shared pool (公基金) */
export const POOL = 'pool'

export interface ExpenseForm {
  amountMinor: number | null
  currency: string
  category: ExpenseCategory | null
  note: string
  /** YYYY-MM-DD in the trip's time zone */
  date: string
  /** A member id, or POOL */
  payer: string
  /** Who shares it, in member order */
  participants: string[]
  method: SplitMethod
  /** Typed per participant: `shares` weights, `percent` percents, `exact` amounts (major units) */
  weights: Record<string, string>
  percents: Record<string, string>
  exacts: Record<string, string>
  receiptAttachmentId: string | null
  stopId: string | null
  dayId: string | null
  /** The rate field's text (1 currency = rate base currency) */
  fxRate: string
  /** The rate was typed (or asked for), so it is sent as a manual rate */
  rateEdited: boolean
}

export type FormProblem =
  | 'amount'
  | 'category'
  | 'participants'
  | 'weights'
  | 'percents'
  | 'percentSum'
  | 'exacts'
  | 'exactSum'
  | 'selfPool'
  | 'rate'

export type Result<T> = { ok: true; value: T } | { ok: false; problem: FormProblem }

export { todayIn }

/** Last used currency, else the trip's first local currency, else its base currency */
export function defaultCurrency(
  trip: Pick<Trip, 'baseCurrency' | 'localCurrencies'>,
  recent: Pick<RecentExpenseChoices, 'currency'>,
): string {
  if (recent.currency && isCurrencyCode(recent.currency)) return recent.currency
  const local = trip.localCurrencies.find((code) => isCurrencyCode(code))
  if (local) return local
  return isCurrencyCode(trip.baseCurrency) ? trip.baseCurrency : 'AUD'
}

/** The currency chip's options: the ones this trip uses first, then the rest of the table */
export function currencyOptions(
  trip: Pick<Trip, 'baseCurrency' | 'secondaryCurrency' | 'localCurrencies'>,
  current: string,
): CurrencyCode[] {
  const first = [current, ...trip.localCurrencies, trip.baseCurrency, trip.secondaryCurrency]
  const known = first.filter((code): code is CurrencyCode => !!code && isCurrencyCode(code))
  return [...new Set([...known, ...CURRENCY_CODES])]
}

/** Category order with the quick picks (last three used) first */
export function categoryOrder(recent: readonly ExpenseCategory[]): ExpenseCategory[] {
  return [...new Set([...recent, ...CATEGORIES])]
}

/** Equal percents that add up to exactly 100 (two decimals; the first ones take the leftovers) */
export function evenPercents(ids: readonly string[]): Record<string, string> {
  if (ids.length === 0) return {}
  const hundredths = Math.floor(10000 / ids.length)
  let left = 10000 - hundredths * ids.length
  const out: Record<string, string> = {}
  for (const id of ids) {
    const value = hundredths + (left > 0 ? 1 : 0)
    if (left > 0) left -= 1
    out[id] = String(value / 100)
  }
  return out
}

export interface NewFormInput {
  trip: Pick<Trip, 'baseCurrency' | 'localCurrencies' | 'tz'>
  me: Pick<Member, 'id'>
  members: readonly Pick<Member, 'id'>[]
  recent: Pick<RecentExpenseChoices, 'currency'>
  now?: number
}

/** A blank expense: today in the trip's zone, I paid, everyone shares equally */
export function newExpenseForm({
  trip,
  me,
  members,
  recent,
  now = Date.now(),
}: NewFormInput): ExpenseForm {
  return {
    amountMinor: null,
    currency: defaultCurrency(trip, recent),
    category: null,
    note: '',
    date: todayIn(trip.tz, now),
    payer: me.id,
    participants: members.map((member) => member.id),
    method: 'equal',
    weights: {},
    percents: {},
    exacts: {},
    receiptAttachmentId: null,
    stopId: null,
    dayId: null,
    fxRate: '',
    rateEdited: false,
  }
}

const numberText = (value: number): string => String(Number(value.toFixed(6)))

/** The form for editing a saved expense */
export function formFromExpense(
  expense: ExpenseView,
  members: readonly Pick<Member, 'id'>[],
): ExpenseForm {
  const digits = minorUnitsOf(expense.currency)
  const self = expense.splitMethod === 'self'
  const weights: Record<string, string> = {}
  const percents: Record<string, string> = {}
  const exacts: Record<string, string> = {}
  for (const share of expense.shares) {
    if (share.weight !== null) weights[share.memberId] = numberText(share.weight)
    if (share.percent !== null) percents[share.memberId] = numberText(share.percent)
    if (share.amountMinor !== null) exacts[share.memberId] = amountText(share.amountMinor, digits)
  }
  return {
    amountMinor: expense.amountMinor,
    currency: expense.currency,
    category: expense.category,
    note: expense.note,
    date: expense.date,
    payer: expense.pool ? POOL : (expense.payerMemberId ?? POOL),
    participants: self
      ? members.map((member) => member.id)
      : expense.shares.map((share) => share.memberId),
    method: expense.splitMethod,
    weights,
    percents,
    exacts,
    receiptAttachmentId: expense.receiptAttachmentId,
    stopId: expense.stopId,
    dayId: expense.dayId,
    fxRate: expense.fxSource === 'base' ? '' : numberText(expense.fxRate),
    rateEdited: false,
  }
}

/** Switch the split method; percents start out even, 只有我 makes me the payer */
export function withMethod(form: ExpenseForm, method: SplitMethod, meId: string): ExpenseForm {
  const next = { ...form, method }
  if (method === 'percent') {
    const typed = form.participants.some((id) => form.percents[id])
    if (!typed) next.percents = evenPercents(form.participants)
  }
  if (method === 'self') next.payer = meId
  return next
}

/** Include or leave out one member; the list keeps member order (removed members stay at the end) */
export function toggleParticipant(
  form: ExpenseForm,
  memberId: string,
  members: readonly Pick<Member, 'id'>[],
): ExpenseForm {
  const set = new Set(form.participants)
  if (set.has(memberId)) set.delete(memberId)
  else set.add(memberId)
  const ordered = members.map((member) => member.id).filter((id) => set.has(id))
  const extra = form.participants.filter((id) => set.has(id) && !ordered.includes(id))
  const participants = [...ordered, ...extra]
  const next = { ...form, participants }
  if (form.method === 'percent') next.percents = evenPercents(participants)
  return next
}

/** A decimal typed by a person ("1.5", "2"), or null */
export function parseDecimal(text: string): number | null {
  const cleaned = text.replace(/[\s,]/g, '')
  if (cleaned === '' || cleaned === '.' || !/^\d*(?:\.\d*)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/** A rate typed in the rate field: positive, at most 6 decimals kept (shared/money/fx.ts) */
export function parseRate(text: string): number | null {
  const value = parseDecimal(text)
  if (value === null || value <= 0) return null
  const rounded = Math.round(value * 1e6) / 1e6
  return rounded > 0 ? rounded : null
}

/** The participant lines the API takes for the form's method */
export function participantsFor(form: ExpenseForm): Result<SplitParticipant[]> {
  if (form.method === 'self') {
    return form.payer === POOL ? { ok: false, problem: 'selfPool' } : { ok: true, value: [] }
  }
  if (form.participants.length === 0) return { ok: false, problem: 'participants' }
  const ids = form.participants
  switch (form.method) {
    case 'equal':
      return { ok: true, value: ids.map((memberId) => ({ memberId })) }
    case 'shares': {
      const value: SplitParticipant[] = []
      for (const memberId of ids) {
        const text = form.weights[memberId] ?? ''
        const weight = text.trim() === '' ? 1 : parseDecimal(text)
        if (weight === null || weight > 1000) return { ok: false, problem: 'weights' }
        value.push({ memberId, weight })
      }
      if (value.every((p) => p.weight === 0)) return { ok: false, problem: 'weights' }
      return { ok: true, value }
    }
    case 'percent': {
      const value: SplitParticipant[] = []
      let sum = 0
      for (const memberId of ids) {
        const percent = parseDecimal(form.percents[memberId] ?? '')
        if (percent === null || percent > 100) return { ok: false, problem: 'percents' }
        sum += percent
        value.push({ memberId, percent })
      }
      if (Math.abs(sum - 100) > 0.01 + 1e-9) return { ok: false, problem: 'percentSum' }
      return { ok: true, value }
    }
    case 'exact': {
      const digits = minorUnitsOf(form.currency)
      const value: SplitParticipant[] = []
      let sum = 0
      for (const memberId of ids) {
        const minor = parseAmount(form.exacts[memberId] ?? '', digits)
        if (minor === 'invalid') return { ok: false, problem: 'exacts' }
        sum += minor ?? 0
        value.push({ memberId, amountMinor: minor ?? 0 })
      }
      if (form.amountMinor !== null && sum !== form.amountMinor) {
        return { ok: false, problem: 'exactSum' }
      }
      return { ok: true, value }
    }
  }
}

/** What is still to assign for `exact` (positive) or over-assigned (negative), in minor units */
export function exactRemainder(form: ExpenseForm): number | null {
  if (form.method !== 'exact' || form.amountMinor === null) return null
  const digits = minorUnitsOf(form.currency)
  let sum = 0
  for (const id of form.participants) {
    const minor = parseAmount(form.exacts[id] ?? '', digits)
    if (minor === 'invalid') return null
    sum += minor ?? 0
  }
  return form.amountMinor - sum
}

/**
 * The split as it will come out, in the expense's own currency, with the remainder rule of
 * shared/money/split.ts (leftover units go to the payer first). The server splits the base amount
 * the same way.
 */
export function previewSplit(form: ExpenseForm): Result<Share[]> {
  if (form.amountMinor === null || form.amountMinor <= 0) return { ok: false, problem: 'amount' }
  const participants = participantsFor(form)
  if (!participants.ok) return participants
  try {
    const shares = splitExpense({
      amountMinor: form.amountMinor,
      payerId: form.payer === POOL ? 'pool' : form.payer,
      method: form.method,
      participants: participants.value,
    })
    return { ok: true, value: shares }
  } catch (error) {
    if (error instanceof SplitError) {
      const problems: Partial<Record<string, FormProblem>> = {
        'percent-sum': 'percentSum',
        'exact-sum': 'exactSum',
        'self-pool-payer': 'selfPool',
        'zero-total-weight': 'weights',
        'invalid-weight': 'weights',
      }
      return { ok: false, problem: problems[error.code] ?? 'participants' }
    }
    throw error
  }
}

export interface BodyOptions {
  baseCurrency: string
  /** The server said it knows no rate (422 fx_unavailable) or GET /fx had none: a rate is required */
  needsRate?: boolean
}

interface CommonFields {
  amountMinor: number
  currency: string
  date: string
  category: ExpenseCategory
  note: string
  splitMethod: SplitMethod
  participants: SplitParticipant[]
  stopId: string | null
  dayId: string | null
  receiptAttachmentId: string | null
  fxRate?: number
}

function commonFields(form: ExpenseForm, options: BodyOptions): Result<CommonFields> {
  if (form.amountMinor === null || form.amountMinor <= 0) return { ok: false, problem: 'amount' }
  if (!form.category) return { ok: false, problem: 'category' }
  const participants = participantsFor(form)
  if (!participants.ok) return participants
  const fields: CommonFields = {
    amountMinor: form.amountMinor,
    currency: form.currency,
    date: form.date,
    category: form.category,
    note: form.note.trim(),
    splitMethod: form.method,
    participants: participants.value,
    stopId: form.stopId,
    dayId: form.dayId,
    receiptAttachmentId: form.receiptAttachmentId,
  }
  if (form.currency !== options.baseCurrency && (form.rateEdited || options.needsRate)) {
    const rate = parseRate(form.fxRate)
    if (rate === null) return { ok: false, problem: 'rate' }
    fields.fxRate = rate
  }
  return { ok: true, value: fields }
}

const payerFields = (form: ExpenseForm) =>
  form.payer === POOL
    ? { pool: true as const }
    : { pool: false as const, payerMemberId: form.payer }

/** POST /expenses body */
export function toCreateBody(form: ExpenseForm, options: BodyOptions): Result<ExpenseCreateBody> {
  const fields = commonFields(form, options)
  if (!fields.ok) return fields
  return { ok: true, value: { ...fields.value, ...payerFields(form) } }
}

/** PATCH /expenses/:eid body: every field (the server writes no history when nothing changed) */
export function toPatchBody(form: ExpenseForm, options: BodyOptions): Result<ExpensePatchBody> {
  const fields = commonFields(form, options)
  if (!fields.ok) return fields
  return { ok: true, value: { ...fields.value, ...payerFields(form) } }
}

/** The base amount the form comes to at `rate` (the 「≈ A$40.95」 line), or null */
export function baseEstimate(
  form: Pick<ExpenseForm, 'amountMinor' | 'currency'>,
  baseCurrency: string,
  rate: number | null,
): number | null {
  if (form.amountMinor === null) return null
  if (form.currency === baseCurrency) return form.amountMinor
  if (rate === null || rate <= 0) return null
  return convertMinor(form.amountMinor, form.currency, baseCurrency, rate)
}

// ---- the list (e7-t08) ----

export interface ExpenseFilter {
  /** Inclusive YYYY-MM-DD bounds */
  from?: string | null
  to?: string | null
  category?: ExpenseCategory | null
  /** Payer or participant */
  memberId?: string | null
  /** Substring of the note (or, for a row without one, of its category label) */
  q?: string
}

/** Client-side filtering, the same rules as GET /expenses */
export function filterExpenses(
  expenses: readonly ExpenseView[],
  filter: ExpenseFilter,
  labelOf: (category: ExpenseCategory) => string = () => '',
): ExpenseView[] {
  const q = filter.q?.trim().toLocaleLowerCase() ?? ''
  return expenses.filter((expense) => {
    if (expense.deletedAt) return false
    if (filter.from && expense.date < filter.from) return false
    if (filter.to && expense.date > filter.to) return false
    if (filter.category && expense.category !== filter.category) return false
    if (
      filter.memberId &&
      expense.payerMemberId !== filter.memberId &&
      !expense.shares.some((share) => share.memberId === filter.memberId)
    )
      return false
    if (q) {
      const text = (expense.note || labelOf(expense.category)).toLocaleLowerCase()
      if (!text.includes(q)) return false
    }
    return true
  })
}

export interface ExpenseDay {
  date: string
  /** Sum of baseMinor (the trip's base currency) */
  totalBaseMinor: number
  expenses: ExpenseView[]
}

const descending = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0)

/** Newest day first; within a day the latest recorded first */
export function groupByDate(expenses: readonly ExpenseView[]): ExpenseDay[] {
  const days = new Map<string, ExpenseDay>()
  for (const expense of expenses) {
    let day = days.get(expense.date)
    if (!day) {
      day = { date: expense.date, totalBaseMinor: 0, expenses: [] }
      days.set(expense.date, day)
    }
    day.totalBaseMinor += expense.baseMinor
    day.expenses.push(expense)
  }
  const sorted = [...days.values()].sort((a, b) => descending(a.date, b.date))
  for (const day of sorted) day.expenses.sort((a, b) => descending(a.createdAt, b.createdAt))
  return sorted
}

export type PayerSummary = { kind: 'pool' } | { kind: 'member'; memberId: string }
export type SplitSummary =
  | { kind: 'self' }
  | { kind: 'everyone' }
  | { kind: 'some'; count: number; method: Exclude<SplitMethod, 'self'> }

/** 「A 付 · 全員平分」 as data; the page turns it into words */
export function describeExpense(
  expense: Pick<ExpenseView, 'pool' | 'payerMemberId' | 'splitMethod' | 'shares'>,
  members: readonly Pick<Member, 'id'>[],
): { payer: PayerSummary; split: SplitSummary } {
  const payer: PayerSummary =
    expense.pool || !expense.payerMemberId
      ? { kind: 'pool' }
      : { kind: 'member', memberId: expense.payerMemberId }
  if (expense.splitMethod === 'self') return { payer, split: { kind: 'self' } }
  const ids = new Set(expense.shares.map((share) => share.memberId))
  const everyone =
    expense.splitMethod === 'equal' &&
    members.length > 0 &&
    ids.size === members.length &&
    members.every((member) => ids.has(member.id))
  return {
    payer,
    split: everyone
      ? { kind: 'everyone' }
      : { kind: 'some', count: ids.size, method: expense.splitMethod },
  }
}

/**
 * A base amount in the trip's secondary currency. `rate` is what GET /fx gives for that currency
 * (1 secondary = rate base); null when there is no secondary currency or no rate.
 */
export function secondaryMinor(
  baseMinor: number,
  baseCurrency: string,
  secondary: string | null,
  rate: number | null,
): number | null {
  if (!secondary || secondary === baseCurrency || !rate || rate <= 0) return null
  if (!isCurrencyCode(secondary) || !isCurrencyCode(baseCurrency)) return null
  return convertMinor(baseMinor, baseCurrency, secondary, invertRate(rate))
}

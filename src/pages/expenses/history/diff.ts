import type {
  ExpenseShareView,
  HistoryAction,
  HistoryEntity,
  HistoryEntry,
} from '../../../../shared/api/expenses.ts'
import { formatDate, formatMoney } from '../../../../shared/i18n/format.ts'
import type { MessageKey } from '../../../../shared/i18n/t.ts'
import type { SplitMethod } from '../../../../shared/money/split.ts'
import type { ExpenseCategory, SettlementMethod } from '../../../../shared/schema/expense.ts'
import { METHOD_LABEL as SETTLE_METHOD_LABEL } from '../../../lib/balances/view.ts'
import { todayIn } from '../../../lib/expenses/form.ts'
import type { Translate } from '../../../lib/i18n.ts'
import { categoryLabel } from '../labels.ts'

// The money log in words (e7-t07): what each history entry changed, 「金額：NZ$45.00 → NZ$50.00」.
// Pure functions over GET /expense-history and /expenses/:eid/history, tested without a DOM.

export const ACTION_LABEL: Record<HistoryAction, MessageKey> = {
  create: 'history.action.create',
  update: 'history.action.update',
  delete: 'history.action.delete',
  restore: 'history.action.restore',
}

export const ENTITY_LABEL: Record<HistoryEntity, MessageKey> = {
  expense: 'history.entity.expense',
  pool: 'history.entity.pool',
  settlement: 'history.entity.settlement',
}

const SPLIT_LABEL: Record<SplitMethod, MessageKey> = {
  equal: 'expenses.method.equal',
  shares: 'expenses.method.shares',
  percent: 'expenses.method.percent',
  exact: 'expenses.method.exact',
  self: 'expenses.method.self',
}

export interface DiffContext {
  t: Translate
  baseCurrency: string
  /** A member's name (or the removed-member label) */
  member: (id: string) => string
  /** A stop's title, when known */
  stopName?: (id: string) => string | null
}

export interface DiffLine {
  field: string
  before: string
  after: string
}

type Snapshot = Record<string, unknown>

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

function sharesOf(value: unknown): ExpenseShareView[] {
  return Array.isArray(value)
    ? value.filter(
        (share): share is ExpenseShareView =>
          typeof share === 'object' && share !== null && 'memberId' in share,
      )
    : []
}

/** The payer of a snapshot-like pair: 公基金 or a member's name */
function payerText(pool: unknown, payerMemberId: unknown, ctx: DiffContext): string {
  if (pool === true || !str(payerMemberId)) return ctx.t('expenses.paidBy.pool')
  return ctx.member(String(payerMemberId))
}

/**
 * The changed fields of one entry as before → after lines, in a fixed order. Bookkeeping fields
 * (rate source and date, day id, links the page does not show) are left out; a currency change
 * shows inside the amount line; the base amount only when the amount itself did not change.
 * Create, delete and plain undelete entries have no lines (the action says it all).
 */
export function diffLines(entry: HistoryEntry, ctx: DiffContext): DiffLine[] {
  if (entry.action === 'create' || entry.action === 'delete') return []
  const { t } = ctx
  const diff = entry.diff
  const snap: Snapshot = entry.snapshot
  const changed = (key: string) => Object.prototype.hasOwnProperty.call(diff, key)
  const before = (key: string): unknown => (changed(key) ? diff[key][0] : snap[key])
  const after = (key: string): unknown => (changed(key) ? diff[key][1] : snap[key])
  const none = t('history.value.none')
  const lines: DiffLine[] = []
  const push = (field: MessageKey, b: string, a: string) => {
    if (b !== a) lines.push({ field: t(field), before: b, after: a })
  }
  const money = (value: unknown, currency: unknown) => {
    const minor = num(value)
    const code = str(currency)
    return minor === null || !code ? none : formatMoney(minor, code, t.locale)
  }
  const date = (value: unknown) => {
    const text = str(value)
    if (!text) return none
    try {
      return formatDate(text, t.locale)
    } catch {
      return text
    }
  }
  const text = (value: unknown) => {
    const s = str(value)
    return s ? s : t('history.value.empty')
  }
  const memberText = (value: unknown) => (str(value) ? ctx.member(String(value)) : none)

  if (entry.entity === 'settlement') {
    const base = ctx.baseCurrency
    if (changed('fromMemberId'))
      push('history.field.from', memberText(before('fromMemberId')), memberText(after('fromMemberId')))
    if (changed('toMemberId'))
      push('history.field.to', memberText(before('toMemberId')), memberText(after('toMemberId')))
    if (changed('amountMinor'))
      push('history.field.amount', money(before('amountMinor'), base), money(after('amountMinor'), base))
    if (changed('method')) {
      const label = (value: unknown) => {
        const key = SETTLE_METHOD_LABEL[value as SettlementMethod]
        return key ? t(key) : none
      }
      push('history.field.method', label(before('method')), label(after('method')))
    }
    if (changed('date')) push('history.field.date', date(before('date')), date(after('date')))
    if (changed('note')) push('history.field.note', text(before('note')), text(after('note')))
    return lines
  }

  if (entry.entity === 'pool' && changed('memberId'))
    push('history.field.member', memberText(before('memberId')), memberText(after('memberId')))
  if (changed('amountMinor') || changed('currency'))
    push(
      'history.field.amount',
      money(before('amountMinor'), before('currency')),
      money(after('amountMinor'), after('currency')),
    )
  if (changed('fxRate'))
    push('history.field.fxRate', String(before('fxRate') ?? none), String(after('fxRate') ?? none))
  if (changed('baseMinor') && !changed('amountMinor'))
    push(
      'history.field.baseAmount',
      money(before('baseMinor'), ctx.baseCurrency),
      money(after('baseMinor'), ctx.baseCurrency),
    )
  if (changed('date')) push('history.field.date', date(before('date')), date(after('date')))
  if (entry.entity === 'pool') {
    if (changed('note')) push('history.field.note', text(before('note')), text(after('note')))
    return lines
  }
  if (changed('category')) {
    const label = (value: unknown) =>
      str(value) ? categoryLabel(t, value as ExpenseCategory) : none
    push('history.field.category', label(before('category')), label(after('category')))
  }
  if (changed('note')) push('history.field.note', text(before('note')), text(after('note')))
  if (changed('payerMemberId') || changed('pool'))
    push(
      'history.field.payer',
      payerText(before('pool'), before('payerMemberId'), ctx),
      payerText(after('pool'), after('payerMemberId'), ctx),
    )
  if (changed('splitMethod')) {
    const label = (value: unknown) => {
      const key = SPLIT_LABEL[value as SplitMethod]
      return key ? t(key) : none
    }
    push('history.field.splitMethod', label(before('splitMethod')), label(after('splitMethod')))
  }
  if (changed('shares')) {
    const names = (value: unknown) =>
      sharesOf(value)
        .map((share) => ctx.member(share.memberId))
        .join(t('history.value.separator')) || none
    const b = names(before('shares'))
    const a = names(after('shares'))
    if (b !== a) push('history.field.participants', b, a)
    else if (!changed('amountMinor') && !changed('baseMinor') && !changed('splitMethod'))
      lines.push({
        field: t('history.field.shares'),
        before: '…',
        after: t('history.value.sharesChanged'),
      })
  }
  if (changed('stopId')) {
    const stop = (value: unknown) => {
      const id = str(value)
      if (!id) return none
      return ctx.stopName?.(id) ?? t('history.value.linked')
    }
    push('history.field.stop', stop(before('stopId')), stop(after('stopId')))
  }
  if (changed('receiptAttachmentId')) {
    const receipt = (value: unknown) => (str(value) ? t('history.value.receipt') : none)
    push('history.field.receipt', receipt(before('receiptAttachmentId')), receipt(after('receiptAttachmentId')))
  }
  return lines
}

/** 「金額：A → B」 */
export const diffText = (t: Translate, line: DiffLine): string =>
  t('history.change', { field: line.field, before: line.before, after: line.after })

/** What the entry is about, from its snapshot: an expense's note (or category), 「Mei 出資」, 「A → B」 */
export function entityName(entry: Pick<HistoryEntry, 'entity' | 'snapshot'>, ctx: DiffContext): string {
  const snap: Snapshot = entry.snapshot
  const { t } = ctx
  if (entry.entity === 'settlement')
    return t('history.settlementName', {
      from: ctx.member(String(snap.fromMemberId ?? '')),
      to: ctx.member(String(snap.toMemberId ?? '')),
    })
  if (entry.entity === 'pool')
    return t('history.poolName', { name: ctx.member(String(snap.memberId ?? '')) })
  const note = str(snap.note)?.trim()
  if (note) return note
  return str(snap.category) ? categoryLabel(t, snap.category as ExpenseCategory) : t(ENTITY_LABEL.expense)
}

/** The amount an entry's snapshot records (expense / pool: own currency; settlement: base) */
export function entityAmount(entry: Pick<HistoryEntry, 'entity' | 'snapshot'>, ctx: DiffContext): string | null {
  const minor = num(entry.snapshot.amountMinor)
  if (minor === null) return null
  const currency = entry.entity === 'settlement' ? ctx.baseCurrency : str(entry.snapshot.currency)
  return currency ? formatMoney(minor, currency, ctx.t.locale) : null
}

export interface HistoryDay {
  /** YYYY-MM-DD in the trip's time zone */
  date: string
  entries: HistoryEntry[]
}

/** Entries grouped by the trip-zone day they happened, keeping their order (newest first) */
export function groupHistoryByDay(entries: readonly HistoryEntry[], tz: string): HistoryDay[] {
  const days: HistoryDay[] = []
  for (const entry of entries) {
    const ms = Date.parse(entry.at)
    const date = Number.isFinite(ms) ? todayIn(tz, ms) : entry.at.slice(0, 10)
    const last = days[days.length - 1]
    if (last && last.date === date) last.entries.push(entry)
    else days.push({ date, entries: [entry] })
  }
  return days
}

/** The versions a sheet offers to restore: entries whose snapshot can be brought back */
export const restorable = (entry: HistoryEntry): boolean =>
  entry.entity === 'expense' &&
  entry.action !== 'delete' &&
  typeof entry.snapshot.amountMinor === 'number' &&
  Array.isArray(entry.snapshot.shares)

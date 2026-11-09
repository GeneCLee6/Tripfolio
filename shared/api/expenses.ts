// Response shapes of the expense API (worker/trips/expenses.ts, pool.ts, settlements.ts; e7-t01).
// Request bodies are the zod schemas in shared/schema/expense.ts. Every write answers with the
// trip's new `rev`. All `*Minor` fields are integers: `amountMinor` in the row's own currency,
// `baseMinor` / `shareMinor` / settlement amounts in the trip's base currency.

import type { MemberBalance, SplitMethod, Transfer } from '../money/index.ts'
import type { ExpenseCategory, SettlementMethod } from '../schema/expense.ts'

/** Where a row's rate came from: same currency · typed in · trip default · fxRates table */
export type FxSource = 'base' | 'manual' | 'trip' | 'auto'
export type PoolRefundMode = 'proportional' | 'equal'

export interface ExpenseShareView {
  memberId: string
  weight: number | null
  percent: number | null
  /** exact: the input, in the expense's currency */
  amountMinor: number | null
  /** The computed share, base currency */
  shareMinor: number
}

export interface Expense {
  id: string
  tripId: string
  /** null when the pool paid */
  payerMemberId: string | null
  pool: boolean
  amountMinor: number
  currency: string
  /** 1 `currency` = fxRate base currency (6 decimals) */
  fxRate: number
  fxSource: FxSource
  /** fxRates date used (auto only; may be up to 7 days before `date`) */
  fxDate: string | null
  baseMinor: number
  date: string
  category: ExpenseCategory
  note: string
  stopId: string | null
  dayId: string | null
  receiptAttachmentId: string | null
  bookingId: string | null
  wishlistItemId: string | null
  splitMethod: SplitMethod
  createdByMemberId: string
  rev: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface ExpenseView extends Expense {
  /** Participant order; sums of shareMinor equal baseMinor */
  shares: ExpenseShareView[]
}

export interface ExpensesResponse {
  expenses: ExpenseView[]
  rev: number
}

export interface ExpenseResponse {
  expense: ExpenseView
  rev: number
}

export type HistoryEntity = 'expense' | 'pool' | 'settlement'
export type HistoryAction = 'create' | 'update' | 'delete' | 'restore'

export interface HistoryEntry {
  id: string
  entity: HistoryEntity
  entityId: string
  memberId: string
  at: string
  action: HistoryAction
  /** Changed fields only: { field: [before, after] } (create: before is null) */
  diff: Record<string, [unknown, unknown]>
  /** Full state after the change; POST …/restore { historyId } brings it back */
  snapshot: Record<string, unknown>
}

export interface HistoryResponse {
  history: HistoryEntry[]
}

export interface PoolContribution {
  id: string
  tripId: string
  memberId: string
  amountMinor: number
  currency: string
  fxRate: number
  fxSource: FxSource
  fxDate: string | null
  baseMinor: number
  date: string
  note: string
  createdByMemberId: string
  rev: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface PoolResponse {
  contributions: PoolContribution[]
  /** Contributions − pool-paid expenses, base currency (may be negative) */
  poolBalanceMinor: number
  refundMode: PoolRefundMode
  rev: number
}

export interface Settlement {
  id: string
  tripId: string
  fromMemberId: string
  toMemberId: string
  /** Base currency */
  amountMinor: number
  method: SettlementMethod
  note: string
  date: string
  createdByMemberId: string
  rev: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface SettlementsResponse {
  settlements: Settlement[]
  rev: number
}

export interface BalanceRow extends MemberBalance {
  /** The member was removed from the trip; their shares still count */
  removed: boolean
}

export interface BalancesResponse {
  baseCurrency: string
  /** Members in join order (removed members only while they have something non-zero) */
  balances: BalanceRow[]
  poolBalanceMinor: number
  refundMode: PoolRefundMode
  /** Greedy fewest-transfers suggestion (shared/money/settle.ts) */
  suggested: Transfer[]
  rev: number
}

export interface SummaryRow {
  /** day: YYYY-MM-DD · category: an ExpenseCategory · member: a member id */
  key: string
  /** Base currency total of expenses (day / category) */
  baseMinor: number
  count: number
  /** member only: expenses this member paid personally (base) */
  paidMinor?: number
  /** member only: this member's shares (base) */
  shareMinor?: number
}

export interface SummaryResponse {
  by: 'day' | 'category' | 'member'
  baseCurrency: string
  rows: SummaryRow[]
  totalMinor: number
  rev: number
}

export interface FxResolved {
  quote: string
  /** 1 quote = rate base currency; null when nothing is known (ask for a manual rate) */
  rate: number | null
  source: FxSource | null
  /** The fxRates date used (auto only) */
  rateDate: string | null
}

export interface FxResponse {
  base: string
  date: string
  /** Trip defaults: 1 key currency = value base currency */
  overrides: Record<string, number>
  rates: FxResolved[]
}

export interface ApplyRateResponse {
  updated: number
  rev: number
}

/** 422 `fx_unavailable` details: the UI asks for a manual rate */
export interface FxUnavailableDetails {
  needsRate: true
  currency: string
  base: string
  date: string
}

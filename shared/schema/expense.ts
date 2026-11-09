import { z } from 'zod'
import { isCurrencyCode } from '../money/currencies.ts'
import { entityId, isoDate } from './common.ts'

// Expenses, the shared pool, settlements and FX (e7-t01, docs/PRD/e7-expenses-splitting.md).
// Amounts are integer minor units of their currency (CLAUDE.md rule 2); decimals per currency come
// from shared/money/currencies.ts.

export const expenseCategories = [
  'food',
  'lodging',
  'transport',
  'fuel',
  'tickets',
  'shopping',
  'misc',
  'other',
] as const
export const expenseCategory = z.enum(expenseCategories)
export type ExpenseCategory = z.infer<typeof expenseCategory>

export const splitMethods = ['equal', 'shares', 'percent', 'exact', 'self'] as const
export const splitMethod = z.enum(splitMethods)

export const settlementMethods = ['cash', 'transfer', 'other'] as const
export const settlementMethod = z.enum(settlementMethods)
export type SettlementMethod = z.infer<typeof settlementMethod>

export const poolRefundModes = ['proportional', 'equal'] as const
export const poolRefundMode = z.enum(poolRefundModes)

/** A currency listed in shared/money/currencies.ts */
export const knownCurrency = z
  .string()
  .refine((c) => isCurrencyCode(c), 'unknown currency (see shared/money/currencies.ts)')

/** Positive integer minor units; the largest amount fits comfortably in a safe integer */
const amountMinor = z.number().int().min(1).max(1e13)
/** "1 unit of the row's currency = rate units of the base currency", 6 decimals kept */
const fxRate = z.number().finite().positive().max(1e9)

export const participantSchema = z.object({
  memberId: entityId,
  /** shares: weight (2 for a couple, 0.5 for a child); defaults to 1 */
  weight: z.number().finite().min(0).max(1000).optional(),
  /** percent: e.g. 33.33; the list must sum to 100 (±0.01) */
  percent: z.number().finite().min(0).max(100).optional(),
  /** exact: minor units of the expense's currency; the list must sum to amountMinor */
  amountMinor: z.number().int().min(0).max(1e13).optional(),
})
export type ParticipantInput = z.infer<typeof participantSchema>

const expenseFields = {
  amountMinor,
  currency: knownCurrency,
  /** Local date in the trip's time zone; omitted on create: today there */
  date: isoDate,
  category: expenseCategory,
  note: z.string().max(2000),
  /** A member paid … */
  payerMemberId: entityId.nullable(),
  /** … or the pool did (true), never both */
  pool: z.boolean(),
  /** Ignored for `self` (the payer carries the whole amount) */
  participants: z.array(participantSchema).max(50),
  splitMethod,
  /** Manual rate; null on PATCH clears it and resolves again (trip default → fxRates) */
  fxRate: fxRate.nullable(),
  stopId: entityId.nullable(),
  dayId: entityId.nullable(),
  receiptAttachmentId: entityId.nullable(),
  bookingId: entityId.nullable(),
  wishlistItemId: entityId.nullable(),
}

export const expenseCreateSchema = z
  .object({
    ...expenseFields,
    date: expenseFields.date.optional(),
    note: expenseFields.note.default(''),
    payerMemberId: expenseFields.payerMemberId.optional(),
    pool: expenseFields.pool.default(false),
    participants: expenseFields.participants.default([]),
    fxRate: fxRate.optional(),
    stopId: expenseFields.stopId.default(null),
    dayId: expenseFields.dayId.default(null),
    receiptAttachmentId: expenseFields.receiptAttachmentId.default(null),
    bookingId: expenseFields.bookingId.default(null),
    wishlistItemId: expenseFields.wishlistItemId.default(null),
  })
  .refine((e) => e.pool !== Boolean(e.payerMemberId), {
    message: 'give either payerMemberId or pool: true',
    path: ['payerMemberId'],
  })
export type ExpenseCreate = z.infer<typeof expenseCreateSchema>

/** Any subset; changing amount, currency, date, payer, participants, method or rate re-splits */
export const expensePatchSchema = z.object(expenseFields).partial()
export type ExpensePatch = z.infer<typeof expensePatchSchema>

export const expenseQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  category: expenseCategory.optional(),
  /** Payer or participant */
  memberId: entityId.optional(),
  /** Substring of the note */
  q: z.string().max(200).optional(),
  /** "1": soft-deleted expenses only (for the history page) */
  deleted: z.enum(['0', '1']).optional(),
})

export const expenseRestoreSchema = z.object({
  /** Restore the version recorded by this history row; omitted: undelete */
  historyId: entityId.optional(),
})

export const summaryQuerySchema = z.object({
  by: z.enum(['day', 'category', 'member']),
  from: isoDate.optional(),
  to: isoDate.optional(),
})

export const applyRateSchema = z.object({
  currency: knownCurrency,
  rate: fxRate,
  /** unsettled: expenses recorded after the latest settlement · all: every expense */
  scope: z.enum(['unsettled', 'all']),
})

export const fxOverridesSchema = z
  .record(z.string(), fxRate)
  .refine(
    (r) => Object.keys(r).every((c) => isCurrencyCode(c)),
    'unknown currency (see shared/money/currencies.ts)',
  )

export const fxQuerySchema = z.object({
  date: isoDate.optional(),
  quote: knownCurrency.optional(),
})

const contributionFields = {
  memberId: entityId,
  amountMinor,
  currency: knownCurrency,
  date: isoDate,
  note: z.string().max(2000),
  fxRate: fxRate.nullable(),
}

export const poolContributionCreateSchema = z.object({
  ...contributionFields,
  date: contributionFields.date.optional(),
  note: contributionFields.note.default(''),
  fxRate: fxRate.optional(),
})
export type PoolContributionCreate = z.infer<typeof poolContributionCreateSchema>

export const poolContributionPatchSchema = z.object(contributionFields).partial()
export type PoolContributionPatch = z.infer<typeof poolContributionPatchSchema>

export const poolSettingsSchema = z.object({ refundMode: poolRefundMode })

export const settlementCreateSchema = z
  .object({
    fromMemberId: entityId,
    toMemberId: entityId,
    /** Base-currency minor units; less than the suggestion = a partial settlement */
    amountMinor,
    method: settlementMethod.default('transfer'),
    note: z.string().max(2000).default(''),
    date: isoDate.optional(),
  })
  .refine((s) => s.fromMemberId !== s.toMemberId, {
    message: 'from and to must differ',
    path: ['toMemberId'],
  })
export type SettlementCreate = z.infer<typeof settlementCreateSchema>

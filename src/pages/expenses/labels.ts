import type { ExpenseView } from '../../../shared/api/expenses.ts'
import type { Member } from '../../../shared/api/types.ts'
import { formatMoney } from '../../../shared/i18n/format.ts'
import type { MessageKey } from '../../../shared/i18n/t.ts'
import type { SplitMethod } from '../../../shared/money/split.ts'
import type { ExpenseCategory } from '../../../shared/schema/expense.ts'
import { secondaryMinor, type PayerSummary, type SplitSummary } from '../../lib/expenses/form.ts'
import type { Translate } from '../../lib/i18n.ts'

// Words for the expense pages: category and method names, and the 「A 付 · 全員平分」 line.

const CATEGORY_LABEL: Record<ExpenseCategory, MessageKey> = {
  food: 'expenses.category.food',
  lodging: 'expenses.category.lodging',
  transport: 'expenses.category.transport',
  fuel: 'expenses.category.fuel',
  tickets: 'expenses.category.tickets',
  shopping: 'expenses.category.shopping',
  misc: 'expenses.category.misc',
  other: 'expenses.category.other',
}

const METHOD_LABEL: Record<SplitMethod, MessageKey> = {
  equal: 'expenses.method.equal',
  shares: 'expenses.method.shares',
  percent: 'expenses.method.percent',
  exact: 'expenses.method.exact',
  self: 'expenses.method.self',
}

export const categoryLabel = (t: Translate, category: ExpenseCategory): string =>
  t(CATEGORY_LABEL[category] ?? CATEGORY_LABEL.other)

/** 「Gene 付 · 全員平分」, 「公基金付 · 3 人分」, 「Mei 付 · 2 人 · 份數」 */
export function whoLine(
  t: Translate,
  summary: { payer: PayerSummary; split: SplitSummary },
  members: readonly Pick<Member, 'id' | 'name'>[],
): string {
  const payer =
    summary.payer.kind === 'pool'
      ? t('expenses.paidBy.pool')
      : t('expenses.paidBy.member', {
          name:
            members.find((m) => m.id === (summary.payer as { memberId: string }).memberId)?.name ??
            t('expenses.removedMember'),
        })
  const { split } = summary
  let how: string
  if (split.kind === 'self') how = t('expenses.split.personal')
  else if (split.kind === 'everyone') how = t('expenses.split.everyone')
  else {
    const people = t.plural('expenses.people', split.count)
    how =
      split.method === 'equal'
        ? t('expenses.split.equalCount', { people })
        : t('expenses.split.methodCount', { people, method: t(METHOD_LABEL[split.method]) })
  }
  return `${payer} · ${how}`
}

export interface RowMoney {
  baseCurrency: string
  secondaryCurrency: string | null
  /** 1 secondary = rate base (GET /fx), or null */
  secondaryRate: number | null
}

/** The amount as recorded, and the line under it: 「≈ A$40.95（≈ NT$…）」 */
export function amountLines(
  expense: ExpenseView,
  money: RowMoney,
  t: Translate,
): [string, string | null] {
  const primary = formatMoney(expense.amountMinor, expense.currency, t.locale)
  const secondaryAmount = secondaryMinor(
    expense.baseMinor,
    money.baseCurrency,
    money.secondaryCurrency,
    money.secondaryRate,
  )
  const secondary =
    secondaryAmount !== null &&
    money.secondaryCurrency &&
    money.secondaryCurrency !== expense.currency
      ? { minor: secondaryAmount, currency: money.secondaryCurrency }
      : undefined
  if (expense.currency !== money.baseCurrency) {
    const base = formatMoney(expense.baseMinor, money.baseCurrency, t.locale, { secondary })
    return [primary, t('expenses.rate.approx', { amount: base })]
  }
  if (secondary) {
    return [
      primary,
      t('expenses.rate.approx', {
        amount: formatMoney(secondary.minor, secondary.currency, t.locale),
      }),
    ]
  }
  return [primary, null]
}

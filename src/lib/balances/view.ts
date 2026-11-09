import type {
  BalanceRow,
  FxResponse,
  PoolRefundMode,
  Settlement,
} from '../../../shared/api/expenses.ts'
import type { Member } from '../../../shared/api/types.ts'
import { formatMoney } from '../../../shared/i18n/format.ts'
import type { Locale, MessageKey } from '../../../shared/i18n/t.ts'
import { convertMinor, invertRate } from '../../../shared/money/fx.ts'
import type { Transfer } from '../../../shared/money/settle.ts'
import type { SettlementMethod } from '../../../shared/schema/expense.ts'
import { paletteIndex } from '../colors.ts'

// Pure helpers for the balances page (e7-t04, e7-t05): signs and labels, the secondary-currency
// line, who is who (removed members included) and the suggestion cards. Sign convention as in
// shared/money/balances.ts: netMinor > 0 gets money back, < 0 owes.

export type BalanceTone = 'gets' | 'owes' | 'even'

export function toneOf(netMinor: number): BalanceTone {
  return netMinor > 0 ? 'gets' : netMinor < 0 ? 'owes' : 'even'
}

/** The word next to the number, so the state never rests on colour alone (DESIGN.md §6) */
export const TONE_LABEL: Record<BalanceTone, MessageKey> = {
  gets: 'balances.tone.gets',
  owes: 'balances.tone.owes',
  even: 'balances.tone.even',
}

const MINUS = '−'

/** "+A$12.34", "−A$12.34" or "A$0.00": the sign is spelled out, the amount is formatted by Intl */
export function signedMoney(minor: number, currency: string, locale: Locale): string {
  const amount = formatMoney(Math.abs(minor), currency, locale)
  if (minor > 0) return `+${amount}`
  if (minor < 0) return `${MINUS}${amount}`
  return amount
}

/**
 * The rate for the secondary line from GET /fx?quote=<secondary> (1 secondary = rate base), or
 * null when there is no secondary currency, it is the base, or no rate is known.
 */
export function secondaryRate(fx: FxResponse | null | undefined, secondary: string | null): number | null {
  if (!fx || !secondary || secondary === fx.base) return null
  return fx.rates.find((rate) => rate.quote === secondary)?.rate ?? null
}

/** A base-currency amount in the secondary currency (rate: 1 secondary = rate base), or null */
export function toSecondaryMinor(
  baseMinor: number,
  base: string,
  secondary: string | null,
  rate: number | null,
): number | null {
  if (!secondary || secondary === base || !rate || rate <= 0) return null
  try {
    return convertMinor(baseMinor, base, secondary, invertRate(rate))
  } catch {
    return null
  }
}

/** Someone who appears in the balances: a current member, or a removed one we may not know */
export interface Person {
  id: string
  /** null: removed and no longer in the member list (show a generic label) */
  name: string | null
  colorIndex: number
  removed: boolean
  isMe: boolean
}

/** Everyone the balances mention, by id: current members first, then removed ids from the rows */
export function peopleOf(
  members: readonly Member[],
  meId: string,
  rows: readonly Pick<BalanceRow, 'memberId' | 'removed'>[] = [],
): Map<string, Person> {
  const people = new Map<string, Person>()
  for (const member of members) {
    people.set(member.id, {
      id: member.id,
      name: member.name,
      colorIndex: paletteIndex(member.color, member.id),
      removed: false,
      isMe: member.id === meId,
    })
  }
  for (const row of rows) {
    const known = people.get(row.memberId)
    if (known) {
      if (row.removed) known.removed = true
    } else {
      people.set(row.memberId, {
        id: row.memberId,
        name: null,
        colorIndex: paletteIndex(null, row.memberId),
        removed: true,
        isMe: false,
      })
    }
  }
  return people
}

/** A person by id, even one nobody has heard of (a settlement with a member removed since) */
export function personFor(people: Map<string, Person>, id: string): Person {
  return (
    people.get(id) ?? {
      id,
      name: null,
      colorIndex: paletteIndex(null, id),
      removed: true,
      isMe: false,
    }
  )
}

export interface SuggestionCard {
  key: string
  from: Person
  to: Person
  amountMinor: number
  /** "Me" pays or receives: shown first */
  mine: boolean
}

/** The server's suggested transfers as cards; the ones involving me first, otherwise in order */
export function suggestionCards(
  suggested: readonly Transfer[],
  people: Map<string, Person>,
): SuggestionCard[] {
  const cards = suggested
    .filter((transfer) => transfer.amountMinor > 0)
    .map((transfer, index) => {
      const from = personFor(people, transfer.from)
      const to = personFor(people, transfer.to)
      return {
        key: `${transfer.from}>${transfer.to}#${index}`,
        from,
        to,
        amountMinor: transfer.amountMinor,
        mine: from.isMe || to.isMe,
        index,
      }
    })
  cards.sort((a, b) => Number(b.mine) - Number(a.mine) || a.index - b.index)
  return cards.map(({ index: _index, ...card }) => card)
}

/** The settlement log, newest first (by date, then by when it was recorded) */
export function settlementLog(settlements: readonly Settlement[]): Settlement[] {
  return settlements
    .filter((settlement) => !settlement.deletedAt)
    .toSorted(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id),
    )
}

export const METHOD_LABEL: Record<SettlementMethod, MessageKey> = {
  cash: 'balances.method.cash',
  transfer: 'balances.method.transfer',
  other: 'balances.method.other',
}

export const REFUND_LABEL: Record<PoolRefundMode, MessageKey> = {
  proportional: 'balances.pool.refund.proportional',
  equal: 'balances.pool.refund.equal',
}

export interface PoolShareRow {
  memberId: string
  /** Put into the pool, base currency */
  inMinor: number
  /** Their part of what is left (negative: the pool is overdrawn and they top it up) */
  backMinor: number
}

/** Who put in and what they get back, from the balance rows (only people with a pool part) */
export function poolShares(rows: readonly BalanceRow[]): PoolShareRow[] {
  return rows
    .filter((row) => row.poolInMinor !== 0 || row.poolBackMinor !== 0)
    .map((row) => ({ memberId: row.memberId, inMinor: row.poolInMinor, backMinor: row.poolBackMinor }))
}

/** My row, or null when I have no balance yet */
export function myRow(rows: readonly BalanceRow[], meId: string): BalanceRow | null {
  return rows.find((row) => row.memberId === meId) ?? null
}

export type SettleAmountProblem = 'empty' | 'tooMuch'

/**
 * A settled amount must be positive and at most what the suggestion says (a partial settlement is
 * less); paying more than is owed would flip who owes whom, so it is refused here.
 */
export function checkSettleAmount(minor: number | null, maxMinor: number): SettleAmountProblem | null {
  if (minor === null || minor <= 0) return 'empty'
  if (minor > maxMinor) return 'tooMuch'
  return null
}

/** Parse a typed exchange rate ("19.02", "0,91"); null when it is not a positive number */
export function parseRate(text: string): number | null {
  const cleaned = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) && value > 0 ? value : null
}

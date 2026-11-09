/**
 * Per-member balances in the trip's base currency.
 *
 * Sign convention: `netMinor > 0` means the member gets money back;
 * `netMinor < 0` means the member owes money.
 *
 *   net = paid − owed + poolIn − poolBack + settledOut − settledIn
 *
 * - `paid`: base amount of expenses this member paid personally.
 * - `owed`: sum of this member's shares across all expenses.
 * - `poolIn`: contributions into the shared pool (公基金).
 * - `poolBack`: this member's part of the pool's remaining balance, refunded at
 *   the end (proportional to contributions, or equally among contributors).
 *   If the pool is overdrawn, `poolBack` is negative (the deficit is charged the
 *   same way). If nobody contributed, the remainder is spread equally over all members.
 * - `settledOut` / `settledIn`: recorded transfers paid / received.
 *
 * The nets of all members always sum to zero.
 */
import { allocate } from './split';

/** A member, in display order (order drives remainder distribution). */
export interface BalanceMember {
  id: string;
}

/** An expense already converted to base currency and already split. */
export interface BalanceExpense {
  /** Member id or `'pool'`. */
  payerId: string;
  /** Total in base-currency minor units. */
  baseMinor: number;
  /** Shares in base-currency minor units; must sum to `baseMinor`. */
  shares: { memberId: string; shareMinor: number }[];
}

/** A contribution into the pool, in base-currency minor units. */
export interface PoolContribution {
  memberId: string;
  baseMinor: number;
}

/** A recorded transfer `from` → `to`, in base-currency minor units. */
export interface Settlement {
  from: string;
  to: string;
  amountMinor: number;
}

/** How the pool's remaining balance is refunded. */
export type PoolRefundMode = 'proportional' | 'equal';

/** Input of {@link computeBalances}. */
export interface BalancesInput {
  members: BalanceMember[];
  expenses: BalanceExpense[];
  poolContributions: PoolContribution[];
  settlements: Settlement[];
  poolRefund: PoolRefundMode;
}

/** One member's balance breakdown (base-currency minor units). */
export interface MemberBalance {
  memberId: string;
  paidMinor: number;
  owedMinor: number;
  poolInMinor: number;
  poolBackMinor: number;
  settledOutMinor: number;
  settledInMinor: number;
  /** > 0 gets back, < 0 owes. */
  netMinor: number;
}

/** Thrown when balances input references unknown members or is inconsistent. */
export class BalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BalanceError';
  }
}

/** Current pool balance: contributions minus pool-paid expenses (may be negative). */
export function poolBalance(input: Pick<BalancesInput, 'expenses' | 'poolContributions'>): number {
  const inSum = input.poolContributions.reduce((a, c) => a + c.baseMinor, 0);
  const outSum = input.expenses.filter((e) => e.payerId === 'pool').reduce((a, e) => a + e.baseMinor, 0);
  return inSum - outSum;
}

/**
 * Compute every member's balance in base currency, including the pool refund.
 * Members are returned in input order.
 */
export function computeBalances(input: BalancesInput): MemberBalance[] {
  const { members, expenses, poolContributions, settlements, poolRefund } = input;
  const rows = new Map<string, MemberBalance>();
  for (const m of members) {
    if (rows.has(m.id)) throw new BalanceError(`Duplicate member ${m.id}`);
    rows.set(m.id, {
      memberId: m.id,
      paidMinor: 0,
      owedMinor: 0,
      poolInMinor: 0,
      poolBackMinor: 0,
      settledOutMinor: 0,
      settledInMinor: 0,
      netMinor: 0,
    });
  }
  const row = (id: string): MemberBalance => {
    const r = rows.get(id);
    if (!r) throw new BalanceError(`Unknown member ${id}`);
    return r;
  };
  const checkInt = (n: number, what: string): void => {
    if (!Number.isSafeInteger(n)) throw new BalanceError(`${what} must be a safe integer, got ${n}`);
  };

  for (const e of expenses) {
    checkInt(e.baseMinor, 'expense.baseMinor');
    const shareSum = e.shares.reduce((a, s) => a + s.shareMinor, 0);
    if (shareSum !== e.baseMinor) {
      throw new BalanceError(`Expense shares sum to ${shareSum}, expected ${e.baseMinor}`);
    }
    if (e.payerId !== 'pool') row(e.payerId).paidMinor += e.baseMinor;
    for (const s of e.shares) {
      checkInt(s.shareMinor, 'share.shareMinor');
      row(s.memberId).owedMinor += s.shareMinor;
    }
  }
  for (const c of poolContributions) {
    checkInt(c.baseMinor, 'contribution.baseMinor');
    row(c.memberId).poolInMinor += c.baseMinor;
  }
  for (const s of settlements) {
    checkInt(s.amountMinor, 'settlement.amountMinor');
    row(s.from).settledOutMinor += s.amountMinor;
    row(s.to).settledInMinor += s.amountMinor;
  }

  const remaining = poolBalance(input);
  if (remaining !== 0 && members.length > 0) {
    const list = members.map((m) => row(m.id));
    const contributors = list.filter((r) => r.poolInMinor > 0);
    const targets = contributors.length > 0 ? contributors : list;
    const weights =
      contributors.length > 0 && poolRefund === 'proportional'
        ? targets.map((r) => BigInt(r.poolInMinor))
        : targets.map(() => 1n);
    const parts = allocate(Math.abs(remaining), weights, 0);
    const sign = remaining < 0 ? -1 : 1;
    targets.forEach((r, i) => {
      r.poolBackMinor = sign * parts[i]! || 0;
    });
  }

  for (const r of rows.values()) {
    r.netMinor = r.paidMinor - r.owedMinor + r.poolInMinor - r.poolBackMinor + r.settledOutMinor - r.settledInMinor;
  }
  return members.map((m) => row(m.id));
}

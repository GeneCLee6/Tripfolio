/**
 * Settlement suggestions: who pays whom to zero every balance.
 *
 * Greedy: repeatedly match the largest creditor with the largest debtor and
 * transfer the smaller of the two amounts. Ties are broken by member id
 * (ascending, by code unit) so the result is deterministic. Each transfer
 * zeroes at least one member and the last one zeroes two, so there are at most
 * n − 1 transfers for n members with non-zero balances.
 */

/** A suggested transfer, in base-currency minor units. */
export interface Transfer {
  from: string;
  to: string;
  amountMinor: number;
}

/** Minimal balance shape accepted by {@link suggestSettlements} (net > 0 = gets back). */
export interface NetBalance {
  memberId: string;
  netMinor: number;
}

/** Thrown when balances do not sum to zero or are not integers. */
export class SettleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettleError';
  }
}

function cmpId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Pick the entry with the largest amount, ties → smallest id. */
function pickLargest(list: { id: string; amt: number }[]): { id: string; amt: number } | undefined {
  let best: { id: string; amt: number } | undefined;
  for (const x of list) {
    if (x.amt <= 0) continue;
    if (!best || x.amt > best.amt || (x.amt === best.amt && cmpId(x.id, best.id) < 0)) best = x;
  }
  return best;
}

/**
 * Suggest the transfers that settle all balances (greedy largest creditor ↔
 * largest debtor). Throws {@link SettleError} if the nets do not sum to zero.
 */
export function suggestSettlements(balances: readonly NetBalance[]): Transfer[] {
  let sum = 0;
  for (const b of balances) {
    if (!Number.isSafeInteger(b.netMinor)) throw new SettleError(`netMinor must be a safe integer, got ${b.netMinor}`);
    sum += b.netMinor;
  }
  if (sum !== 0) throw new SettleError(`Balances must sum to zero, got ${sum}`);

  const creditors = balances.filter((b) => b.netMinor > 0).map((b) => ({ id: b.memberId, amt: b.netMinor }));
  const debtors = balances.filter((b) => b.netMinor < 0).map((b) => ({ id: b.memberId, amt: -b.netMinor }));
  const out: Transfer[] = [];
  for (;;) {
    const c = pickLargest(creditors);
    const d = pickLargest(debtors);
    if (!c || !d) break;
    const amount = Math.min(c.amt, d.amt);
    out.push({ from: d.id, to: c.id, amountMinor: amount });
    c.amt -= amount;
    d.amt -= amount;
  }
  return out;
}

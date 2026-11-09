/**
 * Expense splitting in integer minor units.
 *
 * Remainder rule (ARCHITECTURE §4.3): every share is first floored; the
 * leftover minor units are then handed out one at a time, starting from the
 * payer (when the payer is a participant) and continuing in participant order,
 * wrapping around. When the payer is not a participant (or is the pool) the
 * hand-out starts at the first participant. Participants whose weight is zero
 * never receive a leftover unit.
 *
 * Invariant: `sum(shares.shareMinor) === amountMinor`.
 */

/** Payer of an expense: a member id, or the trip's shared pool (公基金). */
export type PayerId = string | 'pool';

/** The five split methods (E7). */
export type SplitMethod = 'equal' | 'shares' | 'percent' | 'exact' | 'self';

/** One participant line of a split. Which optional field is read depends on the method. */
export interface SplitParticipant {
  memberId: string;
  /** `shares`: weight (e.g. 2 for a couple, 0.5 for a child). Defaults to 1. */
  weight?: number;
  /** `percent`: percentage of the total, e.g. `33.33`. */
  percent?: number;
  /** `exact`: amount in minor units. */
  amountMinor?: number;
}

/** Input of {@link splitExpense}. */
export interface SplitInput {
  /** Total in minor units (non-negative safe integer). */
  amountMinor: number;
  payerId: PayerId;
  method: SplitMethod;
  /** Ignored for `self`; otherwise non-empty and without duplicates. */
  participants: SplitParticipant[];
}

/** One member's share of an expense, in minor units. */
export interface Share {
  memberId: string;
  shareMinor: number;
}

/** Machine-readable reason of a {@link SplitError}. */
export type SplitErrorCode =
  | 'invalid-amount'
  | 'no-participants'
  | 'duplicate-participant'
  | 'invalid-weight'
  | 'zero-total-weight'
  | 'invalid-percent'
  | 'percent-sum'
  | 'invalid-exact'
  | 'exact-sum'
  | 'self-pool-payer';

/** Typed error thrown by {@link splitExpense} on invalid input. */
export class SplitError extends Error {
  readonly code: SplitErrorCode;
  constructor(code: SplitErrorCode, message: string) {
    super(message);
    this.name = 'SplitError';
    this.code = code;
  }
}

/** Fixed-point scale used to turn fractional weights / percents into integers. */
const SCALE = 1_000_000;

/** Percent sums within this distance of 100 are accepted (then normalised). */
export const PERCENT_TOLERANCE = 0.01;

/**
 * Allocate `total` minor units proportionally to non-negative integer
 * `weights`, using floor + the remainder rule starting at `startIndex`.
 * Exact (BigInt) arithmetic; the result always sums to `total`.
 */
export function allocate(total: number, weights: readonly bigint[], startIndex: number): number[] {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError(`allocate: total must be a non-negative safe integer, got ${total}`);
  }
  const sumW = weights.reduce((a, b) => a + b, 0n);
  if (weights.length === 0 || sumW <= 0n) throw new RangeError('allocate: weights must have a positive sum');
  const T = BigInt(total);
  const out = weights.map((w) => Number((T * w) / sumW));
  let left = total - out.reduce((a, b) => a + b, 0);
  const n = weights.length;
  const start = startIndex >= 0 && startIndex < n ? startIndex : 0;
  for (let k = 0; left > 0; k++) {
    const i = (start + k) % n;
    if (weights[i]! > 0n) {
      out[i]! += 1;
      left -= 1;
    }
  }
  return out;
}

/** Turn a non-negative decimal into a scaled BigInt (6 decimal places). */
function scaled(value: number): bigint {
  return BigInt(Math.round(value * SCALE));
}

/**
 * Split an expense into per-member shares (integer minor units).
 * Throws {@link SplitError} on invalid input; see the module doc for the remainder rule.
 */
export function splitExpense(input: SplitInput): Share[] {
  const { amountMinor, payerId, method, participants } = input;
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new SplitError('invalid-amount', `amountMinor must be a non-negative safe integer, got ${amountMinor}`);
  }

  if (method === 'self') {
    if (payerId === 'pool') throw new SplitError('self-pool-payer', "'self' split needs a member payer, not the pool");
    return [{ memberId: payerId, shareMinor: amountMinor }];
  }

  if (participants.length === 0) throw new SplitError('no-participants', 'At least one participant is required');
  const seen = new Set<string>();
  for (const p of participants) {
    if (seen.has(p.memberId)) throw new SplitError('duplicate-participant', `Duplicate participant ${p.memberId}`);
    seen.add(p.memberId);
  }
  const payerIndex = payerId === 'pool' ? -1 : participants.findIndex((p) => p.memberId === payerId);
  const ids = participants.map((p) => p.memberId);
  const zip = (amounts: number[]): Share[] => ids.map((memberId, i) => ({ memberId, shareMinor: amounts[i]! }));

  switch (method) {
    case 'equal':
      return zip(allocate(amountMinor, participants.map(() => 1n), payerIndex));

    case 'shares': {
      const weights = participants.map((p) => {
        const w = p.weight ?? 1;
        if (!Number.isFinite(w) || w < 0) throw new SplitError('invalid-weight', `Invalid weight for ${p.memberId}: ${w}`);
        return scaled(w);
      });
      if (weights.every((w) => w === 0n)) throw new SplitError('zero-total-weight', 'All weights are zero');
      return zip(allocate(amountMinor, weights, payerIndex));
    }

    case 'percent': {
      let sum = 0;
      const weights = participants.map((p) => {
        const pc = p.percent;
        if (pc === undefined || !Number.isFinite(pc) || pc < 0) {
          throw new SplitError('invalid-percent', `Invalid percent for ${p.memberId}: ${pc}`);
        }
        sum += pc;
        return scaled(pc);
      });
      if (Math.abs(sum - 100) > PERCENT_TOLERANCE + 1e-9) {
        throw new SplitError('percent-sum', `Percents must sum to 100 (±${PERCENT_TOLERANCE}), got ${sum}`);
      }
      // Normalising by the actual sum absorbs the tolerance; the remainder rule fixes the last units.
      return zip(allocate(amountMinor, weights, payerIndex));
    }

    case 'exact': {
      let sum = 0;
      for (const p of participants) {
        const a = p.amountMinor;
        if (a === undefined || !Number.isSafeInteger(a) || a < 0) {
          throw new SplitError('invalid-exact', `Invalid exact amount for ${p.memberId}: ${a}`);
        }
        sum += a;
      }
      if (sum !== amountMinor) {
        throw new SplitError('exact-sum', `Exact amounts sum to ${sum}, expected ${amountMinor}`);
      }
      return zip(participants.map((p) => p.amountMinor!));
    }

    default: {
      const never: never = method;
      throw new SplitError('invalid-amount', `Unknown split method ${String(never)}`);
    }
  }
}

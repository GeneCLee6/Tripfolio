/**
 * Currency conversion with explicit rounding.
 *
 * A rate means "1 major unit of `from` = `rate` major units of `to`", stored
 * with at most 6 decimals. Conversion is exact (BigInt) and rounds half away
 * from zero ("half-up" for positive amounts) to the target currency's minor units.
 */
import { minorUnitsOf } from './currencies';

/** Decimal places kept for stored rates. */
export const RATE_DECIMALS = 6;
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);

/** Round a rate to {@link RATE_DECIMALS} decimals; throws if not finite and positive. */
export function normalizeRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`Rate must be a positive finite number, got ${rate}`);
  const r = Math.round(rate * 10 ** RATE_DECIMALS) / 10 ** RATE_DECIMALS;
  if (r <= 0) throw new RangeError(`Rate ${rate} rounds to zero at ${RATE_DECIMALS} decimals`);
  return r;
}

/** Integer division of `n / d` (d > 0) rounding half away from zero. */
function divRoundHalfUp(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (a * 2n + d) / (d * 2n);
  return neg ? -q : q;
}

/**
 * Convert integer minor units of `fromCode` into integer minor units of
 * `toCode` at `rate` (1 from = rate to), rounding half-up to the target precision.
 */
export function convertMinor(minor: number, fromCode: string, toCode: string, rate: number): number {
  if (!Number.isSafeInteger(minor)) throw new RangeError(`Minor amount must be a safe integer, got ${minor}`);
  const fromDigits = minorUnitsOf(fromCode);
  const toDigits = minorUnitsOf(toCode);
  if (fromCode === toCode && rate === 1) return minor;
  const rateScaled = BigInt(Math.round(normalizeRate(rate) * 10 ** RATE_DECIMALS));
  const num = BigInt(minor) * rateScaled * 10n ** BigInt(toDigits);
  const den = RATE_SCALE * 10n ** BigInt(fromDigits);
  return Number(divRoundHalfUp(num, den));
}

/** Invert a rate (A→B into B→A), rounded to {@link RATE_DECIMALS} decimals. */
export function invertRate(rate: number): number {
  return normalizeRate(1 / normalizeRate(rate));
}

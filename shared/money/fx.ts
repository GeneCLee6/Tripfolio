/**
 * Currency conversion with explicit rounding.
 *
 * A rate means "1 major unit of `from` = `rate` major units of `to`", stored with
 * {@link RATE_SIGNIFICANT_DIGITS} significant digits (not a fixed number of decimals:
 * 1 IDR = 0.00009523809524 AUD keeps its precision, which 6 decimals did not, about 0.25% off).
 * Conversion is exact (BigInt from the rate's decimal digits) and rounds half away from zero
 * ("half-up" for positive amounts) to the target currency's minor units.
 *
 * Changed 2026-11-09 (backend sweep): rates used to be rounded to 6 decimals. Rows written before
 * keep their stored rate; only new or recomputed rates get the extra digits.
 */
import { minorUnitsOf } from './currencies';

/** Significant digits kept for stored rates. */
export const RATE_SIGNIFICANT_DIGITS = 10;
/**
 * @deprecated Rates are no longer kept at a fixed number of decimals; this is now the number of
 * significant digits ({@link RATE_SIGNIFICANT_DIGITS}). Kept so existing imports still compile.
 */
export const RATE_DECIMALS = RATE_SIGNIFICANT_DIGITS;

/** Round a rate to {@link RATE_SIGNIFICANT_DIGITS} significant digits; throws if not finite and positive. */
export function normalizeRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`Rate must be a positive finite number, got ${rate}`);
  const r = Number(rate.toPrecision(RATE_SIGNIFICANT_DIGITS));
  if (!(r > 0) || !Number.isFinite(r)) throw new RangeError(`Rate ${rate} cannot be stored`);
  return r;
}

/** A normalized rate as an exact fraction: `mantissa × 10^exp10` (mantissa a BigInt of the digits). */
function rateParts(rate: number): { mantissa: bigint; exp10: number } {
  // toExponential(9) is exactly the 10 significant digits normalizeRate kept: "d.ddddddddde±x"
  const [digits, exp] = normalizeRate(rate).toExponential(RATE_SIGNIFICANT_DIGITS - 1).split('e');
  return {
    mantissa: BigInt(digits.replace('.', '')),
    exp10: Number(exp) - (RATE_SIGNIFICANT_DIGITS - 1),
  };
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
  const { mantissa, exp10 } = rateParts(rate);
  let num = BigInt(minor) * mantissa * 10n ** BigInt(toDigits);
  let den = 10n ** BigInt(fromDigits);
  if (exp10 >= 0) num *= 10n ** BigInt(exp10);
  else den *= 10n ** BigInt(-exp10);
  return Number(divRoundHalfUp(num, den));
}

/** Invert a rate (A→B into B→A), rounded to {@link RATE_SIGNIFICANT_DIGITS} significant digits. */
export function invertRate(rate: number): number {
  return normalizeRate(1 / normalizeRate(rate));
}

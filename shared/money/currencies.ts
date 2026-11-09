/**
 * Currency table and minor-unit helpers.
 *
 * All money in Tripfolio is stored as an integer number of minor units
 * (cents for AUD, whole rupiah for IDR). Never assume two decimals: look the
 * currency up here (CLAUDE.md rule 13).
 */

/** Static description of one ISO 4217 currency. */
export interface Currency {
  /** ISO 4217 code, e.g. `'AUD'`. */
  code: string;
  /** Display symbol, e.g. `'A$'`. */
  symbol: string;
  /** Number of decimal digits in one major unit (0 or 2 here). */
  minorUnits: number;
  /** Bilingual display name. */
  name: { 'zh-TW': string; en: string };
}

/** Supported currencies keyed by ISO code. */
export const CURRENCIES = {
  AUD: { code: 'AUD', symbol: 'A$', minorUnits: 2, name: { 'zh-TW': '澳幣', en: 'Australian dollar' } },
  TWD: { code: 'TWD', symbol: 'NT$', minorUnits: 2, name: { 'zh-TW': '新臺幣', en: 'New Taiwan dollar' } },
  NZD: { code: 'NZD', symbol: 'NZ$', minorUnits: 2, name: { 'zh-TW': '紐西蘭幣', en: 'New Zealand dollar' } },
  IDR: { code: 'IDR', symbol: 'Rp', minorUnits: 0, name: { 'zh-TW': '印尼盾', en: 'Indonesian rupiah' } },
  THB: { code: 'THB', symbol: '฿', minorUnits: 2, name: { 'zh-TW': '泰銖', en: 'Thai baht' } },
  FJD: { code: 'FJD', symbol: 'FJ$', minorUnits: 2, name: { 'zh-TW': '斐濟幣', en: 'Fijian dollar' } },
  USD: { code: 'USD', symbol: 'US$', minorUnits: 2, name: { 'zh-TW': '美元', en: 'US dollar' } },
  EUR: { code: 'EUR', symbol: '€', minorUnits: 2, name: { 'zh-TW': '歐元', en: 'Euro' } },
  GBP: { code: 'GBP', symbol: '£', minorUnits: 2, name: { 'zh-TW': '英鎊', en: 'Pound sterling' } },
  CHF: { code: 'CHF', symbol: 'CHF', minorUnits: 2, name: { 'zh-TW': '瑞士法郎', en: 'Swiss franc' } },
  CZK: { code: 'CZK', symbol: 'Kč', minorUnits: 2, name: { 'zh-TW': '捷克克朗', en: 'Czech koruna' } },
  JPY: { code: 'JPY', symbol: '¥', minorUnits: 0, name: { 'zh-TW': '日圓', en: 'Japanese yen' } },
  KRW: { code: 'KRW', symbol: '₩', minorUnits: 0, name: { 'zh-TW': '韓元', en: 'South Korean won' } },
  VND: { code: 'VND', symbol: '₫', minorUnits: 0, name: { 'zh-TW': '越南盾', en: 'Vietnamese dong' } },
  SGD: { code: 'SGD', symbol: 'S$', minorUnits: 2, name: { 'zh-TW': '新加坡幣', en: 'Singapore dollar' } },
  MYR: { code: 'MYR', symbol: 'RM', minorUnits: 2, name: { 'zh-TW': '馬來西亞令吉', en: 'Malaysian ringgit' } },
  HKD: { code: 'HKD', symbol: 'HK$', minorUnits: 2, name: { 'zh-TW': '港幣', en: 'Hong Kong dollar' } },
  CNY: { code: 'CNY', symbol: 'CN¥', minorUnits: 2, name: { 'zh-TW': '人民幣', en: 'Chinese yuan' } },
} as const satisfies Record<string, Currency>;

/** ISO code of a supported currency. */
export type CurrencyCode = keyof typeof CURRENCIES;

/** All supported currency codes, in table order. */
export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

/** Default settlement (base) currency of a new trip. */
export const DEFAULT_BASE_CURRENCY: CurrencyCode = 'AUD';

/** Default secondary display currency of a new trip. */
export const DEFAULT_SECONDARY_CURRENCY: CurrencyCode = 'TWD';

/** Thrown when a currency code is not in {@link CURRENCIES}. */
export class UnknownCurrencyError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Unknown currency: ${code}`);
    this.name = 'UnknownCurrencyError';
    this.code = code;
  }
}

/** True when `code` is a supported currency code. */
export function isCurrencyCode(code: string): code is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

/** Look up a currency; throws {@link UnknownCurrencyError} if unsupported. */
export function getCurrency(code: string): Currency {
  if (!isCurrencyCode(code)) throw new UnknownCurrencyError(code);
  return CURRENCIES[code];
}

/** Number of minor-unit digits of a currency (0 for IDR/JPY/KRW/VND). */
export function minorUnitsOf(code: string): number {
  return getCurrency(code).minorUnits;
}

/**
 * Convert a major-unit amount (as typed by a user, e.g. `33.33`) to an integer
 * number of minor units, rounding half away from zero to the currency's precision.
 */
export function toMinor(amount: number, code: string): number {
  if (!Number.isFinite(amount)) throw new RangeError(`Amount must be finite: ${amount}`);
  const digits = minorUnitsOf(code);
  // Round via the decimal string to avoid binary artefacts like 1.005 * 100 = 100.4999.
  const sign = amount < 0 ? -1 : 1;
  const scaled = Number(`${Math.abs(amount)}e${digits}`);
  const rounded = Math.round(Number.isFinite(scaled) ? scaled : Math.abs(amount) * 10 ** digits);
  return sign * rounded || 0;
}

/** Convert integer minor units back to a major-unit number (for display / inputs only). */
export function fromMinor(minor: number, code: string): number {
  if (!Number.isInteger(minor)) throw new RangeError(`Minor amount must be an integer: ${minor}`);
  const digits = minorUnitsOf(code);
  return digits === 0 ? minor : minor / 10 ** digits;
}

/**
 * Format integer minor units for display using `Intl.NumberFormat` with the
 * currency's exact number of fraction digits.
 */
export function formatMoney(minor: number, code: string, locale: string = 'zh-TW'): string {
  const digits = minorUnitsOf(code);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(fromMinor(minor, code));
}

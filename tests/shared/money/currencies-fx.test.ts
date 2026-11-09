import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  CURRENCY_CODES,
  DEFAULT_BASE_CURRENCY,
  DEFAULT_SECONDARY_CURRENCY,
  UnknownCurrencyError,
  formatMoney,
  fromMinor,
  getCurrency,
  toMinor,
} from '../../../shared/money/currencies';
import { convertMinor, invertRate, normalizeRate } from '../../../shared/money/fx';

describe('currencies', () => {
  it('has the required currencies with correct minor units', () => {
    const required = ['AUD', 'TWD', 'NZD', 'IDR', 'THB', 'FJD', 'USD', 'EUR', 'GBP', 'CHF', 'CZK', 'JPY', 'KRW', 'VND', 'SGD', 'MYR', 'HKD', 'CNY'];
    for (const code of required) expect(CURRENCY_CODES).toContain(code);
    for (const code of CURRENCY_CODES) {
      const c = CURRENCIES[code];
      expect(c.code).toBe(code);
      expect(c.minorUnits).toBe(['IDR', 'JPY', 'KRW', 'VND'].includes(code) ? 0 : 2);
      expect(c.name['zh-TW'].length).toBeGreaterThan(0);
      expect(c.name.en.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_BASE_CURRENCY).toBe('AUD');
    expect(DEFAULT_SECONDARY_CURRENCY).toBe('TWD');
  });

  it('toMinor / fromMinor respect minor units and avoid float artefacts', () => {
    expect(toMinor(33.33, 'NZD')).toBe(3333);
    expect(toMinor(1.005, 'AUD')).toBe(101);
    expect(toMinor(0.1 + 0.2, 'AUD')).toBe(30);
    expect(toMinor(150000, 'IDR')).toBe(150000);
    expect(toMinor(1234.5, 'JPY')).toBe(1235);
    expect(toMinor(-12.345, 'EUR')).toBe(-1235);
    expect(fromMinor(3333, 'NZD')).toBe(33.33);
    expect(fromMinor(150000, 'IDR')).toBe(150000);
    expect(() => toMinor(1, 'XXX')).toThrow(UnknownCurrencyError);
    expect(() => getCurrency('ABC')).toThrow(UnknownCurrencyError);
  });

  it('formatMoney uses the right number of fraction digits', () => {
    const idr = formatMoney(1500000, 'IDR', 'en-US');
    expect(idr).toContain('1,500,000');
    expect(idr).not.toMatch(/\.\d/);
    expect(formatMoney(123456, 'AUD', 'en-US')).toContain('1,234.56');
    expect(formatMoney(5, 'NZD', 'en-US')).toContain('0.05');
    expect(formatMoney(1000, 'JPY', 'en-US')).toContain('1,000');
    expect(formatMoney(1000, 'JPY', 'en-US')).not.toContain('.');
    expect(formatMoney(123456, 'TWD', 'zh-TW')).toContain('1,234.56');
  });
});

describe('fx', () => {
  it('converts between 2-decimal currencies with half-up rounding', () => {
    // NZD 100.00 at 0.912345 AUD = AUD 91.2345 -> 91.23
    expect(convertMinor(10000, 'NZD', 'AUD', 0.912345)).toBe(9123);
    // NZD 0.01 at 0.5 -> AUD 0.005 -> rounds up to 0.01
    expect(convertMinor(1, 'NZD', 'AUD', 0.5)).toBe(1);
    // negative amounts round half away from zero
    expect(convertMinor(-1, 'NZD', 'AUD', 0.5)).toBe(-1);
  });

  it('handles 0-decimal source and target currencies', () => {
    // IDR 1,000,000 at 0.000095 AUD = AUD 95.00
    expect(convertMinor(1_000_000, 'IDR', 'AUD', 0.000095)).toBe(9500);
    // AUD 10.00 at 10526.315789 IDR = IDR 105263.15789 -> 105263
    expect(convertMinor(1000, 'AUD', 'IDR', 10526.315789)).toBe(105263);
    // AUD 0.05 at 10 JPY... 0.5 JPY -> 1 (half-up)
    expect(convertMinor(5, 'AUD', 'JPY', 10)).toBe(1);
  });

  it('identity conversion keeps the amount; rates keep 10 significant digits', () => {
    expect(convertMinor(12345, 'AUD', 'AUD', 1)).toBe(12345);
    expect(normalizeRate(20.12345678)).toBe(20.12345678);
    expect(normalizeRate(20.123456789123)).toBe(20.12345679);
    // small rates keep their digits (6 decimals made this 0.000095, about 0.25% off)
    expect(normalizeRate(1 / 10500)).toBe(0.00009523809524);
    expect(normalizeRate(12444.8612345)).toBe(12444.86123);
    expect(() => normalizeRate(0)).toThrow(RangeError);
    expect(() => normalizeRate(Number.NaN)).toThrow(RangeError);
  });

  it('invertRate inverts and rounds to 10 significant digits', () => {
    expect(invertRate(20)).toBe(0.05);
    expect(invertRate(0.912345)).toBe(1.096076594);
    expect(invertRate(3)).toBe(0.3333333333);
  });

  it('converts exactly with small and large rates (no float error in the product)', () => {
    // IDR 210,000 at 1/10500 (0.00009523809524) = AUD 20.0000000004 -> 2000
    expect(convertMinor(210_000, 'IDR', 'AUD', 1 / 10500)).toBe(2000);
    // VND 1,000,000,000 at 0.00006123456789 = AUD 61234.56789 -> 6123457
    expect(convertMinor(1_000_000_000, 'VND', 'AUD', 0.00006123456789)).toBe(6123457);
    // AUD 0.10 at 0.1 + 0.2 (0.3000000000000000444) -> 0.03
    expect(convertMinor(10, 'AUD', 'NZD', 0.1 + 0.2)).toBe(3);
    // half-up at the exact boundary: 1 cent at 0.5 = 0.5 cent -> 1
    expect(convertMinor(1, 'AUD', 'NZD', 0.5)).toBe(1);
    // AUD 1,000.00 at 12444.86123 IDR = IDR 12,444,861.23 -> 12444861
    expect(convertMinor(100_000, 'AUD', 'IDR', 12444.86123)).toBe(12444861);
  });
});

import { describe, expect, it } from 'vitest';
import {
  TimeFormatError,
  diffMinutes,
  formatInZone,
  offsetMinutesAt,
  parseHm,
  utcToZoned,
  weekdayKey,
  zonedTimeToUtc,
} from '../../../shared/time/tz';

const AKL = 'Pacific/Auckland';

describe('zonedTimeToUtc / utcToZoned', () => {
  it('Taipei is UTC+8 all year', () => {
    const u = zonedTimeToUtc('2026-06-21T12:00', 'Asia/Taipei');
    expect(u).toBe(Date.UTC(2026, 5, 21, 4, 0));
    expect(utcToZoned(u, 'Asia/Taipei')).toMatchObject({ date: '2026-06-21', time: '12:00', offsetMinutes: 480 });
  });

  it('NZDT -> NZST on the first Sunday of April (2027-04-04, 03:00 -> 02:00)', () => {
    expect(utcToZoned(zonedTimeToUtc('2027-04-03T12:00', AKL), AKL).offsetMinutes).toBe(780);
    expect(utcToZoned(zonedTimeToUtc('2027-04-05T12:00', AKL), AKL).offsetMinutes).toBe(720);
    // Transition instant: 2027-04-03 14:00 UTC
    const t = Date.UTC(2027, 3, 3, 14, 0);
    expect(offsetMinutesAt(t - 60000, AKL)).toBe(780);
    expect(offsetMinutesAt(t, AKL)).toBe(720);
    expect(utcToZoned(t - 60000, AKL)).toMatchObject({ date: '2027-04-04', time: '02:59' });
    expect(utcToZoned(t, AKL)).toMatchObject({ date: '2027-04-04', time: '02:00' });
    // 02:30 happens twice: resolve to the earlier (daylight) instant
    expect(zonedTimeToUtc('2027-04-04T02:30', AKL)).toBe(Date.UTC(2027, 3, 3, 13, 30));
    // A 24h "day" across the change is 25 hours long
    const a = zonedTimeToUtc('2027-04-04T00:00', AKL);
    const b = zonedTimeToUtc('2027-04-05T00:00', AKL);
    expect(diffMinutes(a, b)).toBe(25 * 60);
  });

  it('spring-forward gap moves the time forward (2026-09-27 02:30 NZ does not exist)', () => {
    const u = zonedTimeToUtc('2026-09-27T02:30', AKL);
    expect(utcToZoned(u, AKL)).toMatchObject({ date: '2026-09-27', time: '03:30', offsetMinutes: 780 });
  });

  it('Taipei -> Auckland overnight flight arrives the next day', () => {
    // Depart TPE 2027-02-01 23:40 (UTC+8), arrive AKL 2027-02-02 15:00 (NZDT, UTC+13)
    const dep = zonedTimeToUtc('2027-02-01T23:40', 'Asia/Taipei');
    const arr = zonedTimeToUtc('2027-02-02T15:00', AKL);
    expect(dep).toBe(Date.UTC(2027, 1, 1, 15, 40));
    expect(arr).toBe(Date.UTC(2027, 1, 2, 2, 0));
    expect(diffMinutes(dep, arr)).toBe(620);
    // Same arrival instant seen from Taipei: 10:00 on Feb 2
    expect(utcToZoned(arr, 'Asia/Taipei')).toMatchObject({ date: '2027-02-02', time: '10:00' });
    // Departure seen from Auckland: 04:40 on Feb 2 already
    expect(utcToZoned(dep, AKL)).toMatchObject({ date: '2027-02-02', time: '04:40', offsetMinutes: 780 });
  });

  it('abbrev is a non-empty Intl short name', () => {
    expect(utcToZoned(Date.UTC(2027, 0, 1), AKL).abbrev.length).toBeGreaterThan(0);
  });

  it('rejects malformed input', () => {
    expect(() => zonedTimeToUtc('2027-02-02 15:00', AKL)).toThrow(TimeFormatError);
  });
});

describe('formatInZone and small helpers', () => {
  it('formats in the requested zone', () => {
    const u = Date.UTC(2027, 1, 2, 2, 0);
    expect(formatInZone(u, AKL, 'en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })).toBe('15:00');
    expect(formatInZone(u, 'Asia/Taipei', 'en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })).toBe('10:00');
    expect(formatInZone(u, AKL, 'zh-TW').length).toBeGreaterThan(0);
  });

  it('diffMinutes, weekdayKey, parseHm', () => {
    expect(diffMinutes(0, -90 * 60000)).toBe(-90);
    expect(weekdayKey('2027-02-15')).toBe('mon');
    expect(weekdayKey('2027-04-04')).toBe('sun');
    expect(parseHm('09:30')).toBe(570);
    expect(parseHm('24:00')).toBe(1440);
    expect(parseHm('9:5')).toBeNull();
    expect(parseHm('25:00')).toBeNull();
  });
});

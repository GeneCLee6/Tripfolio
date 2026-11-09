import { describe, expect, it } from 'vitest';
import { localSunTimes, sunTimes } from '../../../shared/time/sun';

const toMin = (hm: string | null): number => {
  if (hm === null) throw new Error('expected a time');
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const near = (got: string | null, expected: string, tol = 3): void => {
  expect(Math.abs(toMin(got) - toMin(expected))).toBeLessThanOrEqual(tol);
};

describe('sunTimes / localSunTimes (NOAA)', () => {
  it('Taipei, summer solstice 2026: sunrise ~05:05, sunset ~18:47 (CST)', () => {
    const s = localSunTimes('2026-06-21', 25.03, 121.57, 'Asia/Taipei');
    near(s.sunrise, '05:05');
    near(s.sunset, '18:47'); // sunrise-sunset.org: 05:04:42 / 18:46:33
    expect(s.polar).toBeUndefined();
  });

  it('Queenstown NZ, 2027-02-10: late summer sunset (NZDT)', () => {
    const s = localSunTimes('2027-02-10', -45.03, 168.66, 'Pacific/Auckland');
    // Reference (sunrise-sunset.org): sunrise 06:54:08, sunset 21:04:07 NZDT.
    near(s.sunrise, '06:54');
    near(s.sunset, '21:04');
  });

  it('Queenstown NZ, winter solstice 2027: sunrise 08:24, sunset 17:10 NZST', () => {
    const s = localSunTimes('2027-06-21', -45.03, 168.66, 'Pacific/Auckland');
    // Reference (sunrise-sunset.org): sunrise 08:24:11, sunset 17:09:51 NZST.
    near(s.sunrise, '08:24');
    near(s.sunset, '17:10');
  });

  it('London 2026-03-20 equinox: sunrise ~06:02, sunset ~18:14 GMT', () => {
    const s = localSunTimes('2026-03-20', 51.5074, -0.1278, 'Europe/London');
    near(s.sunrise, '06:02');
    near(s.sunset, '18:14');
  });

  it('UTC minutes are relative to 00:00 UTC of the date (may be negative east of UTC)', () => {
    const s = sunTimes({ y: 2027, m: 2, d: 10 }, -45.03, 168.66);
    // 06:54 NZDT on Feb 10 = 17:54 UTC Feb 9 -> about -366 minutes
    expect(s.sunriseUtcMinutes).not.toBeNull();
    expect(s.sunriseUtcMinutes!).toBeLessThan(0);
    expect(s.sunsetUtcMinutes!).toBeGreaterThan(s.sunriseUtcMinutes!);
  });

  it('reports polar day and polar night', () => {
    const day = sunTimes({ y: 2026, m: 6, d: 21 }, 78.22, 15.65); // Longyearbyen
    expect(day).toEqual({ sunriseUtcMinutes: null, sunsetUtcMinutes: null, polar: 'day' });
    const night = sunTimes({ y: 2026, m: 12, d: 21 }, 78.22, 15.65);
    expect(night.polar).toBe('night');
    expect(localSunTimes('2026-12-21', 78.22, 15.65, 'Arctic/Longyearbyen')).toEqual({ sunrise: null, sunset: null, polar: 'night' });
  });
});

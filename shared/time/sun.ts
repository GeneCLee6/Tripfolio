/**
 * Sunrise / sunset with the NOAA solar calculator algorithm.
 *
 * Pure and offline (no API). Uses the standard zenith of 90.833° (refraction +
 * solar disc). Accuracy is about a minute for latitudes within ±72°.
 */
import { formatHm } from './tz';

/** A calendar date (month is 1–12). */
export interface YMD {
  y: number;
  m: number;
  d: number;
}

/** Result of {@link sunTimes}. Minutes are counted from 00:00 UTC of the given date and may be < 0 or ≥ 1440. */
export interface SunTimes {
  /** `null` during polar day / night. */
  sunriseUtcMinutes: number | null;
  sunsetUtcMinutes: number | null;
  /** Set when the sun never rises (`'night'`) or never sets (`'day'`) that day. */
  polar?: 'day' | 'night';
}

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** Julian century since J2000.0 for a Julian day. */
function julianCentury(jd: number): number {
  return (jd - 2451545) / 36525;
}

/** Sun declination (degrees) and equation of time (minutes) at Julian century `t`. */
function solarParams(t: number): { declination: number; eqTime: number } {
  const l0 = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(rad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * m)) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(rad(omega));
  const declination = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));
  const y = Math.tan(rad(obliq) / 2) ** 2;
  const eqTimeRad =
    y * Math.sin(2 * rad(l0)) -
    2 * e * Math.sin(rad(m)) +
    4 * e * y * Math.sin(rad(m)) * Math.cos(2 * rad(l0)) -
    0.5 * y * y * Math.sin(4 * rad(l0)) -
    1.25 * e * e * Math.sin(2 * rad(m));
  return { declination, eqTime: 4 * deg(eqTimeRad) };
}

/** cos of the sunrise hour angle; > 1 means polar night, < −1 polar day. */
function cosHourAngle(lat: number, declination: number): number {
  return (
    Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(rad(declination))) -
    Math.tan(rad(lat)) * Math.tan(rad(declination))
  );
}

/** One event (rise = -1, set = +1) in UTC minutes, refined by iteration; `null` if polar. */
function eventMinutes(jd0: number, lat: number, lng: number, dir: -1 | 1): number | null {
  let minutes = 720 - 4 * lng; // first guess: mean solar noon
  for (let i = 0; i < 3; i++) {
    const { declination, eqTime } = solarParams(julianCentury(jd0 + minutes / 1440));
    const cosH = cosHourAngle(lat, declination);
    if (cosH > 1 || cosH < -1) return null;
    minutes = 720 - 4 * lng - eqTime + dir * 4 * deg(Math.acos(cosH));
  }
  return minutes;
}

/**
 * Sunrise and sunset for a date and location (latitude north +, longitude east +),
 * in minutes after 00:00 UTC of that date. Pick the civil date at the location:
 * the result is centred on that place's local solar noon.
 */
export function sunTimes(date: YMD, lat: number, lng: number): SunTimes {
  const jd0 = Date.UTC(date.y, date.m - 1, date.d) / 86400000 + 2440587.5;
  const sunrise = eventMinutes(jd0, lat, lng, -1);
  const sunset = eventMinutes(jd0, lat, lng, 1);
  if (sunrise === null || sunset === null) {
    const noon = solarParams(julianCentury(jd0 + (720 - 4 * lng) / 1440));
    const polar = cosHourAngle(lat, noon.declination) > 1 ? 'night' : 'day';
    return { sunriseUtcMinutes: null, sunsetUtcMinutes: null, polar };
  }
  return { sunriseUtcMinutes: sunrise, sunsetUtcMinutes: sunset };
}

/** Result of {@link localSunTimes}: local wall-clock `HH:mm` strings in the given zone. */
export interface LocalSunTimes {
  sunrise: string | null;
  sunset: string | null;
  polar?: 'day' | 'night';
}

/**
 * Sunrise / sunset for `dateIso` (`YYYY-MM-DD`, the local date) as local `HH:mm`
 * in IANA zone `tz`, rounded to the nearest minute.
 */
export function localSunTimes(dateIso: string, lat: number, lng: number, tz: string): LocalSunTimes {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  const s = sunTimes({ y, m, d }, lat, lng);
  const base = Date.UTC(y, m - 1, d);
  const toLocal = (min: number | null): string | null =>
    min === null ? null : formatHm(base + Math.round(min) * 60000, tz);
  const out: LocalSunTimes = { sunrise: toLocal(s.sunriseUtcMinutes), sunset: toLocal(s.sunsetUtcMinutes) };
  if (s.polar) out.polar = s.polar;
  return out;
}

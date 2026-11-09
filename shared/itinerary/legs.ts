/**
 * Legs between consecutive stops, straight-line estimates, and daily driving totals.
 */
import type { ItineraryStop, LegMode, TripStyle } from './types';

/** A coordinate pair. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** A derived travel leg between two consecutive (non-backup) stops. */
export interface Leg {
  fromStopId: string;
  toStopId: string;
  mode: LegMode;
  distanceM: number;
  durationS: number;
  /** `route`: routing service; `estimate`: haversine x factor; `manual`: user override of the time. */
  source: 'route' | 'estimate' | 'manual';
}

/** Per-leg user override (keyed by {@link legKey}). */
export interface LegOverride {
  mode?: LegMode;
  /** Manual travel time in minutes. */
  minutes?: number;
}

/** Real routing values supplied by a caller (e.g. from the Worker route cache). */
export interface RouteResult {
  distanceM: number;
  durationS: number;
}

/** Synchronous lookup of a cached route; return `null`/`undefined` to fall back to an estimate. */
export type RouteLookup = (from: LatLng, to: LatLng, mode: LegMode) => RouteResult | null | undefined;

/** Options of {@link deriveLegs}. */
export interface DeriveLegsOptions {
  style?: TripStyle;
  /** Overrides the style's default mode. */
  defaultMode?: LegMode;
  routeLookup?: RouteLookup;
}

/** Detour factor applied to the straight-line distance, per mode. */
export const DETOUR_FACTOR: Readonly<Record<LegMode, number>> = {
  drive: 1.3,
  campervan: 1.3,
  walk: 1.2,
  cycle: 1.25,
  transit: 1.4,
  flight: 1.0,
  ferry: 1.1,
  other: 1.3,
};

/** Average speed in km/h used for estimates, per mode. */
export const AVERAGE_SPEED_KMH: Readonly<Record<LegMode, number>> = {
  drive: 70,
  campervan: 60,
  walk: 4.5,
  cycle: 15,
  transit: 30,
  flight: 600,
  ferry: 30,
  other: 50,
};

/** Default daily driving limit in minutes for driving styles. */
export const DEFAULT_DRIVE_LIMIT_MINUTES = 240;
/** Default daily driving limit in minutes for the campervan style. */
export const DEFAULT_CAMPERVAN_LIMIT_MINUTES = 210;

const RIDE_STYLES: ReadonlySet<TripStyle> = new Set<TripStyle>(['private-driver', 'island', 'city', 'rail']);

/** True when someone else drives (no daily limit; totals are labelled "ride"). */
export function isRideStyle(style: TripStyle): boolean {
  return RIDE_STYLES.has(style);
}

/** Default leg mode for a trip style (`campervan` for campervan trips, otherwise `drive`). */
export function defaultModeForStyle(style: TripStyle | undefined): LegMode {
  return style === 'campervan' ? 'campervan' : 'drive';
}

/** Default daily driving limit (minutes) for a style; `null` for ride styles. */
export function defaultLimitMinutes(style: TripStyle | undefined): number | null {
  if (style !== undefined && isRideStyle(style)) return null;
  return style === 'campervan' ? DEFAULT_CAMPERVAN_LIMIT_MINUTES : DEFAULT_DRIVE_LIMIT_MINUTES;
}

/** Stable key of the leg from one stop to the next, used for overrides. */
export function legKey(fromStopId: string, toStopId: string): string {
  return `${fromStopId}>${toStopId}`;
}

/** Great-circle distance in metres (haversine, mean Earth radius 6 371 008.8 m). */
export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371008.8;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimate a leg: haversine x detour factor, at the mode's average speed (rounded to whole m and s). */
export function estimateLeg(from: LatLng, to: LatLng, mode: LegMode): RouteResult {
  const distanceM = Math.round(haversineM(from, to) * DETOUR_FACTOR[mode]);
  const durationS = Math.round(distanceM / ((AVERAGE_SPEED_KMH[mode] * 1000) / 3600));
  return { distanceM, durationS };
}

/** Coordinates of a stop, or `null` when it has none. */
export function stopCoords(s: ItineraryStop): LatLng | null {
  return typeof s.lat === 'number' && typeof s.lng === 'number' && Number.isFinite(s.lat) && Number.isFinite(s.lng)
    ? { lat: s.lat, lng: s.lng }
    : null;
}

/**
 * Derive legs between consecutive stops of a day. Backup stops are dropped
 * first; then a leg is produced for each consecutive pair where both stops have
 * coordinates. Mode = override, else `defaultMode`, else the style default.
 * Distance and time come from `routeLookup` (`source: 'route'`) or
 * {@link estimateLeg}; a manual `minutes` override replaces the time and sets
 * `source: 'manual'`.
 */
export function deriveLegs(
  stops: readonly ItineraryStop[],
  overrides: Readonly<Record<string, LegOverride>> = {},
  options: DeriveLegsOptions = {},
): Leg[] {
  const active = stops.filter((s) => !s.isBackup);
  const baseMode = options.defaultMode ?? defaultModeForStyle(options.style);
  const legs: Leg[] = [];
  for (let i = 0; i + 1 < active.length; i++) {
    const a = active[i]!;
    const b = active[i + 1]!;
    const ca = stopCoords(a);
    const cb = stopCoords(b);
    if (!ca || !cb) continue;
    const ov = overrides[legKey(a.id, b.id)];
    const mode = ov?.mode ?? baseMode;
    const routed = options.routeLookup?.(ca, cb, mode) ?? null;
    const values = routed ?? estimateLeg(ca, cb, mode);
    let durationS = values.durationS;
    let source: Leg['source'] = routed ? 'route' : 'estimate';
    if (ov?.minutes !== undefined && Number.isFinite(ov.minutes) && ov.minutes >= 0) {
      durationS = Math.round(ov.minutes * 60);
      source = 'manual';
    }
    legs.push({ fromStopId: a.id, toStopId: b.id, mode, distanceM: values.distanceM, durationS, source });
  }
  return legs;
}

/** Options of {@link summarizeDay}. */
export interface SummarizeOptions {
  /** Daily driving limit in minutes; defaults from `style`. Ignored for ride styles. */
  limitMinutes?: number;
  style?: TripStyle;
}

/** Daily totals returned by {@link summarizeDay}. */
export interface DaySummary {
  /** Minutes on the road (`drive` + `campervan` legs), rounded. */
  driveMinutes: number;
  /** Total distance of all counted legs, in metres. */
  distanceM: number;
  overLimit: boolean;
  /** Number of backup stops left out of the totals. */
  backupExcluded: number;
  /** `'drive'` for driving styles, `'ride'` when someone else drives. */
  label: 'drive' | 'ride';
  /** The limit applied, or `null` when there is none. */
  limitMinutes: number | null;
}

const ROAD_MODES: ReadonlySet<LegMode> = new Set<LegMode>(['drive', 'campervan']);

/**
 * Sum a day's legs into road minutes and distance and compare with the daily
 * limit. Legs touching a backup stop are ignored.
 */
export function summarizeDay(
  stops: readonly ItineraryStop[],
  legs: readonly Leg[],
  options: SummarizeOptions = {},
): DaySummary {
  const backupIds = new Set(stops.filter((s) => s.isBackup).map((s) => s.id));
  const counted = legs.filter((l) => !backupIds.has(l.fromStopId) && !backupIds.has(l.toStopId));
  const driveSeconds = counted.filter((l) => ROAD_MODES.has(l.mode)).reduce((a, l) => a + l.durationS, 0);
  const distanceM = counted.reduce((a, l) => a + l.distanceM, 0);
  const driveMinutes = Math.round(driveSeconds / 60);
  const ride = options.style !== undefined && isRideStyle(options.style);
  const limit = ride ? null : (options.limitMinutes ?? defaultLimitMinutes(options.style));
  return {
    driveMinutes,
    distanceM,
    overLimit: limit !== null && driveMinutes > limit,
    backupExcluded: backupIds.size,
    label: ride ? 'ride' : 'drive',
    limitMinutes: limit,
  };
}

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMPERVAN_LIMIT_MINUTES,
  DEFAULT_DRIVE_LIMIT_MINUTES,
  deriveLegs,
  estimateLeg,
  haversineM,
  legKey,
  summarizeDay,
  type Leg,
} from '../../../shared/itinerary/legs';
import type { ItineraryStop } from '../../../shared/itinerary/types';

const QT = { lat: -45.0312, lng: 168.6626 }; // Queenstown
const TA = { lat: -45.4145, lng: 167.718 }; // Te Anau
const MS = { lat: -44.6717, lng: 167.9256 }; // Milford Sound

describe('haversine / estimateLeg', () => {
  it('haversine matches a known distance (Sydney - Melbourne ~713.4 km)', () => {
    const d = haversineM({ lat: -33.8688, lng: 151.2093 }, { lat: -37.8136, lng: 144.9631 });
    expect(Math.abs(d - 713_400)).toBeLessThan(2_000);
  });

  it('applies the per-mode factor and speed', () => {
    const straight = haversineM(QT, TA);
    const drive = estimateLeg(QT, TA, 'drive');
    expect(drive.distanceM).toBe(Math.round(straight * 1.3));
    expect(drive.durationS).toBe(Math.round(drive.distanceM / (70 / 3.6)));
    const van = estimateLeg(QT, TA, 'campervan');
    expect(van.distanceM).toBe(drive.distanceM);
    expect(van.durationS).toBe(Math.round(van.distanceM / (60 / 3.6)));
    const walk = estimateLeg(QT, TA, 'walk');
    expect(walk.distanceM).toBe(Math.round(straight * 1.2));
    expect(walk.durationS).toBe(Math.round(walk.distanceM / (4.5 / 3.6)));
    const cycle = estimateLeg(QT, TA, 'cycle');
    expect(cycle.distanceM).toBe(Math.round(straight * 1.25));
    const transit = estimateLeg(QT, TA, 'transit');
    expect(transit.distanceM).toBe(Math.round(straight * 1.4));
    expect(transit.durationS).toBe(Math.round(transit.distanceM / (30 / 3.6)));
    expect(estimateLeg(QT, QT, 'drive')).toEqual({ distanceM: 0, durationS: 0 });
  });
});

describe('deriveLegs', () => {
  const stops: ItineraryStop[] = [
    { id: 'qt', ...QT },
    { id: 'note' }, // no coordinates
    { id: 'ta', ...TA },
    { id: 'rain', ...MS, isBackup: true },
    { id: 'ms', ...MS },
  ];

  it('makes legs only between consecutive stops that both have coordinates, skipping backups', () => {
    const legs = deriveLegs(stops);
    expect(legs.map((l) => [l.fromStopId, l.toStopId])).toEqual([['ta', 'ms']]);
    expect(legs[0]).toMatchObject({ mode: 'drive', source: 'estimate' });
  });

  it('defaults the mode from the trip style', () => {
    const plain = [stops[0]!, stops[2]!];
    expect(deriveLegs(plain, {}, { style: 'campervan' })[0]!.mode).toBe('campervan');
    expect(deriveLegs(plain, {}, { style: 'self-drive' })[0]!.mode).toBe('drive');
    expect(deriveLegs(plain, {}, { style: 'city', defaultMode: 'transit' })[0]!.mode).toBe('transit');
  });

  it('applies per-leg mode and manual minute overrides', () => {
    const plain = [stops[0]!, stops[2]!, stops[4]!];
    const legs = deriveLegs(plain, {
      [legKey('qt', 'ta')]: { minutes: 150 },
      [legKey('ta', 'ms')]: { mode: 'transit' },
    });
    expect(legs[0]).toMatchObject({ mode: 'drive', durationS: 9000, source: 'manual' });
    expect(legs[0]!.distanceM).toBe(estimateLeg(QT, TA, 'drive').distanceM);
    expect(legs[1]).toMatchObject({ mode: 'transit', source: 'estimate', ...estimateLeg(TA, MS, 'transit') });
  });

  it('uses routeLookup values when available and falls back otherwise', () => {
    const plain = [stops[0]!, stops[2]!, stops[4]!];
    const legs = deriveLegs(plain, {}, {
      routeLookup: (from, _to, mode) => (from.lat === QT.lat && mode === 'drive' ? { distanceM: 171_000, durationS: 7_200 } : null),
    });
    expect(legs[0]).toEqual({ fromStopId: 'qt', toStopId: 'ta', mode: 'drive', distanceM: 171_000, durationS: 7_200, source: 'route' });
    expect(legs[1]!.source).toBe('estimate');
  });
});

describe('summarizeDay', () => {
  const leg = (from: string, to: string, minutes: number, mode: Leg['mode'] = 'drive', distanceM = 1000): Leg => ({
    fromStopId: from,
    toStopId: to,
    mode,
    distanceM,
    durationS: minutes * 60,
    source: 'manual',
  });
  const stops: ItineraryStop[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'x', isBackup: true }];

  it('sums road minutes and distance; excludes legs touching backups', () => {
    const s = summarizeDay(stops, [leg('a', 'b', 100), leg('b', 'c', 90, 'walk'), leg('c', 'x', 500)]);
    expect(s).toEqual({ driveMinutes: 100, distanceM: 2000, overLimit: false, backupExcluded: 1, label: 'drive', limitMinutes: DEFAULT_DRIVE_LIMIT_MINUTES });
  });

  it('flags over the default limits: drive 240, campervan 210', () => {
    expect(summarizeDay(stops, [leg('a', 'b', 241)]).overLimit).toBe(true);
    expect(summarizeDay(stops, [leg('a', 'b', 240)]).overLimit).toBe(false);
    const van = summarizeDay(stops, [leg('a', 'b', 211, 'campervan')], { style: 'campervan' });
    expect(van).toMatchObject({ overLimit: true, limitMinutes: DEFAULT_CAMPERVAN_LIMIT_MINUTES });
    expect(summarizeDay(stops, [leg('a', 'b', 200)], { limitMinutes: 180 }).overLimit).toBe(true);
  });

  it('ride styles have no limit and are labelled ride', () => {
    for (const style of ['private-driver', 'island', 'city', 'rail'] as const) {
      const s = summarizeDay(stops, [leg('a', 'b', 600)], { style, limitMinutes: 60 });
      expect(s).toMatchObject({ overLimit: false, label: 'ride', limitMinutes: null, driveMinutes: 600 });
    }
  });

  it('works end-to-end with deriveLegs (backup excluded)', () => {
    const day: ItineraryStop[] = [{ id: 'qt', ...QT }, { id: 'rain', ...MS, isBackup: true }, { id: 'ta', ...TA }];
    const s = summarizeDay(day, deriveLegs(day, {}, { style: 'campervan' }), { style: 'campervan' });
    expect(s.backupExcluded).toBe(1);
    expect(s.distanceM).toBe(estimateLeg(QT, TA, 'campervan').distanceM);
  });
});

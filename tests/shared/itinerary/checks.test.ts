import { describe, expect, it } from 'vitest';
import { checkDay, isOpenAt, stopRange } from '../../../shared/itinerary/checks';
import type { Leg } from '../../../shared/itinerary/legs';
import type { ItineraryStop, OpeningHours } from '../../../shared/itinerary/types';

// 2027-02-15 is a Monday; Queenstown sunset that day is about 20:57 NZDT.
const ctx = { date: '2027-02-15', tz: 'Pacific/Auckland', lat: -45.03, lng: 168.66 };
const kinds = (ws: { kind: string }[]): string[] => ws.map((w) => w.kind);

const museumHours: OpeningHours = {
  tue: [['10:00', '17:00']],
  wed: [['10:00', '17:00']],
  thu: [['10:00', '17:00']],
  fri: [['10:00', '17:00']],
  sat: [['10:00', '17:00']],
  sun: [['10:00', '17:00']],
};

describe('isOpenAt / stopRange', () => {
  it('handles weekday ranges, split days, overnight and closed dates', () => {
    const h: OpeningHours = { mon: [['11:30', '14:00'], ['17:30', '22:00']], sun: [['20:00', '02:00']], closed: ['2027-02-22'] };
    expect(isOpenAt(h, '2027-02-15', 12 * 60)).toBe(true);
    expect(isOpenAt(h, '2027-02-15', 15 * 60)).toBe(false); // afternoon break
    expect(isOpenAt(h, '2027-02-15', 60)).toBe(true); // spill-over from Sunday 20:00-02:00
    expect(isOpenAt(h, '2027-02-22', 12 * 60)).toBe(false); // closed date
    expect(isOpenAt(h, '2027-02-16', 12 * 60)).toBe(false); // tuesday not listed = closed
    expect(isOpenAt({ closed: ['2027-02-15'] }, '2027-02-16', 0)).toBe(true); // no weekday info
  });
  it('computes ranges from end time or duration', () => {
    expect(stopRange({ id: 'a', startTime: '10:00', endTime: '11:30' })).toEqual({ start: 600, end: 690 });
    expect(stopRange({ id: 'a', startTime: '10:00', durationMin: 45 })).toEqual({ start: 600, end: 645 });
    expect(stopRange({ id: 'a', startTime: '23:00', endTime: '01:00' })).toEqual({ start: 1380, end: 1500 });
    expect(stopRange({ id: 'a', durationMin: 45 })).toBeNull();
  });
});

describe('checkDay', () => {
  it('returns nothing for a relaxed, valid day', () => {
    const stops: ItineraryStop[] = [
      { id: 'cafe', startTime: '09:00', durationMin: 60, hours: { mon: [['07:00', '15:00']] } },
      { id: 'look', category: 'viewpoint', startTime: '19:30', durationMin: 30 },
    ];
    expect(checkDay(stops, { ...ctx, dayEnd: '22:00' })).toEqual([]);
  });

  it('closed-on-arrival: museum closed on Monday, closed date, arrival after closing', () => {
    const stops: ItineraryStop[] = [
      { id: 'museum', startTime: '11:00', durationMin: 90, hours: museumHours },
      { id: 'gondola', startTime: '10:00', durationMin: 60, hours: { mon: [['09:00', '21:00']], closed: ['2027-02-15'] } },
      { id: 'shop', startTime: '18:00', durationMin: 30, hours: { mon: [['09:00', '17:00']] } },
      { id: 'ok', startTime: '12:00', durationMin: 30, hours: { mon: [['09:00', '17:00']] } },
    ];
    const ws = checkDay(stops, ctx);
    expect(ws).toEqual([
      { kind: 'closed-on-arrival', stopIds: ['museum'], data: { arrival: '11:00' } },
      { kind: 'closed-on-arrival', stopIds: ['gondola'], data: { arrival: '10:00' } },
      { kind: 'closed-on-arrival', stopIds: ['shop'], data: { arrival: '18:00' } },
    ]);
  });

  it('booking-overlap: two booked slots overlapping; touching ranges and unbooked stops do not count', () => {
    const stops: ItineraryStop[] = [
      { id: 'cruise', booking: 'booked', startTime: '10:30', endTime: '12:30' },
      { id: 'heli', booking: true, startTime: '12:00', durationMin: 60 },
      { id: 'lunch', booking: 'todo', startTime: '13:00', durationMin: 60 }, // touches heli end
      { id: 'walk', booking: 'none', startTime: '10:00', endTime: '14:00' },
    ];
    expect(checkDay(stops, ctx)).toEqual([{ kind: 'booking-overlap', stopIds: ['cruise', 'heli'] }]);
  });

  it('after-sunset: outdoor categories starting after local sunset', () => {
    const stops: ItineraryStop[] = [
      { id: 'hike', category: 'hike', startTime: '21:15', durationMin: 60 },
      { id: 'beach', category: 'beach', startTime: '20:30', durationMin: 20 },
      { id: 'dinner', category: 'restaurant', startTime: '21:30', durationMin: 60 },
      // Auckland: sunset ~20:15 NZDT, earlier than Queenstown's ~20:57
      { id: 'park-far', category: 'park', startTime: '20:40', durationMin: 30, lat: -36.85, lng: 174.76 },
    ];
    const ws = checkDay(stops, ctx);
    expect(kinds(ws)).toEqual(['after-sunset', 'after-sunset']);
    expect(ws[0]!.stopIds).toEqual(['hike']);
    expect(ws[0]!.data!.start).toBe('21:15');
    const sunset = String(ws[0]!.data!.sunset);
    expect(sunset >= '20:54' && sunset <= '21:00').toBe(true);
    // stop coordinates win over the context: the "park" uses its own location
    expect(ws[1]!.stopIds).toEqual(['park-far']);
  });

  it('no-buffer: scheduled stops + legs leave < 30 min before dayEnd', () => {
    const stops: ItineraryStop[] = [
      { id: 'a', startTime: '08:00', durationMin: 240 },
      { id: 'b', durationMin: 180 },
      { id: 'x', isBackup: true, durationMin: 600 },
    ];
    const legs: Leg[] = [{ fromStopId: 'a', toStopId: 'b', mode: 'drive', distanceM: 1, durationS: 150 * 60, source: 'manual' }];
    // 08:00 + 240 + 180 + 150 = 17:30 -> 18:00 leaves exactly 30 = OK
    expect(checkDay(stops, { ...ctx, dayEnd: '18:00', legs })).toEqual([]);
    const ws = checkDay(stops, { ...ctx, dayEnd: '17:50', legs });
    expect(ws).toEqual([{ kind: 'no-buffer', stopIds: ['a', 'b'], data: { freeMinutes: 20, bufferMinutes: 30, finish: '17:30' } }]);
    // custom buffer and a fixed late stop
    const late = checkDay([{ id: 'show', startTime: '20:00', endTime: '21:45' }], { ...ctx, dayEnd: '22:00', bufferMinutes: 60 });
    expect(kinds(late)).toEqual(['no-buffer']);
    // skipped without dayEnd
    expect(checkDay(stops, { ...ctx, legs })).toEqual([]);
  });

  it('ignores backup stops and orders warnings by kind', () => {
    const stops: ItineraryStop[] = [
      { id: 'late-hike', category: 'hike', startTime: '21:30', durationMin: 60, booking: true },
      { id: 'museum', startTime: '21:00', durationMin: 60, hours: museumHours, booking: true },
      { id: 'rain', isBackup: true, startTime: '21:00', durationMin: 60, hours: museumHours, booking: true },
    ];
    expect(kinds(checkDay(stops, { ...ctx, dayEnd: '22:00' }))).toEqual(['closed-on-arrival', 'booking-overlap', 'after-sunset', 'no-buffer']);
  });
});

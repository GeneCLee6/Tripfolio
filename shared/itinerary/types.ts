/** Shared itinerary types used by legs and checks. */

/** Travel mode of a leg. */
export type LegMode = 'drive' | 'campervan' | 'walk' | 'cycle' | 'transit' | 'flight' | 'ferry' | 'other';

/**
 * Trip style. Driving styles (`self-drive`, `roadtrip`, `campervan`, `winter`,
 * `other`) get a daily driving limit; ride styles (`private-driver`, `island`,
 * `city`, `rail`) do not.
 */
export type TripStyle =
  | 'self-drive'
  | 'roadtrip'
  | 'campervan'
  | 'private-driver'
  | 'island'
  | 'city'
  | 'rail'
  | 'winter'
  | 'other';

/** Weekday key used in opening hours. */
export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/**
 * Opening hours: per weekday a list of `[open, close]` `HH:mm` ranges (close
 * earlier than open means past midnight), plus `closed` dates (`YYYY-MM-DD`).
 * A weekday missing from an object that lists at least one weekday is closed.
 */
export type OpeningHours = Partial<Record<WeekdayKey, [string, string][]>> & { closed?: string[] };

/** Booking flag of a stop: `true`, `'todo'` and `'booked'` mean "has a booking slot". */
export type BookingFlag = boolean | 'todo' | 'booked' | 'none';

/** The subset of a stop that legs and checks need. Times are local `HH:mm`. */
export interface ItineraryStop {
  id: string;
  lat?: number | null;
  lng?: number | null;
  /** Rain-backup stop: excluded from legs, totals and checks. */
  isBackup?: boolean;
  /** Place category, e.g. `'viewpoint'`, `'hike'`, `'restaurant'`. */
  category?: string;
  startTime?: string | null;
  endTime?: string | null;
  durationMin?: number | null;
  booking?: BookingFlag;
  hours?: OpeningHours | null;
}

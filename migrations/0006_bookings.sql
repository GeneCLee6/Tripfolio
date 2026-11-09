-- Lodgings and bookings (e4-t01): docs/PRD/e4-lodging-transport-bookings.md. Times are UTC ISO
-- strings (plus the IANA zone they were entered in), dates YYYY-MM-DD, money integer minor units.
-- JSON columns hold TEXT. placeId has no foreign key: places can be deleted or merged (e3-t01)
-- without knowing about lodgings; the API checks it on write.

-- One row per stay (several nights); days.lodgingId points at it for each night in [checkIn, checkOut)
CREATE TABLE lodgings (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  placeId TEXT,
  name TEXT NOT NULL,
  checkIn TEXT NOT NULL,
  checkOut TEXT NOT NULL,
  -- Local wall-clock HH:mm at the lodging (the trip's zone)
  checkInTime TEXT,
  checkOutTime TEXT,
  roomType TEXT,
  guests INTEGER,
  platform TEXT,
  ref TEXT,
  priceMinor INTEGER,
  currency TEXT,
  payStatus TEXT NOT NULL DEFAULT 'unpaid' CHECK (payStatus IN ('unpaid', 'deposit', 'paid')),
  cancelBy TEXT,
  phone TEXT,
  -- Campervan trips (01-travel-domain-notes.md §9)
  campType TEXT CHECK (campType IN ('holiday-park', 'doc', 'freedom')),
  -- {"power":bool,"water":bool,"dump":bool}
  campFacilities TEXT,
  note TEXT NOT NULL DEFAULT '',
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX lodgings_trip ON lodgings (tripId, checkIn);

-- Transport and activity bookings: one table, `details` JSON validated per type (shared/schema/booking.ts)
CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  type TEXT NOT NULL CHECK (type IN ('flight', 'rental', 'driver', 'ferry', 'rail', 'bus', 'activity')),
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  startAt TEXT,
  endAt TEXT,
  -- The zones the times were entered in (a flight's departure and arrival airports); null = trip tz
  startTz TEXT,
  endTz TEXT,
  priceMinor INTEGER,
  currency TEXT,
  payStatus TEXT NOT NULL DEFAULT 'unpaid' CHECK (payStatus IN ('unpaid', 'deposit', 'paid')),
  payerMemberId TEXT REFERENCES members (id),
  cancelBy TEXT,
  ref TEXT,
  note TEXT NOT NULL DEFAULT '',
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX bookings_trip ON bookings (tripId, startAt);

-- Stops created from a booking (stops.bookingId already exists, 0002): where they came from and
-- which of the booking's stops each one is ('depart', 'arrive', 'pickup', 'dropoff', 'main',
-- 'day:YYYY-MM-DD'), so a booking update finds the right row. lodgingId is for lodging stops.
ALTER TABLE stops ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE stops ADD COLUMN bookingSlot TEXT;
ALTER TABLE stops ADD COLUMN lodgingId TEXT;
CREATE INDEX stops_booking ON stops (bookingId);

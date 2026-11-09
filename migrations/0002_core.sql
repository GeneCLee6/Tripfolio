-- Core schema (A3: e1-t01, e2-t01, e3-t01): trips, members and their tokens, invites, shares, days,
-- stops, leg overrides, places. ARCHITECTURE.md §3. Times are UTC ISO strings, dates YYYY-MM-DD,
-- money integer minor units. JSON columns hold TEXT. Tokens are never stored, only SHA-256 hex.

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT '',
  centerLat REAL,
  centerLng REAL,
  startDate TEXT NOT NULL,
  endDate TEXT NOT NULL,
  tz TEXT NOT NULL,
  baseCurrency TEXT NOT NULL DEFAULT 'AUD',
  secondaryCurrency TEXT DEFAULT 'TWD',
  localCurrencies TEXT NOT NULL DEFAULT '[]',
  coverColor TEXT,
  coverAttachmentId TEXT,
  summary TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT 'other',
  driveLimitMin INTEGER,
  ownerMemberId TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  archivedAt TEXT,
  deletedAt TEXT
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  userId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  -- Removed members stay for the expense history (E7); their tokens are revoked
  removedAt TEXT
);
CREATE INDEX members_trip ON members (tripId);

CREATE TABLE memberTokens (
  tokenHash TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  memberId TEXT NOT NULL REFERENCES members (id),
  createdAt TEXT NOT NULL,
  revokedAt TEXT
);
CREATE INDEX memberTokens_member ON memberTokens (memberId);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  tokenHash TEXT NOT NULL UNIQUE,
  createdByMemberId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  revokedAt TEXT
);
CREATE INDEX invites_trip ON invites (tripId);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  tokenHash TEXT NOT NULL UNIQUE,
  options TEXT NOT NULL DEFAULT '{}',
  createdByMemberId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  revokedAt TEXT
);
CREATE INDEX shares_trip ON shares (tripId);

-- One row per trip date; idx NULL = unassigned (the trip's dates shrank; stops are kept)
CREATE TABLE days (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  date TEXT,
  idx INTEGER,
  title TEXT NOT NULL DEFAULT '',
  color TEXT,
  note TEXT NOT NULL DEFAULT '',
  lodgingId TEXT,
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX days_trip ON days (tripId, idx);

CREATE TABLE places (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  nameLocal TEXT NOT NULL,
  nameEn TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  source TEXT NOT NULL DEFAULT 'manual',
  hours TEXT,
  links TEXT NOT NULL DEFAULT '[]',
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX places_trip ON places (tripId);

-- "order" is a fractional sort key within the day (inserting never rewrites the others)
CREATE TABLE stops (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  dayId TEXT NOT NULL REFERENCES days (id),
  "order" REAL NOT NULL,
  type TEXT NOT NULL DEFAULT 'sight',
  title TEXT NOT NULL DEFAULT '',
  placeId TEXT REFERENCES places (id),
  startAt TEXT,
  endAt TEXT,
  durationMin INTEGER,
  costMinor INTEGER,
  currency TEXT,
  booking TEXT NOT NULL DEFAULT 'none',
  note TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '[]',
  wishlistItemId TEXT,
  bookingId TEXT,
  isBackup INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX stops_day ON stops (dayId, "order");
CREATE INDEX stops_trip ON stops (tripId);
CREATE INDEX stops_place ON stops (placeId);

-- Legs are derived from adjacent stops (E2); only manual overrides are stored
CREATE TABLE legOverrides (
  tripId TEXT NOT NULL REFERENCES trips (id),
  fromStopId TEXT NOT NULL,
  toStopId TEXT NOT NULL,
  mode TEXT NOT NULL,
  minutes INTEGER,
  rev INTEGER NOT NULL DEFAULT 1,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (fromStopId, toStopId)
);
CREATE INDEX legOverrides_trip ON legOverrides (tripId);

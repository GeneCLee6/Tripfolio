-- Expenses, splitting, the shared pool (公基金), settlements, change history and FX rates (e7-t01).
-- docs/PRD/e7-expenses-splitting.md, ARCHITECTURE.md §4.3. Money is always integer minor units
-- (CLAUDE.md rule 2): `amountMinor` in the row's own currency, `baseMinor` in the trip's base
-- currency. `fxRate` is "1 unit of `currency` = fxRate units of the base currency" (6 decimals).
--
-- stopId / dayId / receiptAttachmentId / bookingId / wishlistItemId carry no foreign key: stops are
-- hard-deleted by the itinerary API, and attachments / bookings belong to later migrations. A link
-- to something that has gone away is simply shown as missing.
--
-- Removed members (members.removedAt) keep their rows here: balances still count their shares.

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  -- Exactly one of: a member paid, or the pool paid (payerIsPool = 1, payerMemberId NULL)
  payerMemberId TEXT REFERENCES members (id),
  payerIsPool INTEGER NOT NULL DEFAULT 0 CHECK (payerIsPool IN (0, 1)),
  amountMinor INTEGER NOT NULL CHECK (amountMinor >= 0),
  currency TEXT NOT NULL,
  fxRate REAL NOT NULL,
  -- base: same currency as the trip · manual: typed in (or apply-rate) · trip: trips.fxOverrides ·
  -- auto: the fxRates table
  fxSource TEXT NOT NULL CHECK (fxSource IN ('base', 'manual', 'trip', 'auto')),
  -- The fxRates date the rate came from (auto only)
  fxDate TEXT,
  baseMinor INTEGER NOT NULL CHECK (baseMinor >= 0),
  -- Local date in the trip's time zone
  date TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('food', 'lodging', 'transport', 'fuel', 'tickets', 'shopping', 'misc', 'other')
  ),
  note TEXT NOT NULL DEFAULT '',
  stopId TEXT,
  dayId TEXT,
  receiptAttachmentId TEXT,
  bookingId TEXT,
  wishlistItemId TEXT,
  splitMethod TEXT NOT NULL CHECK (splitMethod IN ('equal', 'shares', 'percent', 'exact', 'self')),
  createdByMemberId TEXT NOT NULL REFERENCES members (id),
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  CHECK ((payerIsPool = 1 AND payerMemberId IS NULL) OR (payerIsPool = 0 AND payerMemberId IS NOT NULL))
);
CREATE INDEX expenses_trip_date ON expenses (tripId, date);
CREATE INDEX expenses_trip_deleted ON expenses (tripId, deletedAt);

-- One row per participant: the input of the split (weight / percent / amountMinor in the expense's
-- currency) and its result `shareMinor` in base currency. Shares of an expense sum to baseMinor.
CREATE TABLE expenseShares (
  expenseId TEXT NOT NULL REFERENCES expenses (id),
  memberId TEXT NOT NULL REFERENCES members (id),
  -- Participant order (drives the remainder rule)
  idx INTEGER NOT NULL DEFAULT 0,
  weight REAL,
  percent REAL,
  amountMinor INTEGER,
  shareMinor INTEGER NOT NULL,
  PRIMARY KEY (expenseId, memberId)
);
CREATE INDEX expenseShares_member ON expenseShares (memberId);

CREATE TABLE poolContributions (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  memberId TEXT NOT NULL REFERENCES members (id),
  amountMinor INTEGER NOT NULL CHECK (amountMinor >= 0),
  currency TEXT NOT NULL,
  fxRate REAL NOT NULL,
  fxSource TEXT NOT NULL CHECK (fxSource IN ('base', 'manual', 'trip', 'auto')),
  fxDate TEXT,
  baseMinor INTEGER NOT NULL CHECK (baseMinor >= 0),
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  createdByMemberId TEXT NOT NULL REFERENCES members (id),
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX poolContributions_trip ON poolContributions (tripId, deletedAt);

-- A recorded transfer between members, in base currency (partial settlements allowed)
CREATE TABLE settlements (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  fromMemberId TEXT NOT NULL REFERENCES members (id),
  toMemberId TEXT NOT NULL REFERENCES members (id),
  amountMinor INTEGER NOT NULL CHECK (amountMinor > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'transfer', 'other')),
  note TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  createdByMemberId TEXT NOT NULL REFERENCES members (id),
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  CHECK (fromMemberId <> toMemberId)
);
CREATE INDEX settlements_trip ON settlements (tripId, deletedAt);

-- Who changed what: `diff` is {"field": [before, after]}; `snapshot` is the full state after the
-- change (expense rows include their participants), so any version can be restored.
CREATE TABLE expenseHistory (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  entity TEXT NOT NULL CHECK (entity IN ('expense', 'pool', 'settlement')),
  entityId TEXT NOT NULL,
  memberId TEXT NOT NULL REFERENCES members (id),
  at TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'restore')),
  diff TEXT NOT NULL DEFAULT '{}',
  snapshot TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX expenseHistory_entity ON expenseHistory (entityId, at);
CREATE INDEX expenseHistory_trip ON expenseHistory (tripId, at);

-- Daily reference rates (filled by the e7-t03 proxy): 1 `base` = `rate` `quote`, as open.er-api.com
-- publishes them. Not per trip.
CREATE TABLE fxRates (
  date TEXT NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  rate REAL NOT NULL CHECK (rate > 0),
  source TEXT NOT NULL,
  PRIMARY KEY (date, base, quote)
);

-- How the pool's remainder is refunded at the end (E7 未決問題: proportional by default)
ALTER TABLE trips ADD COLUMN poolRefundMode TEXT NOT NULL DEFAULT 'proportional'
  CHECK (poolRefundMode IN ('proportional', 'equal'));
-- Trip default rates {"NZD": 0.912345}: 1 unit of the key currency = value units of base currency
ALTER TABLE trips ADD COLUMN fxOverrides TEXT NOT NULL DEFAULT '{}';

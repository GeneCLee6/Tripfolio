-- Attachments (e6-t01): photos, documents and receipts stored in R2 `MEDIA`. ARCHITECTURE.md §3,
-- §4.4; docs/PRD/e6-photos-media.md. The bytes live in R2 under
-- <APP_ENV>/trips/<tripId>/<kind>/<uuid>.<ext> (previews share the bucket, DEPLOY.md §2); this
-- row is the only way to find or read them. A row starts 'pending' at /sign and turns 'ready' once
-- /complete sees the object in R2. Deletion is soft; removing the R2 objects is e11-t06's cleanup.

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'document', 'receipt')),
  r2Key TEXT NOT NULL UNIQUE,
  -- Photos only: the 400 px thumbnail, uploaded next to the 2048 px version
  thumbKey TEXT,
  mime TEXT NOT NULL,
  -- Size of the main object as declared at /sign and enforced on upload; thumbBytes once uploaded
  bytes INTEGER NOT NULL,
  thumbBytes INTEGER,
  width INTEGER,
  height INTEGER,
  -- From EXIF before it is stripped: UTC (…Z) when the camera recorded an offset, otherwise the
  -- wall-clock time without a zone (read in the trip's tz)
  takenAt TEXT,
  lat REAL,
  lng REAL,
  -- Where it hangs. No foreign keys on purpose: deleting a place, stop or day (worker/trips/*)
  -- must not fail because a photo points at it; a dangling id is ignored by the readers and
  -- cleared by the next move (e6-t03). bookings/lodgings (E4) have no tables yet either.
  placeId TEXT,
  stopId TEXT,
  dayId TEXT,
  bookingId TEXT,
  lodgingId TEXT,
  wishlistItemId TEXT,
  uploaderMemberId TEXT NOT NULL REFERENCES members (id),
  -- 'trip': may appear on share pages (photos only); 'members-only': never leaves the members
  visibility TEXT NOT NULL DEFAULT 'trip' CHECK (visibility IN ('trip', 'members-only')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX attachments_trip_kind ON attachments (tripId, kind);
CREATE INDEX attachments_stop ON attachments (stopId);
CREATE INDEX attachments_day ON attachments (dayId);

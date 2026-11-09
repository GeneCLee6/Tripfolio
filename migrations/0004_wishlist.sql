-- Wishlist (e5-t01): must-eat / must-buy / must-see / experiences, votes and shopping claims.
-- docs/PRD/e5-wishlist.md. Items not yet scheduled (status 'wish') plus unreferenced places form
-- the pocket list the itinerary sidebar drags from (E2). Money is integer minor units.

CREATE TABLE wishlistItems (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  category TEXT NOT NULL CHECK (category IN ('eat', 'buy', 'see', 'experience')),
  name TEXT NOT NULL,
  placeId TEXT REFERENCES places (id),
  -- E6 attachments do not exist yet: no foreign key
  photoAttachmentId TEXT,
  estMinor INTEGER,
  currency TEXT,
  sourceUrl TEXT,
  -- Link preview (og:title / og:image), filled by e5-t02 through the Worker proxy
  sourceTitle TEXT,
  sourceImageUrl TEXT,
  recommenderMemberId TEXT REFERENCES members (id),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'wish' CHECK (status IN ('wish', 'scheduled', 'done', 'dropped')),
  -- The stop it was scheduled as (stops.wishlistItemId points back)
  stopId TEXT,
  "order" REAL NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX wishlistItems_trip_status ON wishlistItems (tripId, status);
CREATE INDEX wishlistItems_place ON wishlistItems (placeId);

-- "I want to go": one row per member and item
CREATE TABLE wishlistVotes (
  itemId TEXT NOT NULL REFERENCES wishlistItems (id),
  memberId TEXT NOT NULL REFERENCES members (id),
  createdAt TEXT NOT NULL,
  PRIMARY KEY (itemId, memberId)
);
CREATE INDEX wishlistVotes_member ON wishlistVotes (memberId);

-- Who buys it, for whom, how many (souvenirs for family are common)
CREATE TABLE wishlistClaims (
  id TEXT PRIMARY KEY,
  itemId TEXT NOT NULL REFERENCES wishlistItems (id),
  buyerMemberId TEXT REFERENCES members (id),
  forName TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  done INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX wishlistClaims_item ON wishlistClaims (itemId);

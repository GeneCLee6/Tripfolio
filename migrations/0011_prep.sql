-- Pre-trip prep (E9: e9-t01..t05): checklists and their items, the budget table, destination notes,
-- and a category for documents. docs/PRD/e9-pretrip-prep.md, ARCHITECTURE.md §3.
-- Templates (shared/templates/**) are copied into these tables when applied and never linked
-- back; `templateKey` only makes applying the same template twice a no-op.

CREATE TABLE checklists (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  kind TEXT NOT NULL CHECK (kind IN ('pretrip', 'packing')),
  title TEXT NOT NULL,
  "order" REAL NOT NULL,
  templateKey TEXT,
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX checklists_trip ON checklists (tripId, kind);
CREATE UNIQUE INDEX checklists_template ON checklists (tripId, templateKey)
  WHERE templateKey IS NOT NULL;

-- One to-do (pretrip) or one thing to pack (packing). On a packing list the assignee is 「誰帶」.
CREATE TABLE checklistItems (
  id TEXT PRIMARY KEY,
  checklistId TEXT NOT NULL REFERENCES checklists (id),
  tripId TEXT NOT NULL REFERENCES trips (id),
  text TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  assigneeMemberId TEXT REFERENCES members (id),
  -- A calendar date (YYYY-MM-DD) in the trip's zone, or NULL
  dueAt TEXT,
  "order" REAL NOT NULL,
  templateKey TEXT,
  -- Where to confirm it (JSON { label, url? }, url an official root domain) from the template
  linkHint TEXT,
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX checklistItems_list ON checklistItems (checklistId);
CREATE UNIQUE INDEX checklistItems_template ON checklistItems (tripId, templateKey)
  WHERE templateKey IS NOT NULL;

-- The budget table, replaced whole by PUT /budget. Amounts are integer minor units of the trip's
-- base currency; perPerson = 1 means plannedMinor is for each member, 0 for the whole group.
CREATE TABLE budgets (
  tripId TEXT NOT NULL REFERENCES trips (id),
  category TEXT NOT NULL,
  plannedMinor INTEGER NOT NULL CHECK (plannedMinor >= 0),
  currency TEXT NOT NULL,
  perPerson INTEGER NOT NULL DEFAULT 0 CHECK (perPerson IN (0, 1)),
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (tripId, category)
);

-- Destination notes (emergency numbers, plugs, driving rules…), markdown-lite bodies.
-- shareable = 1: may be shown on share pages later (E8); nothing reads it there yet.
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  tripId TEXT NOT NULL REFERENCES trips (id),
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  "order" REAL NOT NULL,
  templateKey TEXT,
  shareable INTEGER NOT NULL DEFAULT 0 CHECK (shareable IN (0, 1)),
  rev INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX notes_trip ON notes (tripId);
CREATE UNIQUE INDEX notes_template ON notes (tripId, templateKey) WHERE templateKey IS NOT NULL;

-- Documents (kind = 'document') get a folder: passport, visa, insurance, licence, other
ALTER TABLE attachments ADD COLUMN docCategory TEXT
  CHECK (docCategory IS NULL OR docCategory IN ('passport', 'visa', 'insurance', 'license', 'other'));

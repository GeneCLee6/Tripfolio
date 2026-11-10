-- e1-t06 optional Google sign-in (ARCHITECTURE.md §4.1). A login never replaces memberTokens: it
-- only lists "my trips" across devices and binds the account to one member per trip.

-- One row per Google account (`sub` is Google's stable id; email/name/picture refresh on sign-in)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  googleSub TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT,
  picture TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- `id` is the SHA-256 (hex) of the tf_session cookie value; the cookie itself is never stored.
-- 30 days, sliding. Expired rows are the cleanup cron's job (worker/cleanup.ts, not yet wired)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users (id),
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions (userId);
CREATE INDEX sessions_expires ON sessions (expiresAt);

-- The account ↔ member binding; the code keeps at most one member per trip per account. No tripId
-- column and no foreign keys on purpose: the trip purge (worker/cleanup.ts) deletes members without
-- knowing this table, and a link whose member is gone simply stops matching (joins on members).
-- Orphans can be swept with DELETE FROM userMembers WHERE memberId NOT IN (SELECT id FROM members)
CREATE TABLE userMembers (
  userId TEXT NOT NULL,
  memberId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (userId, memberId)
);
CREATE INDEX userMembers_member ON userMembers (memberId);

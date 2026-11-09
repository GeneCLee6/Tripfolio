-- Backend leftovers (sweep after Phase D/G) and the e11-t06 cleanup job. docs/NEXT.md §1.
--
-- places.externalId: the provider's id of a searched place (GeoResult.externalId, e.g.
-- `osm:N336415647`), so POST /places can hand back the trip's existing row instead of a duplicate.
-- Not UNIQUE: two requests at once may still both insert (best effort, the merge endpoint fixes it),
-- and the dedupe is per trip.
ALTER TABLE places ADD COLUMN externalId TEXT;
CREATE INDEX places_trip_external ON places (tripId, externalId) WHERE externalId IS NOT NULL;

-- worker/cleanup.ts (daily, after the backup): soft-deleted trips older than 30 days, deleted
-- attachments older than 7 days, pending uploads older than 15 minutes.
CREATE INDEX trips_deleted ON trips (deletedAt) WHERE deletedAt IS NOT NULL;
CREATE INDEX attachments_deleted ON attachments (deletedAt) WHERE deletedAt IS NOT NULL;
CREATE INDEX attachments_pending ON attachments (createdAt) WHERE status = 'pending';

-- legOverrides.mode never had a CHECK (0002), so the new 'cycle' mode needs no table change; the
-- allowed modes live in shared/schema/stop.ts (legModes).

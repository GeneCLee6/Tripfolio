-- Recap mode (e8-t04): one recap text per day, written by editors after (or during) the trip and
-- shown on the recap page and, with the share option showRecap after the end date, on share pages.
-- docs/PRD/e8-share-export-recap.md. Bodies are markdown-lite text (≤ 4,000 characters).

CREATE TABLE dayRecaps (
  dayId TEXT PRIMARY KEY REFERENCES days (id),
  tripId TEXT NOT NULL REFERENCES trips (id),
  body TEXT NOT NULL,
  updatedByMemberId TEXT REFERENCES members (id),
  updatedAt TEXT NOT NULL
);
CREATE INDEX dayRecaps_trip ON dayRecaps (tripId);

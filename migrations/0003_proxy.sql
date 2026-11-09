-- External API proxies (e3-t02, e3-t04): caches, daily usage counts and the small bookkeeping the
-- rate limits need. ARCHITECTURE.md §2 (worker/proxy/*), §5. Times are epoch milliseconds where a
-- comparison is needed (expiresAt, lastAt), otherwise UTC ISO strings.

-- Place search results per provider + language + normalised query + rounded bias; 7-day TTL
CREATE TABLE geoCache (
  key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  results TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  expiresAt INTEGER NOT NULL
);
CREATE INDEX geoCache_expiresAt ON geoCache (expiresAt);

-- Routes keyed by mode + from/to rounded to 5 decimals; permanent (the same leg is routed once)
CREATE TABLE routeCache (
  key TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  provider TEXT NOT NULL,
  distanceM INTEGER NOT NULL,
  durationS INTEGER NOT NULL,
  -- GeoJSON LineString, at most 200 points
  geometry TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

-- Calls made to each provider per UTC day and trip (cache hits are not counted); feeds the quotas
-- and the usage page (E11)
CREATE TABLE apiUsage (
  date TEXT NOT NULL,
  provider TEXT NOT NULL,
  tripId TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, provider, tripId)
);

-- Fixed one-minute windows for per-member request limits (best effort; e11-t04 hardens them)
CREATE TABLE rateLimits (
  key TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, bucket)
);

-- The last call to a provider with a minimum interval (Nominatim: 1 request per second)
CREATE TABLE providerThrottle (
  provider TEXT PRIMARY KEY,
  lastAt INTEGER NOT NULL
);

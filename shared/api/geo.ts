// Request and response shapes of the geo proxies (worker/proxy/*): place search, link/coordinate
// parsing, routing and usage. External APIs are only ever called by the Worker (CLAUDE.md rule 3).

/** Place categories a search result is mapped to (OSM tags → ours) */
export const geoCategories = [
  'sight',
  'food',
  'shopping',
  'lodging',
  'transport',
  'fuel',
  'supplies',
  'nature',
  'other',
] as const
export type GeoCategory = (typeof geoCategories)[number]

export type GeoProvider = 'photon' | 'nominatim'

export interface GeoPoint {
  lat: number
  lng: number
}

/** GET /api/trips/:id/geo/search?q=&lat=&lng=&lang= — one candidate */
export interface GeoResult {
  /** Name as the provider gives it (local language for most places) */
  nameLocal: string
  /** English name when the provider has one, else '' (the UI falls back to nameLocal) */
  nameEn: string
  lat: number
  lng: number
  address: string
  category: GeoCategory
  source: GeoProvider
  /** OSM element, e.g. `osm:N336415647` (N node, W way, R relation) */
  externalId: string
}

export interface GeoSearchResponse {
  results: GeoResult[]
  /** The provider that answered (null when none had results) */
  source: GeoProvider | null
  /** True when the answer came from geoCache (no provider call) */
  cached: boolean
}

/** POST /api/trips/:id/geo/parse */
export interface GeoParseRequest {
  /** `lat, lng`, a Google Maps URL (long or maps.app.goo.gl), or text containing one */
  text: string
}

export interface GeoParseResponse {
  lat: number
  lng: number
  /** Place name from a Google Maps /place/<name>/ URL, when there is one */
  name?: string
  /** Matches Place.source: 'coords' for typed coordinates, 'link' for a URL */
  source: 'coords' | 'link'
}

export const routeModes = ['drive', 'walk', 'cycle'] as const
/** Routable modes. Map campervan → drive; transit/flight/ferry/other are estimated client-side */
export type RouteMode = (typeof routeModes)[number]

/** POST /api/trips/:id/geo/route */
export interface RouteRequest {
  from: GeoPoint
  to: GeoPoint
  mode: RouteMode
}

/** GeoJSON LineString; coordinates are [lng, lat] */
export interface LineStringGeometry {
  type: 'LineString'
  coordinates: [number, number][]
}

export interface RouteResponse {
  distanceM: number
  durationS: number
  /** At most 200 points; a straight from→to line for estimates */
  geometry: LineStringGeometry
  /** 'estimate': straight line × detour factor (shared/itinerary/legs.ts estimateLeg); show 「估」 */
  source: 'ors' | 'estimate'
  /** True when served from routeCache */
  cached: boolean
  /** Why an estimate was returned */
  fallbackReason?: 'no_key' | 'quota' | 'provider_error'
}

/** POST /api/trips/:id/geo/routes — up to 30 legs, answered in the same order */
export interface RoutesRequest {
  legs: RouteRequest[]
}

export interface RoutesResponse {
  routes: RouteResponse[]
}

export type UsageProvider = 'photon' | 'nominatim' | 'ors'

export const GEO_LIMITS = {
  /** Place search + parse requests per member per minute */
  geoPerMemberPerMinute: 30,
  /** Nominatim usage policy: at most one request per second */
  nominatimPerSecond: 1,
  /** ORS calls per trip per UTC day */
  orsPerTripPerDay: 300,
  /** ORS calls per UTC day across all trips (the free key's directions quota) */
  orsPerDay: 2000,
  /** Days a search result stays in geoCache */
  geoCacheDays: 7,
  /** Most legs per POST /geo/routes */
  routesPerBatch: 30,
  /** Most points in a returned geometry */
  geometryMaxPoints: 200,
} as const

/** GET /api/trips/:id/geo/usage (owner) */
export interface GeoUsageResponse {
  /** UTC day the counts are for (YYYY-MM-DD) */
  date: string
  /** Calls made today for this trip */
  trip: Record<UsageProvider, number>
  /** Calls made today across all trips */
  all: Record<UsageProvider, number>
  limits: typeof GEO_LIMITS
  /** False when ORS_API_KEY is not set: every route is an estimate */
  orsConfigured: boolean
}

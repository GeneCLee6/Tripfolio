import type { TripDO } from './trip-do.ts'

export interface Env {
  /** The React app's static assets: index.html (app) and share.html (share page) */
  ASSETS: Fetcher
  /** One object per trip: live sync only (ARCHITECTURE.md §1); a ping-only placeholder for now */
  TRIP: DurableObjectNamespace<TripDO>
  /** Production or staging database (migrations/) */
  DB: D1Database
  /** Photos, documents, receipts (E6); documents are only ever read through the Worker */
  MEDIA: R2Bucket
  /** Daily D1 backups (e11-t03) */
  BACKUPS: R2Bucket
  /** The deployed commit (wrangler deploy --var APP_VERSION:<sha>) */
  APP_VERSION?: string
  /** Which environment this is; the daily backup writes under backups/<APP_ENV>/ (absent = production) */
  APP_ENV?: string
  /** Place search provider base URLs (wrangler vars; swappable, ARCHITECTURE.md §5) */
  PHOTON_URL?: string
  NOMINATIM_URL?: string
  /** OpenRouteService base URL (wrangler var) */
  ORS_URL?: string
  /** OpenRouteService key, a secret: `npx wrangler secret put ORS_API_KEY` (and `--env preview`).
   * Without it every route is a straight-line estimate */
  ORS_API_KEY?: string
  /** Exchange rate provider base URL (wrangler var; open.er-api.com, no key; e7-t03) */
  FX_API_URL?: string
}

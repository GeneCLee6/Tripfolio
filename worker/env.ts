import type { TripDO } from './trip-do.ts'

export interface Env {
  /** The React app's static assets: index.html (app) and share.html (share page) */
  ASSETS: Fetcher
  /** One object per trip: WebSocket fan-out of rev events with a 200-event catch-up buffer (worker/trip-do.ts, ARCHITECTURE.md §4.2) */
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
  /** The operator key for GET /api/admin/usage (e11-t05), a secret:
   * `npx wrangler secret put ADMIN_KEY`. Unset = the usage page answers 503 admin_disabled */
  ADMIN_KEY?: string
  /** Optional Cloudflare GraphQL Analytics token (Account Analytics: Read), a secret; with the
   * account id it adds Workers / D1 / DO numbers to the usage page (DEPLOY.md §14) */
  CF_ANALYTICS_TOKEN?: string
  /** The Cloudflare account id for the analytics query (var or secret; either name works) */
  CF_ACCOUNT_ID?: string
  CLOUDFLARE_ACCOUNT_ID?: string
  /** Google OAuth client id (wrangler var; empty = Google sign-in off, e1-t06, DEPLOY.md §13) */
  GOOGLE_CLIENT_ID?: string
  /** Google OAuth client secret, a secret: `npx wrangler secret put GOOGLE_CLIENT_SECRET`. Also keys
   * the HMAC of the short-lived OAuth state cookie. Without it sign-in stays off */
  GOOGLE_CLIENT_SECRET?: string
  /** The site's own origin (wrangler var), e.g. https://tripfolio.genelee-pro.workers.dev: the
   * OAuth redirect_uri and the post-login redirect are built from it, never from the request */
  APP_ORIGIN?: string
}

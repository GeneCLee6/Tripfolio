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
}

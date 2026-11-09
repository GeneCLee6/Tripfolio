import { handleRequest } from './app.ts'
import { runBackup } from './backup.ts'
import { runCleanup } from './cleanup.ts'
import type { Env } from './env.ts'
import { refreshAllBases } from './proxy/fx.ts'

// The Durable Object classes must be exported from the Worker's entry module
export { TripDO } from './trip-do.ts'

// Routing lives in app.ts and the backup in backup.ts, so that Vitest can test them without the
// Workers runtime
export default {
  fetch: handleRequest,
  // The one daily cron (17:00 UTC): the D1 backup (e11-t03), then the exchange rates (e7-t03),
  // then the cleanup (e11-t06; only after a successful backup, so the last copy of purged rows is
  // in it).
  // Awaited, not waitUntil, so a backup failure fails the run; a rates or cleanup failure is only
  // logged and never keeps the backup from running or from failing the run
  async scheduled(controller, env) {
    let backupError: unknown = null
    try {
      await runBackup(env, controller.scheduledTime)
    } catch (error) {
      backupError = error
    }
    try {
      await refreshAllBases(env)
    } catch (error) {
      console.error(JSON.stringify({ event: 'fx_cron_failed', error: String(error) }))
    }
    // Purging is irreversible: only after today's backup is safely stored
    if (backupError) {
      console.error(JSON.stringify({ event: 'cleanup_skipped', reason: 'backup_failed' }))
    } else {
      try {
        // runCleanup catches its own step errors; this is for anything unexpected
        await runCleanup(env, controller.scheduledTime)
      } catch (error) {
        console.error(JSON.stringify({ event: 'cleanup_failed', error: String(error) }))
      }
    }
    if (backupError) throw backupError
  },
} satisfies ExportedHandler<Env>

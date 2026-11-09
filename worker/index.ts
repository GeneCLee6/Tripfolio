import { handleRequest } from './app.ts'
import { runBackup } from './backup.ts'
import type { Env } from './env.ts'

// The Durable Object classes must be exported from the Worker's entry module
export { TripDO } from './trip-do.ts'

// Routing lives in app.ts and the backup in backup.ts, so that Vitest can test them without the
// Workers runtime
export default {
  fetch: handleRequest,
  // The daily D1 backup (e11-t03). Awaited, not waitUntil, so a failure fails the run
  async scheduled(controller, env) {
    await runBackup(env, controller.scheduledTime)
  },
} satisfies ExportedHandler<Env>

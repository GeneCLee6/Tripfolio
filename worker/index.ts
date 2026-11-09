import { handleRequest } from './app.ts'
import type { Env } from './env.ts'

// The Durable Object classes must be exported from the Worker's entry module
export { TripDO } from './trip-do.ts'

// Routing lives in app.ts so that Vitest can test it without the Workers runtime. A `scheduled`
// handler for the daily backup comes with e11-t03.
export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>

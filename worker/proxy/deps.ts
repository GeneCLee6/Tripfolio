// What the proxies need from the outside world, swappable in tests: the network, the clock, waits.

export interface ProxyDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export const proxyDeps: ProxyDeps = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** Sent to every provider; Nominatim's usage policy requires an identifying User-Agent */
export function providerHeaders(origin: string): Record<string, string> {
  return {
    'user-agent': `Tripfolio/1.0 (private trip planner for friends; ${origin})`,
    referer: `${origin}/`,
    accept: 'application/json',
  }
}

export const nowIsoFrom = (ms: number) => new Date(ms).toISOString()

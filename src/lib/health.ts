import { useEffect, useState } from 'react'
import type { HealthResponse } from '../../shared/health.ts'

export type HealthState =
  | { status: 'checking' }
  | { status: 'ok'; version: string }
  | { status: 'error' }

/** Asks GET /api/health once; the skeleton's proof that the app and the Worker talk */
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ status: 'checking' })
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/health', { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<HealthResponse>) : null))
      .then((body) => setState(body?.ok ? { status: 'ok', version: body.version } : { status: 'error' }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' })
      })
    return () => controller.abort()
  }, [])
  return state
}

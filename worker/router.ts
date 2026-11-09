import type { Env } from './env.ts'
import { ApiError } from './http.ts'

export interface RouteContext {
  request: Request
  env: Env
  url: URL
  params: Record<string, string>
}

export type Handler = (c: RouteContext) => Promise<Response>

interface Route {
  method: string
  parts: string[]
  handler: Handler
}

/** A tiny path router: `/api/trips/:id/stops/:sid` patterns, exact segment counts */
export class Router {
  private readonly routes: Route[] = []

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler })
    return this
  }

  /** null when no pattern matches the path; 405 when one does but not for this method */
  match(
    method: string,
    pathname: string,
  ): { handler: Handler; params: Record<string, string> } | null {
    const segments = pathname.split('/').filter(Boolean)
    let pathMatched = false
    for (const route of this.routes) {
      const params = matchParts(route.parts, segments)
      if (!params) continue
      pathMatched = true
      if (route.method === method) return { handler: route.handler, params }
    }
    if (pathMatched) throw new ApiError(405, 'method_not_allowed', `${method} not allowed here`)
    return null
  }
}

function matchParts(parts: string[], segments: string[]): Record<string, string> | null {
  if (parts.length !== segments.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const segment = segments[i]
    if (part.startsWith(':')) {
      try {
        params[part.slice(1)] = decodeURIComponent(segment)
      } catch {
        return null
      }
    } else if (part !== segment) {
      return null
    }
  }
  return params
}

import type { HealthResponse } from '../shared/health.ts'
import type { Env } from './env.ts'

const noStore = { 'cache-control': 'no-store' }

const notFound = () => Response.json({ error: 'not_found' }, { status: 404, headers: noStore })

/** /s/<token>: the share page's own HTML entry, never indexed. The data API comes with E8 */
async function serveSharePage(request: Request, env: Env): Promise<Response> {
  // `/share` rather than `/share.html`: the assets' html_handling redirects the .html form
  const asset = await env.ASSETS.fetch(new Request(new URL('/share', request.url), request))
  const response = new Response(asset.body, asset)
  response.headers.set('x-robots-tag', 'noindex')
  return response
}

// The Worker answers /api/*, /ws/* and /s/* (wrangler `run_worker_first`) and hands everything else
// to the static assets (the app; client routes fall back to index.html).
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/api/health') {
    const body: HealthResponse = { ok: true, version: env.APP_VERSION ?? 'local' }
    return Response.json(body, { headers: noStore })
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return notFound()
  if (url.pathname.startsWith('/s/')) return serveSharePage(request, env)
  return env.ASSETS.fetch(request)
}

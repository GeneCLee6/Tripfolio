// Security headers on every Worker response (e11-t04, DEPLOY.md §12). The whole site is private to
// a trip's members and share links, so everything is noindex. HTML also gets the CSP below.
//
// The CSP allows: styled-components' injected <style> tags ('unsafe-inline' styles), Google Fonts
// (css + font files), OpenFreeMap styles/tiles/sprites/glyphs (connect), MapLibre's blob: workers
// and blob:/data: images, and any https: image (wishlist link previews keep the source's image
// URL). No inline or third-party script: the Vite build only emits external module scripts.

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://tiles.openfreemap.org https://*.openfreemap.org",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

declare global {
  interface ImportMeta {
    /** Vite's mode: 'development' only under `vite dev` (the Cloudflare plugin runs the Worker) */
    readonly env?: { readonly MODE?: string }
  }
}

/**
 * `vite dev` serves HTML with Vite's inline React Refresh preamble and an HMR WebSocket, which the
 * production CSP would block (the share page at /s/* goes through the Worker in dev too). Only the
 * dev server relaxes script-src and connect-src; builds and tests use the production policy.
 */
export const DEV_CONTENT_SECURITY_POLICY = CONTENT_SECURITY_POLICY.replace(
  "script-src 'self'",
  "script-src 'self' 'unsafe-inline'",
).replace('connect-src', 'connect-src ws: wss:')

const devServer = () => import.meta.env?.MODE === 'development'

/** Set on every response, API and static alike */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(self), geolocation=(self), microphone=()',
  'x-robots-tag': 'noindex',
}

const isHtml = (response: Response) =>
  (response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html')

/**
 * The response with the security headers added (a copy: asset and fetch responses have immutable
 * headers). A CSP the handler already set (media: `default-src 'none'; sandbox`) is kept.
 * WebSocket upgrades (101) are returned untouched.
 */
export function withSecurityHeaders(response: Response): Response {
  if (response.status === 101 || response.webSocket) return response
  const out = new Response(response.body, response)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value)
  if (isHtml(out) && !out.headers.has('content-security-policy'))
    out.headers.set(
      'content-security-policy',
      devServer() ? DEV_CONTENT_SECURITY_POLICY : CONTENT_SECURITY_POLICY,
    )
  return out
}

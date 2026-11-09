import type { HealthResponse } from '../shared/health.ts'
import type { Env } from './env.ts'
import { ApiError, errorResponse, json } from './http.ts'
import * as media from './media.ts'
import { geoSearch } from './proxy/geocode.ts'
import { geoParse } from './proxy/parse.ts'
import { geoRoute, geoRoutes } from './proxy/route.ts'
import { geoUsage } from './proxy/usage.ts'
import { Router } from './router.ts'
import {
  createBooking,
  deleteBooking,
  listBookings,
  listDeadlines,
  patchBooking,
} from './trips/bookings.ts'
import { createLodging, deleteLodging, listLodgings, patchLodging } from './trips/lodging.ts'
import { createShare, listShares, publicShare, revokeShare } from './share.ts'
import {
  createStop,
  deleteLeg,
  deleteStop,
  listDays,
  moveStop,
  patchDay,
  patchStop,
  putLeg,
} from './trips/itinerary.ts'
import {
  createInvite,
  createMember,
  deleteMember,
  join,
  listInvites,
  patchMember,
  previewJoin,
  revokeInvite,
} from './trips/members.ts'
import {
  createPlace,
  deletePlace,
  listPlaces,
  mergePlace,
  patchPlace,
  placeRefs,
} from './trips/places.ts'
import { createTrip, deleteTrip, getTrip, listTrips, patchTrip } from './trips/trips.ts'
import {
  createClaim,
  createWishlistItem,
  deleteClaim,
  deleteWishlistItem,
  listWishlist,
  patchClaim,
  patchWishlistItem,
  pocketList,
  scheduleWishlistItem,
  unscheduleWishlistItem,
  unvoteWishlistItem,
  voteWishlistItem,
} from './trips/wishlist.ts'

// Auth and roles are checked inside each handler (worker/auth.ts authTrip); the router only maps
// paths. ARCHITECTURE.md §2, §4.1.
const api = new Router()
  .add('GET', '/api/health', async (c) => {
    const body: HealthResponse = { ok: true, version: c.env.APP_VERSION ?? 'local' }
    return json(body)
  })
  // Trips (e1-t01)
  .add('POST', '/api/trips', createTrip)
  .add('GET', '/api/trips', listTrips)
  .add('GET', '/api/trips/:id', getTrip)
  .add('PATCH', '/api/trips/:id', patchTrip)
  .add('DELETE', '/api/trips/:id', deleteTrip)
  // Members, invites, joining
  .add('POST', '/api/trips/:id/members', createMember)
  .add('PATCH', '/api/trips/:id/members/:mid', patchMember)
  .add('DELETE', '/api/trips/:id/members/:mid', deleteMember)
  .add('GET', '/api/trips/:id/invites', listInvites)
  .add('POST', '/api/trips/:id/invites', createInvite)
  .add('DELETE', '/api/trips/:id/invites/:iid', revokeInvite)
  .add('GET', '/api/join/:token', previewJoin)
  .add('POST', '/api/join/:token', join)
  // Share links
  .add('GET', '/api/trips/:id/shares', listShares)
  .add('POST', '/api/trips/:id/shares', createShare)
  .add('DELETE', '/api/trips/:id/shares/:sid', revokeShare)
  .add('GET', '/api/share/:token', publicShare)
  // Itinerary (e2-t01)
  .add('GET', '/api/trips/:id/days', listDays)
  .add('PATCH', '/api/trips/:id/days/:dayId', patchDay)
  .add('POST', '/api/trips/:id/stops', createStop)
  .add('PATCH', '/api/trips/:id/stops/:sid', patchStop)
  .add('DELETE', '/api/trips/:id/stops/:sid', deleteStop)
  .add('POST', '/api/trips/:id/stops/:sid/move', moveStop)
  .add('PUT', '/api/trips/:id/legs/:fromStopId/:toStopId', putLeg)
  .add('DELETE', '/api/trips/:id/legs/:fromStopId/:toStopId', deleteLeg)
  // Places (e3-t01)
  .add('GET', '/api/trips/:id/places', listPlaces)
  .add('POST', '/api/trips/:id/places', createPlace)
  .add('PATCH', '/api/trips/:id/places/:pid', patchPlace)
  .add('DELETE', '/api/trips/:id/places/:pid', deletePlace)
  .add('GET', '/api/trips/:id/places/:pid/refs', placeRefs)
  .add('POST', '/api/trips/:id/places/:pid/merge-into/:targetId', mergePlace)
  // Wishlist and the pocket list (e5-t01)
  .add('GET', '/api/trips/:id/wishlist', listWishlist)
  .add('POST', '/api/trips/:id/wishlist', createWishlistItem)
  .add('PATCH', '/api/trips/:id/wishlist/:wid', patchWishlistItem)
  .add('DELETE', '/api/trips/:id/wishlist/:wid', deleteWishlistItem)
  .add('POST', '/api/trips/:id/wishlist/:wid/vote', voteWishlistItem)
  .add('DELETE', '/api/trips/:id/wishlist/:wid/vote', unvoteWishlistItem)
  .add('POST', '/api/trips/:id/wishlist/:wid/claims', createClaim)
  .add('PATCH', '/api/trips/:id/wishlist/:wid/claims/:cid', patchClaim)
  .add('DELETE', '/api/trips/:id/wishlist/:wid/claims/:cid', deleteClaim)
  .add('POST', '/api/trips/:id/wishlist/:wid/schedule', scheduleWishlistItem)
  .add('POST', '/api/trips/:id/wishlist/:wid/unschedule', unscheduleWishlistItem)
  .add('GET', '/api/trips/:id/pocket', pocketList)
  // Attachments and media (e6-t01): worker/media.ts; GET /api/media/* sets its own cache-control
  .add('POST', '/api/trips/:id/attachments/sign', media.signAttachment)
  .add('GET', '/api/trips/:id/attachments/usage', media.attachmentUsage)
  .add('GET', '/api/trips/:id/attachments', media.listAttachments)
  .add('PUT', '/api/trips/:id/attachments/:aid/content', media.putAttachmentContent)
  .add('PUT', '/api/trips/:id/attachments/:aid/thumb', media.putAttachmentThumb)
  .add('POST', '/api/trips/:id/attachments/:aid/complete', media.completeAttachment)
  .add('PATCH', '/api/trips/:id/attachments/:aid', media.patchAttachment)
  .add('DELETE', '/api/trips/:id/attachments/:aid', media.deleteAttachment)
  .add('GET', '/api/media/:aid', media.getMedia)
  .add('GET', '/api/media/:aid/thumb', media.getMediaThumb)
  // Lodgings, bookings and their deadlines (e4-t01)
  .add('GET', '/api/trips/:id/lodgings', listLodgings)
  .add('POST', '/api/trips/:id/lodgings', createLodging)
  .add('PATCH', '/api/trips/:id/lodgings/:lid', patchLodging)
  .add('DELETE', '/api/trips/:id/lodgings/:lid', deleteLodging)
  .add('GET', '/api/trips/:id/bookings', listBookings)
  .add('POST', '/api/trips/:id/bookings', createBooking)
  .add('PATCH', '/api/trips/:id/bookings/:bid', patchBooking)
  .add('DELETE', '/api/trips/:id/bookings/:bid', deleteBooking)
  .add('GET', '/api/trips/:id/deadlines', listDeadlines)
  // External API proxies (e3-t02, e3-t04): worker/proxy/*, never called from the browser
  .add('GET', '/api/trips/:id/geo/search', geoSearch)
  .add('POST', '/api/trips/:id/geo/parse', geoParse)
  .add('POST', '/api/trips/:id/geo/route', geoRoute)
  .add('POST', '/api/trips/:id/geo/routes', geoRoutes)
  .add('GET', '/api/trips/:id/geo/usage', geoUsage)

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    const route = api.match(request.method, url.pathname)
    if (!route) throw new ApiError(404, 'not_found', 'no such endpoint')
    return await route.handler({ request, env, url, params: route.params })
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error)
    console.error(error)
    return errorResponse(new ApiError(500, 'internal', 'internal error'))
  }
}

/** /s/<token>: the share page's own HTML entry, never indexed. Its data is GET /api/share/:token */
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
  if (url.pathname.startsWith('/api/')) return handleApi(request, env, url)
  if (url.pathname.startsWith('/ws/'))
    return errorResponse(new ApiError(404, 'not_found', 'no such endpoint'))
  if (url.pathname.startsWith('/s/')) return serveSharePage(request, env)
  return env.ASSETS.fetch(request)
}

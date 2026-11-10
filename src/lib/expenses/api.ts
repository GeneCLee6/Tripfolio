import type { z } from 'zod'
import type {
  ExpenseResponse,
  ExpensesResponse,
  FxResponse,
  FxUnavailableDetails,
  HistoryEntity,
  HistoryResponse,
  SummaryResponse,
} from '../../../shared/api/expenses.ts'
import type { Rev } from '../../../shared/api/types.ts'
import type { ExpenseCategory, expenseCreateSchema } from '../../../shared/schema/expense.ts'
import { ApiError, isApiError, request } from '../api.ts'
import { queueExpense } from '../offline/expenses.ts'
import { isNetworkError, onMutationSent, replayNow } from '../offline/sync.ts'
import { isOnline, reportNetworkFailure } from '../offline/useOnline.ts'
import { getToken } from '../tokens.ts'

// Typed calls for the expense API (worker/trips/expenses.ts, e7-t01). Uses src/lib/api.ts's
// `request` (same ApiError, same test transport). Only types come from shared/schema, so zod stays
// out of the bundle (NEXT.md B1).

/** The create body as sent: the schema's input, defaults optional */
export type ExpenseCreateBody = z.input<typeof expenseCreateSchema>
/** Any subset of the create fields; fxRate null clears a manual rate (shared/schema expensePatchSchema) */
export type ExpensePatchBody = Partial<Omit<ExpenseCreateBody, 'fxRate'>> & {
  fxRate?: number | null
}

function tokenFor(tripId: string): string {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  return token
}

const base = (tripId: string) => `/api/trips/${encodeURIComponent(tripId)}`
const one = (tripId: string, expenseId: string) =>
  `${base(tripId)}/expenses/${encodeURIComponent(expenseId)}`

/** GET /expenses filters (server side; the page filters on the client below 500 rows) */
export interface ExpenseQuery {
  from?: string
  to?: string
  category?: ExpenseCategory
  /** Payer or participant */
  memberId?: string
  /** Substring of the note */
  q?: string
}

export const expensesApi = {
  list(tripId: string, query: ExpenseQuery = {}, signal?: AbortSignal): Promise<ExpensesResponse> {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value))
    const search = params.size ? `?${params}` : ''
    return request('GET', `${base(tripId)}/expenses${search}`, { token: tokenFor(tripId), signal })
  },

  create(tripId: string, body: ExpenseCreateBody): Promise<ExpenseResponse> {
    return request('POST', `${base(tripId)}/expenses`, { token: tokenFor(tripId), body })
  },

  patch(tripId: string, expenseId: string, body: ExpensePatchBody): Promise<ExpenseResponse> {
    return request('PATCH', one(tripId, expenseId), { token: tokenFor(tripId), body })
  },

  /** Soft delete; restore() brings it back */
  remove(tripId: string, expenseId: string): Promise<Rev & { ok: true }> {
    return request('DELETE', one(tripId, expenseId), { token: tokenFor(tripId) })
  },

  restore(tripId: string, expenseId: string): Promise<ExpenseResponse> {
    return request('POST', `${one(tripId, expenseId)}/restore`, {
      token: tokenFor(tripId),
      body: {},
    })
  },

  /** The rate the server would use for `quote` on `date` (trip default → fxRates), or null */
  fx(
    tripId: string,
    query: { quote?: string; date?: string },
    signal?: AbortSignal,
  ): Promise<FxResponse> {
    const params = new URLSearchParams()
    if (query.quote) params.set('quote', query.quote)
    if (query.date) params.set('date', query.date)
    const search = params.size ? `?${params}` : ''
    return request('GET', `${base(tripId)}/fx${search}`, { token: tokenFor(tripId), signal })
  },
}

/** A create without `id`, a PATCH with it */
export type ExpenseWrite =
  { id?: undefined; body: ExpenseCreateBody } | { id: string; body: ExpensePatchBody }

/**
 * Every expense write of the form goes through here. Offline (or when the request fails on the
 * network) the write is queued (src/lib/offline/, e10-t05) and the answer is provisional: the
 * expense's id starts with `pending-`, `rev` is -1. The queue sends it, in order, once the
 * connection is back; the list then reloads through notifyExpensesChanged.
 */
export async function submitExpense(tripId: string, write: ExpenseWrite): Promise<ExpenseResponse> {
  const token = tokenFor(tripId)
  const urls = { create: `${base(tripId)}/expenses`, one: (id: string) => one(tripId, id) }
  if (!isOnline() || (write.id !== undefined && write.id.startsWith('pending-'))) {
    const queued = await queueExpense(tripId, token, write, urls)
    // An edit of an expense made offline, with the connection back: send it now
    if (isOnline()) void replayNow()
    return queued
  }
  let response: ExpenseResponse
  try {
    response =
      write.id === undefined
        ? await expensesApi.create(tripId, write.body)
        : await expensesApi.patch(tripId, write.id, write.body)
  } catch (error) {
    if (!isNetworkError(error)) throw error
    reportNetworkFailure()
    return queueExpense(tripId, token, write, urls)
  }
  notifyExpensesChanged(tripId)
  return response
}

// A queued expense write reached the server: lists reload
onMutationSent((mutation) => {
  if (mutation.entity.type === 'expense') notifyExpensesChanged(mutation.entity.tripId)
})

/** 422 fx_unavailable: no rate is known for that currency and day; ask for one and send again */
export function isFxUnavailable(
  error: unknown,
): error is ApiError & { details: FxUnavailableDetails } {
  return isApiError(error) && error.status === 422 && error.code === 'fx_unavailable'
}

// The floating 記一筆 button lives in the trip layout, the list on its own page: a write anywhere
// tells the list to load again.
type Listener = (tripId: string) => void
const listeners = new Set<Listener>()

export function onExpensesChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyExpensesChanged(tripId: string): void {
  for (const listener of listeners) listener(tripId)
}

// Statistics and history (e7-t06, e7-t07): the summary, the change log, deleted expenses and
// restoring a version. Restores go through `notifyExpensesChanged` like every other write.

export type SummaryBy = SummaryResponse['by']

export const expenseLogApi = {
  /** GET /expenses/summary?by=&from=&to=: base-currency totals (member rows add paid and share) */
  summary(
    tripId: string,
    by: SummaryBy,
    range: { from?: string | null; to?: string | null } = {},
    signal?: AbortSignal,
  ): Promise<SummaryResponse> {
    const params = new URLSearchParams({ by })
    if (range.from) params.set('from', range.from)
    if (range.to) params.set('to', range.to)
    return request('GET', `${base(tripId)}/expenses/summary?${params}`, {
      token: tokenFor(tripId),
      signal,
    })
  },

  /** GET /expenses/:eid/history: every version of one expense, oldest first */
  history(tripId: string, expenseId: string, signal?: AbortSignal): Promise<HistoryResponse> {
    return request('GET', `${one(tripId, expenseId)}/history`, { token: tokenFor(tripId), signal })
  },

  /** GET /expense-history?entity=&limit=: the trip's money log, newest first */
  tripHistory(
    tripId: string,
    query: { entity?: HistoryEntity; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<HistoryResponse> {
    const params = new URLSearchParams()
    if (query.entity) params.set('entity', query.entity)
    if (query.limit) params.set('limit', String(query.limit))
    const search = params.size ? `?${params}` : ''
    return request('GET', `${base(tripId)}/expense-history${search}`, {
      token: tokenFor(tripId),
      signal,
    })
  },

  /** GET /expenses?deleted=1: the soft-deleted expenses only */
  listDeleted(tripId: string, signal?: AbortSignal): Promise<ExpensesResponse> {
    return request('GET', `${base(tripId)}/expenses?deleted=1`, { token: tokenFor(tripId), signal })
  },

  /** POST /expenses/:eid/restore {}: undelete */
  async undelete(tripId: string, expenseId: string): Promise<ExpenseResponse> {
    const response = await expensesApi.restore(tripId, expenseId)
    notifyExpensesChanged(tripId)
    return response
  },

  /** POST /expenses/:eid/restore { historyId }: bring back the version that entry recorded */
  async restoreVersion(
    tripId: string,
    expenseId: string,
    historyId: string,
  ): Promise<ExpenseResponse> {
    const response = await request<ExpenseResponse>('POST', `${one(tripId, expenseId)}/restore`, {
      token: tokenFor(tripId),
      body: { historyId },
    })
    notifyExpensesChanged(tripId)
    return response
  },
}

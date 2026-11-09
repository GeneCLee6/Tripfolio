import type {
  BalancesResponse,
  FxResponse,
  PoolContribution,
  PoolRefundMode,
  PoolResponse,
  Settlement,
  SettlementsResponse,
} from '../../../shared/api/expenses.ts'
import type { Rev } from '../../../shared/api/types.ts'
import type {
  PoolContributionCreate,
  PoolContributionPatch,
  SettlementCreate,
} from '../../../shared/schema/expense.ts'
import { ApiError, request } from '../api.ts'
import { getToken } from '../tokens.ts'

// The typed client for balances, settlements and the shared pool (worker/trips/settlements.ts and
// pool.ts, e7-t01). Kept apart from src/lib/api.ts so the expense pages and this one can grow
// independently; it reuses the same `request` and token store.

function tokenFor(tripId: string): string {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  return token
}

const tripPath = (tripId: string) => `/api/trips/${encodeURIComponent(tripId)}`

/** The create body: the schema's input, so the defaults stay optional */
export type ContributionCreateBody = Partial<PoolContributionCreate> &
  Pick<PoolContributionCreate, 'memberId' | 'amountMinor' | 'currency'>
export type SettlementCreateBody = Partial<SettlementCreate> &
  Pick<SettlementCreate, 'fromMemberId' | 'toMemberId' | 'amountMinor'>

export const balancesApi = {
  /** GET /balances: every member's balance, the pool balance and the fewest-transfers suggestion */
  getBalances(tripId: string, signal?: AbortSignal): Promise<BalancesResponse> {
    return request('GET', `${tripPath(tripId)}/balances`, { token: tokenFor(tripId), signal })
  },

  listSettlements(tripId: string, signal?: AbortSignal): Promise<SettlementsResponse> {
    return request('GET', `${tripPath(tripId)}/settlements`, { token: tokenFor(tripId), signal })
  },

  /** POST /settlements: less than the suggestion is a partial settlement */
  createSettlement(
    tripId: string,
    body: SettlementCreateBody,
  ): Promise<Rev & { settlement: Settlement }> {
    return request('POST', `${tripPath(tripId)}/settlements`, { token: tokenFor(tripId), body })
  },

  /** DELETE /settlements/:sid: a soft delete, the balances go back */
  deleteSettlement(tripId: string, settlementId: string): Promise<Rev & { ok: true }> {
    return request(
      'DELETE',
      `${tripPath(tripId)}/settlements/${encodeURIComponent(settlementId)}`,
      { token: tokenFor(tripId) },
    )
  },

  getPool(tripId: string, signal?: AbortSignal): Promise<PoolResponse> {
    return request('GET', `${tripPath(tripId)}/pool/contributions`, {
      token: tokenFor(tripId),
      signal,
    })
  },

  /** POST /pool/contributions; 422 fx_unavailable asks for a manual `fxRate` */
  createContribution(
    tripId: string,
    body: ContributionCreateBody,
  ): Promise<Rev & { contribution: PoolContribution }> {
    return request('POST', `${tripPath(tripId)}/pool/contributions`, {
      token: tokenFor(tripId),
      body,
    })
  },

  patchContribution(
    tripId: string,
    contributionId: string,
    patch: PoolContributionPatch,
  ): Promise<Rev & { contribution: PoolContribution }> {
    return request(
      'PATCH',
      `${tripPath(tripId)}/pool/contributions/${encodeURIComponent(contributionId)}`,
      { token: tokenFor(tripId), body: patch },
    )
  },

  deleteContribution(tripId: string, contributionId: string): Promise<Rev & { ok: true }> {
    return request(
      'DELETE',
      `${tripPath(tripId)}/pool/contributions/${encodeURIComponent(contributionId)}`,
      { token: tokenFor(tripId) },
    )
  },

  /** PATCH /pool/settings: how the pool's leftover is refunded */
  setRefundMode(
    tripId: string,
    refundMode: PoolRefundMode,
  ): Promise<Rev & { refundMode: PoolRefundMode }> {
    return request('PATCH', `${tripPath(tripId)}/pool/settings`, {
      token: tokenFor(tripId),
      body: { refundMode },
    })
  },

  /** GET /fx?quote=: today's rate of one currency (1 quote = rate base), for the secondary line */
  getFx(tripId: string, quote: string, signal?: AbortSignal): Promise<FxResponse> {
    const params = new URLSearchParams({ quote })
    return request('GET', `${tripPath(tripId)}/fx?${params}`, { token: tokenFor(tripId), signal })
  },
}

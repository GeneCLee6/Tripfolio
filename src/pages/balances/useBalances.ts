import type {
  BalancesResponse,
  PoolResponse,
  Settlement,
} from '../../../shared/api/expenses.ts'
import type { Trip } from '../../../shared/api/types.ts'
import { balancesApi } from '../../lib/balances/api.ts'
import { secondaryRate } from '../../lib/balances/view.ts'
import { useResource } from '../../lib/hooks.ts'

// Everything the balances page shows, fetched together and fetched again after every write
// (GET /balances is the source of truth: the page never recomputes it).

export interface BalancesData {
  balances: BalancesResponse
  pool: PoolResponse
  settlements: Settlement[]
  /** 1 secondary currency = rate base currency, or null (no secondary, or no rate known) */
  secondaryRate: number | null
}

function wantsSecondary(trip: Trip): string | null {
  const secondary = trip.secondaryCurrency
  return secondary && secondary !== trip.baseCurrency ? secondary : null
}

export async function loadBalances(trip: Trip, signal?: AbortSignal): Promise<BalancesData> {
  const secondary = wantsSecondary(trip)
  const [balances, pool, settlements, fx] = await Promise.all([
    balancesApi.getBalances(trip.id, signal),
    balancesApi.getPool(trip.id, signal),
    balancesApi.listSettlements(trip.id, signal),
    // The secondary line is a nicety: a missing rate only hides it
    secondary ? balancesApi.getFx(trip.id, secondary, signal).catch(() => null) : null,
  ])
  return {
    balances,
    pool,
    settlements: settlements.settlements,
    secondaryRate: secondaryRate(fx, secondary),
  }
}

export function useBalances(trip: Trip) {
  return useResource(`balances:${trip.id}`, (signal) => loadBalances(trip, signal))
}

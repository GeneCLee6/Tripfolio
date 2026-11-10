import type { ExpenseResponse, ExpenseView } from '../../../shared/api/expenses.ts'
import type { ExpenseCreateBody, ExpensePatchBody, ExpenseWrite } from '../expenses/api.ts'
import { isPendingId, PENDING_PREFIX } from './queue.ts'
import { offlineQueue, onMutationSent } from './sync.ts'

// Expense writes made offline (e10-t05): submitExpense() hands them here. A create gets a
// provisional id (`pending-…`) so the form can close and say 「已記一筆」; editing that provisional
// expense again before it was sent changes the queued create instead of queueing a PATCH of an id
// the server never saw. Once the create is sent, the provisional id maps to the real one.

export { isPendingId, PENDING_PREFIX } from './queue.ts'

/** Provisional id → the server's id, once the queued create went through (this tab only) */
const resolved = new Map<string, string>()

onMutationSent((mutation, response) => {
  const tempId = mutation.entity.tempId
  const expense = (response as Partial<ExpenseResponse> | null)?.expense
  if (tempId && expense?.id) resolved.set(tempId, expense.id)
})

/** The server id a provisional id became, if it was sent already */
export const resolvedId = (tempId: string): string | undefined => resolved.get(tempId)

/**
 * What the form gets back for a queued write: the body echoed as an expense. Only id, amount,
 * currency, date, category and note are meaningful; base amounts and shares are the server's to
 * compute, so they are zero/empty here (`rev` -1 marks it as not from the server).
 */
export function provisionalExpense(
  tripId: string,
  id: string,
  body: ExpensePatchBody,
  now: Date = new Date(),
): ExpenseView {
  const stamp = now.toISOString()
  return {
    id,
    tripId,
    payerMemberId: body.payerMemberId ?? null,
    pool: body.pool ?? false,
    amountMinor: body.amountMinor ?? 0,
    currency: body.currency ?? '',
    fxRate: body.fxRate ?? 1,
    fxSource: body.fxRate != null ? 'manual' : 'base',
    fxDate: null,
    baseMinor: 0,
    date: body.date ?? stamp.slice(0, 10),
    category: body.category ?? 'other',
    note: body.note ?? '',
    stopId: body.stopId ?? null,
    dayId: body.dayId ?? null,
    receiptAttachmentId: body.receiptAttachmentId ?? null,
    bookingId: body.bookingId ?? null,
    wishlistItemId: body.wishlistItemId ?? null,
    splitMethod: body.splitMethod ?? 'equal',
    createdByMemberId: '',
    rev: -1,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
    shares: [],
  }
}

/** A create body with a later edit applied; a cleared rate (null) is simply left out */
export function mergeIntoCreate(
  create: ExpenseCreateBody,
  patch: ExpensePatchBody,
): ExpenseCreateBody {
  const { fxRate, ...rest } = patch
  const merged: ExpenseCreateBody = { ...create, ...rest }
  if (fxRate === null) delete merged.fxRate
  else if (fxRate !== undefined) merged.fxRate = fxRate
  return merged
}

/** Queues an expense write; resolves at once with a provisional answer */
export async function queueExpense(
  tripId: string,
  token: string,
  write: ExpenseWrite,
  urls: { create: string; one: (expenseId: string) => string },
): Promise<ExpenseResponse> {
  if (write.id !== undefined && isPendingId(write.id)) {
    const tempId = write.id
    const queued = offlineQueue.list().find((item) => item.entity.tempId === tempId)
    if (queued) {
      // Still waiting: fold the edit into the create
      const body = mergeIntoCreate(queued.body as ExpenseCreateBody, write.body)
      await offlineQueue.update(queued.id, (item) => ({ ...item, body }))
      return { expense: provisionalExpense(tripId, tempId, body), rev: -1 }
    }
    const realId = resolvedId(tempId)
    if (!realId) throw new Error(`unknown provisional expense ${tempId}`)
    write = { id: realId, body: write.body }
  }

  if (write.id === undefined) {
    const tempId = `${PENDING_PREFIX}${crypto.randomUUID()}`
    await offlineQueue.enqueue({
      method: 'POST',
      url: urls.create,
      body: write.body,
      token,
      entity: { type: 'expense', tripId, tempId },
    })
    return { expense: provisionalExpense(tripId, tempId, write.body), rev: -1 }
  }

  await offlineQueue.enqueue({
    method: 'PATCH',
    url: urls.one(write.id),
    body: write.body,
    token,
    entity: { type: 'expense', tripId, id: write.id },
  })
  return { expense: provisionalExpense(tripId, write.id, write.body), rev: -1 }
}

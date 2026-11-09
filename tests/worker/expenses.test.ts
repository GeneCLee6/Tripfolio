import { beforeEach, describe, expect, it } from 'vitest'
import type {
  ApplyRateResponse,
  BalancesResponse,
  ExpenseResponse,
  ExpensesResponse,
  FxResponse,
  HistoryResponse,
  PoolContribution,
  PoolResponse,
  Settlement,
  SettlementsResponse,
  SummaryResponse,
} from '../../shared/api/expenses.ts'
import type {
  CreateInviteResponse,
  CreateTripResponse,
  MemberTokenResponse,
} from '../../shared/api/types.ts'
import type { MemberCreate } from '../../shared/schema/member.ts'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'
import { createFakeD1 } from './fake-d1.ts'

// Expenses, splitting, FX, pool, balances, settlements, summaries and history (e7-t01)

let env: Env
let sqlite: ReturnType<typeof createFakeD1>['sqlite']

beforeEach(() => {
  const fake = createFakeD1()
  sqlite = fake.sqlite
  env = { DB: fake.db, APP_VERSION: 'test' } as unknown as Env
})

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await handleRequest(
    new Request(`https://x.test${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  )
  expect(response.headers.get('cache-control')).toBe('no-store')
  return { status: response.status, body: (await response.json()) as T }
}

/** Trip in AUD with A (owner), B (editor) and C (viewer, still a participant) */
async function setup() {
  const trip = await call<CreateTripResponse>('POST', '/api/trips', undefined, {
    name: 'NZ South Island',
    destination: 'New Zealand',
    startDate: '2026-12-20',
    endDate: '2026-12-31',
    tz: 'Pacific/Auckland',
    baseCurrency: 'AUD',
    localCurrencies: ['NZD'],
    style: 'roadtrip',
    owner: { name: 'Gene', color: 'teal' },
  })
  expect(trip.status).toBe(201)
  const owner = trip.body.memberToken
  const base = `/api/trips/${trip.body.trip.id}`
  const invite = await call<CreateInviteResponse>('POST', `${base}/invites`, owner)
  const editor = await call<MemberTokenResponse>(
    'POST',
    `/api/join/${invite.body.inviteToken}`,
    undefined,
    { name: 'Amy', color: 'rose' },
  )
  const viewerBody: MemberCreate = { name: 'Kid', color: 'sky', email: null, role: 'viewer' }
  const added = await call<{ member: { id: string } }>('POST', `${base}/members`, owner, viewerBody)
  const invite2 = await call<CreateInviteResponse>('POST', `${base}/invites`, owner)
  const viewer = await call<MemberTokenResponse>(
    'POST',
    `/api/join/${invite2.body.inviteToken}`,
    undefined,
    { memberId: added.body.member.id },
  )
  expect(viewer.status).toBe(201)
  return {
    base,
    tripId: trip.body.trip.id,
    owner,
    editor: editor.body.memberToken,
    viewer: viewer.body.memberToken,
    A: trip.body.member.id,
    B: editor.body.member.id,
    C: added.body.member.id,
    dayIds: trip.body.days.map((d) => d.id),
  }
}

type Setup = Awaited<ReturnType<typeof setup>>

const all = (s: Setup) => [{ memberId: s.A }, { memberId: s.B }, { memberId: s.C }]

async function addExpense(s: Setup, body: Record<string, unknown>, token = s.owner) {
  const res = await call<ExpenseResponse>('POST', `${s.base}/expenses`, token, {
    category: 'food',
    date: '2026-12-20',
    ...body,
  })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  const e = res.body.expense
  expect(e.shares.reduce((a, x) => a + x.shareMinor, 0)).toBe(e.baseMinor)
  return res.body
}

const sharesOf = (e: ExpenseResponse['expense']) =>
  Object.fromEntries(e.shares.map((x) => [x.memberId, x.shareMinor]))

describe('creating expenses: five split methods and FX resolution', () => {
  it('splits equal / shares / percent / exact / self with the payer remainder rule', async () => {
    const s = await setup()
    // equal, AUD: 10000 / 3 → payer A takes the leftover cent
    const eq = await addExpense(s, {
      amountMinor: 10000,
      currency: 'AUD',
      payerMemberId: s.A,
      participants: all(s),
      splitMethod: 'equal',
    })
    expect(eq.expense).toMatchObject({ baseMinor: 10000, fxRate: 1, fxSource: 'base', pool: false })
    expect(sharesOf(eq.expense)).toEqual({ [s.A]: 3334, [s.B]: 3333, [s.C]: 3333 })

    // percent: C pays 1000, 50/25/25
    const pc = await addExpense(s, {
      amountMinor: 1000,
      currency: 'AUD',
      payerMemberId: s.C,
      participants: [
        { memberId: s.A, percent: 50 },
        { memberId: s.B, percent: 25 },
        { memberId: s.C, percent: 25 },
      ],
      splitMethod: 'percent',
    })
    expect(sharesOf(pc.expense)).toEqual({ [s.A]: 500, [s.B]: 250, [s.C]: 250 })
    expect(pc.expense.shares[0]).toMatchObject({ percent: 50, weight: null })

    // exact in NZD at an explicit rate 0.5: 1000 + 2000 NZD → weights for 1500 AUD
    const ex = await addExpense(s, {
      amountMinor: 3000,
      currency: 'NZD',
      fxRate: 0.5,
      payerMemberId: s.B,
      participants: [
        { memberId: s.A, amountMinor: 1000 },
        { memberId: s.B, amountMinor: 2000 },
      ],
      splitMethod: 'exact',
    })
    expect(ex.expense).toMatchObject({ baseMinor: 1500, fxRate: 0.5, fxSource: 'manual' })
    expect(sharesOf(ex.expense)).toEqual({ [s.A]: 500, [s.B]: 1000 })
    expect(ex.expense.shares[1].amountMinor).toBe(2000)

    // self: participants ignored
    const self = await addExpense(s, {
      amountMinor: 700,
      currency: 'AUD',
      payerMemberId: s.A,
      participants: all(s),
      splitMethod: 'self',
    })
    expect(sharesOf(self.expense)).toEqual({ [s.A]: 700 })

    // rev moves with every write
    expect(self.rev).toBeGreaterThan(ex.rev)

    // exact amounts that do not add up, percents that do not, self paid by the pool
    const bad = await call<{ error: { code: string; details: { splitError: string } } }>(
      'POST',
      `${s.base}/expenses`,
      s.owner,
      {
        amountMinor: 1000,
        currency: 'AUD',
        category: 'food',
        payerMemberId: s.A,
        participants: [
          { memberId: s.A, percent: 60 },
          { memberId: s.B, percent: 30 },
        ],
        splitMethod: 'percent',
      },
    )
    expect(bad.status).toBe(422)
    expect(bad.body.error.details.splitError).toBe('percent-sum')
    const poolSelf = await call('POST', `${s.base}/expenses`, s.owner, {
      amountMinor: 1000,
      currency: 'AUD',
      category: 'food',
      pool: true,
      splitMethod: 'self',
    })
    expect(poolSelf.status).toBe(422)
  })

  it('resolves the rate: explicit, trip default, fxRates row, earlier row, else 422 needsRate', async () => {
    const s = await setup()
    // explicit: 50.00 NZD × 0.9123454 (10 significant digits are kept) = 45.61727 → 4562; equal B/C
    const explicit = await addExpense(s, {
      amountMinor: 5000,
      currency: 'NZD',
      fxRate: 0.9123454,
      payerMemberId: s.B,
      participants: [{ memberId: s.B }, { memberId: s.C }],
      splitMethod: 'equal',
    })
    expect(explicit.expense).toMatchObject({
      fxRate: 0.9123454,
      baseMinor: 4562,
      fxSource: 'manual',
    })
    expect(sharesOf(explicit.expense)).toEqual({ [s.B]: 2281, [s.C]: 2281 })

    // seed rows the e7-t03 fetcher will write: 1 AUD = 10500 IDR on 12-20
    sqlite
      .prepare(
        "INSERT INTO fxRates (date, base, quote, rate, source) VALUES ('2026-12-20', 'AUD', 'IDR', 10500, 'test')",
      )
      .all()
    // fxRates row: 210000 IDR × (1/10500 → 0.00009523809524, 10 significant digits) = 20.00 AUD;
    // shares 2:1, payer A
    const auto = await addExpense(s, {
      amountMinor: 210000,
      currency: 'IDR',
      payerMemberId: s.A,
      participants: [
        { memberId: s.A, weight: 2 },
        { memberId: s.B, weight: 1 },
      ],
      splitMethod: 'shares',
    })
    expect(auto.expense).toMatchObject({
      fxRate: 0.00009523809524,
      fxSource: 'auto',
      fxDate: '2026-12-20',
      baseMinor: 2000,
    })
    // 2000 × 2/3 = 1333.33, × 1/3 = 666.67: floors 1333 + 666, the leftover cent goes to A
    expect(sharesOf(auto.expense)).toEqual({ [s.A]: 1334, [s.B]: 666 })
    expect(auto.expense.shares[0].weight).toBe(2)

    // an earlier row is used up to 7 days later
    const later = await addExpense(s, {
      date: '2026-12-27',
      amountMinor: 105000,
      currency: 'IDR',
      payerMemberId: s.A,
      participants: all(s),
      splitMethod: 'equal',
    })
    // 105000 IDR / 10500 = 10.00 AUD (6 decimals made it 9.98)
    expect(later.expense).toMatchObject({ fxDate: '2026-12-20', baseMinor: 1000 })

    // 8 days later: nothing; the UI must ask for a rate
    const none = await call<{ error: { code: string; details: Record<string, unknown> } }>(
      'POST',
      `${s.base}/expenses`,
      s.owner,
      {
        date: '2026-12-28',
        amountMinor: 105000,
        currency: 'IDR',
        category: 'food',
        payerMemberId: s.A,
        participants: all(s),
        splitMethod: 'equal',
      },
    )
    expect(none.status).toBe(422)
    expect(none.body.error.code).toBe('fx_unavailable')
    expect(none.body.error.details).toMatchObject({ needsRate: true, currency: 'IDR', base: 'AUD' })

    // trip default beats fxRates
    const put = await call<{ overrides: Record<string, number> }>(
      'PUT',
      `${s.base}/fx/overrides`,
      s.editor,
      { NZD: 0.9, IDR: 0.0001 },
    )
    expect(put.status).toBe(200)
    const trip = await addExpense(s, {
      amountMinor: 1000,
      currency: 'NZD',
      payerMemberId: s.A,
      participants: all(s),
      splitMethod: 'equal',
    })
    expect(trip.expense).toMatchObject({ fxRate: 0.9, fxSource: 'trip', baseMinor: 900 })

    const fx = await call<FxResponse>('GET', `${s.base}/fx?date=2026-12-20`, s.viewer)
    expect(fx.body.base).toBe('AUD')
    expect(fx.body.overrides).toEqual({ NZD: 0.9, IDR: 0.0001 })
    expect(fx.body.rates.find((r) => r.quote === 'NZD')).toMatchObject({
      rate: 0.9,
      source: 'trip',
    })
    await call('PUT', `${s.base}/fx/overrides`, s.owner, {})
    const fx2 = await call<FxResponse>('GET', `${s.base}/fx?date=2026-12-21&quote=IDR`, s.viewer)
    expect(fx2.body.rates).toEqual([
      { quote: 'IDR', rate: 0.00009523809524, source: 'auto', rateDate: '2026-12-20' },
    ])
    const fx3 = await call<FxResponse>('GET', `${s.base}/fx?date=2026-12-21&quote=THB`, s.viewer)
    expect(fx3.body.rates[0]).toMatchObject({ rate: null, source: null })

    // the viewer cannot set defaults; the base currency is not a default; unknown codes are refused
    expect((await call('PUT', `${s.base}/fx/overrides`, s.viewer, { NZD: 1 })).status).toBe(403)
    expect((await call('PUT', `${s.base}/fx/overrides`, s.owner, { AUD: 1 })).status).toBe(422)
    const unknown = await call('POST', `${s.base}/expenses`, s.owner, {
      amountMinor: 100,
      currency: 'XYZ',
      category: 'food',
      payerMemberId: s.A,
      participants: all(s),
      splitMethod: 'equal',
      fxRate: 1,
    })
    expect(unknown.status).toBe(422)
  })

  it('validates payer, members, links and roles', async () => {
    const s = await setup()
    const body = {
      amountMinor: 1000,
      currency: 'AUD',
      category: 'food',
      participants: all(s),
      splitMethod: 'equal',
    }
    expect((await call('POST', `${s.base}/expenses`, s.owner, body)).status).toBe(422)
    expect(
      (
        await call('POST', `${s.base}/expenses`, s.owner, {
          ...body,
          payerMemberId: s.A,
          pool: true,
        })
      ).status,
    ).toBe(422)
    expect(
      (await call('POST', `${s.base}/expenses`, s.owner, { ...body, payerMemberId: 'nobody' }))
        .status,
    ).toBe(422)
    expect(
      (
        await call('POST', `${s.base}/expenses`, s.owner, {
          ...body,
          payerMemberId: s.A,
          amountMinor: 10.5,
        })
      ).status,
    ).toBe(422)
    expect(
      (
        await call('POST', `${s.base}/expenses`, s.owner, {
          ...body,
          payerMemberId: s.A,
          stopId: 'no-stop',
        })
      ).status,
    ).toBe(422)
    const linked = await addExpense(s, { ...body, payerMemberId: s.A, dayId: s.dayIds[0] })
    expect(linked.expense.dayId).toBe(s.dayIds[0])
    // viewers read, never write
    expect(
      (await call('POST', `${s.base}/expenses`, s.viewer, { ...body, payerMemberId: s.C })).status,
    ).toBe(403)
    expect(
      (await call('PATCH', `${s.base}/expenses/${linked.expense.id}`, s.viewer, { note: 'x' }))
        .status,
    ).toBe(403)
    expect((await call('GET', `${s.base}/expenses`, s.viewer)).status).toBe(200)
    expect((await call('GET', `${s.base}/expenses`)).status).toBe(401)
  })
})

describe('editing, history, soft delete and restore', () => {
  it('re-splits on patch, records a diff, soft-deletes and restores any version', async () => {
    const s = await setup()
    const created = await addExpense(s, {
      amountMinor: 10000,
      currency: 'AUD',
      payerMemberId: s.A,
      participants: all(s),
      splitMethod: 'equal',
      note: 'Fergburger',
    })
    const id = created.expense.id
    // B (editor) edits A's expense
    const patched = await call<ExpenseResponse>('PATCH', `${s.base}/expenses/${id}`, s.editor, {
      amountMinor: 9000,
    })
    expect(patched.status).toBe(200)
    expect(sharesOf(patched.body.expense)).toEqual({ [s.A]: 3000, [s.B]: 3000, [s.C]: 3000 })
    expect(patched.body.expense.rev).toBe(2)
    expect(patched.body.rev).toBeGreaterThan(created.rev)

    // new participants and method
    const reSplit = await call<ExpenseResponse>('PATCH', `${s.base}/expenses/${id}`, s.editor, {
      participants: [
        { memberId: s.A, weight: 1 },
        { memberId: s.B, weight: 2 },
      ],
      splitMethod: 'shares',
      payerMemberId: s.B,
    })
    expect(sharesOf(reSplit.body.expense)).toEqual({ [s.A]: 3000, [s.B]: 6000 })
    // switching currency without a rate: no NZD rate is known → 422 needsRate
    const noRate = await call<{ error: { code: string } }>(
      'PATCH',
      `${s.base}/expenses/${id}`,
      s.editor,
      { currency: 'NZD' },
    )
    expect(noRate.body.error.code).toBe('fx_unavailable')
    const nzd = await call<ExpenseResponse>('PATCH', `${s.base}/expenses/${id}`, s.editor, {
      currency: 'NZD',
      fxRate: 0.9,
    })
    expect(nzd.body.expense).toMatchObject({ baseMinor: 8100, fxSource: 'manual' })
    // a no-op patch writes nothing
    const same = await call<ExpenseResponse>('PATCH', `${s.base}/expenses/${id}`, s.editor, {
      note: 'Fergburger',
    })
    expect(same.body.rev).toBe(nzd.body.rev)

    const history = await call<HistoryResponse>('GET', `${s.base}/expenses/${id}/history`, s.viewer)
    expect(history.body.history.map((h) => h.action)).toEqual([
      'create',
      'update',
      'update',
      'update',
    ])
    const [create, first] = history.body.history
    expect(create.memberId).toBe(s.A)
    expect(create.diff.amountMinor).toEqual([null, 10000])
    expect(first.memberId).toBe(s.B)
    expect(first.diff.amountMinor).toEqual([10000, 9000])
    expect(first.diff.baseMinor).toEqual([10000, 9000])
    expect(Object.keys(first.diff).sort()).toEqual(['amountMinor', 'baseMinor', 'shares'])
    expect(history.body.history[2].diff.payerMemberId).toEqual([s.A, s.B])

    // soft delete: gone from the list and balances, visible with deleted=1 and in history
    const del = await call('DELETE', `${s.base}/expenses/${id}`, s.editor)
    expect(del.status).toBe(200)
    expect(
      (await call<ExpensesResponse>('GET', `${s.base}/expenses`, s.viewer)).body.expenses,
    ).toHaveLength(0)
    const deleted = await call<ExpensesResponse>('GET', `${s.base}/expenses?deleted=1`, s.viewer)
    expect(deleted.body.expenses.map((e) => e.id)).toEqual([id])
    const balances = await call<BalancesResponse>('GET', `${s.base}/balances`, s.viewer)
    expect(balances.body.balances.every((b) => b.netMinor === 0)).toBe(true)
    expect((await call('PATCH', `${s.base}/expenses/${id}`, s.editor, { note: 'x' })).status).toBe(
      404,
    )

    // undelete
    const restored = await call<ExpenseResponse>(
      'POST',
      `${s.base}/expenses/${id}/restore`,
      s.owner,
    )
    expect(restored.status).toBe(200)
    expect(restored.body.expense).toMatchObject({ deletedAt: null, baseMinor: 8100 })
    expect((await call('POST', `${s.base}/expenses/${id}/restore`, s.owner)).status).toBe(422)

    // back to the very first version
    const toFirst = await call<ExpenseResponse>(
      'POST',
      `${s.base}/expenses/${id}/restore`,
      s.owner,
      { historyId: create.id },
    )
    expect(toFirst.body.expense).toMatchObject({
      amountMinor: 10000,
      currency: 'AUD',
      fxSource: 'base',
      payerMemberId: s.A,
      splitMethod: 'equal',
    })
    expect(sharesOf(toFirst.body.expense)).toEqual({ [s.A]: 3334, [s.B]: 3333, [s.C]: 3333 })
    const after = await call<HistoryResponse>('GET', `${s.base}/expenses/${id}/history`, s.viewer)
    expect(after.body.history.map((h) => h.action).slice(-3)).toEqual([
      'delete',
      'restore',
      'restore',
    ])
    const log = await call<HistoryResponse>(
      'GET',
      `${s.base}/expense-history?entity=expense`,
      s.viewer,
    )
    expect(log.body.history[0].action).toBe('restore')
  })

  it('filters the list by date, category, member and note', async () => {
    const s = await setup()
    await addExpense(s, {
      amountMinor: 1000,
      currency: 'AUD',
      payerMemberId: s.A,
      participants: [{ memberId: s.A }],
      splitMethod: 'equal',
      note: 'Petrol 100%',
      category: 'fuel',
      date: '2026-12-21',
    })
    await addExpense(s, {
      amountMinor: 2000,
      currency: 'AUD',
      payerMemberId: s.B,
      participants: [{ memberId: s.B }, { memberId: s.C }],
      splitMethod: 'equal',
      note: 'Dinner',
    })
    const get = async (q: string) =>
      (await call<ExpensesResponse>('GET', `${s.base}/expenses?${q}`, s.viewer)).body.expenses
    expect(await get('')).toHaveLength(2)
    expect((await get('from=2026-12-21')).map((e) => e.note)).toEqual(['Petrol 100%'])
    expect((await get('to=2026-12-20')).map((e) => e.note)).toEqual(['Dinner'])
    expect((await get('category=fuel')).map((e) => e.note)).toEqual(['Petrol 100%'])
    expect((await get(`memberId=${s.C}`)).map((e) => e.note)).toEqual(['Dinner'])
    expect((await get('q=100%25')).map((e) => e.note)).toEqual(['Petrol 100%'])
    expect(await get('q=_')).toHaveLength(0)
    expect((await call('GET', `${s.base}/expenses?category=nope`, s.viewer)).status).toBe(422)
  })
})

describe('pool, balances and settlements', () => {
  it('matches a hand-computed scenario, then settles', async () => {
    const s = await setup()
    // Pool: A 200.00, B 100.00
    const pa = await call<{ contribution: PoolContribution }>(
      'POST',
      `${s.base}/pool/contributions`,
      s.owner,
      { memberId: s.A, amountMinor: 20000, currency: 'AUD', date: '2026-12-20' },
    )
    expect(pa.status).toBe(201)
    await call('POST', `${s.base}/pool/contributions`, s.editor, {
      memberId: s.B,
      amountMinor: 10000,
      currency: 'AUD',
    })
    // E1 pool pays 90.00 for all; E2 A pays 60.00 for all; E3 B pays 10.00 for himself
    const e1 = await addExpense(s, {
      amountMinor: 9000,
      currency: 'AUD',
      pool: true,
      participants: all(s),
      splitMethod: 'equal',
      category: 'fuel',
    })
    expect(e1.expense).toMatchObject({ pool: true, payerMemberId: null })
    await addExpense(s, {
      amountMinor: 6000,
      currency: 'AUD',
      payerMemberId: s.A,
      participants: all(s),
      splitMethod: 'equal',
      date: '2026-12-21',
    })
    await addExpense(s, {
      amountMinor: 1000,
      currency: 'AUD',
      payerMemberId: s.B,
      splitMethod: 'self',
      category: 'shopping',
      date: '2026-12-21',
    })

    const pool = await call<PoolResponse>('GET', `${s.base}/pool/contributions`, s.viewer)
    expect(pool.body.contributions).toHaveLength(2)
    expect(pool.body).toMatchObject({ poolBalanceMinor: 21000, refundMode: 'proportional' })

    // pool 210.00 left → A 140.00, B 70.00 back
    // A: 60 − 50 + 200 − 140 = +70 · B: 10 − 60 + 100 − 70 = −20 · C: −50
    const nets = (b: BalancesResponse) =>
      Object.fromEntries(b.balances.map((x) => [x.memberId, x.netMinor]))
    const b1 = (await call<BalancesResponse>('GET', `${s.base}/balances`, s.viewer)).body
    expect(b1.poolBalanceMinor).toBe(21000)
    expect(nets(b1)).toEqual({ [s.A]: 7000, [s.B]: -2000, [s.C]: -5000 })
    expect(b1.balances[0]).toMatchObject({ paidMinor: 6000, owedMinor: 5000, poolBackMinor: 14000 })
    expect(b1.suggested).toEqual([
      { from: s.C, to: s.A, amountMinor: 5000 },
      { from: s.B, to: s.A, amountMinor: 2000 },
    ])

    // equal refund: 105.00 each → A +105, B −55, C −50
    const mode = await call('PATCH', `${s.base}/pool/settings`, s.editor, { refundMode: 'equal' })
    expect(mode.status).toBe(200)
    const b2 = (await call<BalancesResponse>('GET', `${s.base}/balances`, s.viewer)).body
    expect(b2.refundMode).toBe('equal')
    expect(nets(b2)).toEqual({ [s.A]: 10500, [s.B]: -5500, [s.C]: -5000 })
    await call('PATCH', `${s.base}/pool/settings`, s.editor, { refundMode: 'proportional' })

    // C settles in full by cash
    const st = await call<{ settlement: Settlement }>('POST', `${s.base}/settlements`, s.editor, {
      fromMemberId: s.C,
      toMemberId: s.A,
      amountMinor: 5000,
      method: 'cash',
    })
    expect(st.status).toBe(201)
    const b3 = (await call<BalancesResponse>('GET', `${s.base}/balances`, s.viewer)).body
    expect(nets(b3)).toEqual({ [s.A]: 2000, [s.B]: -2000, [s.C]: 0 })
    expect(b3.suggested).toEqual([{ from: s.B, to: s.A, amountMinor: 2000 }])
    // partial settlement
    await call('POST', `${s.base}/settlements`, s.editor, {
      fromMemberId: s.B,
      toMemberId: s.A,
      amountMinor: 500,
    })
    const list = await call<SettlementsResponse>('GET', `${s.base}/settlements`, s.viewer)
    expect(list.body.settlements.map((x) => [x.amountMinor, x.method])).toEqual([
      [5000, 'cash'],
      [500, 'transfer'],
    ])
    expect(
      nets((await call<BalancesResponse>('GET', `${s.base}/balances`, s.viewer)).body),
    ).toEqual({ [s.A]: 1500, [s.B]: -1500, [s.C]: 0 })
    // undo C's settlement
    expect(
      (await call('DELETE', `${s.base}/settlements/${st.body.settlement.id}`, s.editor)).status,
    ).toBe(200)
    expect(
      nets((await call<BalancesResponse>('GET', `${s.base}/balances`, s.viewer)).body),
    ).toEqual({ [s.A]: 6500, [s.B]: -1500, [s.C]: -5000 })
    expect(
      (
        await call('POST', `${s.base}/settlements`, s.editor, {
          fromMemberId: s.A,
          toMemberId: s.A,
          amountMinor: 1,
        })
      ).status,
    ).toBe(422)
    expect(
      (
        await call('POST', `${s.base}/settlements`, s.viewer, {
          fromMemberId: s.C,
          toMemberId: s.A,
          amountMinor: 1,
        })
      ).status,
    ).toBe(403)

    // pool edits: B's contribution becomes NZD 100 at 0.9 → 90.00, then is deleted
    const pb = pool.body.contributions.find((x) => x.memberId === s.B) as PoolContribution
    const patched = await call<{ contribution: PoolContribution }>(
      'PATCH',
      `${s.base}/pool/contributions/${pb.id}`,
      s.editor,
      { currency: 'NZD', fxRate: 0.9 },
    )
    expect(patched.body.contribution).toMatchObject({ baseMinor: 9000, fxSource: 'manual', rev: 2 })
    expect((await call('DELETE', `${s.base}/pool/contributions/${pb.id}`, s.editor)).status).toBe(
      200,
    )
    const pool2 = await call<PoolResponse>('GET', `${s.base}/pool/contributions`, s.viewer)
    expect(pool2.body).toMatchObject({ poolBalanceMinor: 11000 })
    const poolLog = await call<HistoryResponse>(
      'GET',
      `${s.base}/expense-history?entity=pool`,
      s.viewer,
    )
    expect(poolLog.body.history.map((h) => h.action)).toEqual([
      'delete',
      'update',
      'create',
      'create',
    ])

    // balances still sum to zero after a member is removed; their shares stay
    await call('DELETE', `/api/trips/${s.tripId}/members/${s.C}`, s.owner)
    const b4 = (await call<BalancesResponse>('GET', `${s.base}/balances`, s.owner)).body
    expect(b4.balances.find((x) => x.memberId === s.C)).toMatchObject({ removed: true })
    expect(b4.balances.reduce((a, x) => a + x.netMinor, 0)).toBe(0)
  })
})

describe('summaries and bulk rates', () => {
  it('sums by day, category and member', async () => {
    const s = await setup()
    await addExpense(s, {
      amountMinor: 3000,
      currency: 'AUD',
      payerMemberId: s.A,
      participants: all(s),
      splitMethod: 'equal',
      category: 'fuel',
    })
    await addExpense(s, {
      amountMinor: 1000,
      currency: 'AUD',
      payerMemberId: s.B,
      participants: [{ memberId: s.B }],
      splitMethod: 'equal',
      date: '2026-12-21',
    })
    await addExpense(s, {
      amountMinor: 500,
      currency: 'AUD',
      pool: true,
      participants: [{ memberId: s.C }],
      splitMethod: 'equal',
      date: '2026-12-21',
    })
    const sum = async (q: string) =>
      (await call<SummaryResponse>('GET', `${s.base}/expenses/summary?${q}`, s.viewer)).body
    const day = await sum('by=day')
    expect(day.rows).toEqual([
      { key: '2026-12-20', baseMinor: 3000, count: 1 },
      { key: '2026-12-21', baseMinor: 1500, count: 2 },
    ])
    expect(day.totalMinor).toBe(4500)
    const cat = await sum('by=category')
    expect(cat.rows).toEqual([
      { key: 'fuel', baseMinor: 3000, count: 1 },
      { key: 'food', baseMinor: 1500, count: 2 },
    ])
    const mem = await sum('by=member&from=2026-12-20')
    expect(mem.rows).toEqual([
      { key: s.A, baseMinor: 1000, count: 1, paidMinor: 3000, shareMinor: 1000 },
      { key: s.B, baseMinor: 2000, count: 2, paidMinor: 1000, shareMinor: 2000 },
      { key: s.C, baseMinor: 1500, count: 2, paidMinor: 0, shareMinor: 1500 },
    ])
    expect((await sum('by=day&to=2026-12-20')).totalMinor).toBe(3000)
    expect((await call('GET', `${s.base}/expenses/summary?by=week`, s.viewer)).status).toBe(422)
  })

  it('applies a rate to unsettled or all expenses of a currency', async () => {
    const s = await setup()
    await call('PUT', `${s.base}/fx/overrides`, s.owner, { NZD: 0.9 })
    const old = await addExpense(s, {
      amountMinor: 10000,
      currency: 'NZD',
      payerMemberId: s.A,
      participants: all(s),
      splitMethod: 'equal',
    })
    const aud = await addExpense(s, {
      amountMinor: 10000,
      currency: 'AUD',
      payerMemberId: s.A,
      participants: all(s),
      splitMethod: 'equal',
    })
    const st = await call<{ settlement: Settlement }>('POST', `${s.base}/settlements`, s.owner, {
      fromMemberId: s.B,
      toMemberId: s.A,
      amountMinor: 1000,
    })
    // Make the order unambiguous: old expense → settlement → new expense
    sqlite
      .prepare("UPDATE expenses SET createdAt = '2026-01-01T00:00:00.000Z' WHERE id IN (?, ?)")
      .all(old.expense.id, aud.expense.id)
    sqlite
      .prepare("UPDATE settlements SET createdAt = '2026-01-02T00:00:00.000Z' WHERE id = ?")
      .all(st.body.settlement.id)
    const fresh = await addExpense(s, {
      amountMinor: 5000,
      currency: 'NZD',
      payerMemberId: s.B,
      participants: all(s),
      splitMethod: 'equal',
    })
    expect(fresh.expense.baseMinor).toBe(4500)

    const unsettled = await call<ApplyRateResponse>(
      'POST',
      `${s.base}/expenses/apply-rate`,
      s.editor,
      { currency: 'NZD', rate: 0.8, scope: 'unsettled' },
    )
    expect(unsettled.status).toBe(200)
    expect(unsettled.body.updated).toBe(1)
    const get = async (id: string) =>
      (await call<ExpenseResponse>('GET', `${s.base}/expenses/${id}`, s.viewer)).body.expense
    expect(await get(fresh.expense.id)).toMatchObject({
      fxRate: 0.8,
      fxSource: 'manual',
      baseMinor: 4000,
    })
    expect(sharesOf(await get(fresh.expense.id))).toEqual({ [s.A]: 1333, [s.B]: 1334, [s.C]: 1333 })
    expect((await get(old.expense.id)).baseMinor).toBe(9000)

    const everything = await call<ApplyRateResponse>(
      'POST',
      `${s.base}/expenses/apply-rate`,
      s.editor,
      { currency: 'NZD', rate: 0.8, scope: 'all' },
    )
    expect(everything.body.updated).toBe(1)
    expect((await get(old.expense.id)).baseMinor).toBe(8000)
    expect((await get(aud.expense.id)).baseMinor).toBe(10000)
    const h = await call<HistoryResponse>(
      'GET',
      `${s.base}/expenses/${old.expense.id}/history`,
      s.viewer,
    )
    expect(h.body.history.at(-1)?.diff.fxRate).toEqual([0.9, 0.8])
    expect(
      (
        await call('POST', `${s.base}/expenses/apply-rate`, s.editor, {
          currency: 'AUD',
          rate: 1,
          scope: 'all',
        })
      ).status,
    ).toBe(422)
    expect(
      (
        await call('POST', `${s.base}/expenses/apply-rate`, s.viewer, {
          currency: 'NZD',
          rate: 1,
          scope: 'all',
        })
      ).status,
    ).toBe(403)
  })
})

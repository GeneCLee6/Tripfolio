import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { BalanceRow as Row, PoolContribution } from '../../shared/api/expenses.ts'
import type { Member, Trip } from '../../shared/api/types.ts'
import { setLocale } from '../../shared/i18n/t.ts'
import { TripContext, type TripContextValue } from '../../src/app/trip-context.ts'
import { BalanceRow, PoolCard, SettleCard, ToastProvider } from '../../src/components/index.ts'
import { peopleOf } from '../../src/lib/balances/view.ts'
import BalancesPage from '../../src/pages/balances/BalancesPage.tsx'
import { MyBalanceChip } from '../../src/pages/balances/MyBalanceChip.tsx'
import { PoolSection } from '../../src/pages/balances/PoolSection.tsx'

// Balances, settle cards and the shared pool (e7-t04, e7-t05): what each piece shows, and that
// viewers get no write controls.

afterEach(() => setLocale('zh-TW'))

const trip: Trip = {
  id: 'trip1',
  name: 'NZ',
  destination: 'New Zealand',
  centerLat: null,
  centerLng: null,
  startDate: '2030-02-01',
  endDate: '2030-02-10',
  tz: 'Pacific/Auckland',
  baseCurrency: 'NZD',
  secondaryCurrency: 'TWD',
  localCurrencies: ['NZD'],
  coverColor: '#0F6E74',
  coverAttachmentId: null,
  summary: '',
  style: 'campervan',
  driveLimitMin: null,
  ownerMemberId: 'm1',
  rev: 1,
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
  archivedAt: null,
  deletedAt: null,
}

const member = (id: string, name: string, role: Member['role'] = 'editor'): Member => ({
  id,
  tripId: 'trip1',
  name,
  color: '#0F6E74',
  email: null,
  role,
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
})

const gene = member('m1', 'Gene', 'owner')
const mei = member('m2', 'Mei')
const members = [gene, mei]

const row = (memberId: string, extra: Partial<Row>): Row => ({
  memberId,
  paidMinor: 0,
  owedMinor: 0,
  poolInMinor: 0,
  poolBackMinor: 0,
  settledOutMinor: 0,
  settledInMinor: 0,
  netMinor: 0,
  removed: false,
  ...extra,
})

const contribution: PoolContribution = {
  id: 'p1',
  tripId: 'trip1',
  memberId: 'm1',
  amountMinor: 50000,
  currency: 'NZD',
  fxRate: 1,
  fxSource: 'base',
  fxDate: null,
  baseMinor: 50000,
  date: '2030-02-01',
  note: '',
  createdByMemberId: 'm1',
  rev: 1,
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
  deletedAt: null,
}

function inTrip(node: ReactElement, me: Member) {
  const value: TripContextValue = { trip, me, members, reload: () => {}, setTrip: () => {} }
  return renderToStaticMarkup(
    <ToastProvider>
      <TripContext.Provider value={value}>{node}</TripContext.Provider>
    </ToastProvider>,
  )
}

describe('BalanceRow', () => {
  it('shows the sign, the word and the paid / share line, not only a colour', () => {
    const html = renderToStaticMarkup(
      <ul>
        <BalanceRow
          name="Mei"
          colorIndex={1}
          detail="付了 NZ$1,410.00 · 應分攤 NZ$1,529.60"
          amount="−NZ$119.60"
          tone="owes"
          toneLabel="應付"
          badges={['你', '已移除']}
          removed
        />
      </ul>,
    )
    expect(html).toContain('<li')
    expect(html).toContain('aria-label="Mei"')
    expect(html).toContain('−NZ$119.60')
    expect(html).toContain('應付')
    expect(html).toContain('付了 NZ$1,410.00')
    expect(html).toContain('· 你')
    expect(html).toContain('· 已移除')
  })
})

describe('SettleCard', () => {
  it('reads as one sentence and carries its action', () => {
    const html = renderToStaticMarkup(
      <ul>
        <SettleCard
          from={{ name: 'Jo', colorIndex: 4 }}
          to={{ name: 'Gene', colorIndex: 0 }}
          amount="NZ$312.40"
          label="Jo 付給 Gene NZ$312.40"
          meta="2月1日（五） · 現金"
          action={<button type="button">已結清</button>}
        />
      </ul>,
    )
    expect(html).toContain('aria-label="Jo 付給 Gene NZ$312.40"')
    expect(html).toMatch(/aria-hidden="true"[^>]*>→<\/span>/)
    expect(html).toContain('已結清')
    expect(html).toContain('現金')
  })
})

describe('PoolCard and PoolSection', () => {
  it('PoolCard: title, balance and summary', () => {
    const html = renderToStaticMarkup(
      <PoolCard title="公基金結餘" balance="NZ$236.00" summary="出資 NZ$2,000.00 · 池付 NZ$1,764.00" />,
    )
    expect(html).toContain('aria-label="公基金結餘"')
    expect(html).toContain('NZ$236.00')
    expect(html).toContain('池付 NZ$1,764.00')
  })

  const rows = [
    row('m1', { poolInMinor: 50000, poolBackMinor: 20000, netMinor: 100 }),
    row('m2', { netMinor: -100 }),
  ]
  const section = (editable: boolean) => (
    <PoolSection
      contributions={[contribution]}
      rows={rows}
      poolBalanceMinor={20000}
      refundMode="proportional"
      baseCurrency="NZD"
      people={peopleOf(members, 'm1', rows)}
      editable={editable}
      onAdd={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      onRefundMode={() => {}}
    />
  )

  it('editors: add, edit, delete and the refund mode switch', () => {
    const html = inTrip(section(true), gene)
    expect(html).toContain('NZ$200.00')
    expect(html).toContain('出資 NZ$500.00 · 池付 NZ$300.00')
    expect(html).toContain('加一筆出資')
    expect(html).toContain('aria-label="編輯 Gene 的出資"')
    expect(html).toContain('aria-label="刪除 Gene 的出資"')
    expect(html).toContain('role="radiogroup" aria-label="結餘退還方式"')
    expect(html).toContain('按出資比例')
    expect(html).toContain('不用另外轉帳')
    // Expected refunds: Gene put in 500 and gets 200 back
    expect(html).toContain('aria-label="預估退還"')
    expect(html).toContain('出資 NZ$500.00')
  })

  it('viewers: the same numbers, no write controls', () => {
    const html = inTrip(section(false), member('m3', 'Kid', 'viewer'))
    expect(html).toContain('NZ$200.00')
    expect(html).not.toContain('加一筆出資')
    expect(html).not.toContain('的出資"')
    expect(html).not.toContain('radiogroup')
    expect(html).toContain('按出資比例')
  })

  it('an overdrawn pool says so in words', () => {
    const html = inTrip(
      <PoolSection
        contributions={[contribution]}
        rows={[row('m1', { poolInMinor: 50000, poolBackMinor: -1000 })]}
        poolBalanceMinor={-1000}
        refundMode="equal"
        baseCurrency="NZD"
        people={peopleOf(members, 'm1')}
        editable={false}
        onAdd={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onRefundMode={() => {}}
      />,
      gene,
    )
    expect(html).toContain('−NZ$10.00')
    expect(html).toContain('公基金透支')
    expect(html).toContain('補繳')
    expect(html).toContain('平均分回')
  })
})

describe('BalancesPage and MyBalanceChip', () => {
  it('the page starts with its heading and a skeleton while loading', () => {
    const html = inTrip(<BalancesPage />, gene)
    expect(html).toContain('餘額與結算')
    expect(html).toContain('aria-busy="true"')
  })

  it('the chip shows my signed balance and the word', () => {
    const html = inTrip(
      <MyBalanceChip
        balances={{
          baseCurrency: 'NZD',
          balances: [row('m1', { netMinor: 31240 }), row('m2', { netMinor: -31240 })],
          poolBalanceMinor: 0,
          refundMode: 'proportional',
          suggested: [],
          rev: 1,
        }}
      />,
      gene,
    )
    expect(html).toContain('我的餘額')
    expect(html).toContain('+NZ$312.40')
    expect(html).toContain('應收')
  })
})

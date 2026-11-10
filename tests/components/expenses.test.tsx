import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExpenseView } from '../../shared/api/expenses.ts'
import { setLocale } from '../../shared/i18n/t.ts'
import { CategoryIcon, MemberPicker, SplitEditor } from '../../src/components/index.ts'
import { ExpenseRow } from '../../src/pages/expenses/ExpenseRow.tsx'

// The expense list row (e7-t08) and the form's pieces (e7-t02), rendered to markup

afterEach(() => setLocale('zh-TW'))

const members = [
  { id: 'gene', name: 'Gene', color: '#0F6E74' },
  { id: 'mei', name: 'Mei', color: '#B5654A' },
]
const money = { baseCurrency: 'AUD', secondaryCurrency: 'TWD', secondaryRate: 0.05 }

const expense = (patch: Partial<ExpenseView> = {}): ExpenseView => ({
  id: 'e1',
  tripId: 't1',
  payerMemberId: 'gene',
  pool: false,
  amountMinor: 4500,
  currency: 'NZD',
  fxRate: 0.91,
  fxSource: 'trip',
  fxDate: null,
  baseMinor: 4095,
  date: '2026-11-10',
  category: 'food',
  note: 'Fergburger',
  stopId: 's1',
  dayId: 'd1',
  receiptAttachmentId: 'a1',
  bookingId: null,
  wishlistItemId: null,
  splitMethod: 'equal',
  createdByMemberId: 'gene',
  rev: 1,
  createdAt: '2026-11-10T01:00:00Z',
  updatedAt: '2026-11-10T01:00:00Z',
  deletedAt: null,
  shares: [
    { memberId: 'gene', weight: null, percent: null, amountMinor: null, shareMinor: 2048 },
    { memberId: 'mei', weight: null, percent: null, amountMinor: null, shareMinor: 2047 },
  ],
  ...patch,
})

describe('ExpenseRow', () => {
  it('shows the note, who paid and shares, the original amount and the base + secondary line', () => {
    const html = renderToStaticMarkup(
      <ExpenseRow
        expense={expense()}
        members={members}
        money={money}
        stopName="Fergburger Queenstown"
        onOpen={() => {}}
      />,
    )
    expect(html).toContain('Fergburger')
    expect(html).toContain('Gene 付 · 全員平分')
    expect(html).toContain('NZ$45.00')
    expect(html).toContain('≈ AU$40.95（≈ $819.00）')
    expect(html).toContain('有收據')
    expect(html).toContain('行程點：Fergburger Queenstown')
    expect(html).toContain('<button')
  })

  it('falls back to the category, the pool and a plain row for viewers (English)', () => {
    setLocale('en')
    const html = renderToStaticMarkup(
      <ExpenseRow
        expense={expense({
          note: '',
          category: 'fuel',
          pool: true,
          payerMemberId: null,
          currency: 'AUD',
          amountMinor: 11840,
          baseMinor: 11840,
          receiptAttachmentId: null,
          splitMethod: 'shares',
        })}
        members={members}
        money={money}
      />,
    )
    expect(html).toContain('Fuel')
    expect(html).toContain('Shared fund paid · 2 people · By shares')
    expect(html).toContain('A$118.40')
    expect(html).toContain('≈ NT$2,368.00')
    expect(html).not.toContain('<button')
  })
})

describe('form pieces', () => {
  it('MemberPicker marks the selected members and offers the pool', () => {
    const html = renderToStaticMarkup(
      <MemberPicker
        mode="single"
        label="Paid by"
        members={members}
        selected={['pool']}
        extra={{ id: 'pool', label: 'Pool' }}
        onSelect={() => {}}
      />,
    )
    expect(html).toContain('role="radiogroup"')
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(html).toContain('Pool')
  })

  it('SplitEditor collapsed shows the method and each share; open shows inputs and the rule', () => {
    const props = {
      method: 'equal' as const,
      onMethodChange: () => {},
      participants: members,
      currency: 'NZD',
      values: { weights: {}, percents: {}, exacts: {} },
      onValueChange: () => {},
      preview: [
        { memberId: 'gene', shareMinor: 2250 },
        { memberId: 'mei', shareMinor: 2250 },
      ],
      onExpandedChange: () => {},
    }
    const collapsed = renderToStaticMarkup(<SplitEditor {...props} expanded={false} />)
    expect(collapsed).toContain('平均 · 2 人 × NZ$22.50')
    const open = renderToStaticMarkup(
      <SplitEditor
        {...props}
        method="shares"
        expanded
        preview={[
          { memberId: 'gene', shareMinor: 1500 },
          { memberId: 'mei', shareMinor: 3000 },
        ]}
        values={{ weights: { mei: '2' }, percents: {}, exacts: {} }}
      />,
    )
    expect(open).toContain('aria-label="Mei 的份數"')
    expect(open).toContain('value="2"')
    expect(open).toContain('NZ$30.00')
    expect(open).toContain('剩下的從付款人起各加 1')
  })

  it('CategoryIcon draws every category', () => {
    for (const category of [
      'food',
      'lodging',
      'transport',
      'fuel',
      'tickets',
      'shopping',
      'misc',
      'other',
    ] as const) {
      expect(renderToStaticMarkup(<CategoryIcon category={category} />)).toContain('<svg')
    }
  })
})

import { describe, expect, it } from 'vitest'
import type { ExpenseView, PoolContribution, Settlement } from '../../../shared/api/expenses.ts'
import {
  BOM,
  buildCsv,
  csvField,
  csvFileName,
  csvLine,
  decimal,
  expenseRows,
  extraRows,
  safeText,
  type CsvLabels,
} from '../../../src/lib/stats/csv.ts'

// The CSV export (e7-t06): escaping, BOM, CRLF, amounts in each currency's precision

/** A small RFC 4180 reader, enough to check what Excel would see */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else field += ch
  }
  return rows
}

describe('fields and lines', () => {
  it('quotes every field and doubles inner quotes', () => {
    expect(csvField('plain')).toBe('"plain"')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
    expect(csvField(null)).toBe('""')
    expect(csvField(12)).toBe('"12"')
    expect(csvLine(['a', 'b,c'])).toBe('"a","b,c"')
  })

  it('defuses formulas in typed text', () => {
    expect(safeText('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(safeText('+1')).toBe("'+1")
    expect(safeText('@x')).toBe("'@x")
    expect(safeText('Fergburger')).toBe('Fergburger')
  })

  it('starts with a BOM, ends every row with CRLF, and round-trips', () => {
    const text = buildCsv([
      ['日期', '說明'],
      ['2030-02-01', '午餐, "超好吃"\n第二行'],
    ])
    expect(text.startsWith(BOM)).toBe(true)
    expect(text.endsWith('\r\n')).toBe(true)
    expect(text.split('\r\n')).toHaveLength(3)
    expect(parseCsv(text.slice(1))).toEqual([
      ['日期', '說明'],
      ['2030-02-01', '午餐, "超好吃"\n第二行'],
    ])
    expect(new TextEncoder().encode(text).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
  })
})

describe('decimal', () => {
  it('writes minor units in the currency precision', () => {
    expect(decimal(4095, 'AUD')).toBe('40.95')
    expect(decimal(5, 'AUD')).toBe('0.05')
    expect(decimal(-1234, 'NZD')).toBe('-12.34')
    expect(decimal(150000, 'IDR')).toBe('150000')
    expect(decimal(1500, 'JPY')).toBe('1500')
  })
})

const labels: CsvLabels = {
  header: {
    date: 'date',
    category: 'category',
    note: 'note',
    payer: 'payer',
    amount: 'amount',
    currency: 'currency',
    fxRate: 'fxRate',
    baseAmount: 'baseAmount',
    baseCurrency: 'baseCurrency',
    participants: 'participants',
    shares: 'shares',
    stopName: 'stopName',
    receipt: 'receipt',
  },
  category: (c) => `cat:${c}`,
  member: (id) => ({ a: 'Gene', b: 'Mei' })[id] ?? '?',
  pool: 'Pool',
  hasReceipt: 'yes',
  stopName: (id) => (id === 's1' ? 'Hooker Valley' : null),
}

function expense(over: Partial<ExpenseView>): ExpenseView {
  return {
    id: 'e',
    tripId: 't',
    payerMemberId: 'a',
    pool: false,
    amountMinor: 4500,
    currency: 'NZD',
    fxRate: 0.91,
    fxSource: 'trip',
    fxDate: null,
    baseMinor: 4095,
    date: '2030-02-02',
    category: 'food',
    note: 'Lunch, "big"',
    stopId: 's1',
    dayId: null,
    receiptAttachmentId: 'r1',
    bookingId: null,
    wishlistItemId: null,
    splitMethod: 'equal',
    createdByMemberId: 'a',
    rev: 1,
    createdAt: '2030-02-02T01:00:00Z',
    updatedAt: '2030-02-02T01:00:00Z',
    deletedAt: null,
    shares: [
      { memberId: 'a', weight: null, percent: null, amountMinor: null, shareMinor: 2048 },
      { memberId: 'b', weight: null, percent: null, amountMinor: null, shareMinor: 2047 },
    ],
    ...over,
  }
}

describe('expenseRows', () => {
  it('writes the header and one row per expense, oldest first', () => {
    const rows = expenseRows(
      [
        expense({ id: 'late', date: '2030-02-03', pool: true, payerMemberId: null, note: '=cmd', stopId: null, receiptAttachmentId: null }),
        expense({}),
      ],
      'AUD',
      labels,
    )
    expect(rows[0]).toEqual(Object.values(labels.header))
    expect(rows[1]).toEqual([
      '2030-02-02',
      'cat:food',
      'Lunch, "big"',
      'Gene',
      '45.00',
      'NZD',
      '0.91',
      '40.95',
      'AUD',
      'Gene; Mei',
      'Gene 20.48; Mei 20.47',
      'Hooker Valley',
      'yes',
    ])
    expect(rows[2].slice(0, 4)).toEqual(['2030-02-03', 'cat:food', "'=cmd", 'Pool'])
    expect(rows[2].slice(11)).toEqual(['', ''])
    const parsed = parseCsv(buildCsv(rows).slice(1))
    expect(parsed).toHaveLength(3)
    expect(parsed[1][2]).toBe('Lunch, "big"')
  })
})

describe('extraRows', () => {
  it('appends the pool and settlement blocks, skipping deleted ones', () => {
    const contribution = {
      id: 'c',
      memberId: 'b',
      amountMinor: 10000,
      currency: 'NZD',
      fxRate: 0.91,
      baseMinor: 9100,
      date: '2030-02-01',
      note: 'kitty',
      deletedAt: null,
    } as PoolContribution
    const settlement = {
      id: 's',
      fromMemberId: 'b',
      toMemberId: 'a',
      amountMinor: 2047,
      method: 'cash',
      note: '',
      date: '2030-02-05',
      deletedAt: null,
    } as Settlement
    const rows = extraRows(
      [contribution, { ...contribution, id: 'gone', deletedAt: '2030-02-02T00:00:00Z' }],
      [settlement],
      'AUD',
      {
        member: labels.member,
        contributionsTitle: 'Pool',
        settlementsTitle: 'Settlements',
        contributionHeader: { date: 'd', member: 'm', amount: 'a', currency: 'c', fxRate: 'r', baseAmount: 'b', baseCurrency: 'bc', note: 'n' },
        settlementHeader: { date: 'd', from: 'f', to: 't', amount: 'a', baseCurrency: 'bc', method: 'm', note: 'n' },
        method: (m) => `method:${m}`,
      },
    )
    expect(rows).toEqual([
      [],
      ['Pool'],
      ['d', 'm', 'a', 'c', 'r', 'b', 'bc', 'n'],
      ['2030-02-01', 'Mei', '100.00', 'NZD', '0.91', '91.00', 'AUD', 'kitty'],
      [],
      ['Settlements'],
      ['d', 'f', 't', 'a', 'bc', 'm', 'n'],
      ['2030-02-05', 'Mei', 'Gene', '20.47', 'AUD', 'method:cash', ''],
    ])
  })
})

describe('csvFileName', () => {
  it('drops characters Windows refuses and adds the range', () => {
    expect(csvFileName('NZ: South/North?', null, null)).toBe('NZ South North.csv')
    expect(csvFileName('紐西蘭', '2030-02-01', '2030-02-05')).toBe('紐西蘭-2030-02-01_2030-02-05.csv')
    expect(csvFileName('***', null, '2030-02-05')).toBe('trip-_2030-02-05.csv')
  })
})

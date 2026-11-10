import type { ExpenseView, PoolContribution, Settlement } from '../../../shared/api/expenses.ts'
import { isCurrencyCode, minorUnitsOf } from '../../../shared/money/currencies.ts'

// The CSV export of the statistics page (e7-t06): UTF-8 with a byte-order mark and CRLF line ends,
// every field quoted, so Excel opens it straight away with the Chinese text intact. Amounts are
// plain decimals in the currency's own precision (no grouping, no symbol), so a spreadsheet can
// add them up. Text a person typed never starts a formula.

export const BOM = '﻿'
export const CRLF = '\r\n'

/** One field, quoted; inner quotes doubled */
export function csvField(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

/** Typed text that Excel would run as a formula (=, +, -, @, tab, CR) gets a leading apostrophe */
export function safeText(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

export const csvLine = (fields: readonly (string | number | null | undefined)[]): string =>
  fields.map(csvField).join(',')

/** The whole file: BOM, rows joined with CRLF, a CRLF after the last row */
export function buildCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return BOM + rows.map(csvLine).join(CRLF) + CRLF
}

/** Integer minor units as a plain decimal in the currency's precision: 4095 AUD → "40.95" */
export function decimal(minor: number, currency: string): string {
  const digits = isCurrencyCode(currency) ? minorUnitsOf(currency) : 2
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(minor))
  if (digits === 0) return `${sign}${abs}`
  const text = String(abs).padStart(digits + 1, '0')
  return `${sign}${text.slice(0, -digits)}.${text.slice(-digits)}`
}

/** What the export needs to put words to ids (already translated) */
export interface CsvLabels {
  header: {
    date: string
    category: string
    note: string
    payer: string
    amount: string
    currency: string
    fxRate: string
    baseAmount: string
    baseCurrency: string
    participants: string
    shares: string
    stopName: string
    receipt: string
  }
  category: (category: ExpenseView['category']) => string
  member: (id: string) => string
  pool: string
  hasReceipt: string
  stopName: (stopId: string) => string | null
}

export interface ExtraLabels {
  contributionsTitle: string
  settlementsTitle: string
  contributionHeader: {
    date: string
    member: string
    amount: string
    currency: string
    fxRate: string
    baseAmount: string
    baseCurrency: string
    note: string
  }
  settlementHeader: {
    date: string
    from: string
    to: string
    amount: string
    baseCurrency: string
    method: string
    note: string
  }
  method: (method: Settlement['method']) => string
}

type Row = (string | number | null)[]

/** The expense block: the header row, then one row per expense, oldest first */
export function expenseRows(
  expenses: readonly ExpenseView[],
  baseCurrency: string,
  labels: CsvLabels,
): Row[] {
  const h = labels.header
  const header: Row = [
    h.date,
    h.category,
    h.note,
    h.payer,
    h.amount,
    h.currency,
    h.fxRate,
    h.baseAmount,
    h.baseCurrency,
    h.participants,
    h.shares,
    h.stopName,
    h.receipt,
  ]
  const sorted = [...expenses].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  )
  return [
    header,
    ...sorted.map((expense): Row => [
      expense.date,
      labels.category(expense.category),
      safeText(expense.note),
      expense.pool || !expense.payerMemberId
        ? labels.pool
        : safeText(labels.member(expense.payerMemberId)),
      decimal(expense.amountMinor, expense.currency),
      expense.currency,
      String(expense.fxRate),
      decimal(expense.baseMinor, baseCurrency),
      baseCurrency,
      expense.shares.map((share) => safeText(labels.member(share.memberId))).join('; '),
      expense.shares
        .map(
          (share) =>
            `${safeText(labels.member(share.memberId))} ${decimal(share.shareMinor, baseCurrency)}`,
        )
        .join('; '),
      expense.stopId ? safeText(labels.stopName(expense.stopId) ?? '') : '',
      expense.receiptAttachmentId ? labels.hasReceipt : '',
    ]),
  ]
}

/** 「含公基金與結算」: a blank line, a title row and a header before each extra block */
export function extraRows(
  contributions: readonly PoolContribution[],
  settlements: readonly Settlement[],
  baseCurrency: string,
  labels: Pick<CsvLabels, 'member'> & ExtraLabels,
): Row[] {
  const c = labels.contributionHeader
  const s = labels.settlementHeader
  const live = <T extends { deletedAt: string | null; date: string }>(list: readonly T[]) =>
    list.filter((item) => !item.deletedAt).sort((a, b) => a.date.localeCompare(b.date))
  return [
    [],
    [labels.contributionsTitle],
    [c.date, c.member, c.amount, c.currency, c.fxRate, c.baseAmount, c.baseCurrency, c.note],
    ...live(contributions).map((row): Row => [
      row.date,
      safeText(labels.member(row.memberId)),
      decimal(row.amountMinor, row.currency),
      row.currency,
      String(row.fxRate),
      decimal(row.baseMinor, baseCurrency),
      baseCurrency,
      safeText(row.note),
    ]),
    [],
    [labels.settlementsTitle],
    [s.date, s.from, s.to, s.amount, s.baseCurrency, s.method, s.note],
    ...live(settlements).map((row): Row => [
      row.date,
      safeText(labels.member(row.fromMemberId)),
      safeText(labels.member(row.toMemberId)),
      decimal(row.amountMinor, baseCurrency),
      baseCurrency,
      labels.method(row.method),
      safeText(row.note),
    ]),
  ]
}

/** A file name without characters Windows refuses */
export function csvFileName(tripName: string, from: string | null, to: string | null): string {
  const printable = [...tripName].map((ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('')
  const name =
    printable
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'trip'
  const span = from || to ? `-${from ?? ''}_${to ?? ''}` : ''
  return `${name}${span}.csv`
}

/** Saves `text` as a file through a temporary link (the browser's download) */
export function downloadText(fileName: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

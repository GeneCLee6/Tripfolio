import styled from 'styled-components'
import type { EstimateLine, ShareEstimate } from '../../shared/api/share.ts'
import { formatMoney } from '../../shared/i18n/format.ts'
import type { Locale } from '../../shared/i18n/core.ts'
import { useT, type Translate } from '../../src/lib/i18n.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../src/styles/tokens.ts'

// 費用概算 (e8-t01b): the Worker's sums by category in the base currency, then one block per other
// currency (no exchange rates: an estimate, labelled as such). The whole section only exists when
// the share shows money; with hideMoney the payload has no estimate at all. When the trip has a
// budget (E9) the per-person row is the budget's (perPersonSource 'budget'), shown with the budget
// total under the item sums.

const Box = styled.div`
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${fontSize.sm}px;
  th,
  td {
    padding: ${space.sm}px ${space.lg}px;
    text-align: left;
    border-bottom: 1px solid ${color.line};
  }
  thead th {
    font-size: 12px;
    font-weight: ${fontWeight.medium};
    color: ${color.muted};
  }
  td:last-child,
  th:last-child {
    text-align: right;
  }
  td:last-child {
    font-family: ${font.mono};
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  tbody th {
    font-weight: ${fontWeight.regular};
  }
  tr.sum th,
  tr.sum td {
    font-weight: ${fontWeight.semibold};
  }
  tr.group th {
    text-align: left;
    padding-top: ${space.md}px;
    background: ${color.paper};
    font-size: 12px;
    color: ${color.muted};
  }
`

const Badge = styled.span`
  margin-left: ${space.sm}px;
  padding: 0 ${space.sm}px;
  border: 1px solid ${color.tussock};
  border-radius: ${radius.pill}px;
  background: ${color.tussockSoft};
  color: ${color.ink};
  font-size: 11px;
  font-weight: ${fontWeight.medium};
  vertical-align: middle;
`

const Note = styled.p`
  margin: ${space.sm}px 0 0;
  font-size: 12px;
  color: ${color.muted};
`

function Rows({
  lines,
  totalMinor,
  perPersonMinor,
  currency,
  people,
  t,
  locale,
}: {
  lines: readonly EstimateLine[]
  totalMinor: number
  /** Absent: no per-person row (the budget's is shown instead) */
  perPersonMinor?: number
  currency: string
  people: number
  t: Translate
  locale: Locale
}) {
  const money = (minor: number) => formatMoney(minor, currency, locale)
  return (
    <>
      {lines.map((line) => (
        <tr key={line.category}>
          <th scope="row">{t(`share.estimate.category.${line.category}`)}</th>
          <td>{money(line.minor)}</td>
        </tr>
      ))}
      <tr className="sum">
        <th scope="row">{t('share.estimate.total')}</th>
        <td>{money(totalMinor)}</td>
      </tr>
      {perPersonMinor !== undefined && (
        <tr className="sum">
          <th scope="row">{t.plural('share.estimate.perPerson', people)}</th>
          <td>{money(perPersonMinor)}</td>
        </tr>
      )}
    </>
  )
}

export function Estimate({ estimate, people }: { estimate: ShareEstimate; people: number }) {
  const t = useT()
  const locale = t.locale
  const count = Math.max(1, people)
  const fromBudget = estimate.perPersonSource === 'budget'
  const hasBase = estimate.totalMinor !== undefined
  const money = (minor: number) => formatMoney(minor, estimate.currency, locale)
  return (
    <section aria-labelledby="share-estimate" data-testid="share-estimate">
      <SectionHeading id="share-estimate">
        {t('share.estimate.heading')}
        <Badge>{t('share.estimate.badge')}</Badge>
      </SectionHeading>
      <Box>
        <Table>
          <thead>
            <tr>
              <th scope="col">{t('share.estimate.item')}</th>
              <th scope="col">{t('share.estimate.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {hasBase && (
              <Rows
                lines={estimate.breakdown}
                totalMinor={estimate.totalMinor ?? 0}
                perPersonMinor={fromBudget ? undefined : estimate.perPersonMinor}
                currency={estimate.currency}
                people={count}
                t={t}
                locale={locale}
              />
            )}
            {fromBudget && (
              <>
                {estimate.budgetTotalMinor !== undefined && (
                  <tr className="sum">
                    <th scope="row">{t('share.estimate.budgetTotal')}</th>
                    <td>{money(estimate.budgetTotalMinor)}</td>
                  </tr>
                )}
                <tr className="sum" data-testid="share-estimate-budget">
                  <th scope="row">{t.plural('share.estimate.perPersonBudget', count)}</th>
                  <td>{money(estimate.perPersonMinor ?? 0)}</td>
                </tr>
              </>
            )}
            {estimate.others.map((other) => [
              <tr key={`g${other.currency}`} className="group">
                <th scope="rowgroup" colSpan={2}>
                  {t('share.estimate.currency', { currency: other.currency })}
                </th>
              </tr>,
              <Rows
                key={`r${other.currency}`}
                lines={other.breakdown}
                totalMinor={other.totalMinor}
                perPersonMinor={other.perPersonMinor}
                currency={other.currency}
                people={count}
                t={t}
                locale={locale}
              />,
            ])}
          </tbody>
        </Table>
      </Box>
      <Note>{t(fromBudget ? 'share.estimate.noteBudget' : 'share.estimate.note')}</Note>
    </section>
  )
}

const SectionHeading = styled.h2`
  margin: 0 0 ${space.md}px;
  font-size: ${fontSize.lg}px;
`

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import { formatMoney } from '../../../shared/i18n/format.ts'
import '../../../shared/i18n/pages/stats.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { ButtonLink } from '../../components/ButtonLink.tsx'
import {
  BarList,
  Button,
  CategoryIcon,
  DateField,
  EmptyState,
  SegmentBar,
  SegmentedControl,
  Skeleton,
  Sparkline,
  useToast,
} from '../../components/index.ts'
import { itineraryApi } from '../../lib/api.ts'
import { balancesApi } from '../../lib/balances/api.ts'
import { METHOD_LABEL } from '../../lib/balances/view.ts'
import {
  expenseLogApi,
  expensesApi,
  onExpensesChanged,
  type SummaryBy,
} from '../../lib/expenses/api.ts'
import { secondaryMinor, todayIn } from '../../lib/expenses/form.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT, type Translate } from '../../lib/i18n.ts'
import { useApiErrorToast } from '../../lib/role.ts'
import {
  averageDays,
  categoryBars,
  fillDays,
  kpis,
  memberStats,
  rangeBounds,
  type Bounds,
  type Range,
} from '../../lib/stats/aggregate.ts'
import {
  buildCsv,
  csvFileName,
  downloadText,
  expenseRows,
  extraRows,
  type CsvLabels,
} from '../../lib/stats/csv.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, font, fontSize, fontWeight, media, radius, space } from '../../styles/tokens.ts'
import { categoryLabel } from '../expenses/labels.ts'
import { PageHeading, SectionTitle, Stack } from '../parts.tsx'
import { DayChart } from './DayChart.tsx'

// /trips/:id/expenses/stats (e7-t06): the key numbers (總花費、每人平均、每日平均, with the
// secondary currency), the budget card (E9 sets budgets; until then 「尚未設定預算」), then the
// spending by day, by category or by person, and the CSV export. Every total comes from
// GET /expenses/summary for the chosen period (the list page's quick ranges); the page never sums
// expenses itself, so its numbers always match the server's.

const Kpis = styled.dl`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: ${space.md}px;
  margin: 0;
`

const Tile = styled.div`
  display: grid;
  gap: 2px;
  align-content: start;
  padding: ${space.md}px ${space.lg}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  > dt {
    font-size: ${fontSize.sm}px;
    color: ${color.muted};
  }
  > dd {
    margin: 0;
  }
`

const Big = styled.dd`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-size: ${fontSize.lg}px;
  font-weight: ${fontWeight.medium};
  color: ${color.ink};
  @media ${media.tablet} {
    font-size: ${fontSize.xl}px;
  }
`

const Small = styled.dd`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const TileRow = styled.div`
  padding-top: ${space.xs}px;
`

const Panel = styled.section`
  display: grid;
  gap: ${space.md}px;
  padding: ${space.lg}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  min-width: 0;
`

const PanelTitle = styled.h2`
  margin: 0;
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.bold};
`

const Muted = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const BudgetTrack = styled.div`
  height: 10px;
  border-radius: ${radius.pill}px;
  background: color-mix(in srgb, ${color.line} 55%, transparent);
  opacity: 0.6;
`

const Filters = styled.div`
  display: grid;
  gap: ${space.sm}px;
  min-width: 0;
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: ${space.sm}px;
  min-width: 0;
  > * {
    min-width: 0;
  }
`

const ScrollRow = styled.div`
  display: flex;
  overflow-x: auto;
  padding: 2px;
`

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${fontSize.body}px;
  th,
  td {
    padding: ${space.sm}px ${space.xs}px;
    border-bottom: 1px solid ${color.line};
    text-align: right;
    white-space: nowrap;
  }
  th:first-child,
  td:first-child {
    text-align: left;
    white-space: normal;
  }
  thead th {
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.semibold};
    color: ${color.muted};
  }
  td {
    font-family: ${font.mono};
    font-variant-numeric: tabular-nums;
  }
  td:first-child {
    font-family: inherit;
  }
`

const TableScroll = styled.div`
  overflow-x: auto;
  min-width: 0;
`

const Check = styled.label`
  display: inline-flex;
  align-items: center;
  gap: ${space.sm}px;
  min-height: 40px;
  cursor: pointer;
  > input {
    width: 18px;
    height: 18px;
    accent-color: ${color.fjord};
    ${focusRing}
  }
`

type View = SummaryBy

function csvLabels(
  t: Translate,
  member: (id: string) => string,
  stopName: (id: string) => string | null,
): CsvLabels {
  return {
    header: {
      date: t('stats.csv.date'),
      category: t('stats.csv.category'),
      note: t('stats.csv.note'),
      payer: t('stats.csv.payer'),
      amount: t('stats.csv.amount'),
      currency: t('stats.csv.currency'),
      fxRate: t('stats.csv.fxRate'),
      baseAmount: t('stats.csv.baseAmount'),
      baseCurrency: t('stats.csv.baseCurrency'),
      participants: t('stats.csv.participants'),
      shares: t('stats.csv.shares'),
      stopName: t('stats.csv.stopName'),
      receipt: t('stats.csv.receipt'),
    },
    category: (category) => categoryLabel(t, category),
    member,
    pool: t('stats.csv.pool'),
    hasReceipt: t('stats.csv.receiptYes'),
    stopName,
  }
}

const inBounds = (date: string, bounds: Bounds) =>
  (!bounds.from || date >= bounds.from) && (!bounds.to || date <= bounds.to)

export default function StatsPage() {
  const t = useT()
  const { trip, members } = useTripContext()
  const toast = useToast()
  const showError = useApiErrorToast()

  const [range, setRange] = useState<Range>('all')
  const [custom, setCustom] = useState({ from: trip.startDate, to: trip.endDate })
  const [view, setView] = useState<View>('day')
  const [withExtras, setWithExtras] = useState(false)
  const [exporting, setExporting] = useState(false)

  const today = todayIn(trip.tz, Date.now())
  const bounds = rangeBounds(range, custom, trip, today)
  const rangeKey = `${bounds.from ?? ''}:${bounds.to ?? ''}`

  const byDay = useResource(`stats:${trip.id}:day:${rangeKey}`, (signal) =>
    expenseLogApi.summary(trip.id, 'day', bounds, signal),
  )
  const byView = useResource(`stats:${trip.id}:${view}:${rangeKey}`, (signal) =>
    view === 'day' ? Promise.resolve(null) : expenseLogApi.summary(trip.id, view, bounds, signal),
  )
  const reloadDay = byDay.reload
  const reloadView = byView.reload
  useEffect(
    () =>
      onExpensesChanged((tripId) => {
        if (tripId !== trip.id) return
        reloadDay()
        reloadView()
      }),
    [trip.id, reloadDay, reloadView],
  )

  const secondary =
    trip.secondaryCurrency && trip.secondaryCurrency !== trip.baseCurrency
      ? trip.secondaryCurrency
      : null
  const fx = useResource(`stats-fx:${trip.id}:${secondary ?? ''}`, (signal) =>
    secondary
      ? expensesApi.fx(trip.id, { quote: secondary }, signal).catch(() => null)
      : Promise.resolve(null),
  )
  const secondaryRate =
    fx.status === 'ready' && fx.data
      ? (fx.data.rates.find((rate) => rate.quote === secondary)?.rate ?? null)
      : null

  const base = trip.baseCurrency
  const money = (minor: number) => formatMoney(minor, base, t.locale)
  const approx = (minor: number) => {
    const other = secondary ? secondaryMinor(minor, base, secondary, secondaryRate) : null
    return other !== null && secondary
      ? t('stats.approx', { amount: formatMoney(other, secondary, t.locale) })
      : null
  }
  const memberName = (id: string) =>
    members.find((member) => member.id === id)?.name ?? t('expenses.removedMember')

  const days = useMemo(
    () => (byDay.status === 'ready' ? fillDays(byDay.data.rows, bounds, trip) : []),
    // bounds is rebuilt every render; its ends say when to fill again
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [byDay.status, byDay.data, rangeKey, trip.startDate, trip.endDate],
  )
  const totalMinor = byDay.status === 'ready' ? byDay.data.totalMinor : 0
  const dayCount = averageDays(days, today)
  const numbers = kpis(totalMinor, members.length, dayCount)
  // The trend stops at today: the days still ahead would only drag the line to zero
  const pastDays = days.filter((day) => day.date <= today)
  const trend = (pastDays.length > 1 ? pastDays : days).map((day) => day.baseMinor)
  const empty = byDay.status === 'ready' && byDay.data.rows.length === 0

  const exportCsv = async () => {
    setExporting(true)
    try {
      const query = { from: bounds.from ?? undefined, to: bounds.to ?? undefined }
      const [list, itinerary, pool, settlements] = await Promise.all([
        expensesApi.list(trip.id, query),
        itineraryApi.listDays(trip.id).catch(() => null),
        withExtras ? balancesApi.getPool(trip.id) : Promise.resolve(null),
        withExtras ? balancesApi.listSettlements(trip.id) : Promise.resolve(null),
      ])
      const stops = new Map<string, string>()
      for (const day of itinerary?.days ?? [])
        for (const stop of day.stops) stops.set(stop.id, stop.title)
      const labels = csvLabels(t, memberName, (id) => stops.get(id) ?? null)
      const rows = expenseRows(list.expenses, base, labels)
      if (pool && settlements)
        rows.push(
          ...extraRows(
            pool.contributions.filter((c) => inBounds(c.date, bounds)),
            settlements.settlements.filter((s) => inBounds(s.date, bounds)),
            base,
            {
              member: memberName,
              contributionsTitle: t('stats.csv.contributions'),
              settlementsTitle: t('stats.csv.settlements'),
              contributionHeader: {
                date: t('stats.csv.date'),
                member: t('stats.csv.member'),
                amount: t('stats.csv.amount'),
                currency: t('stats.csv.currency'),
                fxRate: t('stats.csv.fxRate'),
                baseAmount: t('stats.csv.baseAmount'),
                baseCurrency: t('stats.csv.baseCurrency'),
                note: t('stats.csv.note'),
              },
              settlementHeader: {
                date: t('stats.csv.date'),
                from: t('stats.csv.from'),
                to: t('stats.csv.to'),
                amount: t('stats.csv.amount'),
                baseCurrency: t('stats.csv.baseCurrency'),
                method: t('stats.csv.method'),
                note: t('stats.csv.note'),
              },
              method: (method) => t(METHOD_LABEL[method]),
            },
          ),
        )
      const file = csvFileName(trip.name, bounds.from, bounds.to)
      downloadText(file, buildCsv(rows))
      toast.show(t('stats.export.done', { file }))
    } catch (error) {
      showError(error)
    } finally {
      setExporting(false)
    }
  }

  const rangeOptions = [
    { value: 'all' as const, label: t('expenses.filter.all') },
    { value: 'today' as const, label: t('expenses.filter.today') },
    { value: 'trip' as const, label: t('expenses.filter.trip') },
    { value: 'custom' as const, label: t('expenses.filter.custom') },
  ]
  const viewOptions = [
    { value: 'day' as const, label: t('stats.view.day') },
    { value: 'category' as const, label: t('stats.view.category') },
    { value: 'member' as const, label: t('stats.view.member') },
  ]

  const kpi = (label: string, minor: number, hint?: string, extra?: ReactNode) => {
    const other = approx(minor)
    return (
      <Tile>
        <dt>{label}</dt>
        <Big>{money(minor)}</Big>
        {other && <Small>{other}</Small>}
        {hint && <Small>{hint}</Small>}
        {extra && <TileRow as="dd">{extra}</TileRow>}
      </Tile>
    )
  }

  const viewData = byView.status === 'ready' ? byView.data : null

  return (
    <Stack $gap="lg">
      <PageHeading
        title={t('stats.title')}
        lead={t('stats.lead', { currency: base })}
        actions={
          <Row>
            <ButtonLink to=".." relative="path" variant="secondary">
              {t('stats.back')}
            </ButtonLink>
            <ButtonLink to="../history" relative="path" variant="ghost">
              {t('history.link')}
            </ButtonLink>
          </Row>
        }
      />

      <Filters>
        <ScrollRow>
          <SegmentedControl
            size="sm"
            label={t('expenses.filter.range')}
            value={range}
            onChange={setRange}
            options={rangeOptions}
          />
        </ScrollRow>
        {range === 'custom' && (
          <Row>
            <DateField
              label={t('expenses.filter.from')}
              value={custom.from}
              onChange={(event) => setCustom((c) => ({ ...c, from: event.target.value }))}
            />
            <DateField
              label={t('expenses.filter.to')}
              value={custom.to}
              onChange={(event) => setCustom((c) => ({ ...c, to: event.target.value }))}
            />
          </Row>
        )}
      </Filters>

      {byDay.status === 'loading' && (
        <Stack $gap="sm" aria-busy="true">
          <Skeleton $height={88} />
          <Skeleton $height={200} />
        </Stack>
      )}
      {byDay.status === 'error' && (
        <EmptyState
          illustration="receipt"
          title={t('error.title')}
          body={t('error.network')}
          action={
            <Button variant="primary" onClick={reloadDay}>
              {t('error.retry')}
            </Button>
          }
        />
      )}

      {byDay.status === 'ready' && (
        <>
          <Kpis aria-label={t('stats.kpi.label')} data-kpis="">
            {kpi(t('stats.kpi.total'), numbers.totalMinor)}
            {kpi(
              t('stats.kpi.perPerson'),
              numbers.perPersonMinor,
              t('stats.kpi.perPersonHint', { people: t.plural('expenses.people', members.length) }),
            )}
            {kpi(
              t('stats.kpi.perDay'),
              numbers.perDayMinor,
              t('stats.kpi.perDayHint', { days: dayCount }),
              trend.length > 1 ? (
                <Sparkline values={trend} label={t('stats.kpi.trend')} />
              ) : null,
            )}
          </Kpis>

          <Panel aria-label={t('stats.budget.title')}>
            <PanelTitle>{t('stats.budget.title')}</PanelTitle>
            <BudgetTrack
              role="progressbar"
              aria-label={t('stats.budget.title')}
              aria-valuetext={t('stats.budget.none')}
              aria-disabled="true"
            />
            <Muted>
              <strong>{t('stats.budget.none')}</strong> · {t('stats.budget.hint')}
            </Muted>
          </Panel>

          {empty ? (
            <EmptyState
              illustration="receipt"
              title={t('stats.empty.title')}
              body={t('stats.empty.body')}
            />
          ) : (
            <Stack $gap="md">
              <ScrollRow>
                <SegmentedControl
                  label={t('stats.view.label')}
                  value={view}
                  onChange={setView}
                  options={viewOptions}
                />
              </ScrollRow>
              {view === 'day' && (
                <Panel>
                  <PanelTitle>{t('stats.day.chart')}</PanelTitle>
                  <DayChart
                    days={days}
                    totalMinor={totalMinor}
                    averageMinor={numbers.perDayMinor}
                    currency={base}
                  />
                </Panel>
              )}
              {view !== 'day' && byView.status === 'loading' && <Skeleton $height={200} />}
              {view === 'category' && viewData && (
                <Panel>
                  <PanelTitle>{t('stats.category.chart')}</PanelTitle>
                  <BarList
                    label={t('stats.category.chart')}
                    items={categoryBars(viewData.rows).map((bar) => ({
                      key: bar.category,
                      label: categoryLabel(t, bar.category),
                      icon: <CategoryIcon category={bar.category} size={28} />,
                      value: bar.baseMinor,
                      valueText: money(bar.baseMinor),
                      detail: t('stats.percent', { percent: bar.percent }),
                    }))}
                  />
                </Panel>
              )}
              {view === 'member' && viewData && (
                <MemberView rows={memberStats(viewData.rows, members)} money={money} t={t} />
              )}
            </Stack>
          )}

          <Panel aria-label={t('stats.export.title')}>
            <SectionTitle as="h2">{t('stats.export.title')}</SectionTitle>
            <Muted>{t('stats.export.body')}</Muted>
            <Row>
              <Check>
                <input
                  type="checkbox"
                  checked={withExtras}
                  onChange={(event) => setWithExtras(event.target.checked)}
                />
                {t('stats.export.withExtras')}
              </Check>
              <Button variant="primary" disabled={exporting} onClick={() => void exportCsv()}>
                {exporting ? t('stats.export.busy') : t('stats.export.button')}
              </Button>
            </Row>
          </Panel>
        </>
      )}
    </Stack>
  )
}

function MemberView({
  rows,
  money,
  t,
}: {
  rows: ReturnType<typeof memberStats>
  money: (minor: number) => string
  t: Translate
}) {
  const name = (row: (typeof rows)[number]) => row.name ?? t('expenses.removedMember')
  return (
    <Panel>
      <PanelTitle>{t('stats.member.table')}</PanelTitle>
      <SegmentBar
        label={t('stats.member.shareBar')}
        segments={rows.map((row) => ({
          key: row.memberId,
          label: name(row),
          value: row.shareMinor,
          colorIndex: row.colorIndex,
          detail: t('stats.percent', { percent: row.sharePercent }),
        }))}
      />
      <TableScroll>
        <Table>
          <thead>
            <tr>
              <th scope="col">{t('stats.member.name')}</th>
              <th scope="col">{t('stats.member.paid')}</th>
              <th scope="col">{t('stats.member.share')}</th>
              <th scope="col">{t('stats.member.diff')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.memberId} data-member={row.memberId}>
                <th scope="row">{name(row)}</th>
                <td data-paid={row.paidMinor}>{money(row.paidMinor)}</td>
                <td data-share={row.shareMinor}>{money(row.shareMinor)}</td>
                <td>{(row.diffMinor > 0 ? '+' : '') + money(row.diffMinor)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
      <Muted>{t('stats.member.note')}</Muted>
    </Panel>
  )
}

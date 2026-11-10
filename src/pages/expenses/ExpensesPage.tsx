import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import type { ExpenseView } from '../../../shared/api/expenses.ts'
import { formatDate, formatMoney } from '../../../shared/i18n/format.ts'
import '../../../shared/i18n/pages/expenses.ts'
import type { ExpenseCategory } from '../../../shared/schema/expense.ts'
import { useTripContext } from '../../app/trip-context.ts'
import {
  Button,
  Chip,
  DateField,
  Dialog,
  EmptyState,
  Input,
  SegmentedControl,
  Select,
  Skeleton,
  useToast,
} from '../../components/index.ts'
import { PlusIcon } from '../../components/icons.tsx'
import { ButtonLink } from '../../components/ButtonLink.tsx'
import { itineraryApi } from '../../lib/api.ts'
import { expensesApi, onExpensesChanged, type ExpenseQuery } from '../../lib/expenses/api.ts'
import {
  CATEGORIES,
  filterExpenses,
  groupByDate,
  todayIn,
  type ExpenseFilter,
} from '../../lib/expenses/form.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import {
  color,
  font,
  fontSize,
  fontWeight,
  media,
  radius,
  space,
  zIndex,
} from '../../styles/tokens.ts'
import { PageHeading, Stack } from '../parts.tsx'
import { ExpenseFormSheet } from './ExpenseFormSheet.tsx'
import { ExpenseRow } from './ExpenseRow.tsx'
import { ExpenseHistorySheet } from './history/ExpenseHistorySheet.tsx'
import { categoryLabel, type RowMoney } from './labels.ts'
import { useUndoBar } from './UndoBar.tsx'

// /trips/:id/expenses (e7-t08, DESIGN.md §4 記帳, mockup Screen 4 right panel): filters, then the
// expenses grouped by date under sticky headers with each day's total. A row shows the category,
// the note, who paid and who shares, the amount as recorded with the base (and secondary) currency
// under it, a paperclip for a receipt and the linked stop. Tap to edit; long-press to delete.
// The whole list is loaded once and filtered here; from 500 rows on, the server filters.

const SERVER_FILTER_FROM = 500
const TOP_BAR = 56

type Range = 'all' | 'today' | 'trip' | 'custom'

const Filters = styled.div`
  display: grid;
  gap: ${space.sm}px;
  min-width: 0;
`

const FilterRow = styled.div`
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
  gap: ${space.xs + 2}px;
  overflow-x: auto;
  padding: 2px;
  scrollbar-width: thin;
`

const Grow = styled.div`
  flex: 1 1 140px;
`

const AddOnWide = styled.div`
  display: none;
  @media ${media.tablet} {
    display: block;
  }
`

const DayList = styled.div`
  display: grid;
  gap: ${space.lg}px;
`

const DayHead = styled.h2`
  position: sticky;
  top: ${TOP_BAR}px;
  z-index: ${zIndex.sticky - 1};
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: ${space.sm}px;
  margin: 0 -${space.xs}px;
  padding: ${space.sm}px ${space.xs}px;
  background: ${color.paper};
  border-bottom: 1px solid ${color.line};
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
  > span:last-child {
    font-family: ${font.mono};
    font-weight: ${fontWeight.medium};
    color: ${color.muted};
  }
`

const Rows = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Card = styled.div`
  padding: 0 ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

function rangeBounds(
  range: Range,
  custom: { from: string; to: string },
  trip: { startDate: string; endDate: string; tz: string },
) {
  if (range === 'today') {
    const today = todayIn(trip.tz, Date.now())
    return { from: today, to: today }
  }
  if (range === 'trip') return { from: trip.startDate, to: trip.endDate }
  if (range === 'custom') return { from: custom.from || null, to: custom.to || null }
  return { from: null, to: null }
}

export default function ExpensesPage() {
  const t = useT()
  const { trip, members } = useTripContext()
  const can = useCan()
  const canEdit = can('editContent')
  const toast = useToast()
  const showError = useApiErrorToast()
  const [bar, showUndo] = useUndoBar()

  const [range, setRange] = useState<Range>('all')
  const [custom, setCustom] = useState({ from: trip.startDate, to: trip.endDate })
  const [category, setCategory] = useState<ExpenseCategory | null>(null)
  const [memberId, setMemberId] = useState<string>('')
  const [q, setQ] = useState('')
  const [serverMode, setServerMode] = useState(false)

  const bounds = rangeBounds(range, custom, trip)
  const filter: ExpenseFilter = { ...bounds, category, memberId: memberId || null, q }
  const query: ExpenseQuery = serverMode
    ? {
        from: bounds.from ?? undefined,
        to: bounds.to ?? undefined,
        category: category ?? undefined,
        memberId: memberId || undefined,
        q: q.trim() || undefined,
      }
    : {}
  const list = useResource(`expenses:${trip.id}:${JSON.stringify(query)}`, (signal) =>
    expensesApi.list(trip.id, query, signal),
  )
  const { reload } = list
  useEffect(() => onExpensesChanged((tripId) => tripId === trip.id && reload()), [trip.id, reload])
  const loaded = list.status === 'ready' ? list.data.expenses : null
  useEffect(() => {
    if (!serverMode && loaded && loaded.length >= SERVER_FILTER_FROM) setServerMode(true)
  }, [serverMode, loaded])

  // The secondary currency's rate, for the 「≈ NT$」 part of each row
  const secondary =
    trip.secondaryCurrency && trip.secondaryCurrency !== trip.baseCurrency
      ? trip.secondaryCurrency
      : null
  const fx = useResource(`expenses-fx:${trip.id}:${secondary ?? ''}`, (signal) =>
    secondary ? expensesApi.fx(trip.id, { quote: secondary }, signal) : Promise.resolve(null),
  )
  const money: RowMoney = {
    baseCurrency: trip.baseCurrency,
    secondaryCurrency: secondary,
    secondaryRate:
      fx.status === 'ready' && fx.data
        ? (fx.data.rates.find((r) => r.quote === secondary)?.rate ?? null)
        : null,
  }

  // Stop names for linked rows (only fetched when a row links one)
  const linksStops = Boolean(loaded?.some((expense) => expense.stopId))
  const days = useResource(`expenses-days:${trip.id}:${linksStops}`, (signal) =>
    linksStops ? itineraryApi.listDays(trip.id, signal) : Promise.resolve(null),
  )
  const stopNames = useMemo(() => {
    const names = new Map<string, string>()
    if (days.status === 'ready' && days.data)
      for (const day of days.data.days) for (const stop of day.stops) names.set(stop.id, stop.title)
    return names
  }, [days.status, days.data])

  const shown = useMemo(
    () => (loaded ? filterExpenses(loaded, filter, (c) => categoryLabel(t, c)) : []),
    // `filter` is rebuilt every render; its parts say when to filter again
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [loaded, bounds.from, bounds.to, category, memberId, q, t],
  )
  const groups = useMemo(() => groupByDate(shown), [shown])

  const [sheet, setSheet] = useState<{ open: boolean; expense: ExpenseView | null }>({
    open: false,
    expense: null,
  })
  const [confirm, setConfirm] = useState<ExpenseView | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)

  const remove = async (expense: ExpenseView) => {
    setConfirm(null)
    try {
      await expensesApi.remove(trip.id, expense.id)
      reload()
      showUndo({
        message: t('expenses.deleted'),
        undo: () => {
          expensesApi.restore(trip.id, expense.id).then(() => {
            reload()
            toast.show(t('expenses.undone'))
          }, showError)
        },
      })
    } catch (error) {
      showError(error)
    }
  }

  const rangeOptions = [
    { value: 'all' as const, label: t('expenses.filter.all') },
    { value: 'today' as const, label: t('expenses.filter.today') },
    { value: 'trip' as const, label: t('expenses.filter.trip') },
    { value: 'custom' as const, label: t('expenses.filter.custom') },
  ]
  const nothingYet = loaded !== null && loaded.length === 0 && !serverMode

  return (
    <Stack $gap="lg">
      <PageHeading
        title={t('expenses.title')}
        lead={loaded ? t.plural('expenses.count', shown.length) : undefined}
        actions={
          <>
            <ButtonLink to="balances" variant="secondary">
              {t('expenses.balancesLink')}
            </ButtonLink>
            <ButtonLink to="stats" variant="secondary">
              {t('stats.link')}
            </ButtonLink>
            <ButtonLink to="history" variant="ghost">
              {t('history.link')}
            </ButtonLink>
            {canEdit ? (
              <AddOnWide>
                <Button variant="primary" onClick={() => setSheet({ open: true, expense: null })}>
                  <PlusIcon size={16} />
                  {t('term.logExpense')}
                </Button>
              </AddOnWide>
            ) : null}
          </>
        }
      />

      {!nothingYet && (
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
            <FilterRow>
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
            </FilterRow>
          )}
          <ScrollRow role="group" aria-label={t('expenses.filter.categories')}>
            {CATEGORIES.map((value) => (
              <Chip
                key={value}
                tone="fjord"
                selected={category === value}
                onClick={() => setCategory((current) => (current === value ? null : value))}
              >
                {categoryLabel(t, value)}
              </Chip>
            ))}
          </ScrollRow>
          <FilterRow>
            <Grow>
              <Input
                type="search"
                label={t('expenses.filter.search')}
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
            </Grow>
            <Grow>
              <Select
                label={t('expenses.filter.member')}
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
              >
                <option value="">{t('expenses.filter.everyone')}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </Grow>
          </FilterRow>
        </Filters>
      )}

      {list.status === 'loading' && (
        <Stack $gap="sm" aria-busy="true">
          <Skeleton $height={56} />
          <Skeleton $height={56} />
          <Skeleton $height={56} />
        </Stack>
      )}
      {list.status === 'error' && (
        <EmptyState
          illustration="receipt"
          title={t('error.title')}
          body={t('error.network')}
          action={
            <Button variant="primary" onClick={reload}>
              {t('error.retry')}
            </Button>
          }
        />
      )}
      {nothingYet && (
        <EmptyState
          illustration="receipt"
          title={t('expenses.empty.title')}
          body={t('expenses.empty.body')}
          action={
            canEdit ? (
              <Button variant="primary" onClick={() => setSheet({ open: true, expense: null })}>
                {t('term.logExpense')}
              </Button>
            ) : undefined
          }
        />
      )}
      {loaded && !nothingYet && groups.length === 0 && (
        <EmptyState
          illustration="receipt"
          title={t('expenses.noMatch.title')}
          body={t('expenses.noMatch.body')}
        />
      )}
      {groups.length > 0 && (
        <DayList>
          {groups.map((day) => (
            <section key={day.date} aria-label={formatDate(day.date, t.locale)}>
              <DayHead>
                <span>{formatDate(day.date, t.locale)}</span>
                <span>
                  {t('expenses.dayTotal', {
                    amount: formatMoney(day.totalBaseMinor, trip.baseCurrency, t.locale),
                  })}
                </span>
              </DayHead>
              <Card>
                <Rows>
                  {day.expenses.map((expense) => (
                    <li key={expense.id}>
                      <ExpenseRow
                        expense={expense}
                        members={members}
                        money={money}
                        stopName={expense.stopId ? stopNames.get(expense.stopId) : null}
                        onOpen={canEdit ? () => setSheet({ open: true, expense }) : undefined}
                        onDelete={canEdit ? () => setConfirm(expense) : undefined}
                      />
                    </li>
                  ))}
                </Rows>
              </Card>
            </section>
          ))}
        </DayList>
      )}

      {canEdit && (
        <ExpenseFormSheet
          open={sheet.open}
          expense={sheet.expense}
          onClose={() => setSheet((current) => ({ ...current, open: false }))}
          onDelete={(expense) => {
            setSheet((current) => ({ ...current, open: false }))
            setConfirm(expense)
          }}
        />
      )}
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t('expenses.deleteTitle')}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setHistoryFor(confirm?.id ?? null)
                setConfirm(null)
              }}
            >
              {t('history.sheet.open')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => confirm && void remove(confirm)}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        {t('expenses.deleteBody')}
      </Dialog>
      <ExpenseHistorySheet
        open={historyFor !== null}
        expenseId={historyFor}
        onClose={() => setHistoryFor(null)}
      />
      {bar}
    </Stack>
  )
}

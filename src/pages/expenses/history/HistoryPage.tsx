import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { ExpenseView, HistoryEntity, HistoryEntry } from '../../../../shared/api/expenses.ts'
import { formatDate, formatMoney, formatTime } from '../../../../shared/i18n/format.ts'
import '../../../../shared/i18n/pages/history.ts'
import { useTripContext } from '../../../app/trip-context.ts'
import { ButtonLink } from '../../../components/ButtonLink.tsx'
import {
  Button,
  CategoryIcon,
  EmptyState,
  SegmentedControl,
  Skeleton,
  useToast,
} from '../../../components/index.ts'
import { expenseLogApi, onExpensesChanged } from '../../../lib/expenses/api.ts'
import { useResource } from '../../../lib/hooks.ts'
import { useT } from '../../../lib/i18n.ts'
import { useApiErrorToast, useCan } from '../../../lib/role.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../../styles/tokens.ts'
import { Count, PageHeading, SectionTitle, Stack } from '../../parts.tsx'
import { categoryLabel } from '../labels.ts'
import {
  ACTION_LABEL,
  diffLines,
  diffText,
  ENTITY_LABEL,
  entityAmount,
  entityName,
  groupHistoryByDay,
  type DiffContext,
} from './diff.ts'
import { ExpenseHistorySheet } from './ExpenseHistorySheet.tsx'

// /trips/:id/expenses/history (e7-t07): the trip's money log (GET /expense-history, newest first)
// grouped by day — who, when, what (建立／修改／刪除／還原), on which expense, contribution or
// settlement, and the changed fields — plus the deleted expenses with 「取消刪除」. An expense's
// versions open in ExpenseHistorySheet, where an earlier one can be brought back.

const LOG_LIMIT = 500

type Filter = 'all' | HistoryEntity

const Day = styled.section`
  display: grid;
  gap: ${space.sm}px;
`

const DayHead = styled.h2`
  margin: 0;
  padding-bottom: ${space.xs}px;
  border-bottom: 1px solid ${color.line};
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
  color: ${color.muted};
`

const Rows = styled.ul`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Row = styled.li`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: ${space.xs}px ${space.md}px;
  padding: ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

const Main = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
`

const Title = styled.span`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: ${space.xs}px ${space.sm}px;
  font-weight: ${fontWeight.semibold};
  overflow-wrap: anywhere;
`

const Action = styled.span<{ $tone: 'create' | 'update' | 'delete' | 'restore' }>`
  padding: 0 ${space.sm}px;
  border-radius: ${radius.pill}px;
  font-size: ${fontSize.sm - 1}px;
  font-weight: ${fontWeight.semibold};
  background: ${({ $tone }) =>
    $tone === 'delete' ? color.tussockSoft : $tone === 'create' ? color.glacier : color.paper};
  color: ${color.ink};
  border: 1px solid ${color.line};
`

const Meta = styled.span`
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const Changes = styled.ul`
  display: grid;
  gap: 2px;
  margin: ${space.xs}px 0 0;
  padding: 0 0 0 ${space.lg}px;
  font-size: ${fontSize.sm}px;
`

const Side = styled.div`
  display: grid;
  justify-items: end;
  align-content: start;
  gap: ${space.xs}px;
`

const Amount = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const DeletedRow = styled.li`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: ${space.md}px;
  padding: ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

const Buttons = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: ${space.xs}px;
`

export default function HistoryPage() {
  const t = useT()
  const { trip, members } = useTripContext()
  const can = useCan()
  const canEdit = can('editContent')
  const toast = useToast()
  const showError = useApiErrorToast()
  const [filter, setFilter] = useState<Filter>('all')
  const [sheetFor, setSheetFor] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const log = useResource(`money-log:${trip.id}:${filter}`, (signal) =>
    expenseLogApi.tripHistory(
      trip.id,
      { entity: filter === 'all' ? undefined : filter, limit: LOG_LIMIT },
      signal,
    ),
  )
  const deleted = useResource(`expenses-deleted:${trip.id}`, (signal) =>
    expenseLogApi.listDeleted(trip.id, signal),
  )
  const reloadLog = log.reload
  const reloadDeleted = deleted.reload
  useEffect(
    () =>
      onExpensesChanged((tripId) => {
        if (tripId !== trip.id) return
        reloadLog()
        reloadDeleted()
      }),
    [trip.id, reloadLog, reloadDeleted],
  )

  const ctx: DiffContext = {
    t,
    baseCurrency: trip.baseCurrency,
    member: (id) => members.find((m) => m.id === id)?.name ?? t('expenses.removedMember'),
  }
  const time = (at: string) => formatTime(new Date(at), t.locale, { timeZone: trip.tz })

  const undelete = async (expense: ExpenseView) => {
    setBusy(expense.id)
    try {
      await expenseLogApi.undelete(trip.id, expense.id)
      toast.show(t('history.undeleted'))
    } catch (error) {
      showError(error)
    } finally {
      setBusy(null)
    }
  }

  const filterOptions = [
    { value: 'all' as const, label: t('history.filter.all') },
    { value: 'expense' as const, label: t(ENTITY_LABEL.expense) },
    { value: 'pool' as const, label: t(ENTITY_LABEL.pool) },
    { value: 'settlement' as const, label: t(ENTITY_LABEL.settlement) },
  ]
  const days = log.status === 'ready' ? groupHistoryByDay(log.data.history, trip.tz) : []
  const deletedList = deleted.status === 'ready' ? deleted.data.expenses : []

  const nameOf = (expense: ExpenseView) => expense.note.trim() || categoryLabel(t, expense.category)

  const versionsButton = (entry: Pick<HistoryEntry, 'entityId'>, name: string) => (
    <Button
      size="sm"
      variant="ghost"
      aria-label={t('history.versionsLabel', { name })}
      onClick={() => setSheetFor(entry.entityId)}
    >
      {t('history.versions')}
    </Button>
  )

  return (
    <Stack $gap="lg">
      <PageHeading
        title={t('history.title')}
        lead={t('history.lead')}
        actions={
          <ButtonLink to=".." relative="path" variant="secondary">
            {t('stats.back')}
          </ButtonLink>
        }
      />

      <div>
        <SegmentedControl
          size="sm"
          label={t('history.filter.label')}
          value={filter}
          onChange={setFilter}
          options={filterOptions}
        />
      </div>

      {log.status === 'loading' && (
        <Stack $gap="sm" aria-busy="true">
          <Skeleton $height={64} />
          <Skeleton $height={64} />
        </Stack>
      )}
      {log.status === 'error' && (
        <EmptyState
          illustration="receipt"
          title={t('error.title')}
          body={t('error.network')}
          action={
            <Button variant="primary" onClick={reloadLog}>
              {t('error.retry')}
            </Button>
          }
        />
      )}
      {log.status === 'ready' && days.length === 0 && (
        <EmptyState
          illustration="receipt"
          title={t('history.empty.title')}
          body={t('history.empty.body')}
        />
      )}
      {days.map((day) => (
        <Day key={day.date} aria-label={formatDate(day.date, t.locale)}>
          <DayHead>{formatDate(day.date, t.locale)}</DayHead>
          <Rows>
            {day.entries.map((entry) => {
              const name = entityName(entry, ctx)
              const amount = entityAmount(entry, ctx)
              const lines = diffLines(entry, ctx)
              return (
                <Row key={entry.id} data-history-id={entry.id} data-action={entry.action}>
                  <Main>
                    <Title>
                      <Action $tone={entry.action}>{t(ACTION_LABEL[entry.action])}</Action>
                      <span>{name}</span>
                    </Title>
                    <Meta>
                      {t(ENTITY_LABEL[entry.entity])} ·{' '}
                      {t('history.who', { name: ctx.member(entry.memberId), time: time(entry.at) })}
                    </Meta>
                    {lines.length > 0 && (
                      <Changes>
                        {lines.map((line) => (
                          <li key={line.field}>{diffText(t, line)}</li>
                        ))}
                      </Changes>
                    )}
                  </Main>
                  <Side>
                    {amount && <Amount>{amount}</Amount>}
                    {entry.entity === 'expense' && versionsButton(entry, name)}
                  </Side>
                </Row>
              )
            })}
          </Rows>
        </Day>
      ))}

      <Stack $gap="md" as="section" aria-label={t('history.deleted.title')}>
        <SectionTitle>
          {t('history.deleted.title')}
          <Count>{deletedList.length}</Count>
        </SectionTitle>
        {deleted.status === 'ready' && deletedList.length === 0 && (
          <Meta>{t('history.deleted.empty')}</Meta>
        )}
        {deletedList.length > 0 && (
          <Rows>
            {deletedList.map((expense) => {
              const name = nameOf(expense)
              return (
                <DeletedRow key={expense.id} data-deleted-id={expense.id}>
                  <CategoryIcon category={expense.category} size={32} />
                  <Main>
                    <Title>{name}</Title>
                    <Meta>
                      {formatDate(expense.date, t.locale)}
                      {expense.deletedAt
                        ? ` · ${t('history.deleted.at', { time: time(expense.deletedAt) })}`
                        : ''}
                    </Meta>
                  </Main>
                  <Side>
                    <Amount>{formatMoney(expense.amountMinor, expense.currency, t.locale)}</Amount>
                    <Buttons>
                      {versionsButton({ entityId: expense.id }, name)}
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy === expense.id}
                          aria-label={t('history.undeleteLabel', { name })}
                          onClick={() => void undelete(expense)}
                        >
                          {t('history.undelete')}
                        </Button>
                      )}
                    </Buttons>
                  </Side>
                </DeletedRow>
              )
            })}
          </Rows>
        )}
      </Stack>

      <ExpenseHistorySheet
        open={sheetFor !== null}
        expenseId={sheetFor}
        onClose={() => setSheetFor(null)}
      />
    </Stack>
  )
}

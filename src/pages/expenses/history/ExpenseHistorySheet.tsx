import { useState } from 'react'
import styled from 'styled-components'
import type { HistoryEntry } from '../../../../shared/api/expenses.ts'
import { formatDate, formatTime } from '../../../../shared/i18n/format.ts'
import { useTripContext } from '../../../app/trip-context.ts'
import { Button, Dialog, Sheet, Skeleton, useToast } from '../../../components/index.ts'
import { expenseLogApi } from '../../../lib/expenses/api.ts'
import { todayIn } from '../../../lib/expenses/form.ts'
import { useResource } from '../../../lib/hooks.ts'
import { useT } from '../../../lib/i18n.ts'
import { useApiErrorToast, useCan } from '../../../lib/role.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../../styles/tokens.ts'
import {
  ACTION_LABEL,
  diffLines,
  diffText,
  entityAmount,
  restorable,
  type DiffContext,
} from './diff.ts'

// Every version of one expense (e7-t07), newest first, each with who changed it, when, and what
// changed. Editors can bring back any earlier version after confirming (POST …/restore
// { historyId }); the restore itself becomes a new version.

const List = styled.ol`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Version = styled.li<{ $current: boolean }>`
  display: grid;
  gap: ${space.xs}px;
  padding: ${space.md}px;
  border: 1px solid ${({ $current }) => ($current ? color.fjord : color.line)};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: ${space.xs}px ${space.sm}px;
  font-weight: ${fontWeight.semibold};
`

const Amount = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
`

const Meta = styled.span`
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const Changes = styled.ul`
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0 0 0 ${space.lg}px;
  font-size: ${fontSize.sm}px;
`

const Badge = styled.span`
  font-size: ${fontSize.sm - 1}px;
  font-weight: ${fontWeight.semibold};
  color: ${color.fjord};
`

export interface ExpenseHistorySheetProps {
  open: boolean
  /** The expense whose versions to show (null: nothing) */
  expenseId: string | null
  onClose: () => void
  /** After a restore, so the caller can load again */
  onRestored?: () => void
}

export function ExpenseHistorySheet({ open, expenseId, onClose, onRestored }: ExpenseHistorySheetProps) {
  const t = useT()
  const { trip, members } = useTripContext()
  const can = useCan()
  const canEdit = can('editContent')
  const toast = useToast()
  const showError = useApiErrorToast()
  const [confirm, setConfirm] = useState<{ entry: HistoryEntry; n: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const history = useResource(`expense-history:${trip.id}:${open ? expenseId : ''}`, (signal) =>
    open && expenseId
      ? expenseLogApi.history(trip.id, expenseId, signal)
      : Promise.resolve({ history: [] }),
  )

  const ctx: DiffContext = {
    t,
    baseCurrency: trip.baseCurrency,
    member: (id) => members.find((m) => m.id === id)?.name ?? t('expenses.removedMember'),
  }
  const when = (at: string) => {
    const ms = Date.parse(at)
    return `${formatDate(todayIn(trip.tz, ms), t.locale)} ${formatTime(new Date(ms), t.locale, {
      timeZone: trip.tz,
    })}`
  }

  const entries = history.status === 'ready' ? history.data.history : []
  // Oldest first from the API: version n is index n − 1; shown newest first
  const versions = entries.map((entry, index) => ({ entry, n: index + 1 })).reverse()

  const restore = async () => {
    if (!confirm || !expenseId) return
    setBusy(true)
    try {
      await expenseLogApi.restoreVersion(trip.id, expenseId, confirm.entry.id)
      toast.show(t('history.restored', { n: confirm.n }))
      setConfirm(null)
      history.reload()
      onRestored?.()
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title={t('history.sheet.title')}>
        {history.status === 'loading' && (
          <List aria-busy="true">
            <Skeleton $height={64} />
            <Skeleton $height={64} />
          </List>
        )}
        {history.status === 'ready' && versions.length === 0 && <Meta>{t('history.sheet.empty')}</Meta>}
        {versions.length > 0 && (
          <List aria-label={t('history.sheet.title')}>
            {versions.map(({ entry, n }, index) => {
              const current = index === 0
              const lines = diffLines(entry, ctx)
              const amount = entityAmount(entry, ctx)
              return (
                <Version key={entry.id} $current={current} data-version={n}>
                  <Head>
                    <span>
                      {t('history.sheet.version', { n })} · {t(ACTION_LABEL[entry.action])}
                    </span>
                    {amount && <Amount>{amount}</Amount>}
                  </Head>
                  <Meta>{t('history.who', { name: ctx.member(entry.memberId), time: when(entry.at) })}</Meta>
                  {lines.length > 0 && (
                    <Changes>
                      {lines.map((line) => (
                        <li key={line.field}>{diffText(t, line)}</li>
                      ))}
                    </Changes>
                  )}
                  {current ? (
                    <Badge>{t('history.sheet.current')}</Badge>
                  ) : canEdit && restorable(entry) ? (
                    <div>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={t('history.sheet.restoreLabel', { n })}
                        onClick={() => setConfirm({ entry, n })}
                      >
                        {t('history.sheet.restore')}
                      </Button>
                    </div>
                  ) : null}
                </Version>
              )
            })}
          </List>
        )}
      </Sheet>
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm ? t('history.sheet.confirmTitle', { n: confirm.n }) : ''}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void restore()}>
              {t('history.sheet.restore')}
            </Button>
          </>
        }
      >
        {confirm
          ? t('history.sheet.confirmBody', {
              when: when(confirm.entry.at),
              amount: entityAmount(confirm.entry, ctx) ?? '',
            })
          : null}
      </Dialog>
    </>
  )
}

export default ExpenseHistorySheet

import styled from 'styled-components'
import type { BalanceRow, PoolContribution, PoolRefundMode } from '../../../shared/api/expenses.ts'
import { formatDate, formatMoney } from '../../../shared/i18n/format.ts'
import { poolRefundModes } from '../../../shared/schema/expense.ts'
import { Avatar, Button, PoolCard, SegmentedControl } from '../../components/index.ts'
import {
  personFor,
  poolShares,
  REFUND_LABEL,
  signedMoney,
  type Person,
} from '../../lib/balances/view.ts'
import { useT } from '../../lib/i18n.ts'
import { color, font, fontSize, fontWeight, space } from '../../styles/tokens.ts'

// The shared pool (e7-t04) inside the balances page: its balance, who put in what (add / edit /
// delete for editors), how the leftover is refunded (by contribution or equally, PATCH
// /pool/settings) and what each contributor gets back, which is already part of the balances.

const Sub = styled.h4`
  margin: 0;
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
`

const List = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Item = styled.li`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.sm}px ${space.md - 2}px;
  padding: ${space.sm}px 0;
  border-top: 1px solid ${color.line};
  &:first-child {
    border-top: 0;
  }
`

const Who = styled.span`
  display: grid;
  flex: 1;
  min-width: 10ch;
  overflow-wrap: anywhere;
`

const Muted = styled.span`
  font-size: ${fontSize.sm - 1}px;
  color: ${color.muted};
`

const Money = styled.span`
  display: grid;
  justify-items: end;
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const Actions = styled.span`
  display: inline-flex;
  gap: ${space.xs}px;
`

const Group = styled.div`
  display: grid;
  gap: ${space.sm}px;
`

const Hint = styled.p`
  margin: 0;
  font-size: ${fontSize.sm - 1}px;
  color: ${color.muted};
`

export function PoolSection({
  contributions,
  rows,
  poolBalanceMinor,
  refundMode,
  baseCurrency,
  people,
  editable,
  onAdd,
  onEdit,
  onDelete,
  onRefundMode,
}: {
  contributions: readonly PoolContribution[]
  rows: readonly BalanceRow[]
  poolBalanceMinor: number
  refundMode: PoolRefundMode
  baseCurrency: string
  people: Map<string, Person>
  editable: boolean
  onAdd: () => void
  onEdit: (contribution: PoolContribution) => void
  onDelete: (contribution: PoolContribution) => void
  onRefundMode: (mode: PoolRefundMode) => void
}) {
  const t = useT()
  const money = (minor: number, currency = baseCurrency) => formatMoney(minor, currency, t.locale)
  const nameOf = (person: Person) => person.name ?? t('balances.removedMember')
  const inTotal = contributions.reduce((sum, item) => sum + item.baseMinor, 0)
  const spent = inTotal - poolBalanceMinor
  const shares = poolShares(rows)
  const summary =
    poolBalanceMinor < 0
      ? `${t('balances.pool.summary', { in: money(inTotal), out: money(spent) })} · ${t('balances.pool.overdrawn')}`
      : t('balances.pool.summary', { in: money(inTotal), out: money(spent) })

  return (
    <PoolCard
      title={t('balances.pool.title')}
      balance={
        poolBalanceMinor < 0
          ? signedMoney(poolBalanceMinor, baseCurrency, t.locale)
          : money(poolBalanceMinor)
      }
      negative={poolBalanceMinor < 0}
      summary={summary}
    >
      <Group>
        <Sub>{t('balances.pool.contributions')}</Sub>
        {contributions.length === 0 ? (
          <Muted>{t('balances.pool.noContributions')}</Muted>
        ) : (
          <List aria-label={t('balances.pool.contributions')}>
            {contributions.map((item) => {
              const person = personFor(people, item.memberId)
              const name = nameOf(person)
              return (
                <Item key={item.id}>
                  <Avatar name={name} colorIndex={person.colorIndex} size="sm" />
                  <Who>
                    <span>{name}</span>
                    <Muted>
                      {formatDate(item.date, t.locale)}
                      {item.note ? ` · ${item.note}` : ''}
                    </Muted>
                  </Who>
                  <Money>
                    <span>{money(item.amountMinor, item.currency)}</span>
                    {item.currency !== baseCurrency && (
                      <Muted>{t('balances.approx', { amount: money(item.baseMinor) })}</Muted>
                    )}
                  </Money>
                  {editable && (
                    <Actions>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('balances.pool.editLabel', { name })}
                        onClick={() => onEdit(item)}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('balances.pool.deleteLabel', { name })}
                        onClick={() => onDelete(item)}
                      >
                        {t('common.delete')}
                      </Button>
                    </Actions>
                  )}
                </Item>
              )
            })}
          </List>
        )}
        {editable && (
          <div>
            <Button size="sm" onClick={onAdd}>
              {t('balances.pool.add')}
            </Button>
          </div>
        )}
      </Group>

      <Group>
        <Sub>{t('balances.pool.refund.label')}</Sub>
        {editable ? (
          <SegmentedControl
            size="sm"
            label={t('balances.pool.refund.label')}
            options={poolRefundModes.map((value) => ({ value, label: t(REFUND_LABEL[value]) }))}
            value={refundMode}
            onChange={(mode) => {
              if (mode !== refundMode) onRefundMode(mode)
            }}
          />
        ) : (
          <Muted>{t(REFUND_LABEL[refundMode])}</Muted>
        )}
        <Hint>
          {refundMode === 'proportional'
            ? t('balances.pool.refund.hintProportional')
            : t('balances.pool.refund.hintEqual')}
        </Hint>
      </Group>

      {shares.length > 0 && (
        <Group>
          <Sub>{t('balances.pool.refunds')}</Sub>
          <List aria-label={t('balances.pool.refunds')}>
            {shares.map((share) => {
              const person = personFor(people, share.memberId)
              const name = nameOf(person)
              return (
                <Item key={share.memberId}>
                  <Avatar name={name} colorIndex={person.colorIndex} size="sm" />
                  <Who>
                    <span>{name}</span>
                    <Muted>{t('balances.pool.paidIn', { amount: money(share.inMinor) })}</Muted>
                  </Who>
                  <Money>
                    <span>{money(Math.abs(share.backMinor))}</span>
                    <Muted>
                      {share.backMinor < 0 ? t('balances.pool.topUp') : t('balances.pool.refundBack')}
                    </Muted>
                  </Money>
                </Item>
              )
            })}
          </List>
        </Group>
      )}
    </PoolCard>
  )
}

import styled from 'styled-components'
import type { BalancesResponse } from '../../../shared/api/expenses.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { balancesApi } from '../../lib/balances/api.ts'
import { myRow, signedMoney, toneOf, TONE_LABEL } from '../../lib/balances/view.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'

// A compact "my balance" pill for other pages (the expense list header, the trip home): the signed
// amount in base currency and the word for it. Pass `balances` when the page already has them;
// otherwise it fetches GET /balances itself and stays empty until it has an answer.

const Pill = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: ${space.xs + 2}px;
  padding: ${space.xs}px ${space.md - 2}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill}px;
  background: ${color.glacier};
  font-size: ${fontSize.sm}px;
  white-space: nowrap;
`

const Label = styled.span`
  color: ${color.muted};
`

const Amount = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-weight: ${fontWeight.medium};
  color: ${color.fjordInk};
`

export function MyBalanceChip({ balances }: { balances?: BalancesResponse }) {
  const { trip } = useTripContext()
  const fetched = useResource(`balances-chip:${trip.id}:${balances ? 'given' : 'fetch'}`, (signal) =>
    balances ? Promise.resolve(balances) : balancesApi.getBalances(trip.id, signal),
  )
  const data = balances ?? fetched.data
  if (!data) return null
  return <ChipBody data={data} />
}

function ChipBody({ data }: { data: BalancesResponse }) {
  const t = useT()
  const { me } = useTripContext()
  const net = myRow(data.balances, me.id)?.netMinor ?? 0
  const tone = toneOf(net)
  return (
    <Pill>
      <Label>{t('balances.chip.label')}</Label>
      <Amount>{signedMoney(net, data.baseCurrency, t.locale)}</Amount>
      <Label>{t(TONE_LABEL[tone])}</Label>
    </Pill>
  )
}

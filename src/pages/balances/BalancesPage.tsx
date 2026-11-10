import { useState, type ReactNode } from 'react'
import styled from 'styled-components'
import type { PoolContribution, PoolRefundMode, Settlement } from '../../../shared/api/expenses.ts'
import { formatDate, formatMoney } from '../../../shared/i18n/format.ts'
import '../../../shared/i18n/pages/balances.ts'
import { isCurrencyCode, type CurrencyCode } from '../../../shared/money/currencies.ts'
import {
  BalanceRow,
  Button,
  Dialog,
  EmptyState,
  SettleCard,
  Skeleton,
  useToast,
} from '../../components/index.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { isApiError } from '../../lib/api.ts'
import { balancesApi } from '../../lib/balances/api.ts'
import {
  METHOD_LABEL,
  myRow,
  peopleOf,
  personFor,
  REFUND_LABEL,
  settlementLog,
  signedMoney,
  suggestionCards,
  toneOf,
  TONE_LABEL,
  toSecondaryMinor,
  type Person,
  type SuggestionCard,
} from '../../lib/balances/view.ts'
import { errorMessageKey } from '../../lib/errors.ts'
import { useT } from '../../lib/i18n.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, font, fontSize, fontWeight, media, radius, space } from '../../styles/tokens.ts'
import { Count, PageHeading, SectionTitle, Stack } from '../parts.tsx'
import { ContributionSheet, type ContributionSave } from './ContributionSheet.tsx'
import { PoolSection } from './PoolSection.tsx'
import { SettleSheet, type SettleValues } from './SettleSheet.tsx'
import { useBalances } from './useBalances.ts'

// /trips/:id/expenses/balances (e7-t04, e7-t05; DESIGN.md §4 記帳, mockup Screen 4 left panel):
// my balance in big type, everyone's balance, the shared pool, the fewest-transfers suggestion with
// 「已結清」 (partial amounts allowed), the settlement log and a short "how is this worked out".
// Every number comes from GET /balances; after each write the page fetches it again. Editors write;
// viewers see the same page read-only.

const Columns = styled.div`
  display: grid;
  gap: ${space.xl}px;
  grid-template-columns: minmax(0, 1fr);
  /* One column at every width, like the mockup's ledger panel: the trip layout's side columns
     leave the middle too narrow for two */
  max-width: 720px;
`

const Mine = styled.section`
  display: grid;
  gap: ${space.xs}px;
  padding: ${space.lg}px;
  border-radius: ${radius.card - 2}px;
  background: ${color.glacier};
`

const Small = styled.span`
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const Big = styled.span`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: ${space.sm}px ${space.md}px;
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-size: ${fontSize.xl}px;
  font-weight: ${fontWeight.medium};
  color: ${color.fjordInk};
  @media ${media.tablet} {
    font-size: ${fontSize.xxl}px;
  }
`

const ToneWord = styled.span`
  font-family: ${font.body};
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.semibold};
`

const List = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Cards = styled.ul`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Muted = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const How = styled.details`
  border-top: 1px solid ${color.line};
  padding-top: ${space.md}px;
  > summary {
    cursor: pointer;
    font-weight: ${fontWeight.semibold};
    min-height: 32px;
    ${focusRing}
  }
  > p {
    margin: ${space.sm}px 0 0;
    font-size: ${fontSize.sm}px;
    color: ${color.muted};
  }
`

type Editing =
  | { kind: 'settle'; card: SuggestionCard }
  | { kind: 'contribution'; contribution: PoolContribution | null }
  | null

interface Confirm {
  title: string
  body: string
  run: () => Promise<void>
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <Stack $gap="md" as="section" aria-label={title}>
      <SectionTitle>
        {title}
        {count !== undefined && <Count>{count}</Count>}
      </SectionTitle>
      {children}
    </Stack>
  )
}

export default function BalancesPage() {
  const t = useT()
  const { trip, me, members } = useTripContext()
  const can = useCan()
  const editable = can('editContent')
  const toast = useToast()
  const showError = useApiErrorToast()
  const resource = useBalances(trip)
  const [editing, setEditing] = useState<Editing>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)

  const title = t('balances.title')

  if (resource.status === 'error') {
    const { key, code } = errorMessageKey(resource.error)
    return (
      <Stack>
        <PageHeading title={title} />
        <EmptyState
          illustration="receipt"
          title={t('error.title')}
          body={t(key, { code })}
          action={
            <Button variant="primary" onClick={resource.reload}>
              {t('error.retry')}
            </Button>
          }
        />
      </Stack>
    )
  }

  if (!resource.data) {
    return (
      <Stack aria-busy="true">
        <PageHeading title={title} />
        <Skeleton $height={120} />
        <Skeleton $height={220} />
      </Stack>
    )
  }

  const { balances, pool, settlements, secondaryRate } = resource.data
  const base = balances.baseCurrency
  const secondary = trip.secondaryCurrency
  const rows = balances.balances
  const people = peopleOf(members, me.id, rows)
  const nameOf = (person: Person) => person.name ?? t('balances.removedMember')
  const money = (minor: number) => formatMoney(minor, base, t.locale)
  const mine = myRow(rows, me.id)
  const myNet = mine?.netMinor ?? 0
  const myTone = toneOf(myNet)
  const mySecondary = toSecondaryMinor(myNet, base, secondary, secondaryRate)
  const cards = suggestionCards(balances.suggested, people)
  const log = settlementLog(settlements)
  const nothingYet =
    rows.every((row) => row.paidMinor === 0 && row.owedMinor === 0 && row.poolInMinor === 0) &&
    log.length === 0
  const currencies = [base, ...trip.localCurrencies, ...(secondary ? [secondary] : [])].filter(
    (code, index, list): code is CurrencyCode => isCurrencyCode(code) && list.indexOf(code) === index,
  )

  /** Runs a write, then fetches everything again; false when it failed (already shown) */
  const write = async (run: () => Promise<unknown>, done: string): Promise<boolean> => {
    try {
      await run()
      toast.show(done)
      resource.reload()
      return true
    } catch (error) {
      showError(error)
      return false
    }
  }

  const settle = (card: SuggestionCard) => (values: SettleValues) =>
    write(
      () =>
        balancesApi.createSettlement(trip.id, {
          fromMemberId: card.from.id,
          toMemberId: card.to.id,
          amountMinor: values.amountMinor,
          method: values.method,
          note: values.note,
        }),
      t('balances.settle.saved', {
        from: nameOf(card.from),
        to: nameOf(card.to),
        amount: money(values.amountMinor),
      }),
    )

  const saveContribution = async (save: ContributionSave): Promise<boolean> => {
    try {
      if (save.kind === 'create') await balancesApi.createContribution(trip.id, save.body)
      else await balancesApi.patchContribution(trip.id, save.id, save.patch)
    } catch (error) {
      if (isApiError(error) && error.code === 'fx_unavailable') throw error
      showError(error)
      return false
    }
    toast.show(t('balances.pool.saved'))
    resource.reload()
    return true
  }

  const setRefundMode = (mode: PoolRefundMode) =>
    void write(
      () => balancesApi.setRefundMode(trip.id, mode),
      t('balances.pool.refund.saved', { mode: t(REFUND_LABEL[mode]) }),
    )

  const askDeleteContribution = (item: PoolContribution) => {
    const name = nameOf(personFor(people, item.memberId))
    setConfirm({
      title: t('balances.pool.deleteTitle'),
      body: t('balances.pool.deleteBody', {
        name,
        amount: formatMoney(item.amountMinor, item.currency, t.locale),
      }),
      run: async () => {
        await write(() => balancesApi.deleteContribution(trip.id, item.id), t('balances.pool.deleted'))
      },
    })
  }

  const transferLabel = (from: Person, to: Person, amount: string) =>
    t('balances.transfer.label', { from: nameOf(from), to: nameOf(to), amount })

  const askDeleteSettlement = (item: Settlement) => {
    const from = personFor(people, item.fromMemberId)
    const to = personFor(people, item.toMemberId)
    setConfirm({
      title: t('balances.log.deleteTitle'),
      body: t('balances.log.deleteBody', {
        from: nameOf(from),
        to: nameOf(to),
        amount: money(item.amountMinor),
      }),
      run: async () => {
        await write(() => balancesApi.deleteSettlement(trip.id, item.id), t('balances.log.deleted'))
      },
    })
  }

  const settleNames = (card: SuggestionCard) => ({ from: nameOf(card.from), to: nameOf(card.to) })

  return (
    <Stack $gap="xl">
      <PageHeading title={title} lead={t('balances.lead', { currency: base })} />
      <Columns>
        <Stack $gap="xl">
          <Mine aria-label={t('balances.mine.title')}>
            <Small>{t('balances.mine.label', { name: me.name })}</Small>
            <Big>
              <span>{signedMoney(myNet, base, t.locale)}</span>
              <ToneWord>{t(TONE_LABEL[myTone])}</ToneWord>
            </Big>
            {mySecondary !== null && secondary && (
              <Small>
                {t('balances.approx', { amount: signedMoney(mySecondary, secondary, t.locale) })}
              </Small>
            )}
          </Mine>

          <Section title={t('balances.people.title')}>
            {nothingYet ? (
              <EmptyState
                illustration="receipt"
                title={t('balances.empty.title')}
                body={t('balances.empty.body')}
              />
            ) : (
              <List aria-label={t('balances.people.title')}>
                {rows.map((row) => {
                  const person = personFor(people, row.memberId)
                  const tone = toneOf(row.netMinor)
                  const badges = [
                    ...(person.isMe ? [t('member.you')] : []),
                    ...(row.removed ? [t('balances.people.removed')] : []),
                  ]
                  return (
                    <BalanceRow
                      key={row.memberId}
                      name={nameOf(person)}
                      colorIndex={person.colorIndex}
                      detail={t('balances.people.detail', {
                        paid: money(row.paidMinor),
                        owed: money(row.owedMinor),
                      })}
                      amount={signedMoney(row.netMinor, base, t.locale)}
                      tone={tone}
                      toneLabel={t(TONE_LABEL[tone])}
                      badges={badges}
                      removed={row.removed}
                    />
                  )
                })}
              </List>
            )}
          </Section>

          <PoolSection
            contributions={pool.contributions}
            rows={rows}
            poolBalanceMinor={balances.poolBalanceMinor}
            refundMode={balances.refundMode}
            baseCurrency={base}
            people={people}
            editable={editable}
            onAdd={() => setEditing({ kind: 'contribution', contribution: null })}
            onEdit={(contribution) => setEditing({ kind: 'contribution', contribution })}
            onDelete={askDeleteContribution}
            onRefundMode={setRefundMode}
          />
        </Stack>

        <Stack $gap="xl">
          <Section title={t('balances.suggest.title')} count={cards.length}>
            {cards.length === 0 ? (
              <Muted>{t('balances.suggest.none')}</Muted>
            ) : (
              <>
                <Muted>{t('balances.suggest.hint')}</Muted>
                <Cards aria-label={t('balances.suggest.title')}>
                  {cards.map((card) => {
                    const amount = money(card.amountMinor)
                    return (
                      <SettleCard
                        key={card.key}
                        from={{ name: nameOf(card.from), colorIndex: card.from.colorIndex }}
                        to={{ name: nameOf(card.to), colorIndex: card.to.colorIndex }}
                        amount={amount}
                        label={transferLabel(card.from, card.to, amount)}
                        action={
                          editable ? (
                            <Button
                              size="sm"
                              aria-label={t('balances.suggest.settleLabel', settleNames(card))}
                              onClick={() => setEditing({ kind: 'settle', card })}
                            >
                              {t('balances.suggest.settle')}
                            </Button>
                          ) : undefined
                        }
                      />
                    )
                  })}
                </Cards>
              </>
            )}
          </Section>

          <Section title={t('balances.log.title')} count={log.length}>
            {log.length === 0 ? (
              <Muted>{t('balances.log.none')}</Muted>
            ) : (
              <Cards aria-label={t('balances.log.title')}>
                {log.map((item) => {
                  const from = personFor(people, item.fromMemberId)
                  const to = personFor(people, item.toMemberId)
                  const amount = money(item.amountMinor)
                  const metaParts = [formatDate(item.date, t.locale), t(METHOD_LABEL[item.method])]
                  if (item.note) metaParts.push(item.note)
                  return (
                    <SettleCard
                      key={item.id}
                      from={{ name: nameOf(from), colorIndex: from.colorIndex }}
                      to={{ name: nameOf(to), colorIndex: to.colorIndex }}
                      amount={amount}
                      label={transferLabel(from, to, amount)}
                      meta={metaParts.join(' · ')}
                      action={
                        editable ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t('balances.log.deleteLabel', {
                              from: nameOf(from),
                              to: nameOf(to),
                            })}
                            onClick={() => askDeleteSettlement(item)}
                          >
                            {t('common.delete')}
                          </Button>
                        ) : undefined
                      }
                    />
                  )
                })}
              </Cards>
            )}
          </Section>

          <How>
            <summary>{t('balances.how.title')}</summary>
            <p>{t('balances.how.net')}</p>
            <p>{t('balances.how.remainder')}</p>
            <p>{t('balances.how.pool')}</p>
            <p>{t('balances.how.settle')}</p>
            <p>{t('balances.how.currency', { currency: base })}</p>
          </How>
        </Stack>
      </Columns>

      {editing?.kind === 'settle' && (
        <SettleSheet
          key={editing.card.key}
          card={editing.card}
          currency={base}
          names={settleNames(editing.card)}
          onSubmit={settle(editing.card)}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === 'contribution' && (
        <ContributionSheet
          key={editing.contribution?.id ?? 'new'}
          contribution={editing.contribution}
          members={members}
          defaultMemberId={me.id}
          baseCurrency={base}
          currencies={currencies}
          onSave={saveContribution}
          onClose={() => setEditing(null)}
        />
      )}
      <Dialog
        open={Boolean(confirm)}
        onClose={() => (busy ? undefined : setConfirm(null))}
        title={confirm?.title ?? ''}
        actions={
          <>
            <Button onClick={() => setConfirm(null)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (!confirm) return
                setBusy(true)
                await confirm.run()
                setBusy(false)
                setConfirm(null)
              }}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <Muted>{confirm?.body}</Muted>
      </Dialog>
    </Stack>
  )
}

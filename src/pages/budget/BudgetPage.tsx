import { useState } from 'react'
import styled from 'styled-components'
import type { BudgetCategoryProgress, BudgetProgressResponse } from '../../../shared/api/prep.ts'
import { formatDate, formatMoney } from '../../../shared/i18n/format.ts'
import '../../../shared/i18n/pages/prep.ts'
import type { CurrencyCode } from '../../../shared/money/currencies.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { ButtonLink } from '../../components/ButtonLink.tsx'
import { Button, EmptyState, MoneyField, Skeleton, useToast } from '../../components/index.ts'
import { useNow, useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { budgetApi } from '../../lib/prep/api.ts'
import {
  burnPaths,
  draftFrom,
  draftGroupMinor,
  draftTotals,
  rowsFromDraft,
  sameRows,
  useBudgetProgress,
  type BudgetDraftRow,
} from '../../lib/prep/budget.ts'
import { BUDGET_LABEL, TRACKED_CATEGORIES } from '../../lib/prep/constants.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { todayIn } from '../../lib/trip-groups.ts'
import { color, font, fontSize, fontWeight, media, radius, space } from '../../styles/tokens.ts'
import { Fill, Mono, Muted, Panel, PanelHead, PanelTitle, Row, Switch, Track } from '../checklists/prep-ui.tsx'
import { PageHeading, Stack } from '../parts.tsx'

// /trips/:id/budget (e9-t01): the category table (planned in the base currency, per person or for
// the group) next to the actual spending from GET /budget/progress, the remaining amount, the
// burn-down by day, and the per-person totals (the share page's estimate comes from these).

const Kpis = styled.dl`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
  gap: ${space.md}px;
  margin: 0;
  > div {
    display: grid;
    gap: 2px;
    padding: ${space.md}px ${space.lg}px;
    border: 1px solid ${color.line};
    border-radius: ${radius.card}px;
    background: ${color.card};
  }
  dt {
    font-size: ${fontSize.sm}px;
    color: ${color.muted};
  }
  dd {
    margin: 0;
    font-family: ${font.mono};
    font-variant-numeric: tabular-nums;
    font-size: ${fontSize.lg}px;
    font-weight: ${fontWeight.medium};
  }
`

const Categories = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
`

const CategoryRow = styled.li`
  display: grid;
  gap: ${space.sm}px;
  padding: ${space.md}px 0;
  border-top: 1px solid ${color.line};
  &:first-child {
    border-top: 0;
  }
  > * {
    min-width: 0;
  }
  input[type='text'] {
    width: 100%;
    min-width: 0;
  }
  @media ${media.tablet} {
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.3fr) minmax(0, 1.5fr);
    align-items: center;
  }
`

/** The amount and its toggle: a single shrinkable track, so the field never spills over */
const Plan = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: ${space.xs}px;
  min-width: 0;
`

const Name = styled.div`
  font-weight: ${fontWeight.semibold};
`

const Numbers = styled.div`
  display: grid;
  gap: ${space.xs}px;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
  min-width: 0;
`

const Over = styled.span`
  color: ${color.danger};
  font-weight: ${fontWeight.semibold};
`

const Chart = styled.svg`
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
`

const Legend = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.md}px;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
  > span {
    display: inline-flex;
    align-items: center;
    gap: ${space.xs}px;
  }
`

const Swatch = styled.i<{ $dashed?: boolean }>`
  display: inline-block;
  width: 18px;
  border-top: 2px ${({ $dashed }) => ($dashed ? 'dashed' : 'solid')}
    ${({ $dashed }) => ($dashed ? color.muted : color.fjord)};
`

const TRACKED = new Set<string>(TRACKED_CATEGORIES)
const W = 320
const H = 120

export default function BudgetPage() {
  const t = useT()
  const { trip, members } = useTripContext()
  const can = useCan()
  const editable = can('editContent')
  const toast = useToast()
  const showError = useApiErrorToast()
  const currency = trip.baseCurrency as CurrencyCode
  const money = (minor: number) => formatMoney(minor, currency, t.locale)

  const budget = useResource(`budget:${trip.id}`, (signal) => budgetApi.get(trip.id, signal))
  const progress = useBudgetProgress(trip.id)
  // The edits since the last load or save; null shows the saved table
  const [edits, setDraft] = useState<BudgetDraftRow[] | null>(null)
  const [saving, setSaving] = useState(false)
  const draft = edits ?? (budget.status === 'ready' ? draftFrom(budget.data.rows) : null)

  const memberCount = budget.status === 'ready' ? budget.data.memberCount : members.length || 1
  const totals = draft ? draftTotals(draft, memberCount) : null
  const dirty =
    draft !== null && budget.status === 'ready' && !sameRows(rowsFromDraft(draft), budget.data.rows)
  const actualOf = (category: string): BudgetCategoryProgress | undefined =>
    progress.status === 'ready'
      ? progress.data.categories.find((c) => c.category === category)
      : undefined

  const update = (index: number, patch: Partial<BudgetDraftRow>) =>
    setDraft(draft && draft.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const res = await budgetApi.put(trip.id, { rows: rowsFromDraft(draft) })
      budget.set(res)
      setDraft(null)
      progress.reload()
      toast.show(t('prep.budget.saved'))
    } catch (error) {
      showError(error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack $gap="lg">
      <PageHeading
        title={t('prep.budget.title')}
        lead={t('prep.budget.lead', { currency })}
        actions={
          <ButtonLink to=".." relative="path" variant="ghost">
            {t('prep.back')}
          </ButtonLink>
        }
      />

      {(budget.status === 'loading' || !draft) && budget.status !== 'error' && (
        <Skeleton $height={240} />
      )}
      {budget.status === 'error' && (
        <EmptyState
          title={t('error.title')}
          body={t('error.network')}
          action={
            <Button variant="primary" onClick={budget.reload}>
              {t('error.retry')}
            </Button>
          }
        />
      )}

      {draft && totals && (
        <>
          <Kpis aria-label={t('prep.budget.kpis')} data-budget-kpis="">
            <div>
              <dt>{t('prep.budget.kpi.planned')}</dt>
              <dd>{money(totals.plannedMinor)}</dd>
            </div>
            <div>
              <dt>{t('prep.budget.kpi.perPerson')}</dt>
              <dd data-per-person="">{money(totals.perPersonMinor)}</dd>
            </div>
            {progress.status === 'ready' && (
              <>
                <div>
                  <dt>{t('prep.budget.kpi.actual')}</dt>
                  <dd data-actual-total="">{money(progress.data.totals.actualMinor)}</dd>
                </div>
                <div>
                  <dt>{t('prep.budget.kpi.actualPerPerson')}</dt>
                  <dd>{money(progress.data.totals.actualPerPersonMinor)}</dd>
                </div>
              </>
            )}
          </Kpis>
          <Muted>
            {t('prep.budget.perPersonHint', { people: t.plural('expenses.people', memberCount) })}
          </Muted>

          <Panel aria-labelledby="budget-table-title">
            <PanelHead>
              <PanelTitle id="budget-table-title">{t('prep.budget.table')}</PanelTitle>
              {editable && (
                <Row>
                  {dirty && <Muted>{t('prep.budget.dirty')}</Muted>}
                  <Button variant="primary" disabled={!dirty || saving} onClick={save}>
                    {saving ? t('prep.budget.saving') : t('prep.budget.save')}
                  </Button>
                </Row>
              )}
            </PanelHead>
            {!editable && <Muted>{t('prep.budget.readonly')}</Muted>}
            <Categories>
              {draft.map((row, index) => {
                const label = t(BUDGET_LABEL[row.category])
                const planned = draftGroupMinor(row, memberCount)
                const actual = actualOf(row.category)
                // Tracked categories without spending yet have no progress row: 0 spent
                const spent = TRACKED.has(row.category) ? (actual?.actualMinor ?? 0) : null
                const remaining = spent === null ? null : planned - spent
                return (
                  <CategoryRow key={row.category} data-category={row.category}>
                    <Name>{label}</Name>
                    <Plan>
                      <MoneyField
                        label={t('prep.budget.amount', { category: label })}
                        value={row.plannedMinor}
                        currency={currency}
                        currencies={[currency]}
                        disabled={!editable}
                        onChange={(minor) => update(index, { plannedMinor: minor })}
                      />
                      <Switch>
                        <input
                          type="checkbox"
                          checked={row.perPerson}
                          disabled={!editable}
                          onChange={(event) => update(index, { perPerson: event.target.checked })}
                        />
                        {t('prep.budget.perPersonToggle')}
                      </Switch>
                    </Plan>
                    <Numbers>
                      <span>
                        {t('prep.budget.plannedGroup')} <Mono>{money(planned)}</Mono>
                      </span>
                      {spent === null ? (
                        <span>{t('prep.budget.untracked')}</span>
                      ) : (
                        <>
                          <span data-actual={row.category}>
                            {t('prep.budget.actual')} <Mono>{money(spent)}</Mono>
                            {' · '}
                            {remaining !== null && remaining < 0 ? (
                              <Over>{t('prep.budget.over', { amount: money(-remaining) })}</Over>
                            ) : (
                              t('prep.budget.remaining', { amount: money(remaining ?? 0) })
                            )}
                          </span>
                          {planned > 0 && (
                            <Track
                              role="progressbar"
                              aria-label={t('prep.budget.used', { category: label })}
                              aria-valuemin={0}
                              aria-valuemax={planned}
                              aria-valuenow={Math.min(spent, planned)}
                            >
                              <Fill
                                $ratio={spent / planned}
                                $tone={spent > planned ? 'danger' : 'ok'}
                              />
                            </Track>
                          )}
                        </>
                      )}
                    </Numbers>
                  </CategoryRow>
                )
              })}
            </Categories>
          </Panel>

          {progress.status === 'ready' && <Burn data={progress.data} money={money} />}
          {progress.status === 'ready' && progress.data.members.length > 0 && (
            <Panel aria-labelledby="budget-members-title">
              <PanelTitle id="budget-members-title">{t('prep.budget.members')}</PanelTitle>
              <Categories>
                {progress.data.members.map((share) => (
                  <CategoryRow key={share.memberId} as="li">
                    <Name>
                      {members.find((m) => m.id === share.memberId)?.name ??
                        t('expenses.removedMember')}
                    </Name>
                    <Numbers>
                      <span>
                        {t('prep.budget.memberShare')} <Mono>{money(share.shareMinor)}</Mono>
                      </span>
                    </Numbers>
                    <Numbers>
                      <span>
                        {t('prep.budget.memberPlanned')} <Mono>{money(totals.perPersonMinor)}</Mono>
                      </span>
                    </Numbers>
                  </CategoryRow>
                ))}
              </Categories>
            </Panel>
          )}
        </>
      )}
    </Stack>
  )
}

function Burn({ data, money }: { data: BudgetProgressResponse; money: (minor: number) => string }) {
  const t = useT()
  const { trip } = useTripContext()
  const today = todayIn(trip.tz, useNow())
  const started = data.burn.some((p) => p.date <= today)
  const paths = burnPaths(data.burn, today, W, H)
  const last = [...data.burn].reverse().find((p) => p.date <= today)
  return (
    <Panel aria-labelledby="budget-burn-title">
      <PanelTitle id="budget-burn-title">{t('prep.budget.burn.title')}</PanelTitle>
      {!data.hasBudget ? (
        <Muted>{t('prep.budget.burn.noBudget')}</Muted>
      ) : (
        <>
          <Chart
            viewBox={`-4 -4 ${W + 8} ${H + 8}`}
            role="img"
            aria-label={
              last
                ? t('prep.budget.burn.label', {
                    date: formatDate(last.date, t.locale),
                    amount: money(last.remainingMinor),
                  })
                : t('prep.budget.burn.chart')
            }
          >
            <line
              x1={0}
              x2={W}
              y1={paths.zeroY}
              y2={paths.zeroY}
              stroke={color.line}
              strokeWidth={1}
            />
            <polyline
              points={paths.ideal}
              fill="none"
              stroke={color.muted}
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            {started && (
              <polyline points={paths.actual} fill="none" stroke={color.fjord} strokeWidth={2.5} />
            )}
          </Chart>
          <Legend>
            <span>
              <Swatch />
              {t('prep.budget.burn.actual')}
            </span>
            <span>
              <Swatch $dashed />
              {t('prep.budget.burn.ideal')}
            </span>
          </Legend>
          <Muted>
            {started && last
              ? t('prep.budget.burn.label', {
                  date: formatDate(last.date, t.locale),
                  amount: money(last.remainingMinor),
                })
              : t('prep.budget.burn.empty')}
          </Muted>
        </>
      )}
    </Panel>
  )
}

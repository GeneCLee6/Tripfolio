import styled from 'styled-components'
import { formatMoney } from '../../shared/i18n/format.ts'
import type { MessageKey } from '../../shared/i18n/t.ts'
import { minorUnitsOf } from '../../shared/money/currencies.ts'
import type { Share, SplitMethod } from '../../shared/money/split.ts'
import { useT } from '../lib/i18n.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../styles/tokens.ts'
import { Button } from './Button.tsx'
import { SegmentedControl } from './SegmentedControl.tsx'
import { controlBox } from './styles.ts'
import type { PickerMember } from './MemberPicker.tsx'

// How an expense is split (E7 分法): collapsed it is one line (「平均 · 每人 NZ$22.50」); open it
// offers 平均／份數／比例／指定金額／只有我 with an input per person and a live preview of the exact
// minor amounts each person gets, so the remainder rule is visible before saving.

export type SplitValueKind = 'weights' | 'percents' | 'exacts'

const METHODS: readonly SplitMethod[] = ['equal', 'shares', 'percent', 'exact', 'self']
const METHOD_LABEL: Record<SplitMethod, MessageKey> = {
  equal: 'expenses.method.equal',
  shares: 'expenses.method.shares',
  percent: 'expenses.method.percent',
  exact: 'expenses.method.exact',
  self: 'expenses.method.self',
}
const VALUE_KIND: Partial<Record<SplitMethod, SplitValueKind>> = {
  shares: 'weights',
  percent: 'percents',
  exact: 'exacts',
}
const INPUT_LABEL: Record<SplitValueKind, MessageKey> = {
  weights: 'expenses.split.weight',
  percents: 'expenses.split.percent',
  exacts: 'expenses.split.exact',
}

const Box = styled.div`
  display: grid;
  min-width: 0;
  gap: ${space.sm}px;
  padding: ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.paper};
`

const Line = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space.sm}px;
  min-width: 0;
  font-size: ${fontSize.sm}px;
  > button {
    flex: none;
    white-space: nowrap;
  }
`

const Methods = styled.div`
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: thin;
`

const People = styled.ul`
  display: grid;
  gap: ${space.xs}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Person = styled.li`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: ${space.sm}px;
  font-size: ${fontSize.sm}px;
  > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const SmallInput = styled.input`
  ${controlBox}
  width: 92px;
  min-height: 34px;
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  text-align: right;
`

const Amount = styled.span`
  min-width: 84px;
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-weight: ${fontWeight.medium};
  text-align: right;
`

const Note = styled.p<{ $error?: boolean }>`
  margin: 0;
  font-size: ${fontSize.sm - 1}px;
  color: ${({ $error }) => ($error ? color.danger : color.muted)};
`

export interface SplitEditorProps {
  method: SplitMethod
  onMethodChange: (method: SplitMethod) => void
  /** The people sharing it, in order (names for the rows) */
  participants: readonly PickerMember[]
  currency: string
  /** The values typed per person, by kind */
  values: Record<SplitValueKind, Record<string, string>>
  onValueChange: (kind: SplitValueKind, memberId: string, text: string) => void
  /** The split as it would come out (shared/money splitExpense), or null when it cannot be computed */
  preview: readonly Share[] | null
  /** Already translated: why there is no preview */
  problem?: string
  /** exact: what is left to assign (minor units; negative = too much) */
  remainderMinor?: number | null
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}

/** The split method, the per-person inputs and the live preview */
export function SplitEditor({
  method,
  onMethodChange,
  participants,
  currency,
  values,
  onValueChange,
  preview,
  problem,
  remainderMinor,
  expanded,
  onExpandedChange,
}: SplitEditorProps) {
  const t = useT()
  const money = (minor: number) => formatMoney(minor, currency, t.locale)
  const shareOf = (memberId: string) => preview?.find((share) => share.memberId === memberId)
  const everyoneSame =
    preview &&
    preview.length > 0 &&
    preview.every((share) => share.shareMinor === preview[0].shareMinor)

  if (!expanded) {
    const summary =
      method === 'equal' && preview && everyoneSame
        ? `${t(METHOD_LABEL[method])} · ${t.plural('expenses.people', preview.length)} × ${money(preview[0].shareMinor)}`
        : t(METHOD_LABEL[method])
    return (
      <Box>
        <Line>
          <span>{summary}</span>
          <Button size="sm" variant="ghost" onClick={() => onExpandedChange(true)}>
            {t('expenses.split.change')}
          </Button>
        </Line>
        {problem && <Note $error>{problem}</Note>}
      </Box>
    )
  }

  const kind = VALUE_KIND[method]
  const digits = minorUnitsOf(currency)
  const rows = participants
  const percentTotal =
    method === 'percent'
      ? participants.reduce((sum, p) => sum + (Number(values.percents[p.id]) || 0), 0)
      : null

  return (
    <Box>
      <Line>
        <Methods>
          <SegmentedControl
            size="sm"
            label={t('expenses.method')}
            value={method}
            onChange={onMethodChange}
            options={METHODS.map((value) => ({ value, label: t(METHOD_LABEL[value]) }))}
          />
        </Methods>
        <Button size="sm" variant="ghost" onClick={() => onExpandedChange(false)}>
          {t('expenses.split.done')}
        </Button>
      </Line>
      {method === 'self' ? <Note>{t('expenses.split.selfNote')}</Note> : null}
      <People aria-label={t('expenses.split.preview')}>
        {rows.map((person) => {
          const share = shareOf(person.id)
          return (
            <Person key={person.id}>
              <span>{person.name}</span>
              {kind ? (
                <SmallInput
                  type="text"
                  inputMode={kind === 'exacts' && digits === 0 ? 'numeric' : 'decimal'}
                  autoComplete="off"
                  aria-label={t(INPUT_LABEL[kind], { name: person.name })}
                  placeholder={kind === 'weights' ? '1' : ''}
                  value={values[kind][person.id] ?? ''}
                  onChange={(event) => onValueChange(kind, person.id, event.target.value)}
                />
              ) : (
                <span />
              )}
              <Amount>{share ? money(share.shareMinor) : '—'}</Amount>
            </Person>
          )
        })}
      </People>
      {percentTotal !== null && (
        <Note $error={Math.abs(percentTotal - 100) > 0.01}>
          {t('expenses.split.percentTotal', { percent: String(Number(percentTotal.toFixed(2))) })}
        </Note>
      )}
      {remainderMinor !== null && remainderMinor !== undefined && remainderMinor !== 0 && (
        <Note $error>
          {remainderMinor > 0
            ? t('expenses.split.left', { amount: money(remainderMinor) })
            : t('expenses.split.over', { amount: money(-remainderMinor) })}
        </Note>
      )}
      {problem && <Note $error>{problem}</Note>}
      <Note>{t('expenses.split.rule')}</Note>
    </Box>
  )
}

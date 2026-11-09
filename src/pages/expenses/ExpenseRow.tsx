import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import styled from 'styled-components'
import type { ExpenseView } from '../../../shared/api/expenses.ts'
import type { Member } from '../../../shared/api/types.ts'
import { CategoryIcon } from '../../components/index.ts'
import { MapPinIcon } from '../../components/icons.tsx'
import { describeExpense } from '../../lib/expenses/form.ts'
import { useT } from '../../lib/i18n.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, font, fontSize, fontWeight, space } from '../../styles/tokens.ts'
import { amountLines, categoryLabel, whoLine, type RowMoney } from './labels.ts'

// One expense in the list (e7-t08, mockup Screen 4): category tile, note, who paid and who shares,
// a paperclip for a receipt, the linked stop; the amount as recorded with the base (and secondary)
// currency under it. Tap to edit; long-press, right-click or Delete to delete.

const LONG_PRESS_MS = 550

const rowLayout = `
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: ${space.md}px;
  width: 100%;
  padding: ${space.md}px ${space.xs}px;
  border: 0;
  border-bottom: 1px solid ${color.line};
  background: none;
  color: ${color.ink};
  font: inherit;
  text-align: left;
`

const RowButton = styled.button`
  ${rowLayout}
  cursor: pointer;
  -webkit-touch-callout: none;
  user-select: none;
  &:hover {
    background: ${color.card};
  }
  ${focusRing}
`

const RowStatic = styled.div`
  ${rowLayout}
`

const Text = styled.span`
  display: grid;
  gap: 2px;
  min-width: 0;
`

const Title = styled.span`
  font-weight: ${fontWeight.semibold};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Sub = styled.span`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px ${space.sm}px;
  color: ${color.muted};
  font-size: ${fontSize.sm - 1}px;
  > span {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
`

const Amounts = styled.span`
  display: grid;
  justify-items: end;
  gap: 2px;
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  > span:first-child {
    font-weight: ${fontWeight.semibold};
  }
  > span:nth-child(2) {
    color: ${color.muted};
    font-size: ${fontSize.sm - 1}px;
  }
`

const Paperclip = () => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 0 1 5.7 5.7l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5" />
  </svg>
)

const Hidden = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
`

export interface ExpenseRowProps {
  expense: ExpenseView
  members: readonly Pick<Member, 'id' | 'name'>[]
  money: RowMoney
  stopName?: string | null
  /** Tap: edit (omitted for viewers: the row is not a button) */
  onOpen?: () => void
  /** Long-press or the Delete key */
  onDelete?: () => void
}

/** One expense in the list */
export function ExpenseRow({
  expense,
  members,
  money,
  stopName,
  onOpen,
  onDelete,
}: ExpenseRowProps) {
  const t = useT()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressed = useRef(false)
  const title = expense.note || categoryLabel(t, expense.category)
  const [primary, secondary] = amountLines(expense, money, t)
  const content = (
    <>
      <CategoryIcon category={expense.category} />
      <Text>
        <Title>{title}</Title>
        <Sub>
          <span>{whoLine(t, describeExpense(expense, members), members)}</span>
          {expense.receiptAttachmentId && (
            <span title={t('expenses.hasReceipt')}>
              <Paperclip />
              <Hidden>{t('expenses.hasReceipt')}</Hidden>
            </span>
          )}
          {stopName && (
            <span>
              <MapPinIcon size={12} />
              {t('expenses.linkedStop', { name: stopName })}
            </span>
          )}
        </Sub>
      </Text>
      <Amounts>
        <span>{primary}</span>
        {secondary && <span>{secondary}</span>}
      </Amounts>
    </>
  )
  if (!onOpen) return <RowStatic>{content}</RowStatic>

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const start = (event: ReactPointerEvent) => {
    if (!onDelete || event.button !== 0) return
    pressed.current = false
    cancel()
    timer.current = setTimeout(() => {
      pressed.current = true
      onDelete()
    }, LONG_PRESS_MS)
  }
  return (
    <RowButton
      type="button"
      data-expense-id={expense.id}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => {
        if (!onDelete) return
        event.preventDefault()
        if (!pressed.current) {
          cancel()
          pressed.current = true
          onDelete()
        }
      }}
      onKeyDown={(event) => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && onDelete) {
          event.preventDefault()
          onDelete()
        }
      }}
      onClick={() => {
        if (pressed.current) {
          pressed.current = false
          return
        }
        onOpen()
      }}
    >
      {content}
    </RowButton>
  )
}

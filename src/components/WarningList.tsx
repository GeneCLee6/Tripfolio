import styled, { css } from 'styled-components'
import { focusRing } from '../styles/mixins.ts'
import { color, fontSize, radius, space } from '../styles/tokens.ts'

// A compact list of non-blocking warnings (DESIGN.md §6: icon plus text, never colour alone). Each
// line can be tapped to jump to what it is about.

const List = styled.ul`
  display: grid;
  gap: 2px;
  margin: 0;
  padding: ${space.xs}px ${space.sm}px;
  list-style: none;
  border: 1px solid ${color.warning};
  border-radius: ${radius.control}px;
  background: ${color.paper};
`

const line = css`
  display: flex;
  align-items: flex-start;
  gap: ${space.sm}px;
  width: 100%;
  min-height: 32px;
  padding: ${space.xs}px 0;
  font-size: ${fontSize.sm}px;
  line-height: 1.4;
  color: ${color.ink};
  text-align: left;
  > svg {
    flex: none;
    margin-top: 2px;
    color: ${color.warning};
  }
`

const Line = styled.span`
  ${line}
`

const LineButton = styled.button`
  ${line}
  border: 0;
  background: transparent;
  font: inherit;
  font-size: ${fontSize.sm}px;
  cursor: pointer;
  &:hover {
    text-decoration: underline;
  }
  ${focusRing}
`

export const WarningIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
)

export interface WarningItem {
  key: string
  /** One line, already translated */
  text: string
  /** Jump to what the warning is about (the line becomes a button) */
  onSelect?: () => void
}

export interface WarningListProps {
  /** Accessible name of the list (already translated) */
  label: string
  items: readonly WarningItem[]
}

export function WarningList({ label, items }: WarningListProps) {
  if (items.length === 0) return null
  return (
    <List aria-label={label}>
      {items.map((item) => (
        <li key={item.key}>
          {item.onSelect ? (
            <LineButton type="button" onClick={item.onSelect}>
              <WarningIcon />
              <span>{item.text}</span>
            </LineButton>
          ) : (
            <Line>
              <WarningIcon />
              <span>{item.text}</span>
            </Line>
          )}
        </li>
      ))}
    </List>
  )
}

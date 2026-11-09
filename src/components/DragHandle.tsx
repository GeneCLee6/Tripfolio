import { forwardRef, type ButtonHTMLAttributes } from 'react'
import styled from 'styled-components'
import { focusRing } from '../styles/mixins.ts'
import { color, radius, touchTarget } from '../styles/tokens.ts'

// The grip that starts a drag (DESIGN.md §6): a 44 px target on every pointer, keyboard focusable
// (Space picks the item up, arrows move it, Space drops, Esc cancels: the drag library listens on
// it). Presentational only: the drag library's listeners and attributes are spread onto it.

const Grip = styled.button<{ $dragging: boolean }>`
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: ${touchTarget}px;
  height: ${touchTarget}px;
  padding: 0;
  border: 0;
  border-radius: ${radius.control}px;
  background: ${({ $dragging }) => ($dragging ? color.glacier : 'transparent')};
  color: ${color.muted};
  cursor: ${({ $dragging }) => ($dragging ? 'grabbing' : 'grab')};
  touch-action: none;
  &:hover:not(:disabled) {
    background: ${color.glacier};
    color: ${color.ink};
  }
  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  ${focusRing}
`

export interface DragHandleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  /** Accessible name (already translated), e.g. 「拖曳以排序」 */
  label: string
  dragging?: boolean
}

export const DragHandle = forwardRef<HTMLButtonElement, DragHandleProps>(function DragHandle(
  { label, dragging = false, type = 'button', ...rest },
  ref,
) {
  return (
    <Grip ref={ref} type={type} aria-label={label} title={label} $dragging={dragging} {...rest}>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="9" cy="6" r="1.6" />
        <circle cx="15" cy="6" r="1.6" />
        <circle cx="9" cy="12" r="1.6" />
        <circle cx="15" cy="12" r="1.6" />
        <circle cx="9" cy="18" r="1.6" />
        <circle cx="15" cy="18" r="1.6" />
      </svg>
    </Grip>
  )
})

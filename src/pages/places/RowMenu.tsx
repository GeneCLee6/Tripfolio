import { useEffect, useId, useRef, useState } from 'react'
import styled from 'styled-components'
import { IconButton } from '../../components/index.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, fontSize, radius, space, touchTarget, zIndex } from '../../styles/tokens.ts'

// The ⋯ menu on a place row (same behaviour as the picks card menu): closes on Escape, an outside
// click or a choice; arrow keys move between the items.

const Wrapper = styled.div`
  position: relative;
  > button {
    background: ${color.card};
    color: ${color.ink};
    opacity: 0.94;
  }
`

const List = styled.ul`
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: ${zIndex.overlay};
  min-width: 168px;
  margin: 0;
  padding: ${space.xs}px;
  list-style: none;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.card};
  box-shadow: 0 6px 18px ${color.shadow};
`

const Item = styled.button<{ $danger: boolean }>`
  display: flex;
  width: 100%;
  min-height: 36px;
  align-items: center;
  padding: 0 ${space.md}px;
  border: 0;
  border-radius: ${radius.control - 4}px;
  background: transparent;
  color: ${({ $danger }) => ($danger ? color.danger : color.ink)};
  font: inherit;
  font-size: ${fontSize.sm}px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  &:hover,
  &:focus-visible {
    background: ${color.paper};
  }
  @media (pointer: coarse) {
    min-height: ${touchTarget}px;
  }
  ${focusRing}
`

const DotsIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
)

export interface MenuAction {
  key: string
  label: string
  danger?: boolean
  onSelect: () => void
}

export function RowMenu({ label, actions }: { label: string; actions: readonly MenuAction[] }) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const wrapper = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const close = (event: Event) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      setOpen(false)
      wrapper.current?.querySelector<HTMLButtonElement>('button')?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <Wrapper ref={wrapper} onKeyDown={onKeyDown}>
      <IconButton
        size="sm"
        variant="secondary"
        label={label}
        icon={<DotsIcon />}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <List ref={list} id={menuId} role="menu" aria-label={label}>
          {actions.map((action) => (
            <li key={action.key} role="none">
              <Item
                type="button"
                role="menuitem"
                $danger={Boolean(action.danger)}
                onClick={() => {
                  setOpen(false)
                  action.onSelect()
                }}
              >
                {action.label}
              </Item>
            </li>
          ))}
        </List>
      )}
    </Wrapper>
  )
}

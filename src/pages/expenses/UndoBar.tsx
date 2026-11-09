import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import styled, { keyframes } from 'styled-components'
import { IconButton } from '../../components/index.ts'
import { CloseIcon } from '../../components/icons.tsx'
import { useT } from '../../lib/i18n.ts'
import { focusRing } from '../../styles/mixins.ts'
import {
  color,
  duration,
  fontSize,
  fontWeight,
  media,
  radius,
  space,
  zIndex,
} from '../../styles/tokens.ts'

// A toast with one action (「已記一筆 NZ$45.00 · 復原」). The shared Toast has no action button, so
// the expense pages keep their own: one at a time, above the phone's bottom navigation.

const SHOW_MS = 6000

const rise = keyframes`
  from { opacity: 0; transform: translate(-50%, 12px); }
  to { opacity: 1; transform: translate(-50%, 0); }
`

const Bar = styled.div`
  position: fixed;
  left: 50%;
  bottom: calc(64px + ${space.lg}px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: ${zIndex.toast};
  display: flex;
  align-items: center;
  gap: ${space.sm}px;
  width: min(420px, calc(100vw - ${space.xxl}px));
  padding: ${space.xs}px ${space.xs}px ${space.xs}px ${space.lg}px;
  border-radius: ${radius.control}px;
  border-left: 4px solid ${color.success};
  background: ${color.ink};
  color: ${color.paper};
  font-size: ${fontSize.body - 1}px;
  box-shadow: 0 8px 24px ${color.shadow};
  > span {
    flex: 1;
  }
  > button:last-child {
    color: ${color.paper};
  }
  /* Above the shared toasts (bottom-center from tablet width), so both stay readable */
  @media ${media.tablet} {
    bottom: calc(${space.lg + 64}px + env(safe-area-inset-bottom, 0px));
  }
  @media ${media.motion} {
    animation: ${rise} ${duration.base}ms ease-out;
  }
`

const Action = styled.button`
  min-height: 36px;
  padding: 0 ${space.md}px;
  border: 0;
  border-radius: ${radius.control}px;
  background: transparent;
  color: ${color.glacier};
  font: inherit;
  font-weight: ${fontWeight.semibold};
  cursor: pointer;
  ${focusRing}
`

export interface UndoItem {
  message: string
  /** Runs when 復原 is tapped; the bar closes first */
  undo: () => void
}

/** `const [bar, showUndo] = useUndoBar()`: render `bar`, call `showUndo({ message, undo })` */
export function useUndoBar(): [ReactNode, (item: UndoItem) => void] {
  const t = useT()
  const [item, setItem] = useState<(UndoItem & { id: number }) | null>(null)
  const nextId = useRef(1)
  const show = useCallback((next: UndoItem) => setItem({ ...next, id: nextId.current++ }), [])

  useEffect(() => {
    if (!item) return
    const timer = setTimeout(() => setItem(null), SHOW_MS)
    return () => clearTimeout(timer)
  }, [item])

  const bar = item ? (
    <Bar key={item.id} role="status" aria-live="polite">
      <span>{item.message}</span>
      <Action
        type="button"
        onClick={() => {
          setItem(null)
          item.undo()
        }}
      >
        {t('expenses.undo')}
      </Action>
      <IconButton
        size="sm"
        label={t('common.dismiss')}
        icon={<CloseIcon size={16} />}
        onClick={() => setItem(null)}
      />
    </Bar>
  ) : null
  return [bar, show]
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import styled, { keyframes } from 'styled-components'
import { useT } from '../lib/i18n.ts'
import { color, duration, fontSize, media, radius, space, zIndex } from '../styles/tokens.ts'
import { IconButton } from './IconButton.tsx'
import { CloseIcon } from './icons.tsx'
import { ToastContext, type ToastOptions, type ToastTone } from './toast-context.ts'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

const rise = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: none; }
`

const Region = styled.div`
  position: fixed;
  left: 50%;
  bottom: calc(${space.lg}px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: ${zIndex.toast};
  display: grid;
  gap: ${space.sm}px;
  width: min(420px, calc(100vw - ${space.xxl}px));
  pointer-events: none;
`

const toneBar: Record<ToastTone, string> = {
  neutral: color.fjord,
  success: color.success,
  danger: color.danger,
}

const Item = styled.div<{ $tone: ToastTone }>`
  display: flex;
  align-items: center;
  gap: ${space.sm}px;
  padding: ${space.xs}px ${space.xs}px ${space.xs}px ${space.lg}px;
  border-radius: ${radius.control}px;
  border-left: 4px solid ${({ $tone }) => toneBar[$tone]};
  background: ${color.ink};
  color: ${color.paper};
  font-size: ${fontSize.body - 1}px;
  box-shadow: 0 8px 24px ${color.shadow};
  pointer-events: auto;
  > span {
    flex: 1;
  }
  > button {
    color: ${color.paper};
  }
  @media ${media.motion} {
    animation: ${rise} ${duration.base}ms ease-out;
  }
`

/** Holds the toasts; mount once near the root */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
  }, [])

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = nextId.current++
      setItems((current) => [...current.slice(-2), { id, message, tone: options.tone ?? 'neutral' }])
      const ms = options.duration ?? 4000
      if (ms > 0) timers.current.set(id, setTimeout(() => dismiss(id), ms))
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
    }
  }, [])

  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext value={api}>
      {children}
      <Region role="status" aria-live="polite" aria-label={t('toast.region')}>
        {items.map((item) => (
          <Item key={item.id} $tone={item.tone}>
            <span>{item.message}</span>
            <IconButton size="sm" label={t('common.dismiss')} icon={<CloseIcon size={16} />} onClick={() => dismiss(item.id)} />
          </Item>
        ))}
      </Region>
    </ToastContext>
  )
}

import { useEffect, useId, useRef, useState } from 'react'
import styled from 'styled-components'
import { paletteIndex } from '../lib/colors.ts'
import { useT } from '../lib/i18n.ts'
import { focusRing } from '../styles/mixins.ts'
import {
  color,
  duration,
  font,
  fontSize,
  fontWeight,
  media,
  radius,
  space,
  touchTarget,
  zIndex,
} from '../styles/tokens.ts'
import { Avatar, AvatarGroup } from './Avatar.tsx'

// 「想去」 on a pick (e5-t04): a toggle for the current member with the head count. Who wants to go
// shows as the button's title, and in a small popover on hover or a long press (touch).

const Wrapper = styled.span`
  position: relative;
  display: inline-flex;
`

const Toggle = styled.button<{ $on: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs + 1}px;
  min-height: 28px;
  padding: 0 ${space.sm + 2}px;
  border: 1px solid ${({ $on }) => ($on ? color.tussock : color.line)};
  border-radius: ${radius.pill}px;
  background: ${({ $on }) => ($on ? color.tussockSoft : color.card)};
  color: ${({ $on }) => ($on ? color.ink : color.muted)};
  font: inherit;
  font-size: ${fontSize.sm - 1}px;
  font-weight: ${fontWeight.medium};
  white-space: nowrap;
  cursor: pointer;
  -webkit-touch-callout: none;
  user-select: none;
  > svg {
    color: ${({ $on }) => ($on ? color.tussock : 'currentColor')};
  }
  > b {
    font-family: ${font.mono};
    font-weight: ${fontWeight.medium};
    font-variant-numeric: tabular-nums;
  }
  &:hover:not(:disabled) {
    border-color: ${color.tussock};
  }
  &:disabled {
    cursor: default;
  }
  @media ${media.motion} {
    transition: background-color ${duration.fast}ms ease;
  }
  @media ${media.coarse} {
    min-height: ${touchTarget - 8}px;
  }
  ${focusRing}
`

const Popover = styled.span`
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: ${zIndex.overlay};
  display: grid;
  gap: ${space.xs}px;
  min-width: 140px;
  max-width: 240px;
  padding: ${space.sm}px ${space.md - 2}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.card};
  box-shadow: 0 6px 18px ${color.shadow};
  color: ${color.ink};
  font-size: ${fontSize.sm - 1}px;
  white-space: normal;
  pointer-events: none;
`

const Names = styled.span`
  color: ${color.muted};
  overflow-wrap: anywhere;
`

const Heart = ({ filled }: { filled: boolean }) => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={2}
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
  </svg>
)

export interface VoteButtonProps {
  /** The members who want to go (current members only, as the API returns them) */
  voters: readonly { id: string; name: string; color: string }[]
  /** The current member is one of them */
  voted: boolean
  onToggle: (next: boolean) => void
  /** Viewers see the count but cannot vote */
  disabled?: boolean
  /** The pick's name, for the accessible label */
  itemName: string
}

const LONG_PRESS_MS = 450

export function VoteButton({ voters, voted, onToggle, disabled = false, itemName }: VoteButtonProps) {
  const t = useT()
  const popoverId = useId()
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  const wrapper = useRef<HTMLSpanElement>(null)

  const names = voters.map((voter) => voter.name).join(t('picks.vote.separator'))
  const summary = voters.length ? t('picks.vote.voters', { names }) : t('picks.vote.none')

  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const cancelPress = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  return (
    <Wrapper
      ref={wrapper}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Toggle
        type="button"
        aria-pressed={voted}
        aria-label={t('picks.vote.toggle', { name: itemName, count: voters.length })}
        aria-describedby={open ? popoverId : undefined}
        title={summary}
        disabled={disabled}
        $on={voted}
        onPointerDown={(event) => {
          if (event.pointerType !== 'touch') return
          longPressed.current = false
          cancelPress()
          timer.current = setTimeout(() => {
            longPressed.current = true
            setOpen(true)
          }, LONG_PRESS_MS)
        }}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onContextMenu={(event) => event.preventDefault()}
        onClick={() => {
          // A long press only shows who wants to go
          if (longPressed.current) {
            longPressed.current = false
            return
          }
          onToggle(!voted)
        }}
      >
        <Heart filled={voted} />
        {voters.length > 0 ? t.plural('picks.votes', voters.length) : t('picks.vote.want')}
      </Toggle>
      {open && voters.length > 0 && (
        <Popover role="tooltip" id={popoverId}>
          <AvatarGroup>
            {voters.slice(0, 8).map((voter) => (
              <Avatar
                key={voter.id}
                name={voter.name}
                colorIndex={paletteIndex(voter.color, voter.id)}
                size="sm"
              />
            ))}
          </AvatarGroup>
          <Names>{summary}</Names>
        </Popover>
      )}
    </Wrapper>
  )
}

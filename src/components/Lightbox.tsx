import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import styled, { keyframes } from 'styled-components'
import { useT } from '../lib/i18n.ts'
import { visuallyHidden } from '../styles/mixins.ts'
import { color, duration, fontSize, fontWeight, media, space } from '../styles/tokens.ts'
import { IconButton } from './IconButton.tsx'
import { CloseIcon } from './icons.tsx'
import { PhotoThumb } from './PhotoThumb.tsx'

// The photo lightbox (DESIGN.md §3, e6-t04, AC-6.3): a full-screen native modal <dialog> (top
// layer, the rest of the page inert, so focus stays inside; Esc closes; focus returns to the tile).
// ←/→ and the side buttons step through the photos, a horizontal swipe does too; the position is
// announced (「第 N／M 張」). The info panel (time, place, actions) is the caller's. Motion only when
// the user has not asked for less.

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`

const Panel = styled.dialog`
  width: 100vw;
  max-width: 100vw;
  height: 100dvh;
  max-height: 100dvh;
  margin: 0;
  padding: 0;
  border: 0;
  background: ${color.paper};
  color: ${color.ink};
  &[open] {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    @media ${media.desktop} {
      grid-template-columns: minmax(0, 1fr) 340px;
      grid-template-rows: auto minmax(0, 1fr);
    }
  }
  &::backdrop {
    background: ${color.scrim};
  }
`

const Bar = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space.md}px;
  padding: ${space.sm}px ${space.sm}px ${space.sm}px ${space.lg}px;
  @media ${media.desktop} {
    grid-column: 1 / -1;
  }
`

const Counter = styled.h2`
  margin: 0;
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.semibold};
  font-variant-numeric: tabular-nums;
`

const Live = styled.p`
  ${visuallyHidden}
`

const Stage = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 0 ${space.xs}px;
  touch-action: pan-y;
  user-select: none;
`

const Frame = styled.div`
  width: 100%;
  height: 100%;
  @media ${media.motion} {
    animation: ${fadeIn} ${duration.base}ms ease-out;
  }
`

const Side = styled.div<{ $side: 'left' | 'right' }>`
  position: absolute;
  top: 50%;
  ${({ $side }) => $side}: ${space.sm}px;
  transform: translateY(-50%);
  border-radius: 999px;
  background: ${color.card};
  box-shadow: 0 2px 10px ${color.shadow};
`

const Info = styled.aside`
  max-height: 40dvh;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: ${space.md}px ${space.lg}px calc(${space.lg}px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid ${color.line};
  background: ${color.card};
  @media ${media.desktop} {
    max-height: none;
    border-top: 0;
    border-left: 1px solid ${color.line};
  }
`

const Chevron = ({ d }: { d: string }) => (
  <svg
    width={22}
    height={22}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d={d} />
  </svg>
)

/** How far a horizontal swipe must go to step (px) */
const SWIPE_PX = 48

export interface LightboxProps {
  open: boolean
  photos: readonly { id: string }[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  /** Defaults to the trip of the surrounding trip layout */
  tripId?: string
  /** Alt text of a photo by index (already translated) */
  altFor: (index: number) => string
  /** The info panel: capture time, place, actions */
  info?: ReactNode
}

export function Lightbox({
  open,
  photos,
  index,
  onIndexChange,
  onClose,
  tripId,
  altFor,
  info,
}: LightboxProps) {
  const t = useT()
  const ref = useRef<HTMLDialogElement>(null)
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null)
  const titleId = useId()
  const total = photos.length
  const current = photos[index]
  const position = t('photos.viewer.title', { index: index + 1, total })

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const show = open && current !== undefined
    if (show && !dialog.open) dialog.showModal()
    else if (!show && dialog.open) dialog.close()
  }, [open, current])

  const step = (delta: number) => {
    if (total < 2) return
    onIndexChange((index + delta + total) % total)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    // Arrow keys belong to form fields in the info panel
    const target = event.target as HTMLElement
    if (target.closest('input, select, textarea, [role="listbox"]')) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      step(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      step(1)
    }
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if ((event.target as HTMLElement).closest('button')) return
    swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current
    swipe.current = null
    if (!start || start.id !== event.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1)
  }

  return (
    <Panel
      ref={ref}
      aria-labelledby={titleId}
      data-testid="lightbox"
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        // Esc: the owner closes it by setting open=false
        event.preventDefault()
        onClose()
      }}
    >
      <Bar>
        <Counter id={titleId}>{position}</Counter>
        <IconButton label={t('common.close')} icon={<CloseIcon />} onClick={onClose} />
      </Bar>
      <Live aria-live="polite" aria-atomic="true">
        {open && current ? position : ''}
      </Live>
      <Stage
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipe.current = null
        }}
      >
        {open && current && (
          <Frame key={current.id}>
            <PhotoThumb
              attachmentId={current.id}
              tripId={tripId}
              variant="full"
              fit="contain"
              alt={altFor(index)}
            />
          </Frame>
        )}
        {total > 1 && (
          <>
            <Side $side="left">
              <IconButton
                label={t('photos.viewer.prev')}
                icon={<Chevron d="m15 18-6-6 6-6" />}
                onClick={() => step(-1)}
              />
            </Side>
            <Side $side="right">
              <IconButton
                label={t('photos.viewer.next')}
                icon={<Chevron d="m9 18 6-6-6-6" />}
                onClick={() => step(1)}
              />
            </Side>
          </>
        )}
      </Stage>
      {info && <Info aria-label={t('photos.viewer.info')}>{info}</Info>}
    </Panel>
  )
}

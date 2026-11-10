import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import styled, { css, keyframes } from 'styled-components'
import { useT } from '../lib/i18n.ts'
import { color, duration, fontSize, fontWeight, media, radius, space } from '../styles/tokens.ts'
import { IconButton } from './IconButton.tsx'
import { CloseIcon } from './icons.tsx'

// Dialog and Sheet are both a native modal <dialog>: showModal() puts it in the top layer and makes
// the rest of the page inert, so focus stays inside (the focus trap), Esc fires `cancel`, and the
// browser hands focus back to the opener on close. An owner may also unmount an open modal (a form
// rendered only while open): then the browser has no close to restore from, so the opener is
// remembered here and given the focus back (AC-10.5).

type Variant = 'dialog' | 'sheet'

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: none; }
`

const slideUp = keyframes`
  from { transform: translateY(100%); }
  to { transform: none; }
`

const Panel = styled.dialog<{ $variant: Variant }>`
  padding: 0;
  border: 1px solid ${color.line};
  background: ${color.card};
  color: ${color.ink};
  max-height: min(88dvh, 720px);
  overflow: hidden;
  &[open] {
    display: flex;
    flex-direction: column;
  }
  &::backdrop {
    background: ${color.scrim};
  }
  ${({ $variant }) =>
    $variant === 'dialog'
      ? css`
          width: min(440px, calc(100vw - ${space.xxl}px));
          border-radius: ${radius.card}px;
          @media ${media.motion} {
            &[open] {
              animation: ${fadeIn} ${duration.base}ms ease-out;
            }
          }
        `
      : css`
          /* Phones: a bottom drawer; tablet and up: a centered panel */
          width: 100vw;
          max-width: 100vw;
          margin: auto 0 0;
          border-radius: ${radius.cover}px ${radius.cover}px 0 0;
          border-bottom: 0;
          padding-bottom: env(safe-area-inset-bottom, 0px);
          @media ${media.motion} {
            &[open] {
              animation: ${slideUp} ${duration.slow}ms cubic-bezier(0.2, 0.8, 0.2, 1);
            }
          }
          @media ${media.tablet} {
            width: min(520px, calc(100vw - ${space.xxl}px));
            margin: auto;
            border-radius: ${radius.cover}px;
            border-bottom: 1px solid ${color.line};
            padding-bottom: 0;
            @media ${media.motion} {
              &[open] {
                animation: ${fadeIn} ${duration.base}ms ease-out;
              }
            }
          }
        `}
`

const Grabber = styled.div`
  width: 40px;
  height: 4px;
  margin: ${space.sm}px auto 0;
  border-radius: ${radius.pill}px;
  background: ${color.line};
  @media ${media.tablet} {
    display: none;
  }
`

const Header = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space.md}px;
  padding: ${space.md}px ${space.md}px 0 ${space.xl}px;
`

const Title = styled.h2`
  margin: 0;
  font-size: ${fontSize.lg}px;
  font-weight: ${fontWeight.bold};
`

const Body = styled.div`
  padding: ${space.md}px ${space.xl}px ${space.xl}px;
  overflow-y: auto;
  overscroll-behavior: contain;
`

const Actions = styled.footer`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: ${space.sm}px;
  padding: ${space.md}px ${space.xl}px ${space.xl}px;
  border-top: 1px solid ${color.line};
`

export interface DialogProps {
  open: boolean
  onClose: () => void
  /** Heading, also the accessible name (already translated) */
  title: string
  children?: ReactNode
  /** Buttons for the footer (the main action last) */
  actions?: ReactNode
}

function Modal({ variant, open, onClose, title, children, actions }: DialogProps & { variant: Variant }) {
  const t = useT()
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
    } else if (!open && dialog.open) dialog.close()
  }, [open])

  // Unmounted while open: close it while it is still in the document, then hand the focus back.
  // A layout cleanup runs before React removes the <dialog> node.
  useLayoutEffect(() => {
    const dialog = ref.current
    return () => {
      if (!dialog?.open) return
      dialog.close()
      const back = opener.current
      if (back?.isConnected) back.focus()
    }
  }, [])

  return (
    <Panel
      ref={ref}
      $variant={variant}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc: let the owner decide (it closes by setting open=false)
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> itself
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {variant === 'sheet' && <Grabber aria-hidden="true" />}
      <Header>
        <Title id={titleId}>{title}</Title>
        <IconButton label={t('common.close')} icon={<CloseIcon />} onClick={onClose} />
      </Header>
      <Body>{children}</Body>
      {actions && <Actions>{actions}</Actions>}
    </Panel>
  )
}

/** A centered modal for confirmations and short forms */
export function Dialog(props: DialogProps) {
  return <Modal variant="dialog" {...props} />
}

/** The editing surface: a bottom drawer on phones, a centered panel from tablet width (DESIGN.md §4) */
export function Sheet(props: DialogProps) {
  return <Modal variant="sheet" {...props} />
}

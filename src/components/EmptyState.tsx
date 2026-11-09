import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, fontSize, fontWeight, radius, space } from '../styles/tokens.ts'

export type Illustration = 'suitcase' | 'pin' | 'receipt'

const Wrapper = styled.div`
  display: grid;
  justify-items: center;
  gap: ${space.sm}px;
  padding: ${space.xxl}px ${space.xl}px;
  text-align: center;
  border: 1px dashed ${color.line};
  border-radius: ${radius.card}px;
`

const Art = styled.svg`
  width: 96px;
  height: 72px;
  margin-bottom: ${space.sm}px;
`

const Title = styled.h3`
  margin: 0;
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.bold};
`

const Body = styled.p`
  margin: 0;
  max-width: 40ch;
  color: ${color.muted};
  font-size: ${fontSize.sm + 1}px;
`

const Action = styled.div`
  margin-top: ${space.sm}px;
`

/** Simple geometric drawings: one stroke weight, the fjord and tussock accents (DESIGN.md §7) */
function Drawing({ kind }: { kind: Illustration }) {
  const stroke = { stroke: color.ink, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <Art viewBox="0 0 96 72" aria-hidden="true" focusable="false">
      <ellipse cx="48" cy="66" rx="34" ry="4" fill={color.line} />
      {kind === 'suitcase' && (
        <>
          <rect x="22" y="20" width="52" height="40" rx="6" {...stroke} fill={color.glacier} />
          <path d="M38 20v-6a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v6" {...stroke} fill="none" />
          <path d="M22 34h52" {...stroke} fill="none" />
          <rect x="44" y="30" width="8" height="8" rx="2" fill={color.tussock} stroke="none" />
        </>
      )}
      {kind === 'pin' && (
        <>
          <path d="M14 58l18-8 18 8 18-8 14 6" {...stroke} stroke={color.muted} fill="none" />
          <path d="M48 52s-16-14-16-26a16 16 0 0 1 32 0c0 12-16 26-16 26Z" {...stroke} fill={color.glacier} />
          <circle cx="48" cy="26" r="6" fill={color.fjord} stroke="none" />
        </>
      )}
      {kind === 'receipt' && (
        <>
          <path d="M30 8h36v54l-6-4-6 4-6-4-6 4-6-4-6 4Z" {...stroke} fill={color.tussockSoft} />
          <path d="M38 22h20M38 32h20M38 42h12" {...stroke} stroke={color.muted} fill="none" />
          <circle cx="62" cy="46" r="8" fill={color.fjord} stroke="none" />
        </>
      )}
    </Art>
  )
}

export interface EmptyStateProps {
  title: string
  body?: string
  illustration?: Illustration
  /** Usually one primary Button */
  action?: ReactNode
}

/** What a list shows before it has anything: a drawing, what goes here, and how to add the first */
export function EmptyState({ title, body, illustration = 'suitcase', action }: EmptyStateProps) {
  return (
    <Wrapper>
      <Drawing kind={illustration} />
      <Title>{title}</Title>
      {body && <Body>{body}</Body>}
      {action && <Action>{action}</Action>}
    </Wrapper>
  )
}

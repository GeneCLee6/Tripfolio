import type { ReactNode } from 'react'
import styled from 'styled-components'
import type { ExpenseCategory } from '../../shared/schema/expense.ts'
import { color, radius } from '../styles/tokens.ts'

// An expense category as a line icon on a tinted tile (the list rows and the form's category row,
// mockup Screen 4). Decorative: the row or button around it carries the words.

const tones: Record<ExpenseCategory, { background: string; ink: string }> = {
  food: { background: color.tussockSoft, ink: color.tussock },
  lodging: { background: color.glacier, ink: color.fjordInk },
  transport: { background: color.glacier, ink: color.fjordInk },
  fuel: { background: color.tussockSoft, ink: color.tussock },
  tickets: { background: color.glacier, ink: color.fjordInk },
  shopping: { background: color.tussockSoft, ink: color.tussock },
  misc: { background: color.paper, ink: color.muted },
  other: { background: color.paper, ink: color.muted },
}

const paths: Record<ExpenseCategory, ReactNode> = {
  food: (
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
  ),
  lodging: <path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9" />,
  transport: (
    <>
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2M9 17h6" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </>
  ),
  fuel: (
    <path d="M3 22h12M4 9h10M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.8a2 2 0 0 0-.6-1.4L18 5" />
  ),
  tickets: (
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v2M13 17v2M13 11v2" />
  ),
  shopping: (
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0" />
  ),
  misc: (
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1ZM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11" />
  ),
  other: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" />
    </>
  ),
}

const Tile = styled.span<{ $size: number; $background: string; $ink: string }>`
  display: inline-grid;
  place-items: center;
  flex: none;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border-radius: ${radius.control}px;
  background: ${({ $background }) => $background};
  color: ${({ $ink }) => $ink};
`

export interface CategoryIconProps {
  category: ExpenseCategory
  /** The tile's side in px (the icon is a little over half of it) */
  size?: number
}

/** The category's icon on its tile */
export function CategoryIcon({ category, size = 36 }: CategoryIconProps) {
  const tone = tones[category] ?? tones.other
  const icon = Math.round(size * 0.55)
  return (
    <Tile aria-hidden="true" $size={size} $background={tone.background} $ink={tone.ink}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        {paths[category] ?? paths.other}
      </svg>
    </Tile>
  )
}

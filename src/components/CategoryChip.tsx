import type { ReactNode } from 'react'
import styled from 'styled-components'
import type { WishlistCategory } from '../../shared/schema/index.ts'
import { useT } from '../lib/i18n.ts'
import { CATEGORY_LABEL } from '../lib/picks/labels.ts'
import { color, fontSize, fontWeight, radius, space } from '../styles/tokens.ts'

// The category of a pick (必吃／必買／必看／體驗, DESIGN.md §4 必吃必買): a pill laid over the card's
// picture, and the line glyph the placeholder picture draws large.

const glyphs: Record<WishlistCategory, ReactNode> = {
  // Fork and knife
  eat: (
    <>
      <path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8a2 2 0 0 1-2 2" />
      <path d="M17 21V3c-2 1-3 3-3 6v4h3" />
    </>
  ),
  // Bag
  buy: (
    <>
      <path d="M5 8h14l-1 13H6Z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
    </>
  ),
  // A mountain with the sun
  see: (
    <>
      <path d="m3 20 6-10 4 6 2-3 6 7Z" />
      <circle cx="17" cy="6" r="2" />
    </>
  ),
  // A ticket
  experience: (
    <>
      <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z" />
      <path d="M13 6v2M13 11v2M13 16v2" />
    </>
  ),
}

/** The category's line glyph (decorative) */
export function CategoryGlyph({ category, size = 16 }: { category: WishlistCategory; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size > 32 ? 1.5 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyphs[category]}
    </svg>
  )
}

const Pill = styled.span<{ $overlay: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs}px;
  min-height: 22px;
  padding: 0 ${space.sm + 1}px;
  border-radius: ${radius.pill}px;
  border: 1px solid ${({ $overlay }) => ($overlay ? 'transparent' : color.line)};
  background: ${color.card};
  color: ${color.ink};
  font-size: ${fontSize.sm - 2}px;
  font-weight: ${fontWeight.semibold};
  line-height: 1.2;
  white-space: nowrap;
  opacity: ${({ $overlay }) => ($overlay ? 0.94 : 1)};
`

export interface CategoryChipProps {
  category: WishlistCategory
  /** Laid over a picture (no border) */
  overlay?: boolean
}

/** 必吃／必買／必看／體驗 with its glyph */
export function CategoryChip({ category, overlay = false }: CategoryChipProps) {
  const t = useT()
  return (
    <Pill $overlay={overlay}>
      <CategoryGlyph category={category} size={12} />
      {t(CATEGORY_LABEL[category])}
    </Pill>
  )
}

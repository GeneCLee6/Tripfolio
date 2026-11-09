import type { ReactNode } from 'react'
import type { StopType } from '../../shared/schema/index.ts'

// One line glyph per stop type (DESIGN.md §3), in the same 24-grid style as icons.tsx. Decorative:
// the type's name is always written next to it or carried by the surrounding control.

const paths: Record<StopType, ReactNode> = {
  // Binoculars-like viewpoint: a mountain with the sun
  sight: (
    <>
      <path d="m3 20 6-10 4 6 2-3 6 7Z" />
      <circle cx="17" cy="6" r="2" />
    </>
  ),
  // Fork and knife
  food: (
    <>
      <path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8a2 2 0 0 1-2 2" />
      <path d="M17 21V3c-2 1-3 3-3 6v4h3" />
    </>
  ),
  // Bag
  shopping: (
    <>
      <path d="M5 8h14l-1 13H6Z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
    </>
  ),
  // Bed
  lodging: (
    <>
      <path d="M3 18V6M3 14h18v4M21 14v-3a3 3 0 0 0-3-3h-7v6" />
      <circle cx="7" cy="11" r="1.5" />
    </>
  ),
  // Bus
  transport: (
    <>
      <rect x="5" y="3" width="14" height="14" rx="2" />
      <path d="M5 11h14M8 17v3M16 17v3" />
    </>
  ),
  // Fuel pump
  fuel: (
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10" />
      <path d="M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3" />
    </>
  ),
  // Basket
  supplies: (
    <>
      <path d="M3 10h18l-2 10H5Z" />
      <path d="m8 10 3-6M16 10l-3-6M9 14v3M15 14v3" />
    </>
  ),
  // Coffee cup
  rest: (
    <>
      <path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z" />
      <path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3" />
    </>
  ),
  // Dot in a circle
  other: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
}

export interface StopTypeIconProps {
  type: StopType
  size?: number
}

/** The glyph of a stop type (also used for search result categories mapped to a stop type) */
export function StopTypeIcon({ type, size = 16 }: StopTypeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[type] ?? paths.other}
    </svg>
  )
}

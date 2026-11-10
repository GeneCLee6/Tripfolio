import type { ReactNode } from 'react'
import type { BookingType } from '../../shared/schema/booking.ts'

// One line glyph per booking type plus lodging (e4-t02, e4-t03), in the 24-grid style of
// StopTypeIcon. Decorative: the type is always written next to it.

export type BookingIconKind = BookingType | 'lodging'

const paths: Record<BookingIconKind, ReactNode> = {
  // Bed
  lodging: (
    <>
      <path d="M3 18V6M3 14h18v4M21 14v-3a3 3 0 0 0-3-3h-7v6" />
      <circle cx="7" cy="11" r="1.5" />
    </>
  ),
  // Plane
  flight: <path d="M10 21h4l-1-6 7 2v-3l-7-4V4a1.5 1.5 0 0 0-3 0v6l-7 4v3l7-2Z" />,
  // Car
  rental: (
    <>
      <path d="M4 16v-4l2-5h12l2 5v4Z" />
      <path d="M4 12h16" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="16.5" cy="17.5" r="1.5" />
    </>
  ),
  // Steering wheel
  driver: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2" />
      <path d="M4 11h6M14 11h6M12 14v6" />
    </>
  ),
  // Boat on water
  ferry: (
    <>
      <path d="M4 15h16l-2 4H6Z" />
      <path d="M7 15V9h10v6M10 9V6h4v3" />
      <path d="M3 21c2 0 2-1 4.5-1s2.5 1 4.5 1 2-1 4.5-1 2.5 1 4.5 1" />
    </>
  ),
  // Train front
  rail: (
    <>
      <rect x="6" y="3" width="12" height="14" rx="3" />
      <path d="M6 11h12M9 14h.01M15 14h.01M8 21l2-4M16 21l-2-4" />
    </>
  ),
  // Bus
  bus: (
    <>
      <rect x="5" y="3" width="14" height="14" rx="2" />
      <path d="M5 11h14M8 17v3M16 17v3" />
    </>
  ),
  // Ticket
  activity: (
    <>
      <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z" />
      <path d="M13 6v2M13 11v2M13 16v2" />
    </>
  ),
}

export interface BookingTypeIconProps {
  type: BookingIconKind
  size?: number
}

/** The glyph of a booking type, or of a lodging */
export function BookingTypeIcon({ type, size = 16 }: BookingTypeIconProps) {
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
      {paths[type] ?? paths.activity}
    </svg>
  )
}

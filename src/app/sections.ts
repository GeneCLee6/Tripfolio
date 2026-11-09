import type { ComponentType } from 'react'
import type { MessageKey } from '../../shared/i18n/t.ts'
import {
  ExpensesIcon,
  ItineraryIcon,
  MapIcon,
  OverviewIcon,
  PicksIcon,
  SettingsIcon,
} from './icons.tsx'

// The parts of a trip, in navigation order. The first five are the phone's bottom navigation
// (DESIGN.md §4); settings sits in the side navigation and the top bar.

export type SectionId = 'overview' | 'itinerary' | 'map' | 'picks' | 'expenses' | 'settings'

export interface Section {
  id: SectionId
  /** Path under /trips/:id ('' is the trip home) */
  path: string
  label: MessageKey
  /** One line for the trip home's section cards */
  body?: MessageKey
  icon: ComponentType<{ size?: number }>
  /** In the phone's bottom bar */
  inBottomNav: boolean
}

export const SECTIONS: readonly Section[] = [
  { id: 'overview', path: '', label: 'nav.overview', icon: OverviewIcon, inBottomNav: true },
  {
    id: 'itinerary',
    path: 'itinerary',
    label: 'nav.itinerary',
    body: 'section.itinerary.body',
    icon: ItineraryIcon,
    inBottomNav: true,
  },
  {
    id: 'map',
    path: 'map',
    label: 'nav.map',
    body: 'section.map.body',
    icon: MapIcon,
    inBottomNav: true,
  },
  {
    id: 'picks',
    path: 'picks',
    label: 'nav.picks',
    body: 'section.picks.body',
    icon: PicksIcon,
    inBottomNav: true,
  },
  {
    id: 'expenses',
    path: 'expenses',
    label: 'nav.expenses',
    body: 'section.expenses.body',
    icon: ExpensesIcon,
    inBottomNav: true,
  },
  {
    id: 'settings',
    path: 'settings',
    label: 'nav.settings',
    body: 'section.settings.body',
    icon: SettingsIcon,
    inBottomNav: false,
  },
]

/** The sections that are placeholders until later batches fill them (docs/ROADMAP.md) */
export const PLACEHOLDER_SECTIONS = ['itinerary', 'map', 'picks', 'expenses'] as const
export type PlaceholderSectionId = (typeof PLACEHOLDER_SECTIONS)[number]

export const tripPath = (tripId: string, section: Pick<Section, 'path'> | string = ''): string => {
  const path = typeof section === 'string' ? section : section.path
  return `/trips/${encodeURIComponent(tripId)}${path ? `/${path}` : ''}`
}

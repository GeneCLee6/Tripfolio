import { useSyncExternalStore } from 'react'
import { useThemePreference } from '../styles/theme.ts'
import type { MapScheme } from './types.ts'

// The colour scheme the map draws in: a fixed theme choice, else the system preference. MapLibre
// cannot read CSS variables, so the map needs the scheme itself to pick token values.

const DARK_QUERY = '(prefers-color-scheme: dark)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const mediaStore = (query: string) => ({
  subscribe(listener: () => void) {
    if (typeof matchMedia === 'undefined') return () => {}
    const list = matchMedia(query)
    list.addEventListener('change', listener)
    return () => list.removeEventListener('change', listener)
  },
  get: () => (typeof matchMedia === 'undefined' ? false : matchMedia(query).matches),
})

const dark = mediaStore(DARK_QUERY)
const reducedMotion = mediaStore(REDUCED_MOTION_QUERY)

export function useMapScheme(override?: MapScheme): MapScheme {
  const [preference] = useThemePreference()
  const systemDark = useSyncExternalStore(dark.subscribe, dark.get, () => false)
  if (override) return override
  if (preference === 'light' || preference === 'dark') return preference
  return systemDark ? 'dark' : 'light'
}

/** True when the camera should jump instead of fly (DESIGN.md §6) */
export const useReducedMotion = (): boolean =>
  useSyncExternalStore(reducedMotion.subscribe, reducedMotion.get, () => false)

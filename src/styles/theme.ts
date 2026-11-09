import { useSyncExternalStore } from 'react'

// Theme preference: follow the system (default) or a fixed light/dark, kept in localStorage. A fixed
// choice is written as <html data-theme>, which GlobalStyle reads; `system` removes the attribute
// and the prefers-color-scheme media query decides.

export type ThemePreference = 'system' | 'light' | 'dark'
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

const STORAGE_KEY = 'tripfolio.theme'
const listeners = new Set<() => void>()
let current: ThemePreference = 'system'

const isPreference = (value: unknown): value is ThemePreference =>
  value === 'system' || value === 'light' || value === 'dark'

function readStored(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isPreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

function apply(preference: ThemePreference): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (preference === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', preference)
}

/** Reads the stored preference and applies it; call once before the first render */
export function initTheme(): void {
  current = readStored()
  apply(current)
}

export const getThemePreference = (): ThemePreference => current

export function setThemePreference(preference: ThemePreference): void {
  current = preference
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Private mode or storage disabled: the choice lasts for this page only
  }
  apply(preference)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The current preference and its setter; re-renders when it changes */
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const preference = useSyncExternalStore(subscribe, getThemePreference, getThemePreference)
  return [preference, setThemePreference]
}

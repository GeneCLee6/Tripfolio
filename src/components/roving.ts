import type { KeyboardEvent } from 'react'

/**
 * Arrow-key movement for a row of options (Tabs, SegmentedControl): Left/Right (and Up/Down) step
 * with wrap-around, Home/End jump. Focuses the new option and selects it.
 */
export function rovingKeyDown<T>(
  event: KeyboardEvent<HTMLElement>,
  values: readonly T[],
  current: T,
  select: (value: T) => void,
): void {
  const index = values.indexOf(current)
  let next: number
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = (index + 1) % values.length
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      next = (index - 1 + values.length) % values.length
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = values.length - 1
      break
    default:
      return
  }
  event.preventDefault()
  select(values[next])
  const buttons = event.currentTarget.querySelectorAll<HTMLElement>('[data-roving]')
  buttons[next]?.focus()
}

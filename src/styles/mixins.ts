import { css } from 'styled-components'
import { color } from './tokens.ts'

/** The visible focus ring (DESIGN.md §6: accent, 2 px outline) */
export const focusRing = css`
  &:focus-visible {
    outline: 2px solid ${color.fjord};
    outline-offset: 2px;
  }
`

/** Hidden visually, still read by screen readers */
export const visuallyHidden = css`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
`

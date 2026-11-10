import { css } from 'styled-components'
import { color, media, touchTarget } from './tokens.ts'

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

/** At least a 44 px target on a coarse pointer (DESIGN.md §6), for controls that set a smaller size */
export const coarseTarget = css`
  @media ${media.coarse} {
    min-height: ${touchTarget}px;
    min-width: ${touchTarget}px;
  }
`

/** A link standing on its own (not in running text): a 44 px tall target on a coarse pointer */
export const coarseLink = css`
  @media ${media.coarse} {
    display: inline-flex;
    align-items: center;
    min-height: ${touchTarget}px;
  }
`

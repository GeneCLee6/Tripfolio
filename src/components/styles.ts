import { css } from 'styled-components'
import { focusRing } from '../styles/mixins.ts'
import { color, duration, fontSize, fontWeight, media, radius, space, touchTarget } from '../styles/tokens.ts'

// Style blocks shared by several components

/** Shared by Button and IconButton */
export const pressable = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${space.sm}px;
  border: 1px solid transparent;
  border-radius: ${radius.control}px;
  font-weight: ${fontWeight.semibold};
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @media ${media.motion} {
    transition:
      background-color ${duration.fast}ms ease,
      border-color ${duration.fast}ms ease,
      transform ${duration.fast}ms ease;
    &:active:not(:disabled) {
      transform: scale(0.98);
    }
  }
  ${focusRing}
`

/** The box every text-like control shares: Input, Select, DateField, TimeField, MoneyField */
export const controlBox = css`
  width: 100%;
  min-height: 40px;
  padding: 0 ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.card};
  color: ${color.ink};
  font-size: ${fontSize.body}px;
  &::placeholder {
    color: ${color.muted};
    opacity: 1;
  }
  &:hover:not(:disabled) {
    border-color: ${color.muted};
  }
  &:focus-visible {
    outline: 2px solid ${color.fjord};
    outline-offset: 1px;
    border-color: ${color.fjord};
  }
  &[aria-invalid='true'] {
    border-color: ${color.danger};
  }
  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  @media ${media.motion} {
    transition: border-color ${duration.fast}ms ease;
  }
  @media ${media.coarse} {
    min-height: ${touchTarget}px;
    font-size: 16px; /* iOS zooms into inputs below 16 px */
  }
`


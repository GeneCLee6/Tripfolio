import styled, { css } from 'styled-components'
import { color, duration, fontSize, fontWeight, media, radius, space } from '../styles/tokens.ts'

/**
 * A surface on the paper background. Flat by default (DESIGN.md §2: depth comes from the background
 * difference); `$interactive` adds the one hover shadow and a small lift.
 */
export const Card = styled.section<{ $interactive?: boolean; $padding?: keyof typeof space; $accent?: string }>`
  position: relative;
  min-width: 0;
  padding: ${({ $padding = 'lg' }) => space[$padding]}px;
  background: ${color.card};
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  overflow: hidden;
  ${({ $accent }) =>
    $accent &&
    css`
      border-left: 6px solid ${$accent};
    `}
  ${({ $interactive }) =>
    $interactive &&
    css`
      cursor: pointer;
      &:hover {
        box-shadow: 0 6px 20px ${color.shadow};
      }
      @media ${media.motion} {
        transition:
          transform ${duration.fast}ms ease,
          box-shadow ${duration.fast}ms ease;
        &:hover {
          transform: translateY(-2px);
        }
      }
    `}
`

export const CardTitle = styled.h3`
  margin: 0 0 ${space.xs}px;
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.bold};
`

export const CardText = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

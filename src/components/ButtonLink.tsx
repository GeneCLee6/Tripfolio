import { Link, type LinkProps } from 'react-router-dom'
import styled, { css } from 'styled-components'
import { color, fontSize, media, space, touchTarget } from '../styles/tokens.ts'
import { pressable } from './styles.ts'

// A router link drawn as a Button, for navigation that looks like an action ("New trip")

const StyledLink = styled(Link)<{ $variant: 'primary' | 'secondary' | 'ghost' }>`
  ${pressable}
  min-height: 40px;
  padding: 0 ${space.lg}px;
  font-size: ${fontSize.body}px;
  text-decoration: none;
  ${({ $variant }) =>
    $variant === 'primary'
      ? css`
          background: ${color.fjord};
          border-color: ${color.fjord};
          color: ${color.onFjord};
          &:hover {
            background: color-mix(in srgb, ${color.fjord} 85%, ${color.ink});
          }
        `
      : $variant === 'secondary'
        ? css`
            background: ${color.paper};
            border-color: ${color.line};
            color: ${color.ink};
            &:hover {
              border-color: ${color.muted};
            }
          `
        : css`
            background: transparent;
            color: ${color.fjord};
            &:hover {
              background: ${color.glacier};
            }
          `}
  @media ${media.coarse} {
    min-height: ${touchTarget}px;
  }
`

export function ButtonLink({
  variant = 'secondary',
  ...rest
}: LinkProps & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return <StyledLink $variant={variant} {...rest} />
}

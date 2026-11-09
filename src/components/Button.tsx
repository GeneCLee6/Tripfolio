import type { ButtonHTMLAttributes } from 'react'
import styled, { css } from 'styled-components'
import { color, fontSize, media, space, touchTarget } from '../styles/tokens.ts'
import { pressable } from './styles.ts'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const heights: Record<ButtonSize, number> = { sm: 32, md: 40, lg: 48 }

const variants: Record<ButtonVariant, ReturnType<typeof css>> = {
  primary: css`
    background: ${color.fjord};
    border-color: ${color.fjord};
    color: ${color.onFjord};
    &:hover:not(:disabled) {
      background: color-mix(in srgb, ${color.fjord} 85%, ${color.ink});
    }
  `,
  secondary: css`
    background: ${color.paper};
    border-color: ${color.line};
    color: ${color.ink};
    &:hover:not(:disabled) {
      border-color: ${color.muted};
    }
  `,
  ghost: css`
    background: transparent;
    border-color: transparent;
    color: ${color.fjord};
    &:hover:not(:disabled) {
      background: ${color.glacier};
    }
  `,
  danger: css`
    background: ${color.danger};
    border-color: ${color.danger};
    color: ${color.onFjord};
    &:hover:not(:disabled) {
      background: color-mix(in srgb, ${color.danger} 85%, ${color.ink});
    }
  `,
}

const StyledButton = styled.button<{ $variant: ButtonVariant; $size: ButtonSize; $block: boolean }>`
  ${pressable}
  min-height: ${({ $size }) => heights[$size]}px;
  padding: 0 ${({ $size }) => ($size === 'sm' ? space.md : space.lg)}px;
  font-size: ${({ $size }) => ($size === 'lg' ? fontSize.md : $size === 'sm' ? fontSize.sm : fontSize.body)}px;
  width: ${({ $block }) => ($block ? '100%' : 'auto')};
  ${({ $variant }) => variants[$variant]}
  @media ${media.coarse} {
    min-height: ${({ $size }) => Math.max(heights[$size], touchTarget)}px;
  }
`

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Full width */
  block?: boolean
}

/** The one button: primary for the main action of a view, secondary for the rest */
export function Button({ variant = 'secondary', size = 'md', block = false, type = 'button', ...rest }: ButtonProps) {
  return <StyledButton $variant={variant} $size={size} $block={block} type={type} {...rest} />
}

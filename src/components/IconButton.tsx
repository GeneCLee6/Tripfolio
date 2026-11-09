import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { color, media, touchTarget } from '../styles/tokens.ts'
import type { ButtonSize } from './Button.tsx'
import { pressable } from './styles.ts'

const sizes: Record<ButtonSize, number> = { sm: 32, md: 40, lg: 48 }

const StyledIconButton = styled.button<{ $size: ButtonSize; $variant: 'ghost' | 'secondary' | 'primary' }>`
  ${pressable}
  width: ${({ $size }) => sizes[$size]}px;
  height: ${({ $size }) => sizes[$size]}px;
  padding: 0;
  ${({ $variant }) =>
    $variant === 'primary'
      ? css`
          background: ${color.fjord};
          color: ${color.onFjord};
        `
      : $variant === 'secondary'
        ? css`
            background: ${color.paper};
            border-color: ${color.line};
            color: ${color.ink};
          `
        : css`
            background: transparent;
            color: ${color.muted};
            &:hover:not(:disabled) {
              background: ${color.glacier};
              color: ${color.ink};
            }
          `}
  @media ${media.coarse} {
    width: ${({ $size }) => Math.max(sizes[$size], touchTarget)}px;
    height: ${({ $size }) => Math.max(sizes[$size], touchTarget)}px;
  }
`

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: the button has no visible text, so this is its name (already translated) */
  label: string
  icon: ReactNode
  size?: ButtonSize
  variant?: 'ghost' | 'secondary' | 'primary'
}

/** A square button holding one icon; `label` becomes its aria-label and tooltip */
export function IconButton({ label, icon, size = 'md', variant = 'ghost', type = 'button', ...rest }: IconButtonProps) {
  return (
    <StyledIconButton aria-label={label} title={label} $size={size} $variant={variant} type={type} {...rest}>
      {icon}
    </StyledIconButton>
  )
}

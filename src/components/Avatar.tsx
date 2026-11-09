import styled from 'styled-components'
import { color, dayColor, fontWeight, onDayColor } from '../styles/tokens.ts'
import { initialOf } from './text.ts'

export type AvatarSize = 'sm' | 'md' | 'lg'
const sizes: Record<AvatarSize, number> = { sm: 22, md: 30, lg: 44 }

const Circle = styled.span<{ $size: AvatarSize; $color: string }>`
  display: inline-grid;
  place-items: center;
  flex: none;
  width: ${({ $size }) => sizes[$size]}px;
  height: ${({ $size }) => sizes[$size]}px;
  border-radius: 50%;
  border: 2px solid ${color.card};
  background: ${({ $color }) => $color};
  color: ${onDayColor};
  font-size: ${({ $size }) => Math.round(sizes[$size] * 0.45)}px;
  font-weight: ${fontWeight.semibold};
  line-height: 1;
  user-select: none;
`

export interface AvatarProps {
  /** The member's display name (user content, also the accessible name) */
  name: string
  /** The member's color slot (index into the day palette) */
  colorIndex: number
  size?: AvatarSize
}

/** A member: their initial on their color */
export function Avatar({ name, colorIndex, size = 'md' }: AvatarProps) {
  return (
    <Circle role="img" aria-label={name} title={name} $size={size} $color={dayColor(colorIndex)}>
      {initialOf(name)}
    </Circle>
  )
}

/** Overlapping avatars (who recommended a pick, who is in a split) */
export const AvatarGroup = styled.span`
  display: inline-flex;
  > * + * {
    margin-left: -6px;
  }
`

import styled, { keyframes } from 'styled-components'
import { color, media, radius } from '../styles/tokens.ts'

const shimmer = keyframes`
  from { background-position: 150% 0; }
  to { background-position: -50% 0; }
`

/**
 * A placeholder block while data loads. Decorative (aria-hidden): put `aria-busy` on the region that
 * is loading. The shimmer only runs without prefers-reduced-motion.
 */
export const Skeleton = styled.span.attrs({ 'aria-hidden': true })<{
  $width?: number | string
  $height?: number
  $radius?: keyof typeof radius
}>`
  display: block;
  width: ${({ $width = '100%' }) => (typeof $width === 'number' ? `${$width}px` : $width)};
  height: ${({ $height = 14 }) => $height}px;
  border-radius: ${({ $radius = 'control' }) => radius[$radius]}px;
  background-color: ${color.line};
  background-image: linear-gradient(90deg, transparent 0%, ${color.shimmer} 50%, transparent 100%);
  background-size: 200% 100%;
  background-repeat: no-repeat;
  @media ${media.motion} {
    animation: ${shimmer} 1.4s ease-in-out infinite;
  }
`

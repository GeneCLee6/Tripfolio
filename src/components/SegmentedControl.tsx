import styled from 'styled-components'
import { focusRing } from '../styles/mixins.ts'
import { color, duration, fontSize, fontWeight, media, radius, space, touchTarget } from '../styles/tokens.ts'
import { rovingKeyDown } from './roving.ts'

const Group = styled.div<{ $size: 'sm' | 'md' }>`
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill}px;
  background: ${color.card};
  font-size: ${({ $size }) => ($size === 'sm' ? fontSize.sm : fontSize.body)}px;
`

const Option = styled.button<{ $active: boolean; $size: 'sm' | 'md' }>`
  min-height: ${({ $size }) => ($size === 'sm' ? 28 : 34)}px;
  padding: 0 ${({ $size }) => ($size === 'sm' ? space.md - 2 : space.md)}px;
  border: 0;
  border-radius: ${radius.pill}px;
  background: ${({ $active }) => ($active ? color.ink : 'transparent')};
  color: ${({ $active }) => ($active ? color.paper : color.muted)};
  font-weight: ${({ $active }) => ($active ? fontWeight.semibold : fontWeight.medium)};
  white-space: nowrap;
  cursor: pointer;
  &:hover {
    color: ${({ $active }) => ($active ? color.paper : color.ink)};
  }
  @media ${media.motion} {
    transition:
      background-color ${duration.fast}ms ease,
      color ${duration.fast}ms ease;
  }
  @media ${media.coarse} {
    min-height: ${touchTarget}px;
  }
  ${focusRing}
`

export interface SegmentOption<T extends string> {
  value: T
  label: string
  /** The option's language when it differs from the page (a language switch) */
  lang?: string
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name of the group (already translated) */
  label: string
  size?: 'sm' | 'md'
}

/** One choice out of a few, all visible (a radio group drawn as a pill) */
export function SegmentedControl<T extends string>({ options, value, onChange, label, size = 'md' }: SegmentedControlProps<T>) {
  const values = options.map((option) => option.value)
  return (
    <Group
      role="radiogroup"
      aria-label={label}
      $size={size}
      onKeyDown={(event) => rovingKeyDown(event, values, value, onChange)}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <Option
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            lang={option.lang}
            data-roving=""
            $active={active}
            $size={size}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Option>
        )
      })}
    </Group>
  )
}

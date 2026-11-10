import styled from 'styled-components'
import { paletteIndex } from '../lib/colors.ts'
import { focusRing } from '../styles/mixins.ts'
import { color, fontSize, fontWeight, media, radius, space, touchTarget } from '../styles/tokens.ts'
import { Avatar } from './Avatar.tsx'
import { initialOf } from './text.ts'

// Members as tappable avatar chips: one of them (誰付, with an extra chip for the pool) or any of
// them (分給誰: everyone starts selected, a tap leaves someone out).

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
`

const Option = styled.button<{ $selected: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: ${space.sm}px;
  min-height: 36px;
  max-width: 100%;
  padding: 0 ${space.md}px 0 ${space.xs}px;
  border: 1px solid ${({ $selected }) => ($selected ? color.fjord : color.line)};
  border-radius: ${radius.pill}px;
  background: ${({ $selected }) => ($selected ? color.glacier : color.card)};
  color: ${({ $selected }) => ($selected ? color.fjordInk : color.muted)};
  font: inherit;
  font-size: ${fontSize.sm}px;
  font-weight: ${({ $selected }) => ($selected ? fontWeight.semibold : fontWeight.regular)};
  cursor: pointer;
  > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  > span:first-child {
    opacity: ${({ $selected }) => ($selected ? 1 : 0.45)};
  }
  @media ${media.coarse} {
    min-height: ${touchTarget}px;
  }
  ${focusRing}
`

const ExtraMark = styled.span`
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: ${color.tussockSoft};
  color: ${color.tussockText};
  font-weight: ${fontWeight.bold};
`

export interface PickerMember {
  id: string
  name: string
  color: string
}

export interface MemberPickerProps {
  /** Accessible name of the group (already translated) */
  label: string
  members: readonly PickerMember[]
  /** Selected ids (single mode: one of the members or the extra's id) */
  selected: readonly string[]
  /** single: pick this one · multi: toggle it */
  onSelect: (id: string) => void
  mode?: 'single' | 'multi'
  /** One more option after the members, e.g. the pool (公基金) */
  extra?: { id: string; label: string } | null
}

/** Pick who paid (single) or who shares (multi) */
export function MemberPicker({
  label,
  members,
  selected,
  onSelect,
  mode = 'multi',
  extra = null,
}: MemberPickerProps) {
  const single = mode === 'single'
  const options = [
    ...members.map((member) => ({ id: member.id, label: member.name, member })),
    ...(extra ? [{ id: extra.id, label: extra.label, member: null }] : []),
  ]
  return (
    <Row role={single ? 'radiogroup' : 'group'} aria-label={label}>
      {options.map((option) => {
        const isSelected = selected.includes(option.id)
        return (
          <Option
            key={option.id}
            type="button"
            role={single ? 'radio' : undefined}
            aria-checked={single ? isSelected : undefined}
            aria-pressed={single ? undefined : isSelected}
            $selected={isSelected}
            onClick={() => onSelect(option.id)}
          >
            {option.member ? (
              <span aria-hidden="true">
                <Avatar
                  name={option.member.name}
                  colorIndex={paletteIndex(option.member.color, option.member.id)}
                  size="sm"
                />
              </span>
            ) : (
              <ExtraMark aria-hidden="true">{initialOf(option.label)}</ExtraMark>
            )}
            <span>{option.label}</span>
          </Option>
        )
      })}
    </Row>
  )
}

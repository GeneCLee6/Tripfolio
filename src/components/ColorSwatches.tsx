import styled from 'styled-components'
import { useT } from '../lib/i18n.ts'
import { DAY_COLOR_NAMES } from '../lib/colors.ts'
import { focusRing } from '../styles/mixins.ts'
import {
  color,
  dayColors,
  fontSize,
  fontWeight,
  media,
  space,
  touchTarget,
} from '../styles/tokens.ts'
import { rovingKeyDown } from './roving.ts'

const Group = styled.div`
  display: grid;
  gap: ${space.xs}px;
`

const Label = styled.span`
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
`

const Swatch = styled.button<{ $color: string; $active: boolean }>`
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50%;
  border: 2px solid ${({ $active }) => ($active ? color.ink : 'transparent')};
  background: ${({ $color }) => $color};
  box-shadow: inset 0 0 0 2px ${color.card};
  cursor: pointer;
  @media ${media.coarse} {
    width: ${touchTarget - 4}px;
    height: ${touchTarget - 4}px;
  }
  ${focusRing}
`

export interface ColorSwatchesProps {
  /** Visible label of the group (already translated) */
  label: string
  /** One of the day colours (hex) */
  value: string
  onChange: (value: string) => void
}

/** Pick one of the ten day colours (trip covers, member avatars); a radio group with arrow keys */
export function ColorSwatches({ label, value, onChange }: ColorSwatchesProps) {
  const t = useT()
  const values = [...dayColors] as string[]
  const current = values.includes(value) ? value : values[0]
  return (
    <Group>
      <Label>{label}</Label>
      <Row
        role="radiogroup"
        aria-label={label}
        onKeyDown={(event) => rovingKeyDown(event, values, current, onChange)}
      >
        {values.map((hex, index) => {
          const active = hex === current
          return (
            <Swatch
              key={hex}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={t(`color.${DAY_COLOR_NAMES[index]}`)}
              title={t(`color.${DAY_COLOR_NAMES[index]}`)}
              tabIndex={active ? 0 : -1}
              data-roving=""
              $color={hex}
              $active={active}
              onClick={() => onChange(hex)}
            />
          )
        })}
      </Row>
    </Group>
  )
}

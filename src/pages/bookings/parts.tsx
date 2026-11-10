import { useMemo, useState, type ReactNode } from 'react'
import styled from 'styled-components'
import type { Place } from '../../../shared/api/types.ts'
import { Button, PlacePicker, Select } from '../../components/index.ts'
import { useT } from '../../lib/i18n.ts'
import { timeZoneOptions } from '../../lib/trip-prefill.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, fontSize, fontWeight, media, radius, space } from '../../styles/tokens.ts'

// Small pieces the lodging and booking sheets share: two-column rows, a checkbox, the time-zone
// select, and a place field (PlacePicker, then the chosen place with 「移除」).

export const Pair = styled.div`
  display: grid;
  gap: ${space.md}px;
  @media ${media.tablet} {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`

export const Group = styled.fieldset`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
  > legend {
    padding: 0;
    margin-bottom: ${space.xs}px;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.semibold};
    color: ${color.ink};
  }
`

export const Hint = styled.p<{ $tone?: 'warning' | 'danger' }>`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${({ $tone }) =>
    $tone === 'danger' ? color.danger : $tone === 'warning' ? color.warning : color.muted};
`

const CheckLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: ${space.sm}px;
  min-height: 36px;
  padding: 0 ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill}px;
  background: ${color.card};
  font-size: ${fontSize.sm}px;
  cursor: pointer;
  > input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: ${color.fjord};
  }
  &:focus-within {
    border-color: ${color.fjord};
  }
`

export const Checks = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
`

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <CheckLabel>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </CheckLabel>
  )
}

/** An IANA zone, the trip's first */
export function TzSelect({
  label,
  hint,
  value,
  tripTz,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  tripTz: string
  onChange: (tz: string) => void
}) {
  const zones = useMemo(() => timeZoneOptions(tripTz, value), [tripTz, value])
  return (
    <Select label={label} hint={hint} value={value} onChange={(event) => onChange(event.target.value)}>
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </Select>
  )
}

const Chosen = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space.sm}px;
  padding: ${space.sm}px ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.paper};
  font-size: ${fontSize.sm}px;
`

const More = styled.button`
  justify-self: start;
  padding: 0;
  border: 0;
  background: transparent;
  color: ${color.fjord};
  font: inherit;
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
  cursor: pointer;
  ${focusRing}
`

/** A place from search; null clears it */
export function PlaceField({
  label,
  tripId,
  places,
  bias,
  placeId,
  onChange,
  onPlaceCreated,
}: {
  label: string
  tripId: string
  places: readonly Place[]
  bias: { lat: number; lng: number } | null
  placeId: string | null
  onChange: (place: Place | null) => void
  onPlaceCreated: (place: Place) => void
}) {
  const t = useT()
  const place = placeId ? places.find((p) => p.id === placeId) : undefined
  return (
    <Group>
      <legend>{label}</legend>
      {placeId ? (
        <Chosen>
          <span>{place ? place.nameLocal : t('bookings.form.placeChosen')}</span>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            {t('bookings.form.placeClear')}
          </Button>
        </Chosen>
      ) : (
        <PlacePicker
          tripId={tripId}
          places={places}
          bias={bias}
          onPlaceCreated={onPlaceCreated}
          onPick={(pick) => {
            if (!pick.manual) onChange(pick.place)
          }}
        />
      )}
    </Group>
  )
}

/** 「更多欄位」: the rest of a form, folded until asked for */
export function Folded({ open: initial, children }: { open?: boolean; children: ReactNode }) {
  const t = useT()
  const [open, setOpen] = useState(initial ?? false)
  if (open) return <>{children}</>
  return (
    <More type="button" aria-expanded={false} onClick={() => setOpen(true)}>
      {t('bookings.form.more')}
    </More>
  )
}

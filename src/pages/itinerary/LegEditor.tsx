import { useState } from 'react'
import styled from 'styled-components'
import type { TripStyle } from '../../../shared/itinerary/types.ts'
import { formatDistance, formatDuration } from '../../../shared/i18n/format.ts'
import { Button, Input, Select } from '../../components/index.ts'
import { useT } from '../../lib/i18n.ts'
import {
  OVERRIDE_MODES,
  overrideModeOf,
  parseMinutes,
  type DisplayLeg,
  type OverrideMode,
} from '../../lib/itinerary/legs.ts'
import { color, fontSize, space } from '../../styles/tokens.ts'
import { LEG_MODE_LABEL } from './labels.ts'

// The leg editor (e2-t05): pick the transport mode and, optionally, type the minutes by hand
// (PUT /legs/:from/:to); 「恢復自動」 removes the override (DELETE). The API stores mode and
// minutes only, so the distance stays the routed or estimated one.

const Form = styled.form`
  display: grid;
  gap: ${space.lg}px;
`

const Route = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
  overflow-wrap: anywhere;
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: ${space.sm}px;
  padding-top: ${space.sm}px;
  border-top: 1px solid ${color.line};
`

const Spacer = styled.span`
  flex: 1;
`

export interface LegEditorProps {
  leg: DisplayLeg
  fromName: string
  toName: string
  style: TripStyle
  onSave: (mode: OverrideMode, minutes: number | null) => void
  onReset: () => void
  onClose: () => void
}

export function LegEditor({
  leg,
  fromName,
  toName,
  style,
  onSave,
  onReset,
  onClose,
}: LegEditorProps) {
  const t = useT()
  const [mode, setMode] = useState<OverrideMode>(overrideModeOf(leg.mode))
  const [minutes, setMinutes] = useState(
    leg.overrideMinutes !== null ? String(leg.overrideMinutes) : '',
  )
  const [error, setError] = useState<string | undefined>()
  const label = (value: OverrideMode) =>
    t(LEG_MODE_LABEL[value === 'drive' && style === 'campervan' ? 'campervan' : value])

  return (
    <Form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        const parsed = parseMinutes(minutes)
        if (parsed !== null && Number.isNaN(parsed)) {
          setError(t('itinerary.leg.invalidMinutes'))
          return
        }
        onSave(mode, parsed)
        onClose()
      }}
    >
      <Route>{t('itinerary.leg.route', { from: fromName, to: toName })}</Route>
      <Select
        label={t('itinerary.leg.modeLabel')}
        value={mode}
        onChange={(event) => setMode(event.target.value as OverrideMode)}
      >
        {OVERRIDE_MODES.map((value) => (
          <option key={value} value={value}>
            {label(value)}
          </option>
        ))}
      </Select>
      <Input
        label={t('itinerary.leg.minutesLabel')}
        optional
        inputMode="numeric"
        value={minutes}
        error={error}
        hint={t('itinerary.leg.minutesHint', {
          duration: formatDuration(leg.durationS / 60, t.locale),
          distance: formatDistance(leg.distanceM, t.locale),
        })}
        onChange={(event) => {
          setMinutes(event.target.value)
          setError(undefined)
        }}
      />
      <Actions>
        {leg.overridden && (
          <Button
            variant="ghost"
            onClick={() => {
              onReset()
              onClose()
            }}
          >
            {t('itinerary.leg.reset')}
          </Button>
        )}
        <Spacer />
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" type="submit">
          {t('common.save')}
        </Button>
      </Actions>
    </Form>
  )
}

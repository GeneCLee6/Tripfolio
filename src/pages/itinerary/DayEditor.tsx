import { useId, useState } from 'react'
import styled from 'styled-components'
import type { Day } from '../../../shared/api/types.ts'
import type { DayPatch } from '../../../shared/schema/index.ts'
import { dayPatchSchema } from '../../../shared/schema/index.ts'
import { Button, ColorSwatches, Input } from '../../components/index.ts'
import { controlBox } from '../../components/styles.ts'
import { useT } from '../../lib/i18n.ts'
import { color, fontSize, fontWeight, space } from '../../styles/tokens.ts'

// A day's title, colour and note (e2-t02), in the detail pane or a Sheet

const Form = styled.form`
  display: grid;
  gap: ${space.lg}px;
`

const Label = styled.label`
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
`

const Field = styled.div`
  display: grid;
  gap: ${space.xs}px;
`

const Textarea = styled.textarea`
  ${controlBox}
  min-height: 96px;
  padding: ${space.sm}px ${space.md}px;
  resize: vertical;
  font: inherit;
`

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${space.sm}px;
  padding-top: ${space.sm}px;
  border-top: 1px solid ${color.line};
`

export interface DayEditorProps {
  day: Day
  /** The colour the day shows now (its own, or the palette slot of its number) */
  shownColor: string
  onSubmit: (patch: DayPatch) => void
  onClose: () => void
}

export function DayEditor({ day, shownColor, onSubmit, onClose }: DayEditorProps) {
  const t = useT()
  const noteId = useId()
  const [title, setTitle] = useState(day.title)
  const [dayColor, setDayColor] = useState(day.color ?? shownColor)
  const [note, setNote] = useState(day.note)

  return (
    <Form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        const patch: DayPatch = {}
        if (title.trim() !== day.title) patch.title = title.trim()
        if (dayColor !== (day.color ?? shownColor)) patch.color = dayColor
        if (note !== day.note) patch.note = note
        const parsed = dayPatchSchema.safeParse(patch)
        if (parsed.success && Object.keys(patch).length > 0) onSubmit(parsed.data)
        onClose()
      }}
    >
      <Input
        label={t('itinerary.day.titleLabel')}
        placeholder={t('itinerary.day.titlePlaceholder')}
        value={title}
        maxLength={120}
        onChange={(event) => setTitle(event.target.value)}
      />
      <ColorSwatches label={t('itinerary.day.color')} value={dayColor} onChange={setDayColor} />
      <Field>
        <Label htmlFor={noteId}>{t('itinerary.day.note')}</Label>
        <Textarea
          id={noteId}
          value={note}
          maxLength={5000}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <Actions>
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

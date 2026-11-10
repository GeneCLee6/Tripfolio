import { useId } from 'react'
import styled from 'styled-components'
import { useT } from '../lib/i18n.ts'
import {
  DEFAULT_RANGE,
  WEEK_ORDER,
  isClosedDay,
  weekdayName,
  withDay,
  type HoursDraft,
  type HoursIssue,
} from '../lib/places/hours.ts'
import { color, font, fontSize, fontWeight, media, space } from '../styles/tokens.ts'
import { Button } from './Button.tsx'
import { Input } from './Field.tsx'
import { IconButton } from './IconButton.tsx'
import { CloseIcon } from './icons.tsx'
import { controlBox } from './styles.ts'

// Weekly opening hours (e3-t05): one row per weekday, Monday first, each with `HH:mm–HH:mm` ranges
// (a range that closes before it opens runs past midnight) or 「休息」. Days without ranges are
// closed once any day has one; with none at all the hours are unknown. Plus a free-text note. The
// draft becomes the stored PlaceHours through hoursFromDraft (src/lib/places/hours.ts).

const Table = styled.fieldset`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
`

const Legend = styled.legend`
  padding: 0;
  margin-bottom: ${space.xs}px;
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
`

const Hint = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Row = styled.div`
  display: grid;
  gap: ${space.xs}px ${space.sm}px;
  @media ${media.tablet} {
    grid-template-columns: 3.5em minmax(0, 1fr);
  }
  align-items: start;
  padding: ${space.xs}px 0;
  border-top: 1px solid ${color.line};
`

const Day = styled.span`
  @media ${media.tablet} {
    padding-top: ${space.sm}px;
  }
  font-weight: ${fontWeight.medium};
`

const Ranges = styled.div`
  display: grid;
  gap: ${space.xs}px;
  min-width: 0;
`

const Range = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 11em) auto minmax(0, 11em) auto;
  align-items: center;
  gap: ${space.xs}px;
`

const Time = styled.input`
  ${controlBox}
  width: 100%;
  min-width: 0;
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
`

const Dash = styled.span`
  color: ${color.muted};
`

const Closed = styled.span`
  @media ${media.tablet} {
    padding-top: ${space.sm}px;
  }
  color: ${color.muted};
`

const Problem = styled.p`
  margin: 0;
  color: ${color.danger};
  font-size: ${fontSize.sm}px;
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs}px;
`

export interface HoursEditorProps {
  value: HoursDraft
  onChange: (next: HoursDraft) => void
  /** From hoursFromDraft: shown next to the range they belong to */
  issues?: readonly HoursIssue[]
  disabled?: boolean
}

export function HoursEditor({ value, onChange, issues = [], disabled = false }: HoursEditorProps) {
  const t = useT()
  const noteId = useId()
  const anyRange = value.days.some((ranges) => ranges.length > 0)
  const tooMany = issues.some((issue) => issue.problem === 'tooMany')

  return (
    <Table disabled={disabled} data-testid="hours-editor">
      <Legend>{t('places.hours.title')}</Legend>
      <Hint>{anyRange ? t('places.hours.hintClosed') : t('places.hours.hintUnknown')}</Hint>
      {WEEK_ORDER.map((day) => {
        const name = weekdayName(day, t.locale)
        const ranges = value.days[day] ?? []
        const closed = isClosedDay(value, day)
        const setRanges = (next: typeof ranges) => onChange(withDay(value, day, next))
        return (
          <Row key={day} role="group" aria-label={name} data-weekday={day}>
            <Day aria-hidden="true">{name}</Day>
            <Ranges>
              {ranges.map((range, index) => {
                const issue = issues.find((item) => item.day === day && item.index === index)
                const set = (patch: Partial<typeof range>) =>
                  setRanges(ranges.map((r, i) => (i === index ? { ...r, ...patch } : r)))
                return (
                  <div key={index}>
                    <Range>
                      <Time
                        type="time"
                        step={60}
                        value={range.open}
                        aria-label={t('places.hours.open', { day: name })}
                        aria-invalid={issue ? true : undefined}
                        onChange={(event) => set({ open: event.target.value })}
                      />
                      <Dash aria-hidden="true">–</Dash>
                      <Time
                        type="time"
                        step={60}
                        value={range.close}
                        aria-label={t('places.hours.close', { day: name })}
                        aria-invalid={issue ? true : undefined}
                        onChange={(event) => set({ close: event.target.value })}
                      />
                      <IconButton
                        size="sm"
                        label={t('places.hours.removeRange', { day: name })}
                        icon={<CloseIcon size={16} />}
                        onClick={() => setRanges(ranges.filter((_, i) => i !== index))}
                      />
                    </Range>
                    {issue && (
                      <Problem role="alert">
                        {issue.problem === 'same'
                          ? t('places.hours.errorSame')
                          : t('places.hours.errorFormat')}
                      </Problem>
                    )}
                  </div>
                )
              })}
              {ranges.length === 0 && (
                <Closed>{closed ? t('places.hours.closed') : t('places.hours.unknown')}</Closed>
              )}
              <Actions>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('places.hours.addRangeFor', { day: name })}
                  onClick={() => {
                    const last = ranges[ranges.length - 1]
                    setRanges([
                      ...ranges,
                      last ? { open: last.close, close: last.close } : { ...DEFAULT_RANGE },
                    ])
                  }}
                >
                  {t('places.hours.addRange')}
                </Button>
                {ranges.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('places.hours.setClosedFor', { day: name })}
                    onClick={() => setRanges([])}
                  >
                    {t('places.hours.setClosed')}
                  </Button>
                )}
                {ranges.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('places.hours.copyAllFor', { day: name })}
                    onClick={() =>
                      onChange({ ...value, days: value.days.map(() => ranges.map((r) => ({ ...r }))) })
                    }
                  >
                    {t('places.hours.copyAll')}
                  </Button>
                )}
              </Actions>
            </Ranges>
          </Row>
        )
      })}
      {tooMany && <Problem role="alert">{t('places.hours.errorTooMany')}</Problem>}
      <Input
        id={noteId}
        label={t('places.hours.note')}
        optional
        placeholder={t('places.hours.notePlaceholder')}
        value={value.text}
        maxLength={500}
        onChange={(event) => onChange({ ...value, text: event.target.value })}
      />
    </Table>
  )
}

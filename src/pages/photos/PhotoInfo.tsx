import { useState } from 'react'
import styled from 'styled-components'
import type { Attachment } from '../../../shared/api/media.ts'
import type { DayWithStops, Place } from '../../../shared/api/types.ts'
import { Button, Chip, Select } from '../../components/index.ts'
import { useT } from '../../lib/i18n.ts'
import { color, fontSize, fontWeight, space } from '../../styles/tokens.ts'
import { stopName } from '../itinerary/labels.ts'
import { dayHeading, filedText, takenAtText } from './photos.ts'

// The lightbox's info panel (e6-t03, e6-t04): when and where the photo was taken, the day or stop it
// is filed under, and for editors 「搬到…」 (day → optional stop), the trip cover, the day cover and
// delete.

const Meta = styled.dl`
  display: grid;
  gap: ${space.xs}px;
  margin: 0 0 ${space.md}px;
  font-size: ${fontSize.sm}px;
  dt {
    color: ${color.muted};
  }
  dd {
    margin: 0 0 ${space.xs}px;
    color: ${color.ink};
    font-weight: ${fontWeight.medium};
  }
`

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs}px;
  margin-bottom: ${space.md}px;
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
`

const MoveForm = styled.form`
  display: grid;
  gap: ${space.md}px;
  margin: 0 0 ${space.md}px;
  padding: ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: 10px;
  background: ${color.paper};
`

const MoveTitle = styled.h3`
  margin: 0;
  font-size: ${fontSize.body}px;
  font-weight: ${fontWeight.semibold};
`

export interface PhotoInfoProps {
  photo: Attachment
  tz: string
  days: readonly DayWithStops[]
  places: ReadonlyMap<string, Place>
  canEdit: boolean
  busy: boolean
  isTripCover: boolean
  isDayCover: boolean
  onMove: (target: { dayId: string | null; stopId: string | null }) => void
  onTripCover: (on: boolean) => void
  onDayCover: () => void
  onDelete: () => void
}

export function PhotoInfo({
  photo,
  tz,
  days,
  places,
  canEdit,
  busy,
  isTripCover,
  isDayCover,
  onMove,
  onTripCover,
  onDayCover,
  onDelete,
}: PhotoInfoProps) {
  const t = useT()
  const [moving, setMoving] = useState(false)
  const assigned = days.filter((day) => day.idx !== null)
  const filedDay = assigned.find(
    (day) => day.id === photo.dayId || day.stops.some((s) => s.id === photo.stopId),
  )
  const [dayId, setDayId] = useState<string>(filedDay?.id ?? '')
  const [stopId, setStopId] = useState<string>(photo.stopId ?? '')
  const stops = assigned.find((day) => day.id === dayId)?.stops ?? []
  const where = filedText(photo, days, places, t)

  return (
    <>
      <Meta>
        <dt>{t('photos.viewer.takenLabel')}</dt>
        <dd>{photo.takenAt ? takenAtText(photo.takenAt, tz, t.locale) : t('photos.viewer.noTime')}</dd>
        <dt>{t('photos.viewer.filedLabel')}</dt>
        <dd data-testid="photo-filed">{where ?? t('photos.album.unassigned')}</dd>
      </Meta>
      {(isTripCover || isDayCover) && (
        <Chips>
          {isTripCover && <Chip tone="fjord">{t('photos.cover.current')}</Chip>}
          {isDayCover && <Chip tone="tussock">{t('photos.dayCover.current')}</Chip>}
        </Chips>
      )}
      {canEdit && moving && (
        <MoveForm
          aria-label={t('photos.move.title')}
          onSubmit={(event) => {
            event.preventDefault()
            onMove({ dayId: dayId || null, stopId: dayId && stopId ? stopId : null })
            setMoving(false)
          }}
        >
          <MoveTitle>{t('photos.move.title')}</MoveTitle>
          <Select
            label={t('photos.move.day')}
            value={dayId}
            onChange={(event) => {
              setDayId(event.target.value)
              setStopId('')
            }}
          >
            <option value="">{t('photos.move.noDay')}</option>
            {assigned.map((day) => (
              <option key={day.id} value={day.id}>
                {dayHeading(day, t)}
              </option>
            ))}
          </Select>
          {dayId && stops.length > 0 && (
            <Select
              label={t('photos.move.stop')}
              optional
              value={stopId}
              onChange={(event) => setStopId(event.target.value)}
            >
              <option value="">{t('photos.move.wholeDay')}</option>
              {stops.map((stop) => (
                <option key={stop.id} value={stop.id}>
                  {stopName(stop, stop.placeId ? places.get(stop.placeId) : undefined, t)}
                </option>
              ))}
            </Select>
          )}
          <Actions>
            <Button onClick={() => setMoving(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {t('photos.move.save')}
            </Button>
          </Actions>
        </MoveForm>
      )}
      <Actions>
        {canEdit && !moving && (
          <Button onClick={() => setMoving(true)} disabled={busy}>
            {t('photos.move.open')}
          </Button>
        )}
        {canEdit && (
          <Button
            variant={isTripCover ? 'secondary' : 'primary'}
            disabled={busy}
            onClick={() => onTripCover(!isTripCover)}
          >
            {isTripCover ? t('photos.cover.clear') : t('photos.cover.set')}
          </Button>
        )}
        {filedDay && !isDayCover && (
          <Button disabled={busy} onClick={onDayCover}>
            {t('photos.dayCover.set')}
          </Button>
        )}
        {canEdit && (
          <Button variant="danger" disabled={busy} onClick={onDelete}>
            {t('common.delete')}
          </Button>
        )}
      </Actions>
    </>
  )
}

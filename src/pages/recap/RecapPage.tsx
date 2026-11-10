import { useState, type CSSProperties } from 'react'
import styled from 'styled-components'
import type { RecapDay, RecapResponse } from '../../../shared/api/share.ts'
import { RECAP_MAX_CHARS } from '../../../shared/api/share.ts'
import { formatDate, formatMoney } from '../../../shared/i18n/format.ts'
import '../../../shared/i18n/pages/photos.ts'
import '../../../shared/i18n/pages/recap.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { ButtonLink } from '../../components/ButtonLink.tsx'
import {
  Button,
  EmptyState,
  Lightbox,
  PhotoGrid,
  Skeleton,
  useToast,
} from '../../components/index.ts'
import { colorIndexOf } from '../../lib/colors.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT, type Translate } from '../../lib/i18n.ts'
import { recapApi } from '../../lib/recap/api.ts'
import { compare, paragraphs } from '../../lib/recap/compare.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { focusRing } from '../../styles/mixins.ts'
import {
  color,
  dayColor,
  font,
  fontSize,
  fontWeight,
  media,
  onDayColor,
  radius,
  space,
} from '../../styles/tokens.ts'
import { PageHeading, Stack } from '../parts.tsx'

// /trips/:id/recap (e8-t04): recap mode. Trip totals on top, then one card per day: the day colour,
// the recap text (a textarea for editors, paragraphs for viewers), the photo wall (PhotoGrid +
// Lightbox) and 「預估 vs 實際」 with two bars on one scale and the difference. Everything comes
// from GET /recap; the money is app-only (share pages show text and photos, never amounts).
// Any trip can open it; the trip home links here once the end date has passed.

const Panel = styled.section`
  display: grid;
  grid-template-columns: 6px 1fr;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

const DayBar = styled.div`
  background: var(--day);
`

const PanelBody = styled.div`
  display: grid;
  gap: ${space.md}px;
  min-width: 0;
  padding: ${space.md}px ${space.lg}px ${space.lg}px;
`

const DayHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: ${space.xs}px ${space.md}px;
  h2 {
    margin: 0;
    font-size: ${fontSize.md}px;
    font-weight: ${fontWeight.bold};
  }
`

const DayTag = styled.span`
  display: inline-block;
  margin-right: ${space.sm}px;
  padding: 0 ${space.sm}px;
  border-radius: ${radius.pill}px;
  background: var(--day);
  color: ${onDayColor};
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
`

const Mono = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const Totals = styled.dl`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: ${space.md}px;
  margin: 0;
  padding: ${space.md}px ${space.lg}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  > div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  dt {
    font-size: ${fontSize.sm}px;
    color: ${color.muted};
  }
  dd {
    margin: 0;
    font-family: ${font.mono};
    font-variant-numeric: tabular-nums;
    font-size: ${fontSize.md}px;
    font-weight: ${fontWeight.semibold};
    overflow-wrap: anywhere;
  }
  @media ${media.tablet} {
    dd {
      font-size: ${fontSize.lg}px;
    }
  }
`

const Muted = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const Notice = styled.p`
  margin: 0;
  padding: ${space.sm}px ${space.md}px;
  border-radius: ${radius.control}px;
  background: ${color.tussockSoft};
  font-size: ${fontSize.sm}px;
`

const Text = styled.div`
  display: grid;
  gap: ${space.sm}px;
  overflow-wrap: anywhere;
  p {
    margin: 0;
    line-height: 1.7;
  }
`

const Textarea = styled.textarea`
  width: 100%;
  min-height: 120px;
  padding: ${space.sm}px ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.paper};
  color: ${color.ink};
  font: inherit;
  line-height: 1.6;
  resize: vertical;
  ${focusRing}
`

const Label = styled.label`
  display: block;
  margin-bottom: ${space.xs}px;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const EditorRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space.sm}px;
`

const Money = styled.div`
  display: grid;
  gap: ${space.xs}px;
  h3 {
    margin: 0;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.semibold};
  }
`

const BarRow = styled.div`
  display: grid;
  grid-template-columns: 4.5em 1fr auto;
  align-items: center;
  gap: ${space.sm}px;
  font-size: ${fontSize.sm}px;
`

const Track = styled.div`
  height: 8px;
  border-radius: ${radius.pill}px;
  background: ${color.paper};
  overflow: hidden;
`

const Fill = styled.div<{ $tone: 'estimate' | 'actual' }>`
  height: 100%;
  border-radius: ${radius.pill}px;
  background: ${({ $tone }) => ($tone === 'estimate' ? color.line : 'var(--day)')};
  ${({ $tone }) => ($tone === 'estimate' ? `border: 1px solid ${color.muted};` : '')}
`

const Diff = styled.span<{ $tone: 'over' | 'under' | 'even' | 'none' }>`
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
  color: ${({ $tone }) =>
    $tone === 'over' ? color.danger : $tone === 'under' ? color.success : color.muted};
`

/** The day's colour: the stored one when it is one of ours, else the one for its index */
const toneOf = (day: RecapDay): string => {
  const at = colorIndexOf(day.color)
  return dayColor(at >= 0 ? at : day.index - 1)
}

function RecapText({ body }: { body: string }) {
  return (
    <Text>
      {paragraphs(body).map((lines, i) => (
        <p key={i}>
          {lines.map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
      ))}
    </Text>
  )
}

function RecapEditor({
  tripId,
  day,
  onSaved,
}: {
  tripId: string
  day: RecapDay
  onSaved: (body: string, updatedAt: string) => void
}) {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const saved = day.recapBody ?? ''
  const [draft, setDraft] = useState(saved)
  const [saving, setSaving] = useState(false)
  const id = `recap-${day.dayId}`
  const tooLong = draft.length > RECAP_MAX_CHARS
  const save = async () => {
    setSaving(true)
    try {
      const res = await recapApi.put(tripId, day.dayId, draft)
      setDraft(res.body)
      onSaved(res.body, res.updatedAt)
      toast.show(t('recap.text.saved', { index: day.index }))
    } catch (error) {
      showError(error)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div>
      <Label htmlFor={id}>{t('recap.text.label', { index: day.index })}</Label>
      <Textarea
        id={id}
        value={draft}
        placeholder={t('recap.text.placeholder')}
        onChange={(e) => setDraft(e.target.value)}
        aria-invalid={tooLong || undefined}
        data-testid="recap-text"
      />
      <EditorRow>
        <Mono aria-live="polite">
          {tooLong
            ? t('recap.text.tooLong', { max: RECAP_MAX_CHARS })
            : t('recap.text.count', { count: draft.length, max: RECAP_MAX_CHARS })}
        </Mono>
        <Button
          variant="primary"
          size="sm"
          disabled={saving || tooLong || draft === saved}
          onClick={save}
          data-testid="recap-save"
        >
          {saving ? t('recap.text.saving') : t('recap.text.save')}
        </Button>
      </EditorRow>
    </div>
  )
}

function MoneyRow({ day, currency, t }: { day: RecapDay; currency: string; t: Translate }) {
  const money = (minor: number) => formatMoney(minor, currency, t.locale)
  const c = compare(day.estimateMinor, day.actualMinor)
  const diff = Math.abs(c.diffMinor)
  return (
    <Money data-testid="recap-money">
      <h3>{t('recap.money.label')}</h3>
      {c.tone === 'none' ? (
        <Muted>{t('recap.money.none')}</Muted>
      ) : (
        <>
          <BarRow>
            <span>{t('recap.money.estimate')}</span>
            <Track aria-hidden="true">
              <Fill $tone="estimate" style={{ width: `${c.estimateRatio * 100}%` }} />
            </Track>
            <Mono>{money(day.estimateMinor)}</Mono>
          </BarRow>
          <BarRow>
            <span>{t('recap.money.actual')}</span>
            <Track aria-hidden="true">
              <Fill $tone="actual" style={{ width: `${c.actualRatio * 100}%` }} />
            </Track>
            <Mono>{money(day.actualMinor)}</Mono>
          </BarRow>
          <Diff $tone={c.tone}>
            {c.tone === 'over'
              ? t('recap.money.over', { amount: money(diff) })
              : c.tone === 'under'
                ? t('recap.money.under', { amount: money(diff) })
                : t('recap.money.even')}
          </Diff>
        </>
      )}
      {day.unconverted.length > 0 && (
        <Muted>
          {t('recap.money.unconverted', {
            list: new Intl.ListFormat(t.locale, { type: 'unit' }).format(
              day.unconverted.map((u) => formatMoney(u.minor, u.currency, t.locale)),
            ),
          })}
        </Muted>
      )}
    </Money>
  )
}

function DayPanel({
  tripId,
  day,
  currency,
  editable,
  onSaved,
}: {
  tripId: string
  day: RecapDay
  currency: string
  editable: boolean
  onSaved: (body: string, updatedAt: string) => void
}) {
  const t = useT()
  const [viewer, setViewer] = useState<number | null>(null)
  const photos = day.photoIds.map((id) => ({ id }))
  const style = { '--day': toneOf(day) } as CSSProperties
  const label = t('recap.day.label', { index: day.index })
  return (
    <Panel style={style} aria-labelledby={`recap-day-${day.dayId}`} data-testid="recap-day">
      <DayBar aria-hidden="true" />
      <PanelBody>
        <DayHead>
          <h2 id={`recap-day-${day.dayId}`}>
            <DayTag>{label}</DayTag>
            {day.title}
          </h2>
          {day.date && <Mono>{formatDate(day.date, t.locale)}</Mono>}
        </DayHead>
        {editable ? (
          <RecapEditor tripId={tripId} day={day} onSaved={onSaved} />
        ) : day.recapBody ? (
          <RecapText body={day.recapBody} />
        ) : (
          <Muted>{t('recap.text.empty')}</Muted>
        )}
        <div aria-label={t('recap.photos.label', { index: day.index })} role="group">
          {photos.length > 0 ? (
            <PhotoGrid
              photos={photos}
              tripId={tripId}
              data-testid="recap-photos"
              onOpen={setViewer}
              labelFor={(at) => t('recap.photo.open', { index: at + 1 })}
              altFor={(at) => t('recap.photo.alt', { day: day.index, index: at + 1 })}
            />
          ) : (
            <Muted>{t('recap.photos.empty')}</Muted>
          )}
        </div>
        <MoneyRow day={day} currency={currency} t={t} />
      </PanelBody>
      <Lightbox
        open={viewer !== null}
        photos={photos}
        index={viewer ?? 0}
        onIndexChange={setViewer}
        onClose={() => setViewer(null)}
        tripId={tripId}
        altFor={(at) => t('recap.photo.alt', { day: day.index, index: at + 1 })}
      />
    </Panel>
  )
}

function TotalsBlock({ recap, t }: { recap: RecapResponse; t: Translate }) {
  const money = (minor: number) => formatMoney(minor, recap.baseCurrency, t.locale)
  const { estimateMinor, actualMinor, otherActualMinor } = recap.totals
  const diff = actualMinor - estimateMinor
  return (
    <Stack $gap="sm">
      <Totals aria-label={t('recap.totals.heading')} data-testid="recap-totals">
        <div>
          <dt>{t('recap.totals.estimate')}</dt>
          <dd>{money(estimateMinor)}</dd>
        </div>
        <div>
          <dt>{t('recap.totals.actual')}</dt>
          <dd>{money(actualMinor)}</dd>
        </div>
        <div>
          <dt>{t('recap.totals.diff')}</dt>
          <dd>
            <Diff $tone={diff > 0 ? 'over' : diff < 0 ? 'under' : 'even'}>
              {diff === 0
                ? money(0)
                : t(diff > 0 ? 'recap.money.over' : 'recap.money.under', {
                    amount: money(Math.abs(diff)),
                  })}
            </Diff>
          </dd>
        </div>
      </Totals>
      {otherActualMinor > 0 && (
        <Muted>{t('recap.totals.other', { amount: money(otherActualMinor) })}</Muted>
      )}
    </Stack>
  )
}

export default function RecapPage() {
  const t = useT()
  const { trip } = useTripContext()
  const can = useCan()
  const editable = can('editContent')
  const recap = useResource(`recap:${trip.id}`, (signal) => recapApi.get(trip.id, signal))

  const savedText = (dayId: string) => (body: string, updatedAt: string) => {
    if (recap.status !== 'ready') return
    recap.set({
      ...recap.data,
      days: recap.data.days.map((d) => {
        if (d.dayId !== dayId) return d
        const { recapBody: _body, recapUpdatedAt: _at, ...rest } = d
        return body ? { ...rest, recapBody: body, recapUpdatedAt: updatedAt } : rest
      }),
    })
  }

  return (
    <Stack $gap="lg">
      <PageHeading
        title={t('recap.title')}
        lead={t('recap.lead')}
        actions={
          <ButtonLink to=".." relative="path" variant="ghost">
            {t('recap.back')}
          </ButtonLink>
        }
      />
      {recap.status === 'loading' && (
        <Stack $gap="md">
          <Skeleton $height={72} $radius="card" />
          <Skeleton $height={240} $radius="card" />
          <Skeleton $height={240} $radius="card" />
        </Stack>
      )}
      {recap.status === 'error' && (
        <EmptyState
          title={t('recap.error')}
          action={
            <Button variant="primary" onClick={recap.reload}>
              {t('recap.retry')}
            </Button>
          }
        />
      )}
      {recap.status === 'ready' && (
        <>
          {!recap.data.ended && <Notice>{t('recap.notEnded')}</Notice>}
          <TotalsBlock recap={recap.data} t={t} />
          {recap.data.days.length === 0 ? (
            <EmptyState title={t('recap.empty')} />
          ) : (
            recap.data.days.map((day) => (
              <DayPanel
                key={day.dayId}
                tripId={trip.id}
                day={day}
                currency={recap.data.baseCurrency}
                editable={editable}
                onSaved={savedText(day.dayId)}
              />
            ))
          )}
        </>
      )}
    </Stack>
  )
}

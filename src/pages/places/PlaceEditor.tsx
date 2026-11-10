import { useState, type FormEvent } from 'react'
import styled from 'styled-components'
import type { Place } from '../../../shared/api/types.ts'
import type { PlacePatch } from '../../../shared/schema/index.ts'
import {
  Button,
  IconButton,
  Input,
  Select,
  Sheet,
} from '../../components/index.ts'
// Straight from its file, so the editor stays in this page's chunk, not the shared first screen
import { HoursEditor } from '../../components/HoursEditor.tsx'
import { CloseIcon } from '../../components/icons.tsx'
import { useT } from '../../lib/i18n.ts'
import { useApiErrorToast } from '../../lib/role.ts'
import { placesApi } from '../../lib/places/api.ts'
import { draftFromHours, hoursFromDraft, type HoursDraft } from '../../lib/places/hours.ts'
import { PLACE_CATEGORIES, displayName, placeCategory } from '../../lib/places/library.ts'
import { color, fontSize, fontWeight, media, space } from '../../styles/tokens.ts'
import { Stack } from '../parts.tsx'
import { CATEGORY_LABEL } from './labels.ts'

// The place editor (e3-t05): names, category, address, coordinates, links and opening hours, saved
// with PATCH /places/:pid. Moving the pin on the map is the map page's long-press (a new place)
// followed by a merge here; the coordinates can also be typed.

const Pair = styled.div`
  display: grid;
  gap: ${space.md}px;
  @media ${media.tablet} {
    grid-template-columns: 1fr 1fr;
  }
`

const Hint = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Group = styled.fieldset`
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

const LinkRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: ${space.sm}px;
  align-items: end;
  padding-top: ${space.sm}px;
  border-top: 1px solid ${color.line};
  > div {
    display: grid;
    gap: ${space.sm}px;
    @media ${media.tablet} {
      grid-template-columns: 2fr 1fr;
    }
  }
`

const Error = styled.p`
  margin: 0;
  color: ${color.danger};
  font-size: ${fontSize.sm}px;
`

interface LinkDraft {
  url: string
  label: string
}

interface Draft {
  nameLocal: string
  nameEn: string
  category: string
  address: string
  lat: string
  lng: string
  links: LinkDraft[]
  hours: HoursDraft
}

function draftOf(place: Place): Draft {
  return {
    nameLocal: place.nameLocal,
    nameEn: place.nameEn,
    category: placeCategory(place.category),
    address: place.address,
    lat: String(place.lat),
    lng: String(place.lng),
    links: place.links.map((link) => ({ url: link.url, label: link.label ?? '' })),
    hours: draftFromHours(place.hours),
  }
}

const isHttpUrl = (text: string) => {
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const inRange = (text: string, limit: number) => {
  if (text.trim() === '') return false
  const value = Number(text)
  return Number.isFinite(value) && Math.abs(value) <= limit
}

export interface PlaceEditorProps {
  tripId: string
  place: Place | null
  onClose: () => void
  onSaved: (place: Place) => void
}

export function PlaceEditor({ tripId, place, onClose, onSaved }: PlaceEditorProps) {
  const t = useT()
  const showError = useApiErrorToast()
  const [draft, setDraft] = useState<Draft | null>(place ? draftOf(place) : null)
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))
  const hours = draft ? hoursFromDraft(draft.hours) : null
  const errors = draft
    ? {
        nameLocal: draft.nameLocal.trim() ? undefined : t('places.editor.nameLocalRequired'),
        lat: inRange(draft.lat, 90) ? undefined : t('places.editor.latInvalid'),
        lng: inRange(draft.lng, 180) ? undefined : t('places.editor.lngInvalid'),
        links: draft.links.map((link) =>
          link.url.trim() === '' || isHttpUrl(link.url.trim())
            ? undefined
            : t('places.editor.linkInvalid'),
        ),
      }
    : null
  const invalid =
    !errors ||
    Boolean(errors.nameLocal || errors.lat || errors.lng || errors.links.some(Boolean)) ||
    (hours?.issues.length ?? 0) > 0

  async function save(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (!place || !draft || invalid || !hours) return
    const patch: PlacePatch = {
      nameLocal: draft.nameLocal.trim(),
      nameEn: draft.nameEn.trim(),
      category: draft.category,
      address: draft.address.trim(),
      lat: Number(draft.lat),
      lng: Number(draft.lng),
      links: draft.links
        .filter((link) => link.url.trim())
        .map((link) =>
          link.label.trim()
            ? { url: link.url.trim(), label: link.label.trim() }
            : { url: link.url.trim() },
        ),
      hours: hours.hours,
    }
    setBusy(true)
    try {
      const response = await placesApi.patch(tripId, place.id, patch)
      onSaved(response.place)
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  const formId = 'place-editor-form'
  return (
    <Sheet
      open={Boolean(place && draft)}
      onClose={onClose}
      title={place ? t('places.editor.titleFor', { name: displayName(place, t.locale) }) : t('places.editor.title')}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={busy}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {draft && errors && (
        <form id={formId} onSubmit={save} noValidate>
          <Stack $gap="lg">
            <Pair>
              <Input
                label={t('places.editor.nameLocal')}
                value={draft.nameLocal}
                maxLength={200}
                error={tried ? errors.nameLocal : undefined}
                onChange={(event) => set({ nameLocal: event.target.value })}
              />
              <Input
                label={t('places.editor.nameEn')}
                optional
                lang="en"
                value={draft.nameEn}
                maxLength={200}
                onChange={(event) => set({ nameEn: event.target.value })}
              />
            </Pair>
            <Select
              label={t('places.editor.category')}
              value={draft.category}
              onChange={(event) => set({ category: event.target.value })}
            >
              {PLACE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(CATEGORY_LABEL[category])}
                </option>
              ))}
            </Select>
            <Input
              label={t('places.editor.address')}
              optional
              value={draft.address}
              maxLength={500}
              onChange={(event) => set({ address: event.target.value })}
            />
            <Stack $gap="sm">
              <Pair>
                <Input
                  label={t('places.editor.lat')}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={-90}
                  max={90}
                  value={draft.lat}
                  error={tried ? errors.lat : undefined}
                  onChange={(event) => set({ lat: event.target.value })}
                />
                <Input
                  label={t('places.editor.lng')}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={-180}
                  max={180}
                  value={draft.lng}
                  error={tried ? errors.lng : undefined}
                  onChange={(event) => set({ lng: event.target.value })}
                />
              </Pair>
              <Hint>{t('places.editor.pinHint')}</Hint>
            </Stack>

            <Group>
              <Legend>{t('places.editor.links')}</Legend>
              {draft.links.length === 0 && <Hint>{t('places.editor.noLinks')}</Hint>}
              {draft.links.map((link, index) => (
                <LinkRow key={index}>
                  <div>
                    <Input
                      label={t('places.editor.linkUrl')}
                      type="url"
                      inputMode="url"
                      placeholder={t('places.editor.linkPlaceholder')}
                      value={link.url}
                      error={tried ? errors.links[index] : undefined}
                      onChange={(event) =>
                        set({
                          links: draft.links.map((l, i) =>
                            i === index ? { ...l, url: event.target.value } : l,
                          ),
                        })
                      }
                    />
                    <Input
                      label={t('places.editor.linkLabel')}
                      optional
                      placeholder={t('places.editor.linkLabelPlaceholder')}
                      value={link.label}
                      maxLength={120}
                      onChange={(event) =>
                        set({
                          links: draft.links.map((l, i) =>
                            i === index ? { ...l, label: event.target.value } : l,
                          ),
                        })
                      }
                    />
                  </div>
                  <IconButton
                    label={t('places.editor.removeLink', { n: index + 1 })}
                    icon={<CloseIcon size={16} />}
                    onClick={() => set({ links: draft.links.filter((_, i) => i !== index) })}
                  />
                </LinkRow>
              ))}
              {draft.links.length < 20 && (
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => set({ links: [...draft.links, { url: '', label: '' }] })}
                  >
                    {t('places.editor.addLink')}
                  </Button>
                </div>
              )}
            </Group>

            <HoursEditor
              value={draft.hours}
              issues={hours?.issues}
              onChange={(next) => set({ hours: next })}
            />
            {tried && invalid && <Error role="alert">{t('places.editor.invalid')}</Error>}
          </Stack>
        </form>
      )}
    </Sheet>
  )
}

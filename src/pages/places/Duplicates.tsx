import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { Place, PlaceRefsResponse } from '../../../shared/api/types.ts'
import { formatDistance } from '../../../shared/i18n/format.ts'
import { Button, Chip, Dialog, Select, Sheet, Skeleton } from '../../components/index.ts'
import { useT } from '../../lib/i18n.ts'
import { useApiErrorToast } from '../../lib/role.ts'
import { placesApi, type MergeResponse } from '../../lib/places/api.ts'
import { distanceM, type DuplicateGroup } from '../../lib/places/dedupe.ts'
import { coordsText, displayName } from '../../lib/places/library.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { Stack } from '../parts.tsx'
import { REASON_LABEL, refsTotal } from './labels.ts'
import { RefList } from './RefList.tsx'

// 「找出重複」 (e3-t05, AC-3.4): the likely duplicate groups, and 「合併到…」 for each place that is
// not the one to keep. The merge dialog lists what will be re-pointed (GET /refs), then
// POST /places/:pid/merge-into/:targetId; the counts it moved are shown afterwards.

const Lead = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Group = styled.section`
  display: grid;
  gap: ${space.sm}px;
  padding: ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
`

const GroupHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.xs}px ${space.sm}px;
  h3 {
    margin: 0;
    font-size: ${fontSize.body}px;
    font-weight: ${fontWeight.bold};
  }
`

const Members = styled.ul`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Member = styled.li`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: ${space.sm}px;
  align-items: center;
  padding-top: ${space.sm}px;
  border-top: 1px solid ${color.line};
`

const Name = styled.p`
  margin: 0;
  font-weight: ${fontWeight.semibold};
  overflow-wrap: anywhere;
`

const Meta = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
  overflow-wrap: anywhere;
`

const Mono = styled.span`
  font-family: ${font.mono};
`

const Done = styled.p`
  margin: 0;
  padding: ${space.sm}px ${space.md}px;
  border-radius: ${radius.control}px;
  background: ${color.glacier};
  font-size: ${fontSize.sm}px;
`

export interface DuplicatesSheetProps {
  open: boolean
  onClose: () => void
  tripId: string
  groups: readonly DuplicateGroup[]
  refs: ReadonlyMap<string, number>
  canEdit: boolean
  /** After a merge: the duplicate is gone, the target was returned */
  onMerged: (duplicateId: string, response: MergeResponse) => void
}

export function DuplicatesSheet({
  open,
  onClose,
  tripId,
  groups,
  refs,
  canEdit,
  onMerged,
}: DuplicatesSheetProps) {
  const t = useT()
  const [merging, setMerging] = useState<{ place: Place; group: DuplicateGroup } | null>(null)
  const [result, setResult] = useState<string | null>(null)

  return (
    <>
      <Sheet
        open={open && !merging}
        onClose={() => {
          setResult(null)
          onClose()
        }}
        title={t('places.dupes.title')}>
        <Stack $gap="md">
          <Lead>{t('places.dupes.lead')}</Lead>
          <div role="status">{result && <Done data-testid="merge-result">{result}</Done>}</div>
          {groups.length === 0 && <Lead>{t('places.dupes.none')}</Lead>}
          {groups.map((group, index) => {
            const keep = group.places[0]
            return (
              <Group key={keep.id} aria-labelledby={`dupe-group-${index}`} data-testid="dupe-group">
                <GroupHead>
                  <h3 id={`dupe-group-${index}`}>{t('places.dupes.group', { n: index + 1 })}</h3>
                  {group.reasons.map((reason) => (
                    <Chip key={reason} tone="warning">
                      {t(REASON_LABEL[reason])}
                    </Chip>
                  ))}
                </GroupHead>
                <Members>
                  {group.places.map((place, at) => {
                    const name = displayName(place, t.locale)
                    const count = refs.get(place.id) ?? 0
                    return (
                      <Member key={place.id} data-place-id={place.id}>
                        <div>
                          <Name>{name}</Name>
                          <Meta>
                            <Mono>{coordsText(place)}</Mono>
                            {at > 0 &&
                              ` · ${t('places.dupes.distance', {
                                distance: formatDistance(distanceM(place, keep), t.locale),
                              })}`}
                          </Meta>
                          <Meta>
                            {count > 0 ? t.plural('places.refs', count) : t('places.unused')}
                          </Meta>
                        </div>
                        {at === 0 ? (
                          <Chip tone="success">{t('places.dupes.suggested')}</Chip>
                        ) : (
                          canEdit && (
                            <Button
                              size="sm"
                              aria-label={t('places.dupes.mergeIntoFor', { name })}
                              onClick={() => setMerging({ place, group })}
                            >
                              {t('places.dupes.mergeInto')}
                            </Button>
                          )
                        )}
                      </Member>
                    )
                  })}
                </Members>
              </Group>
            )
          })}
        </Stack>
      </Sheet>
      <MergeDialog
        key={merging?.place.id ?? 'none'}
        tripId={tripId}
        merging={merging}
        onClose={() => setMerging(null)}
        onMerged={(duplicate, response) => {
          setMerging(null)
          setResult(
            t('places.merge.done', {
              name: displayName(response.place, t.locale),
              stops: response.repointed.stops,
              wishlist: response.repointed.wishlistItems,
              lodgings: response.repointed.lodgings,
              bookings: response.repointed.bookings,
              attachments: response.repointed.attachments,
            }),
          )
          onMerged(duplicate.id, response)
        }}
      />
    </>
  )
}

function MergeDialog({
  tripId,
  merging,
  onClose,
  onMerged,
}: {
  tripId: string
  merging: { place: Place; group: DuplicateGroup } | null
  onClose: () => void
  onMerged: (duplicate: Place, response: MergeResponse) => void
}) {
  const t = useT()
  const showError = useApiErrorToast()
  const [targetId, setTargetId] = useState(
    () => merging?.group.places.find((p) => p.id !== merging.place.id)?.id ?? '',
  )
  const [refs, setRefs] = useState<PlaceRefsResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const place = merging?.place ?? null
  const targets = merging ? merging.group.places.filter((p) => p.id !== merging.place.id) : []

  useEffect(() => {
    if (!merging) return
    const controller = new AbortController()
    placesApi.refs(tripId, merging.place.id, controller.signal).then(setRefs, (error: unknown) => {
      if (!controller.signal.aborted) showError(error)
    })
    return () => controller.abort()
  }, [merging, tripId, showError])

  async function merge() {
    if (!place || !targetId) return
    setBusy(true)
    try {
      const response = await placesApi.mergeInto(tripId, place.id, targetId)
      onMerged(place, response)
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  const name = place ? displayName(place, t.locale) : ''
  return (
    <Dialog
      open={Boolean(merging)}
      onClose={onClose}
      title={t('places.merge.title', { name })}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void merge()} disabled={busy || !refs || !targetId}>
            {t('places.merge.confirm')}
          </Button>
        </>
      }
    >
      {place && (
        <Stack $gap="md">
          <Select
            label={t('places.merge.target')}
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {`${displayName(target, t.locale)} (${coordsText(target)})`}
              </option>
            ))}
          </Select>
          {!refs ? (
            <Skeleton $height={48} />
          ) : refsTotal(refs) > 0 ? (
            <div>
              <Meta>{t('places.merge.moves')}</Meta>
              <RefList refs={refs} />
            </div>
          ) : (
            <Meta>{t('places.merge.nothing', { name })}</Meta>
          )}
          <Meta>{t('places.merge.after', { name })}</Meta>
        </Stack>
      )}
    </Dialog>
  )
}

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import type { Place, PlaceRefsResponse } from '../../../shared/api/types.ts'
import {
  Button,
  Dialog,
  EmptyState,
  Input,
  Select,
  Skeleton,
  useToast,
} from '../../components/index.ts'
import { tripPath } from '../../app/sections.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { placesApi } from '../../lib/places/api.ts'
import { findDuplicateGroups } from '../../lib/places/dedupe.ts'
import {
  PLACE_CATEGORIES,
  countRefs,
  displayName,
  filterAndSort,
  type LibraryQuery,
  type PlaceCategory,
  type PlaceSort,
} from '../../lib/places/library.ts'
import { color, fontSize, media, space } from '../../styles/tokens.ts'
import { Count, PageHeading, SectionTitle, Stack } from '../parts.tsx'
import { DuplicatesSheet } from './Duplicates.tsx'
import { CATEGORY_LABEL, SORT_LABEL, refsTotal } from './labels.ts'
import { PlaceEditor } from './PlaceEditor.tsx'
import { PlaceRow } from './PlaceRow.tsx'
import { RefList } from './RefList.tsx'
import type { MenuAction } from './RowMenu.tsx'

// /trips/:id/places (e3-t05, AC-3.4): every place of the trip with search, a category filter and
// sort; how many items use each one (counted from the days, wishlist, lodgings and bookings lists);
// edit (names, category, address, coordinates, links, opening hours), 「在地圖上看」, delete (only
// when nothing uses it), and 「找出重複」 with merge. Writes are for editors (useCan).

const Controls = styled.div`
  display: grid;
  gap: ${space.md}px;
  @media ${media.tablet} {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr);
    align-items: end;
  }
`

const List = styled.ul`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Note = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const SORTS: readonly PlaceSort[] = ['name', 'refs', 'unused']

interface LibraryData {
  places: Place[]
  refs: Map<string, number>
}

async function loadLibrary(tripId: string, signal: AbortSignal): Promise<LibraryData> {
  // Lodgings and bookings only add to the counts: a failure there does not hide the list
  const optional = <T,>(promise: Promise<T>, empty: T) => promise.catch(() => empty)
  const [places, days, wishlist, lodgings, bookings] = await Promise.all([
    placesApi.list(tripId, signal),
    placesApi.days(tripId, signal),
    placesApi.wishlist(tripId, signal),
    optional(placesApi.lodgings(tripId, signal), { lodgings: [], rev: 0 }),
    optional(placesApi.bookings(tripId, signal), { bookings: [], rev: 0 }),
  ])
  return {
    places: places.places,
    refs: countRefs({
      days: days.days,
      wishlist: wishlist.items,
      lodgings: lodgings.lodgings,
      bookings: bookings.bookings,
    }),
  }
}

export default function PlacesPage() {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const showError = useApiErrorToast()
  const { trip } = useTripContext()
  const can = useCan()
  const canEdit = can('editContent')
  const library = useResource(`places:${trip.id}`, (signal) => loadLibrary(trip.id, signal))
  const [query, setQuery] = useState<LibraryQuery>({ text: '', category: 'all', sort: 'name' })
  const [editing, setEditing] = useState<Place | null>(null)
  const [deleting, setDeleting] = useState<Place | null>(null)
  const [deleteRefs, setDeleteRefs] = useState<PlaceRefsResponse | null>(null)
  const [dupesOpen, setDupesOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const data = library.data
  const places = useMemo(() => data?.places ?? [], [data])
  const refs = useMemo(() => data?.refs ?? new Map<string, number>(), [data])
  const shown = useMemo(
    () => filterAndSort(places, refs, query, t.locale),
    [places, refs, query, t.locale],
  )
  const groups = useMemo(() => findDuplicateGroups(places, refs), [places, refs])
  const filtered = query.text.trim() !== '' || query.category !== 'all'

  const replacePlace = (place: Place) => {
    if (!library.data) return
    library.set({
      ...library.data,
      places: library.data.places.map((p) => (p.id === place.id ? place : p)),
    })
  }

  const askDelete = (place: Place) => {
    setDeleting(place)
    setDeleteRefs(null)
    placesApi.refs(trip.id, place.id).then(setDeleteRefs, (error: unknown) => {
      setDeleting(null)
      showError(error)
    })
  }

  async function remove(place: Place) {
    setBusy(true)
    try {
      await placesApi.remove(trip.id, place.id)
      if (library.data) {
        library.set({
          ...library.data,
          places: library.data.places.filter((p) => p.id !== place.id),
        })
      }
      setDeleting(null)
      toast.show(t('places.delete.done', { name: displayName(place, t.locale) }), {
        tone: 'success',
      })
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  const actionsFor = (place: Place): MenuAction[] => {
    const map: MenuAction = {
      key: 'map',
      label: t('places.action.map'),
      onSelect: () => navigate(`${tripPath(trip.id)}/map?place=${encodeURIComponent(place.id)}`),
    }
    if (!canEdit) return [map]
    return [
      { key: 'edit', label: t('places.action.edit'), onSelect: () => setEditing(place) },
      map,
      { key: 'delete', label: t('places.action.delete'), danger: true, onSelect: () => askDelete(place) },
    ]
  }

  const deletingName = deleting ? displayName(deleting, t.locale) : ''
  const inUse = deleteRefs !== null && refsTotal(deleteRefs) > 0

  return (
    <Stack>
      <PageHeading
        title={t('places.title')}
        eyebrow={trip.name}
        lead={library.status === 'ready' ? t.plural('places.lead', places.length) : undefined}
        actions={
          library.status === 'ready' && places.length > 1 ? (
            <Button onClick={() => setDupesOpen(true)}>{t('places.dupes.find')}</Button>
          ) : undefined
        }
      />

      <Controls>
        <Input
          label={t('places.search')}
          type="search"
          placeholder={t('places.searchPlaceholder')}
          value={query.text}
          onChange={(event) => setQuery((q) => ({ ...q, text: event.target.value }))}
        />
        <Select
          label={t('places.filter.category')}
          value={query.category}
          onChange={(event) =>
            setQuery((q) => ({ ...q, category: event.target.value as PlaceCategory | 'all' }))
          }
        >
          <option value="all">{t('places.filter.all')}</option>
          {PLACE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(CATEGORY_LABEL[category])}
            </option>
          ))}
        </Select>
        <Select
          label={t('places.sort.label')}
          value={query.sort}
          onChange={(event) => setQuery((q) => ({ ...q, sort: event.target.value as PlaceSort }))}
        >
          {SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {t(SORT_LABEL[sort])}
            </option>
          ))}
        </Select>
      </Controls>

      <Stack
        as="section"
        $gap="md"
        aria-labelledby="places-list"
        aria-busy={library.status === 'loading'}
      >
        <SectionTitle id="places-list">
          {t('places.title')}
          {library.status === 'ready' && <Count>{shown.length}</Count>}
        </SectionTitle>
        {library.status === 'loading' && (
          <List>
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i}>
                <Skeleton $height={96} />
              </li>
            ))}
          </List>
        )}
        {library.status === 'error' && (
          <EmptyState
            illustration="pin"
            title={t('places.loadError')}
            body=""
            action={<Button onClick={library.reload}>{t('error.retry')}</Button>}
          />
        )}
        {library.status === 'ready' && places.length === 0 && (
          <EmptyState illustration="pin" title={t('places.empty.title')} body={t('places.empty.body')} />
        )}
        {library.status === 'ready' && places.length > 0 && shown.length === 0 && filtered && (
          <Stack $gap="sm">
            <Note>{t('places.emptyFilter')}</Note>
            <div>
              <Button
                size="sm"
                onClick={() => setQuery((q) => ({ ...q, text: '', category: 'all' }))}
              >
                {t('places.clearFilters')}
              </Button>
            </div>
          </Stack>
        )}
        {shown.length > 0 && (
          <List data-testid="place-list">
            {shown.map((place) => (
              <PlaceRow
                key={place.id}
                place={place}
                refs={refs.get(place.id) ?? 0}
                actions={actionsFor(place)}
              />
            ))}
          </List>
        )}
      </Stack>

      {canEdit && (
        <PlaceEditor
          key={editing?.id ?? 'none'}
          tripId={trip.id}
          place={editing}
          onClose={() => setEditing(null)}
          onSaved={(place) => {
            replacePlace(place)
            setEditing(null)
            toast.show(t('places.editor.saved', { name: displayName(place, t.locale) }), {
              tone: 'success',
            })
          }}
        />
      )}

      <DuplicatesSheet
        open={dupesOpen}
        onClose={() => setDupesOpen(false)}
        tripId={trip.id}
        groups={groups}
        refs={refs}
        canEdit={canEdit}
        onMerged={() => library.reload()}
      />

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={
          inUse
            ? t('places.delete.refusedTitle', { name: deletingName })
            : t('places.delete.title', { name: deletingName })
        }
        actions={
          inUse ? (
            <Button variant="primary" onClick={() => setDeleting(null)}>
              {t('common.dismiss')}
            </Button>
          ) : (
            <>
              <Button onClick={() => setDeleting(null)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={busy || deleteRefs === null}
                onClick={() => deleting && void remove(deleting)}
              >
                {t('common.delete')}
              </Button>
            </>
          )
        }
      >
        {deleteRefs === null ? (
          <Note role="status">{t('places.delete.checking')}</Note>
        ) : inUse ? (
          <>
            <Note>{t('places.delete.refusedBody')}</Note>
            <RefList refs={deleteRefs} />
          </>
        ) : (
          <Note>{t('places.delete.body')}</Note>
        )}
      </Dialog>
    </Stack>
  )
}

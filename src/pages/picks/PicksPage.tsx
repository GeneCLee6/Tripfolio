import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import type { DayWithStops, Member, WishlistItemView } from '../../../shared/api/types.ts'
import { formatDate } from '../../../shared/i18n/format.ts'
import type { WishlistStatus } from '../../../shared/schema/index.ts'
import {
  Button,
  Chip,
  DayChip,
  Dialog,
  EmptyState,
  PickCard,
  SegmentedControl,
  Sheet,
  Skeleton,
  VoteButton,
  useToast,
} from '../../components/index.ts'
import { useDetailPane, useTripContext } from '../../app/trip-context.ts'
import { errorMessageKey } from '../../lib/errors.ts'
import { useT } from '../../lib/i18n.ts'
import { CATEGORY_LABEL } from '../../lib/picks/labels.ts'
import {
  filterPicks,
  groupPicks,
  PICK_CATEGORIES,
  sortPicks,
  STATUS_FILTERS,
  stopDays,
  toggled,
  type CategoryFilter,
  type PickGrouping,
  type PickSort,
  type StatusFilter,
  type StopDay,
} from '../../lib/picks/picks.ts'
import { usePickImage } from '../../lib/picks/photo.ts'
import { usePicksState, usePicksStore, type PicksStore } from '../../lib/picks/store.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { color, fontSize, space } from '../../styles/tokens.ts'
import { Count, PageHeading, SectionTitle, Stack } from '../parts.tsx'
import { CardMenu, type MenuAction } from './CardMenu.tsx'
import { dayLabel, pickTags, STATUS_LABEL } from './labels.ts'
import { PickDetail, type PickActions } from './PickDetail.tsx'
import { PickEditor } from './PickEditor.tsx'

// /trips/:id/picks (e5-t02..t04, DESIGN.md §4 必吃必買, mockup Screen 3): a masonry wall of pick
// cards (CSS columns: 1, 2 or 3 by the page's own width), filtered by category and status, sorted
// by newest / votes / price, optionally grouped by category or by itinerary day (unscheduled ones
// under the pocket list). Cards open in the detail pane; editors can add, edit, vote, claim, put a
// pick into a day (a stop is created) or pull it back (the stop is deleted).

const Column = styled(Stack)`
  grid-template-columns: minmax(0, 1fr);
`

const Toolbar = styled.div`
  display: grid;
  gap: ${space.sm + 2}px;
  min-width: 0;
`

const Scroll = styled.div`
  max-width: 100%;
  overflow-x: auto;
  padding: 2px;
  scrollbar-width: thin;
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px ${space.md}px;
  align-items: center;
`

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs + 2}px;
  align-items: center;
`

const ChipsLabel = styled.span`
  font-size: ${fontSize.sm - 1}px;
  color: ${color.muted};
  margin-right: ${space.xs}px;
`

/** The wall measures its own width (the middle column on desktop is narrower than the screen) */
const WallHost = styled.div`
  container-type: inline-size;
  min-width: 0;
`

const Wall = styled.div`
  columns: 1;
  column-gap: ${space.md + 2}px;
  @container (min-width: 480px) {
    columns: 2;
  }
  @container (min-width: 840px) {
    columns: 3;
  }
`

const Group = styled.section`
  display: grid;
  gap: ${space.md}px;
`

const Muted = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const DayGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
`

const SORTS: readonly PickSort[] = ['newest', 'votes', 'price']
const GROUPINGS: readonly PickGrouping[] = ['none', 'category', 'day']

export default function PicksPage() {
  const t = useT()
  const { trip, me, members } = useTripContext()
  const { setDetail } = useDetailPane()
  const toast = useToast()
  const showError = useApiErrorToast()
  const can = useCan()
  const canEdit = can('editContent')
  const store = usePicksStore(trip.id)
  const state = usePicksState(store)
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [sort, setSort] = useState<PickSort>('newest')
  const [grouping, setGrouping] = useState<PickGrouping>('none')
  const [statuses, setStatuses] = useState<ReadonlySet<StatusFilter>>(() => new Set())
  const [scheduling, setScheduling] = useState<WishlistItemView | null>(null)
  const [unscheduling, setUnscheduling] = useState<WishlistItemView | null>(null)
  const [deleting, setDeleting] = useState<WishlistItemView | null>(null)

  const membersById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members])
  const dayOfStop = useMemo(() => stopDays(state.days), [state.days])
  const shown = useMemo(
    () => sortPicks(filterPicks(state.items, { category, statuses }), sort),
    [state.items, category, statuses, sort],
  )
  const groups = groupPicks(shown, grouping, dayOfStop)
  const assignedDays = state.days.filter((day) => day.idx !== null)

  const openEditor = (item: WishlistItemView | null) => {
    setDetail({
      title: item ? t('picks.editor.edit') : t('picks.editor.new'),
      content: (
        <PickEditor
          key={item?.id ?? 'new'}
          trip={trip}
          me={me}
          members={members}
          item={item}
          places={store.get().places}
          store={store}
          onSaved={(saved) =>
            toast.show(t(item ? 'picks.saved' : 'picks.created', { name: saved.name }))
          }
          onDeleted={(name) => toast.show(t('picks.delete.done', { name }))}
          onClose={() => setDetail(null)}
        />
      ),
    })
  }

  const setStatus = (item: WishlistItemView, status: WishlistStatus) =>
    void store.patch(item.id, { status }).catch(showError)

  const vote = (item: WishlistItemView, on: boolean) =>
    void store.vote(item.id, me.id, on).catch(showError)

  // The detail pane renders outside this tree: it gets a stable object that calls the latest code
  const current: PickActions = {
    edit: openEditor,
    schedule: (item) => setScheduling(item),
    unschedule: (item) => setUnscheduling(item),
    setStatus,
    remove: (item) => setDeleting(item),
    vote,
  }
  const latest = useRef<PickActions | null>(null)
  useLayoutEffect(() => {
    latest.current = current
  })
  const [actions] = useState<PickActions>(() => ({
    edit: (item) => latest.current?.edit(item),
    schedule: (item) => latest.current?.schedule(item),
    unschedule: (item) => latest.current?.unschedule(item),
    setStatus: (item, status) => latest.current?.setStatus(item, status),
    remove: (item) => latest.current?.remove(item),
    vote: (item, on) => latest.current?.vote(item, on),
  }))

  const openDetail = (item: WishlistItemView) =>
    setDetail({
      title: t('picks.detail.title'),
      content: (
        <PickDetail
          key={item.id}
          itemId={item.id}
          store={store}
          trip={trip}
          me={me}
          members={members}
          canEdit={canEdit}
          actions={actions}
        />
      ),
    })

  const schedule = async (item: WishlistItemView, day: DayWithStops) => {
    setScheduling(null)
    try {
      await store.schedule(item.id, day.id)
      toast.show(t('picks.schedule.done', { name: item.name, day: dayLabel(stopDayOf(day), t) }))
    } catch (error) {
      showError(error)
    }
  }

  const heading = (
    <PageHeading
      title={t('picks.title')}
      lead={t('section.picks.body')}
      actions={
        canEdit && state.status === 'ready' ? (
          <Button variant="primary" onClick={() => openEditor(null)}>
            {t('picks.add')}
          </Button>
        ) : undefined
      }
    />
  )

  if (state.status === 'error') {
    const { key, code } = errorMessageKey(state.error)
    return (
      <Column>
        {heading}
        <EmptyState
          illustration="suitcase"
          title={t('error.title')}
          body={t(key, { code })}
          action={
            <Button variant="primary" onClick={() => void store.load()}>
              {t('error.retry')}
            </Button>
          }
        />
      </Column>
    )
  }

  if (state.status === 'loading') {
    return (
      <Column aria-busy="true">
        {heading}
        <Skeleton $height={40} />
        <Skeleton $height={260} />
      </Column>
    )
  }

  const filtered = category !== 'all' || statuses.size > 0

  return (
    <Column $gap="lg">
      {heading}
      {state.items.length === 0 ? (
        <EmptyState
          illustration="suitcase"
          title={t('picks.empty.title')}
          body={t('picks.empty.body')}
          action={
            canEdit ? (
              <Button variant="primary" onClick={() => openEditor(null)}>
                {t('picks.add')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Toolbar>
            <Scroll>
              <SegmentedControl
                label={t('picks.category.label')}
                value={category}
                onChange={setCategory}
                options={[
                  { value: 'all' as const, label: t('picks.category.all') },
                  ...PICK_CATEGORIES.map((value) => ({ value, label: t(CATEGORY_LABEL[value]) })),
                ]}
              />
            </Scroll>
            <Controls>
              <SegmentedControl
                label={t('picks.sort.label')}
                size="sm"
                value={sort}
                onChange={setSort}
                options={SORTS.map((value) => ({ value, label: t(`picks.sort.${value}`) }))}
              />
              <SegmentedControl
                label={t('picks.group.label')}
                size="sm"
                value={grouping}
                onChange={setGrouping}
                options={GROUPINGS.map((value) => ({ value, label: t(`picks.group.${value}`) }))}
              />
            </Controls>
            <Chips role="group" aria-label={t('picks.filter.label')}>
              <ChipsLabel aria-hidden="true">{t('picks.filter.label')}</ChipsLabel>
              {STATUS_FILTERS.map((value) => (
                <Chip
                  key={value}
                  tone="fjord"
                  selected={statuses.has(value)}
                  onClick={() => setStatuses((set) => toggled(set, value))}
                >
                  {t(STATUS_LABEL[value])}
                </Chip>
              ))}
            </Chips>
          </Toolbar>

          {groups.length === 0 ? (
            <Stack $gap="sm">
              <Muted>{t('picks.emptyFilter')}</Muted>
              {filtered && (
                <div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setCategory('all')
                      setStatuses(new Set())
                    }}
                  >
                    {t('picks.clearFilters')}
                  </Button>
                </div>
              )}
            </Stack>
          ) : (
            groups.map((group) => {
              const wall = (
                <WallHost>
                  <Wall>
                    {group.items.map((item) => (
                      <PickTile
                        key={item.id}
                        item={item}
                        store={store}
                        day={item.stopId ? dayOfStop.get(item.stopId) : undefined}
                        membersById={membersById}
                        me={me}
                        canEdit={canEdit}
                        onOpen={() => openDetail(item)}
                        onEdit={() => openEditor(item)}
                        onSchedule={() => setScheduling(item)}
                        onUnschedule={() => setUnscheduling(item)}
                        onStatus={(status) => setStatus(item, status)}
                        onDelete={() => setDeleting(item)}
                        onVote={(on) => vote(item, on)}
                      />
                    ))}
                  </Wall>
                </WallHost>
              )
              if (group.kind === 'all') return <div key={group.key}>{wall}</div>
              const title =
                group.kind === 'category'
                  ? t(CATEGORY_LABEL[group.category])
                  : group.kind === 'day'
                    ? `${dayLabel(group.day, t)}${group.day.date ? ` · ${formatDate(group.day.date, t.locale)}` : ''}${group.day.title ? ` · ${group.day.title}` : ''}`
                    : t('picks.pocket')
              return (
                <Group key={group.key} aria-label={title}>
                  <SectionTitle>
                    {title}
                    <Count>{group.items.length}</Count>
                  </SectionTitle>
                  {wall}
                </Group>
              )
            })
          )}
        </>
      )}

      <Sheet
        open={Boolean(scheduling)}
        onClose={() => setScheduling(null)}
        title={scheduling ? t('picks.schedule.title', { name: scheduling.name }) : ''}
      >
        {assignedDays.length === 0 ? (
          <Muted>{t('picks.schedule.noDays')}</Muted>
        ) : (
          <Stack $gap="md">
            <Muted>{t('picks.schedule.hint')}</Muted>
            <DayGrid role="group" aria-label={t('picks.schedule.days')}>
              {assignedDays.map((day) => (
                <DayChip
                  key={day.id}
                  index={day.idx! - 1}
                  date={day.date ? formatDate(day.date, t.locale) : undefined}
                  title={day.title || undefined}
                  onClick={() => scheduling && void schedule(scheduling, day)}
                />
              ))}
            </DayGrid>
          </Stack>
        )}
      </Sheet>

      <Dialog
        open={Boolean(unscheduling)}
        onClose={() => setUnscheduling(null)}
        title={unscheduling ? t('picks.unschedule.title', { name: unscheduling.name }) : ''}
        actions={
          <>
            <Button onClick={() => setUnscheduling(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const item = unscheduling
                setUnscheduling(null)
                if (!item) return
                try {
                  await store.unschedule(item.id)
                  toast.show(t('picks.unschedule.done', { name: item.name }))
                } catch (error) {
                  showError(error)
                }
              }}
            >
              {t('picks.unschedule.confirm')}
            </Button>
          </>
        }
      >
        <p>{t('picks.unschedule.body')}</p>
      </Dialog>

      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={deleting ? t('picks.delete.title', { name: deleting.name }) : ''}
        actions={
          <>
            <Button onClick={() => setDeleting(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const item = deleting
                setDeleting(null)
                if (!item) return
                try {
                  await store.remove(item.id)
                  setDetail(null)
                  toast.show(t('picks.delete.done', { name: item.name }))
                } catch (error) {
                  showError(error)
                }
              }}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p>{t('picks.delete.body')}</p>
      </Dialog>
    </Column>
  )
}

const stopDayOf = (day: DayWithStops): StopDay => ({
  dayId: day.id,
  idx: day.idx,
  date: day.date,
  title: day.title,
})

interface PickTileProps {
  item: WishlistItemView
  store: PicksStore
  day: StopDay | undefined
  membersById: ReadonlyMap<string, Member>
  me: Member
  canEdit: boolean
  onOpen: () => void
  onEdit: () => void
  onSchedule: () => void
  onUnschedule: () => void
  onStatus: (status: WishlistStatus) => void
  onDelete: () => void
  onVote: (on: boolean) => void
}

/** One card with its picture, 「想去」 and menu */
function PickTile({
  item,
  store,
  day,
  membersById,
  me,
  canEdit,
  onOpen,
  onEdit,
  onSchedule,
  onUnschedule,
  onStatus,
  onDelete,
  onVote,
}: PickTileProps) {
  const t = useT()
  const image = usePickImage(store.tripId, item)
  const voters = item.votes
    .map((id) => membersById.get(id))
    .filter((member): member is Member => Boolean(member))
  const recommender = item.recommenderMemberId
    ? (membersById.get(item.recommenderMemberId) ?? null)
    : null

  const menu: MenuAction[] = [{ key: 'edit', label: t('picks.action.edit'), onSelect: onEdit }]
  if (item.stopId) menu.push({ key: 'unschedule', label: t('picks.action.unschedule'), onSelect: onUnschedule })
  else if (item.status === 'wish')
    menu.push({ key: 'schedule', label: t('picks.action.schedule'), onSelect: onSchedule })
  if (item.status === 'done')
    menu.push({
      key: 'reopen',
      label: t('picks.action.reopen'),
      onSelect: () => onStatus(item.stopId ? 'scheduled' : 'wish'),
    })
  else if (item.status === 'dropped')
    menu.push({ key: 'restore', label: t('picks.action.restore'), onSelect: () => onStatus('wish') })
  else menu.push({ key: 'done', label: t('picks.action.done'), onSelect: () => onStatus('done') })
  if (item.status === 'wish')
    menu.push({ key: 'drop', label: t('picks.action.drop'), onSelect: () => onStatus('dropped') })
  menu.push({ key: 'delete', label: t('picks.action.delete'), danger: true, onSelect: onDelete })

  return (
    <PickCard
      item={item}
      imageUrl={image}
      recommender={recommender}
      tags={pickTags(item, day, membersById, t)}
      onOpen={onOpen}
      vote={
        <VoteButton
          itemName={item.name}
          voters={voters}
          voted={item.votes.includes(me.id)}
          disabled={!canEdit}
          onToggle={onVote}
        />
      }
      menu={
        canEdit ? (
          <CardMenu label={t('picks.menu.label', { name: item.name })} actions={menu} />
        ) : undefined
      }
    />
  )
}

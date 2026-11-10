import { useEffect, useMemo, useState, type FormEvent } from 'react'
import styled from 'styled-components'
import type { Checklist, ChecklistItem } from '../../../shared/api/prep.ts'
import { formatDate } from '../../../shared/i18n/format.ts'
import '../../../shared/i18n/pages/prep.ts'
import type { ChecklistKind, ChecklistTemplateStyle } from '../../../shared/schema/prep.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { ButtonLink } from '../../components/ButtonLink.tsx'
import {
  Avatar,
  Button,
  Chip,
  DateField,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  Select,
  Sheet,
  Skeleton,
  Tabs,
  useToast,
} from '../../components/index.ts'
import { paletteIndex } from '../../lib/colors.ts'
import { useNow, useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { checklistsApi } from '../../lib/prep/api.ts'
import { isOverdue, listsOfKind, moveOrder, progressOf, withItem } from '../../lib/prep/checklists.ts'
import { STYLE_LABEL, TEMPLATE_STYLES, templateForTripStyle } from '../../lib/prep/constants.ts'
import { useApiErrorToast, useCan } from '../../lib/role.ts'
import { todayIn } from '../../lib/trip-groups.ts'
import { color, fontSize, space } from '../../styles/tokens.ts'
import { PageHeading, Stack } from '../parts.tsx'
import { Check, CheckHit, Fill, Muted, Panel, PanelHead, PanelTitle, Row, Track } from './prep-ui.tsx'

// /trips/:id/checklists (e9-t03): pre-trip to-dos and packing lists in two tabs. A template for the
// trip's style can be copied in (with a preview of what it adds; applying twice adds nothing).
// Items: tick, who does it / who brings it, a due date, up/down. Lists refresh every 20 s while the
// page is visible, so ticks from the others show up without a reload.

const POLL_MS = 20_000

const Items = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
`

const ItemRow = styled.li`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: ${space.sm}px;
  padding: ${space.sm}px 0;
  border-top: 1px solid ${color.line};
  &:first-child {
    border-top: 0;
  }
  > input {
    margin-top: 2px;
  }
`

const ItemBody = styled.div`
  display: grid;
  gap: ${space.xs}px;
  min-width: 0;
`

const ItemText = styled.button<{ $done: boolean }>`
  padding: 0;
  border: 0;
  background: none;
  color: ${({ $done }) => ($done ? color.muted : color.ink)};
  text-decoration: ${({ $done }) => ($done ? 'line-through' : 'none')};
  font: inherit;
  font-size: ${fontSize.body}px;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
  &:disabled {
    cursor: default;
  }
`

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.xs}px ${space.sm}px;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
  a {
    color: ${color.fjordInk};
  }
`

const Person = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs}px;
`

const Moves = styled.div`
  display: flex;
  gap: 2px;
`

const AddForm = styled.form`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: ${space.sm}px;
`

const PreviewList = styled.ul`
  display: grid;
  gap: ${space.xs}px;
  margin: 0;
  padding-left: ${space.lg}px;
  font-size: ${fontSize.sm}px;
`

const Arrow = ({ up }: { up: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d={up ? 'M8 3 3 9h3v4h4V9h3Z' : 'M8 13 3 7h3V3h4v4h3Z'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
)

interface Preview {
  lists: { title: string; items: number }[]
  items: number
}

export default function ChecklistsPage() {
  const t = useT()
  const { trip, members, me } = useTripContext()
  const can = useCan()
  const editable = can('editContent')
  const toast = useToast()
  const showError = useApiErrorToast()
  const [tab, setTab] = useState<ChecklistKind>('pretrip')
  const [editing, setEditing] = useState<ChecklistItem | null>(null)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [newListOpen, setNewListOpen] = useState(false)
  const [deleting, setDeleting] = useState<Checklist | null>(null)

  const resource = useResource(`checklists:${trip.id}`, (signal) =>
    checklistsApi.list(trip.id, signal),
  )
  const { reload, set } = resource
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') reload()
    }
    const timer = window.setInterval(tick, POLL_MS)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', tick)
    }
  }, [reload])

  const lists = useMemo(
    () => (resource.status === 'ready' ? resource.data.checklists : []),
    [resource.status, resource.data],
  )
  const setLists = (next: Checklist[]) => {
    if (resource.status === 'ready') set({ ...resource.data, checklists: next })
  }
  const shown = listsOfKind(lists, tab)
  const progress = progressOf(shown)
  const today = todayIn(trip.tz, useNow())
  const memberName = (id: string | null) => members.find((m) => m.id === id) ?? null

  const patchItem = async (item: ChecklistItem, body: Parameters<typeof checklistsApi.patchItem>[3]) => {
    // Optimistic: the tick shows at once, the answer replaces it
    setLists(withItem(lists, { ...item, ...body } as ChecklistItem))
    try {
      const res = await checklistsApi.patchItem(trip.id, item.checklistId, item.id, body)
      setLists(withItem(lists, res.item))
      return res.item
    } catch (error) {
      setLists(withItem(lists, item))
      showError(error)
      return null
    }
  }

  const move = (list: Checklist, index: number, direction: -1 | 1) => {
    const order = moveOrder(list.items, index, direction)
    if (order !== null) void patchItem(list.items[index], { order })
  }

  const addItem = async (list: Checklist, text: string) => {
    try {
      await checklistsApi.createItem(trip.id, list.id, { text })
      reload()
      return true
    } catch (error) {
      showError(error)
      return false
    }
  }

  const removeList = async (list: Checklist) => {
    try {
      await checklistsApi.remove(trip.id, list.id)
      setDeleting(null)
      reload()
    } catch (error) {
      showError(error)
    }
  }

  const tabs = [
    { value: 'pretrip' as const, label: t('prep.checklists.tab.pretrip') },
    { value: 'packing' as const, label: t('prep.checklists.tab.packing') },
  ]

  return (
    <Stack $gap="lg">
      <PageHeading
        title={t('prep.checklists.title')}
        lead={t('prep.checklists.lead')}
        actions={
          <Row>
            {editable && (
              <Button variant="primary" onClick={() => setTemplateOpen(true)}>
                {t('prep.checklists.template.button')}
              </Button>
            )}
            <ButtonLink to=".." relative="path" variant="ghost">
              {t('prep.back')}
            </ButtonLink>
          </Row>
        }
      />

      <Tabs
        items={tabs}
        value={tab}
        onChange={setTab}
        label={t('prep.checklists.tabs')}
        idPrefix="checklists"
      />

      <div
        role="tabpanel"
        id={`checklists-panel-${tab}`}
        aria-labelledby={`checklists-tab-${tab}`}
      >
        <Stack $gap="md">
          {resource.status === 'loading' && <Skeleton $height={200} />}
          {resource.status === 'error' && (
            <EmptyState
              title={t('error.title')}
              body={t('error.network')}
              action={
                <Button variant="primary" onClick={reload}>
                  {t('error.retry')}
                </Button>
              }
            />
          )}
          {resource.status === 'ready' && shown.length === 0 && (
            <EmptyState
              title={t('prep.checklists.empty.title')}
              body={t('prep.checklists.empty.body')}
              action={
                editable ? (
                  <Button variant="primary" onClick={() => setTemplateOpen(true)}>
                    {t('prep.checklists.template.button')}
                  </Button>
                ) : undefined
              }
            />
          )}
          {shown.length > 0 && (
            <Stack $gap="xs">
              <Muted>{t('prep.checklists.progress', progress)}</Muted>
              <Track
                role="progressbar"
                aria-label={t('prep.checklists.progressLabel')}
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
              >
                <Fill $ratio={progress.total ? progress.done / progress.total : 0} />
              </Track>
            </Stack>
          )}
          {shown.map((list) => {
            const own = progressOf([list])
            return (
              <Panel key={list.id} aria-label={list.title} data-checklist={list.templateKey ?? list.id}>
                <PanelHead>
                  <PanelTitle>{list.title}</PanelTitle>
                  <Row>
                    <Muted>{t('prep.checklists.progress', own)}</Muted>
                    {editable && (
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(list)}>
                        {t('prep.checklists.deleteList')}
                      </Button>
                    )}
                  </Row>
                </PanelHead>
                <Items>
                  {list.items.map((item, index) => {
                    const person = memberName(item.assigneeMemberId)
                    const overdue = isOverdue(item, today)
                    return (
                      <ItemRow key={item.id} data-item={item.templateKey ?? item.id}>
                        <CheckHit>
                          <Check
                            checked={item.done}
                            disabled={!editable}
                            aria-label={t('prep.checklists.item.done', { text: item.text })}
                            onChange={(event) => void patchItem(item, { done: event.target.checked })}
                          />
                        </CheckHit>
                        <ItemBody>
                          <ItemText
                            type="button"
                            $done={item.done}
                            disabled={!editable}
                            onClick={() => setEditing(item)}
                          >
                            {item.text}
                          </ItemText>
                          <Meta>
                            {person ? (
                              <Person data-assignee={person.id}>
                                <Avatar
                                  name={person.name}
                                  colorIndex={paletteIndex(person.color, person.id)}
                                  size="sm"
                                />
                                {list.kind === 'packing'
                                  ? t('prep.checklists.item.bringsIt', { name: person.name })
                                  : person.name}
                              </Person>
                            ) : (
                              list.kind === 'packing' &&
                              !list.templateKey?.includes('packing-personal') &&
                              editable && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void patchItem(item, { assigneeMemberId: me.id })}
                                >
                                  {t('prep.checklists.item.claim')}
                                </Button>
                              )
                            )}
                            {item.dueAt && (
                              <Chip tone={overdue ? 'danger' : 'neutral'}>
                                {overdue
                                  ? t('prep.checklists.item.overdue', {
                                      date: formatDate(item.dueAt, t.locale),
                                    })
                                  : t('prep.checklists.item.dueOn', {
                                      date: formatDate(item.dueAt, t.locale),
                                    })}
                              </Chip>
                            )}
                            {item.linkHint && (
                              <span>
                                {t('prep.checklists.item.where')}{' '}
                                {item.linkHint.url ? (
                                  <a href={item.linkHint.url} target="_blank" rel="noopener noreferrer">
                                    {item.linkHint.label}
                                  </a>
                                ) : (
                                  item.linkHint.label
                                )}
                              </span>
                            )}
                          </Meta>
                        </ItemBody>
                        {editable && (
                          <Moves>
                            <IconButton
                              size="sm"
                              label={t('prep.checklists.item.moveUp', { text: item.text })}
                              icon={<Arrow up />}
                              disabled={index === 0}
                              onClick={() => move(list, index, -1)}
                            />
                            <IconButton
                              size="sm"
                              label={t('prep.checklists.item.moveDown', { text: item.text })}
                              icon={<Arrow up={false} />}
                              disabled={index === list.items.length - 1}
                              onClick={() => move(list, index, 1)}
                            />
                          </Moves>
                        )}
                      </ItemRow>
                    )
                  })}
                </Items>
                {editable && <AddItem onAdd={(text) => addItem(list, text)} />}
              </Panel>
            )
          })}
          {editable && resource.status === 'ready' && (
            <div>
              <Button variant="secondary" onClick={() => setNewListOpen(true)}>
                {t('prep.checklists.newList')}
              </Button>
            </div>
          )}
        </Stack>
      </div>

      {editing && (
        <ItemSheet
          key={editing.id}
          item={editing}
          kind={lists.find((l) => l.id === editing.checklistId)?.kind ?? 'pretrip'}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const saved = await patchItem(editing, body)
            if (saved) setEditing(null)
          }}
          onDelete={async () => {
            try {
              await checklistsApi.removeItem(trip.id, editing.checklistId, editing.id)
              setEditing(null)
              reload()
            } catch (error) {
              showError(error)
            }
          }}
        />
      )}

      <TemplateDialog
        open={templateOpen}
        lists={lists}
        defaultStyle={templateForTripStyle(trip.style)}
        onClose={() => setTemplateOpen(false)}
        onApply={async (style) => {
          try {
            const res = await checklistsApi.applyTemplate(trip.id, { style, locale: t.locale })
            setLists(res.checklists)
            reload()
            setTemplateOpen(false)
            toast.show(t('prep.checklists.template.done', { items: res.added.items }))
          } catch (error) {
            showError(error)
          }
        }}
      />

      <NewListDialog
        open={newListOpen}
        onClose={() => setNewListOpen(false)}
        onCreate={async (title) => {
          try {
            await checklistsApi.create(trip.id, { kind: tab, title })
            setNewListOpen(false)
            reload()
          } catch (error) {
            showError(error)
          }
        }}
      />

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('prep.checklists.deleteList')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('prep.cancel')}
            </Button>
            <Button variant="danger" onClick={() => deleting && void removeList(deleting)}>
              {t('prep.delete')}
            </Button>
          </>
        }
      >
        {deleting && (
          <p>
            {t('prep.checklists.deleteList.confirm', {
              title: deleting.title,
              count: deleting.items.length,
            })}
          </p>
        )}
      </Dialog>
    </Stack>
  )
}

function AddItem({ onAdd }: { onAdd: (text: string) => Promise<boolean> }) {
  const t = useT()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    if (await onAdd(text.trim())) setText('')
    setBusy(false)
  }
  return (
    <AddForm onSubmit={submit}>
      <Input
        label={t('prep.checklists.addItem')}
        placeholder={t('prep.checklists.addItem.placeholder')}
        value={text}
        maxLength={500}
        onChange={(event) => setText(event.target.value)}
      />
      <Button type="submit" disabled={busy || !text.trim()}>
        {t('prep.checklists.addItem.button')}
      </Button>
    </AddForm>
  )
}

function ItemSheet({
  item,
  kind,
  onClose,
  onSave,
  onDelete,
}: {
  item: ChecklistItem
  kind: ChecklistKind
  onClose: () => void
  onSave: (body: { text: string; assigneeMemberId: string | null; dueAt: string | null }) => void
  onDelete: () => void
}) {
  const t = useT()
  const { members } = useTripContext()
  const [text, setText] = useState(item.text)
  const [assignee, setAssignee] = useState(item.assigneeMemberId ?? '')
  const [due, setDue] = useState(item.dueAt ?? '')
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('prep.checklists.item.edit')}
      actions={
        <>
          <Button variant="danger" onClick={onDelete}>
            {t('prep.checklists.item.delete')}
          </Button>
          <Button
            variant="primary"
            disabled={!text.trim()}
            onClick={() =>
              onSave({ text: text.trim(), assigneeMemberId: assignee || null, dueAt: due || null })
            }
          >
            {t('prep.save')}
          </Button>
        </>
      }
    >
      <Stack $gap="md">
        <Input
          label={t('prep.checklists.item.text')}
          value={text}
          maxLength={500}
          onChange={(event) => setText(event.target.value)}
        />
        <Select
          label={
            kind === 'packing' ? t('prep.checklists.item.bringer') : t('prep.checklists.item.assignee')
          }
          value={assignee}
          onChange={(event) => setAssignee(event.target.value)}
        >
          <option value="">{t('prep.checklists.item.nobody')}</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </Select>
        <DateField
          label={t('prep.checklists.item.due')}
          optional
          value={due}
          onChange={(event) => setDue(event.target.value)}
        />
      </Stack>
    </Sheet>
  )
}

function TemplateDialog({
  open,
  lists,
  defaultStyle,
  onClose,
  onApply,
}: {
  open: boolean
  lists: readonly Checklist[]
  defaultStyle: ChecklistTemplateStyle
  onClose: () => void
  onApply: (style: ChecklistTemplateStyle) => Promise<void>
}) {
  const t = useT()
  const [style, setStyle] = useState(defaultStyle)
  const [busy, setBusy] = useState(false)
  // The templates are their own chunk: loaded when the dialog opens, not with the page
  const templates = useResource(`checklist-templates:${open}`, () =>
    open ? import('../../../shared/templates/index.ts') : Promise.resolve(null),
  )
  const preview = useMemo((): Preview | null => {
    if (templates.status !== 'ready' || !templates.data) return null
    const listKeys = new Set(lists.map((l) => l.templateKey))
    const itemKeys = new Set(lists.flatMap((l) => l.items.map((i) => i.templateKey)))
    const out: Preview = { lists: [], items: 0 }
    for (const list of templates.data.checklistTemplateLists(style)) {
      const items = list.items.filter((item) => !itemKeys.has(item.key)).length
      if (!items && listKeys.has(list.key)) continue
      out.lists.push({ title: list.title[t.locale], items })
      out.items += items
    }
    return out
  }, [templates.status, templates.data, lists, style, t.locale])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('prep.checklists.template.title')}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('prep.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !preview || preview.items === 0}
            onClick={async () => {
              setBusy(true)
              await onApply(style)
              setBusy(false)
            }}
          >
            {t('prep.checklists.template.apply')}
          </Button>
        </>
      }
    >
      <Stack $gap="md">
        <Select
          label={t('prep.checklists.template.style')}
          hint={t('prep.checklists.template.hint')}
          value={style}
          onChange={(event) => setStyle(event.target.value as ChecklistTemplateStyle)}
        >
          {TEMPLATE_STYLES.map((value) => (
            <option key={value} value={value}>
              {value === defaultStyle
                ? t('prep.checklists.template.suggested', { style: t(STYLE_LABEL[value]) })
                : t(STYLE_LABEL[value])}
            </option>
          ))}
        </Select>
        {!preview && <Skeleton $height={60} />}
        {preview && preview.items === 0 && <Muted>{t('prep.checklists.template.nothing')}</Muted>}
        {preview && preview.items > 0 && (
          <Stack $gap="xs" data-template-preview="">
            <Muted>
              {t('prep.checklists.template.preview', {
                lists: preview.lists.length,
                items: preview.items,
              })}
            </Muted>
            <PreviewList>
              {preview.lists.map((list) => (
                <li key={list.title}>
                  {t('prep.checklists.template.previewList', { title: list.title, items: list.items })}
                </li>
              ))}
            </PreviewList>
          </Stack>
        )}
      </Stack>
    </Dialog>
  )
}

function NewListDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (title: string) => Promise<void>
}) {
  const t = useT()
  const [title, setTitle] = useState('')
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('prep.checklists.newList')}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('prep.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!title.trim()}
            onClick={async () => {
              await onCreate(title.trim())
              setTitle('')
            }}
          >
            {t('prep.checklists.newList.create')}
          </Button>
        </>
      }
    >
      <Input
        label={t('prep.checklists.newList.name')}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
      />
    </Dialog>
  )
}

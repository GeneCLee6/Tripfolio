// Checklists (e9-t02/t03): pre-trip to-dos and packing lists, their items (assignee = who brings
// it, a due date), and copying a template in (docs/PRD/e9-pretrip-prep.md). Viewers read, editors
// write; every write bumps the trip rev and answers with it.
//
// Applying a template is idempotent: lists and items carry the template's key (unique per trip),
// so a second apply only adds what is missing. Deleting an item and applying again brings it back.

import type {
  ApplyTemplateResponse,
  Checklist,
  ChecklistItem,
  ChecklistItemResponse,
  ChecklistResponse,
  ChecklistsResponse,
} from '../../shared/api/prep.ts'
import {
  applyChecklistTemplateSchema,
  checklistCreateSchema,
  checklistItemCreateSchema,
  checklistItemPatchSchema,
  checklistPatchSchema,
  type StoredLinkHint,
} from '../../shared/schema/prep.ts'
import { checklistTemplateLists, dateMinusDays } from '../../shared/templates/index.ts'
import { authTrip } from '../auth.ts'
import { insertStatement, updateStatement, writeWithRev, type Row } from '../db.ts'
import { invalid, json, notFound, nowIso, readBody } from '../http.ts'
import { notifyTrip } from '../sync.ts'
import type { RouteContext } from '../router.ts'

const LIST_COLUMNS = ['title', 'order'] as const
const ITEM_COLUMNS = ['text', 'note', 'done', 'assigneeMemberId', 'dueAt', 'order'] as const

const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

function parseLinkHint(v: unknown): StoredLinkHint | null {
  if (typeof v !== 'string') return null
  try {
    const parsed = JSON.parse(v) as StoredLinkHint
    return typeof parsed?.label === 'string' ? parsed : null
  } catch {
    return null
  }
}

function toItem(r: Row): ChecklistItem {
  return {
    id: String(r.id),
    checklistId: String(r.checklistId),
    text: String(r.text),
    note: String(r.note ?? ''),
    done: Number(r.done) === 1,
    assigneeMemberId: strOrNull(r.assigneeMemberId),
    dueAt: strOrNull(r.dueAt),
    order: Number(r.order),
    templateKey: strOrNull(r.templateKey),
    linkHint: parseLinkHint(r.linkHint),
    rev: Number(r.rev),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  }
}

function toList(r: Row): Checklist {
  return {
    id: String(r.id),
    tripId: String(r.tripId),
    kind: String(r.kind) as Checklist['kind'],
    title: String(r.title),
    order: Number(r.order),
    templateKey: strOrNull(r.templateKey),
    rev: Number(r.rev),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
    items: [],
  }
}

/** Every list of the trip with its items, in order */
export async function loadChecklists(db: D1Database, tripId: string): Promise<Checklist[]> {
  const [lists, items] = await Promise.all([
    db
      .prepare('SELECT * FROM checklists WHERE tripId = ? ORDER BY "order", createdAt, id')
      .bind(tripId)
      .all<Row>(),
    db
      .prepare('SELECT * FROM checklistItems WHERE tripId = ? ORDER BY "order", createdAt, id')
      .bind(tripId)
      .all<Row>(),
  ])
  const byId = new Map<string, Checklist>()
  for (const r of lists.results) byId.set(String(r.id), toList(r))
  for (const r of items.results) byId.get(String(r.checklistId))?.items.push(toItem(r))
  return [...byId.values()]
}

async function loadList(db: D1Database, tripId: string, id: string): Promise<Checklist> {
  const list = (await loadChecklists(db, tripId)).find((l) => l.id === id)
  if (!list) throw notFound('checklist not found')
  return list
}

async function loadItem(db: D1Database, listId: string, id: string): Promise<ChecklistItem> {
  const row = await db
    .prepare('SELECT * FROM checklistItems WHERE id = ? AND checklistId = ?')
    .bind(id, listId)
    .first<Row>()
  if (!row) throw notFound('checklist item not found')
  return toItem(row)
}

async function assertMember(db: D1Database, tripId: string, memberId: string | null | undefined) {
  if (!memberId) return
  const row = await db
    .prepare('SELECT id FROM members WHERE id = ? AND tripId = ? AND removedAt IS NULL')
    .bind(memberId, tripId)
    .first<Row>()
  if (!row) throw invalid('assigneeMemberId: no such member in this trip')
}

async function nextOrder(db: D1Database, sql: string, id: string): Promise<number> {
  const last = await db.prepare(sql).bind(id).first<number | null>('m')
  return last === null || last === undefined ? 1 : Number(last) + 1
}

/** GET /api/trips/:id/checklists (viewer) */
export async function listChecklists(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
  const body: ChecklistsResponse = {
    checklists: await loadChecklists(c.env.DB, auth.trip.id),
    rev: auth.trip.rev,
  }
  return json(body)
}

/** POST /api/trips/:id/checklists (editor) */
export async function createChecklist(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const body = await readBody(c.request, checklistCreateSchema)
  const now = nowIso()
  const id = crypto.randomUUID()
  const order =
    body.order ??
    (await nextOrder(db, 'SELECT MAX("order") AS m FROM checklists WHERE tripId = ?', auth.trip.id))
  const rev = await writeWithRev(db, auth.trip.id, [
    insertStatement(db, 'checklists', {
      id,
      tripId: auth.trip.id,
      kind: body.kind,
      title: body.title,
      order,
      createdAt: now,
      updatedAt: now,
    }),
  ])
  notifyTrip(c.env, auth.trip.id, { rev, entity: 'checklist', id: id, action: 'upsert', by: auth.member.id })
  const response: ChecklistResponse = { checklist: await loadList(db, auth.trip.id, id), rev }
  return json(response, 201)
}

/** PATCH /api/trips/:id/checklists/:cid (editor) */
export async function patchChecklist(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const list = await loadList(db, auth.trip.id, c.params.cid)
  const patch = await readBody(c.request, checklistPatchSchema)
  const update = updateStatement(db, 'checklists', patch, LIST_COLUMNS, nowIso(), {
    sql: 'id = ?',
    values: [list.id],
  })
  const rev = update ? await writeWithRev(db, auth.trip.id, [update]) : auth.trip.rev
  if (update) notifyTrip(c.env, auth.trip.id, { rev, entity: 'checklist', id: list.id, action: 'upsert', by: auth.member.id })
  const response: ChecklistResponse = { checklist: await loadList(db, auth.trip.id, list.id), rev }
  return json(response)
}

/** DELETE /api/trips/:id/checklists/:cid (editor): the list and its items */
export async function deleteChecklist(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const list = await loadList(db, auth.trip.id, c.params.cid)
  const rev = await writeWithRev(db, auth.trip.id, [
    db.prepare('DELETE FROM checklistItems WHERE checklistId = ?').bind(list.id),
    db.prepare('DELETE FROM checklists WHERE id = ?').bind(list.id),
  ])
  notifyTrip(c.env, auth.trip.id, { rev, entity: 'checklist', id: list.id, action: 'delete', by: auth.member.id })
  return json({ ok: true, rev })
}

/** POST /api/trips/:id/checklists/:cid/items (editor) */
export async function createChecklistItem(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const list = await loadList(db, auth.trip.id, c.params.cid)
  const body = await readBody(c.request, checklistItemCreateSchema)
  await assertMember(db, auth.trip.id, body.assigneeMemberId)
  const now = nowIso()
  const id = crypto.randomUUID()
  const order =
    body.order ??
    (await nextOrder(
      db,
      'SELECT MAX("order") AS m FROM checklistItems WHERE checklistId = ?',
      list.id,
    ))
  const rev = await writeWithRev(db, auth.trip.id, [
    insertStatement(db, 'checklistItems', {
      id,
      checklistId: list.id,
      tripId: auth.trip.id,
      text: body.text,
      note: body.note,
      done: body.done,
      assigneeMemberId: body.assigneeMemberId,
      dueAt: body.dueAt,
      order,
      createdAt: now,
      updatedAt: now,
    }),
  ])
  notifyTrip(c.env, auth.trip.id, { rev, entity: 'checklist', id: list.id, action: 'upsert', by: auth.member.id })
  const response: ChecklistItemResponse = { item: await loadItem(db, list.id, id), rev }
  return json(response, 201)
}

/** PATCH /api/trips/:id/checklists/:cid/items/:iid (editor): tick, assign, due date, text, order */
export async function patchChecklistItem(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const list = await loadList(db, auth.trip.id, c.params.cid)
  const item = await loadItem(db, list.id, c.params.iid)
  const patch = await readBody(c.request, checklistItemPatchSchema)
  await assertMember(db, auth.trip.id, patch.assigneeMemberId)
  const update = updateStatement(db, 'checklistItems', patch, ITEM_COLUMNS, nowIso(), {
    sql: 'id = ?',
    values: [item.id],
  })
  const rev = update ? await writeWithRev(db, auth.trip.id, [update]) : auth.trip.rev
  if (update) notifyTrip(c.env, auth.trip.id, { rev, entity: 'checklist', id: list.id, action: 'upsert', by: auth.member.id })
  const response: ChecklistItemResponse = { item: await loadItem(db, list.id, item.id), rev }
  return json(response)
}

/** DELETE /api/trips/:id/checklists/:cid/items/:iid (editor) */
export async function deleteChecklistItem(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const list = await loadList(db, auth.trip.id, c.params.cid)
  const item = await loadItem(db, list.id, c.params.iid)
  const rev = await writeWithRev(db, auth.trip.id, [
    db.prepare('DELETE FROM checklistItems WHERE id = ?').bind(item.id),
  ])
  notifyTrip(c.env, auth.trip.id, { rev, entity: 'checklist', id: list.id, action: 'upsert', by: auth.member.id })
  return json({ ok: true, rev })
}

/**
 * POST /api/trips/:id/checklists/apply-template { style, locale } (editor): copies the general
 * template plus the style's own, in `locale`; lists and items already copied (same templateKey) are
 * skipped. Due dates are the trip's start minus the item's dueDaysBefore.
 */
export async function applyChecklistTemplate(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const { style, locale } = await readBody(c.request, applyChecklistTemplateSchema)
  const existing = await loadChecklists(db, auth.trip.id)
  const listByKey = new Map(existing.filter((l) => l.templateKey).map((l) => [l.templateKey, l]))
  const itemKeys = new Set(existing.flatMap((l) => l.items.map((i) => i.templateKey)))
  let order = existing.reduce((max, l) => Math.max(max, l.order), 0)
  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  const added = { lists: 0, items: 0 }
  for (const list of checklistTemplateLists(style)) {
    let listId = listByKey.get(list.key)?.id
    let itemOrder = listByKey.get(list.key)?.items.reduce((max, i) => Math.max(max, i.order), 0)
    if (!listId) {
      listId = crypto.randomUUID()
      itemOrder = 0
      order += 1
      added.lists += 1
      statements.push(
        insertStatement(db, 'checklists', {
          id: listId,
          tripId: auth.trip.id,
          kind: list.kind,
          title: list.title[locale],
          order,
          templateKey: list.key,
          createdAt: now,
          updatedAt: now,
        }),
      )
    }
    for (const item of list.items) {
      if (itemKeys.has(item.key)) continue
      itemOrder = (itemOrder ?? 0) + 1
      added.items += 1
      const linkHint: StoredLinkHint | null = item.linkHint
        ? { label: item.linkHint.label[locale], ...(item.linkHint.url && { url: item.linkHint.url }) }
        : null
      statements.push(
        insertStatement(db, 'checklistItems', {
          id: crypto.randomUUID(),
          checklistId: listId,
          tripId: auth.trip.id,
          text: item.text[locale],
          done: false,
          dueAt:
            item.dueDaysBefore === undefined
              ? null
              : dateMinusDays(auth.trip.startDate, item.dueDaysBefore),
          order: itemOrder,
          templateKey: item.key,
          linkHint,
          createdAt: now,
          updatedAt: now,
        }),
      )
    }
  }
  const rev = statements.length ? await writeWithRev(db, auth.trip.id, statements) : auth.trip.rev
  if (statements.length) notifyTrip(c.env, auth.trip.id, { rev, entity: 'checklist', id: '*', action: 'upsert', by: auth.member.id })
  const body: ApplyTemplateResponse = {
    added,
    checklists: await loadChecklists(db, auth.trip.id),
    rev,
  }
  return json(body, added.lists || added.items ? 201 : 200)
}

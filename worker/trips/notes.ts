// Destination notes (e9-t05): sections such as emergency numbers, plugs, driving rules, copied
// from a destination template (the first is New Zealand) and edited freely. `shareable` marks a
// note the share page may show later (E8); nothing outside the members reads notes yet.
// Viewers read, editors write. Applying a template is idempotent by templateKey.

import type {
  ApplyNotesResponse,
  Note,
  NoteResponse,
  NotesResponse,
} from '../../shared/api/prep.ts'
import {
  applyNotesTemplateSchema,
  noteCreateSchema,
  notePatchSchema,
} from '../../shared/schema/prep.ts'
import { NOTE_TEMPLATES } from '../../shared/templates/index.ts'
import { authTrip } from '../auth.ts'
import { insertStatement, updateStatement, writeWithRev, type Row } from '../db.ts'
import { json, notFound, nowIso, readBody } from '../http.ts'
import { notifyTrip } from '../sync.ts'
import type { RouteContext } from '../router.ts'

const COLUMNS = ['section', 'title', 'body', 'order', 'shareable'] as const

function toNote(r: Row): Note {
  return {
    id: String(r.id),
    tripId: String(r.tripId),
    section: String(r.section) as Note['section'],
    title: String(r.title),
    body: String(r.body ?? ''),
    order: Number(r.order),
    templateKey: r.templateKey === null || r.templateKey === undefined ? null : String(r.templateKey),
    shareable: Number(r.shareable) === 1,
    rev: Number(r.rev),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  }
}

export async function loadNotes(db: D1Database, tripId: string): Promise<Note[]> {
  const { results } = await db
    .prepare('SELECT * FROM notes WHERE tripId = ? ORDER BY "order", createdAt, id')
    .bind(tripId)
    .all<Row>()
  return results.map(toNote)
}

async function loadNote(db: D1Database, tripId: string, id: string): Promise<Note> {
  const row = await db
    .prepare('SELECT * FROM notes WHERE id = ? AND tripId = ?')
    .bind(id, tripId)
    .first<Row>()
  if (!row) throw notFound('note not found')
  return toNote(row)
}

async function maxOrder(db: D1Database, tripId: string): Promise<number> {
  const m = await db
    .prepare('SELECT MAX("order") AS m FROM notes WHERE tripId = ?')
    .bind(tripId)
    .first<number | null>('m')
  return m === null || m === undefined ? 0 : Number(m)
}

/** GET /api/trips/:id/notes (viewer) */
export async function listNotes(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
  const body: NotesResponse = { notes: await loadNotes(c.env.DB, auth.trip.id), rev: auth.trip.rev }
  return json(body)
}

/** POST /api/trips/:id/notes (editor) */
export async function createNote(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const body = await readBody(c.request, noteCreateSchema)
  const now = nowIso()
  const id = crypto.randomUUID()
  const rev = await writeWithRev(db, auth.trip.id, [
    insertStatement(db, 'notes', {
      id,
      tripId: auth.trip.id,
      section: body.section,
      title: body.title,
      body: body.body,
      order: body.order ?? (await maxOrder(db, auth.trip.id)) + 1,
      shareable: body.shareable,
      createdAt: now,
      updatedAt: now,
    }),
  ])
  notifyTrip(c.env, auth.trip.id, { rev, entity: 'note', id: id, action: 'upsert', by: auth.member.id })
  const response: NoteResponse = { note: await loadNote(db, auth.trip.id, id), rev }
  return json(response, 201)
}

/** PATCH /api/trips/:id/notes/:nid (editor) */
export async function patchNote(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const note = await loadNote(db, auth.trip.id, c.params.nid)
  const patch = await readBody(c.request, notePatchSchema)
  const update = updateStatement(db, 'notes', patch, COLUMNS, nowIso(), {
    sql: 'id = ?',
    values: [note.id],
  })
  const rev = update ? await writeWithRev(db, auth.trip.id, [update]) : auth.trip.rev
  if (update) notifyTrip(c.env, auth.trip.id, { rev, entity: 'note', id: note.id, action: 'upsert', by: auth.member.id })
  const response: NoteResponse = { note: await loadNote(db, auth.trip.id, note.id), rev }
  return json(response)
}

/** DELETE /api/trips/:id/notes/:nid (editor) */
export async function deleteNote(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const note = await loadNote(db, auth.trip.id, c.params.nid)
  const rev = await writeWithRev(db, auth.trip.id, [
    db.prepare('DELETE FROM notes WHERE id = ?').bind(note.id),
  ])
  notifyTrip(c.env, auth.trip.id, { rev, entity: 'note', id: note.id, action: 'delete', by: auth.member.id })
  return json({ ok: true, rev })
}

/** POST /api/trips/:id/notes/apply-template { destination, locale } (editor) */
export async function applyNotesTemplate(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const { destination, locale } = await readBody(c.request, applyNotesTemplateSchema)
  const existing = await loadNotes(db, auth.trip.id)
  const keys = new Set(existing.map((n) => n.templateKey))
  let order = existing.reduce((max, n) => Math.max(max, n.order), 0)
  const now = nowIso()
  const statements = NOTE_TEMPLATES[destination].sections
    .filter((s) => !keys.has(s.key))
    .map((s) => {
      order += 1
      return insertStatement(db, 'notes', {
        id: crypto.randomUUID(),
        tripId: auth.trip.id,
        section: s.section,
        title: s.title[locale],
        body: s.body[locale],
        order,
        templateKey: s.key,
        shareable: false,
        createdAt: now,
        updatedAt: now,
      })
    })
  const rev = statements.length ? await writeWithRev(db, auth.trip.id, statements) : auth.trip.rev
  if (statements.length) notifyTrip(c.env, auth.trip.id, { rev, entity: 'note', id: '*', action: 'upsert', by: auth.member.id })
  const body: ApplyNotesResponse = {
    added: statements.length,
    notes: await loadNotes(db, auth.trip.id),
    rev,
  }
  return json(body, statements.length ? 201 : 200)
}

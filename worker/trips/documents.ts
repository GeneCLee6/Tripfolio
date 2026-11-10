// The documents folder (e9-t04): passports, visas, insurance, licences. Only a listing and
// categorising layer over worker/media.ts: uploads go through /attachments/sign with
// kind 'document' (always members-only), bytes through GET /api/media/:aid (members only,
// no-store), deletion through DELETE /attachments/:aid. Documents never reach a share page: the
// share payload only lists kind 'photo', and share tokens are refused for every other kind.

import type { DocumentResponse, DocumentsResponse, TripDocument } from '../../shared/api/prep.ts'
import { documentPatchSchema, type DocCategory } from '../../shared/schema/prep.ts'
import { authTrip } from '../auth.ts'
import { writeWithRev, type Row } from '../db.ts'
import { json, notFound, nowIso, readBody } from '../http.ts'
import { toAttachment } from '../media.ts'
import type { RouteContext } from '../router.ts'

const toDocument = (r: Row): TripDocument => ({
  ...toAttachment(r),
  docCategory:
    r.docCategory === null || r.docCategory === undefined
      ? null
      : (String(r.docCategory) as DocCategory),
})

async function loadDocument(db: D1Database, tripId: string, id: string): Promise<Row> {
  const row = await db
    .prepare(
      `SELECT * FROM attachments WHERE id = ? AND tripId = ? AND kind = 'document'
          AND status = 'ready' AND deletedAt IS NULL`,
    )
    .bind(id, tripId)
    .first<Row>()
  if (!row) throw notFound('document not found')
  return row
}

/** GET /api/trips/:id/documents (viewer): ready documents, newest first */
export async function listDocuments(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM attachments WHERE tripId = ? AND kind = 'document' AND status = 'ready'
        AND deletedAt IS NULL ORDER BY createdAt DESC, id`,
  )
    .bind(auth.trip.id)
    .all<Row>()
  const body: DocumentsResponse = { documents: results.map(toDocument), rev: auth.trip.rev }
  return json(body)
}

/** PATCH /api/trips/:id/documents/:aid { docCategory } (editor) */
export async function patchDocument(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const row = await loadDocument(db, auth.trip.id, c.params.aid)
  const { docCategory } = await readBody(c.request, documentPatchSchema)
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare('UPDATE attachments SET docCategory = ?, rev = rev + 1, updatedAt = ? WHERE id = ?')
      .bind(docCategory, nowIso(), String(row.id)),
  ])
  const body: DocumentResponse = {
    document: toDocument(await loadDocument(db, auth.trip.id, String(row.id))),
    rev,
  }
  return json(body)
}

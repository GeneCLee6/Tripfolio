import { beforeEach, describe, expect, it } from 'vitest'
import type {
  ApplyNotesResponse,
  ApplyTemplateResponse,
  BudgetProgressResponse,
  BudgetResponse,
  ChecklistItemResponse,
  ChecklistResponse,
  ChecklistsResponse,
  DocumentResponse,
  DocumentsResponse,
  NoteResponse,
} from '../../shared/api/prep.ts'
import type { SharePayload } from '../../shared/api/share.ts'
import type {
  CreateInviteResponse,
  CreateTripResponse,
  MemberTokenResponse,
} from '../../shared/api/types.ts'
import type { MemberCreate } from '../../shared/schema/member.ts'
import { CHECKLIST_TEMPLATES, checklistTemplateLists } from '../../shared/templates/index.ts'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'
import { computeProgress } from '../../worker/trips/budget.ts'
import { createFakeD1 } from './fake-d1.ts'

// Pre-trip prep (E9): checklists and templates, budget and progress, notes, documents

let env: Env
let sqlite: ReturnType<typeof createFakeD1>['sqlite']

beforeEach(() => {
  const fake = createFakeD1()
  sqlite = fake.sqlite
  env = { DB: fake.db, APP_VERSION: 'test' } as unknown as Env
})

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: T; headers: Headers }> {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await handleRequest(
    new Request(`https://x.test${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  )
  return { status: response.status, body: (await response.json()) as T, headers: response.headers }
}

async function setup() {
  const trip = await call<CreateTripResponse>('POST', '/api/trips', undefined, {
    name: 'South Island',
    destination: 'New Zealand',
    startDate: '2026-12-20',
    endDate: '2026-12-23',
    tz: 'Pacific/Auckland',
    localCurrencies: ['NZD'],
    style: 'campervan',
    owner: { name: 'Gene', color: 'teal' },
  })
  expect(trip.status).toBe(201)
  const owner = trip.body.memberToken
  const tripId = trip.body.trip.id
  const base = `/api/trips/${tripId}`
  const invite = await call<CreateInviteResponse>('POST', `${base}/invites`, owner)
  const editor = await call<MemberTokenResponse>(
    'POST',
    `/api/join/${invite.body.inviteToken}`,
    undefined,
    { name: 'Amy', color: 'rose' },
  )
  const viewerBody: MemberCreate = { name: 'Kid', color: 'sky', email: null, role: 'viewer' }
  const added = await call<{ member: { id: string } }>('POST', `${base}/members`, owner, viewerBody)
  const invite2 = await call<CreateInviteResponse>('POST', `${base}/invites`, owner)
  const viewer = await call<MemberTokenResponse>(
    'POST',
    `/api/join/${invite2.body.inviteToken}`,
    undefined,
    { memberId: added.body.member.id },
  )
  return {
    tripId,
    base,
    owner,
    ownerId: trip.body.trip.ownerMemberId,
    editor: editor.body.memberToken,
    editorId: editor.body.member.id,
    viewer: viewer.body.memberToken,
    viewerId: added.body.member.id,
  }
}

describe('checklists', () => {
  it('applies a style template idempotently: general + campervan, due dates from the start', async () => {
    const s = await setup()
    const first = await call<ApplyTemplateResponse>(
      'POST',
      `${s.base}/checklists/apply-template`,
      s.editor,
      { style: 'campervan' },
    )
    expect(first.status).toBe(201)
    expect(first.headers.get('cache-control')).toBe('no-store')
    const expectedLists = checklistTemplateLists('campervan')
    const expectedItems = expectedLists.reduce((n, l) => n + l.items.length, 0)
    expect(first.body.added).toEqual({ lists: expectedLists.length, items: expectedItems })
    expect(first.body.checklists.map((l) => l.templateKey)).toEqual(expectedLists.map((l) => l.key))
    const items = first.body.checklists.flatMap((l) => l.items)
    const selfContained = items.find((i) => i.templateKey === 'campervan.pretrip.self-contained')
    expect(selfContained?.text).toContain('self-contained')
    // 30 days before 2026-12-20
    expect(selfContained?.dueAt).toBe('2026-11-20')
    expect(selfContained?.linkHint).toEqual({
      label: '當地政府與保育部官網',
      url: 'https://www.doc.govt.nz',
    })
    expect(items.find((i) => i.templateKey === 'campervan.pretrip.dump')?.dueAt).toBeNull()

    // Again, in English: nothing new, nothing duplicated
    const again = await call<ApplyTemplateResponse>(
      'POST',
      `${s.base}/checklists/apply-template`,
      s.owner,
      { style: 'campervan', locale: 'en' },
    )
    expect(again.status).toBe(200)
    expect(again.body.added).toEqual({ lists: 0, items: 0 })
    expect(again.body.rev).toBe(first.body.rev)
    expect(again.body.checklists.flatMap((l) => l.items)).toHaveLength(expectedItems)

    // Another style adds only its own lists; general is not copied twice
    const winter = await call<ApplyTemplateResponse>(
      'POST',
      `${s.base}/checklists/apply-template`,
      s.owner,
      { style: 'winter', locale: 'en' },
    )
    const winterTemplate = CHECKLIST_TEMPLATES.winter.lists
    expect(winter.body.added.lists).toBe(winterTemplate.length)
    expect(winter.body.checklists.at(-1)?.title).toBe(winterTemplate.at(-1)?.title.en)

    // A deleted item comes back on the next apply
    const list = again.body.checklists[0]
    const victim = list.items[0]
    await call('DELETE', `${s.base}/checklists/${list.id}/items/${victim.id}`, s.editor)
    const restored = await call<ApplyTemplateResponse>(
      'POST',
      `${s.base}/checklists/apply-template`,
      s.editor,
      { style: 'campervan' },
    )
    expect(restored.body.added).toEqual({ lists: 0, items: 1 })
  })

  it('creates lists and items, ticks, assigns, sets a due date, reorders and deletes', async () => {
    const s = await setup()
    const created = await call<ChecklistResponse>('POST', `${s.base}/checklists`, s.editor, {
      kind: 'packing',
      title: '公用',
    })
    expect(created.status).toBe(201)
    const list = created.body.checklist
    const a = await call<ChecklistItemResponse>(
      'POST',
      `${s.base}/checklists/${list.id}/items`,
      s.editor,
      { text: '轉接頭' },
    )
    const b = await call<ChecklistItemResponse>(
      'POST',
      `${s.base}/checklists/${list.id}/items`,
      s.editor,
      { text: '鍋具' },
    )
    expect(a.body.item).toMatchObject({ order: 1, done: false, assigneeMemberId: null })
    expect(b.body.item.order).toBe(2)

    const ticked = await call<ChecklistItemResponse>(
      'PATCH',
      `${s.base}/checklists/${list.id}/items/${a.body.item.id}`,
      s.editor,
      { done: true, assigneeMemberId: s.viewerId, dueAt: '2026-12-01', order: 3 },
    )
    expect(ticked.status).toBe(200)
    expect(ticked.body.item).toMatchObject({
      done: true,
      assigneeMemberId: s.viewerId,
      dueAt: '2026-12-01',
      order: 3,
    })
    // Not a member of this trip
    const bad = await call(
      'PATCH',
      `${s.base}/checklists/${list.id}/items/${a.body.item.id}`,
      s.editor,
      { assigneeMemberId: 'nobody' },
    )
    expect(bad.status).toBe(422)

    const all = await call<ChecklistsResponse>('GET', `${s.base}/checklists`, s.viewer)
    expect(all.body.checklists[0].items.map((i) => i.text)).toEqual(['鍋具', '轉接頭'])

    expect((await call('DELETE', `${s.base}/checklists/${list.id}`, s.editor)).status).toBe(200)
    const none = await call<ChecklistsResponse>('GET', `${s.base}/checklists`, s.viewer)
    expect(none.body.checklists).toEqual([])
    const orphans = sqlite.prepare('SELECT COUNT(*) AS n FROM checklistItems').all()
    expect(orphans[0].n).toBe(0)
  })

  it('lets viewers read only, and keeps lists inside their trip', async () => {
    const s = await setup()
    const other = await setup()
    expect((await call('GET', `${s.base}/checklists`, s.viewer)).status).toBe(200)
    expect(
      (await call('POST', `${s.base}/checklists`, s.viewer, { kind: 'pretrip', title: 'x' }))
        .status,
    ).toBe(403)
    expect(
      (await call('POST', `${s.base}/checklists/apply-template`, s.viewer, { style: 'general' }))
        .status,
    ).toBe(403)
    expect((await call('GET', `${s.base}/checklists`)).status).toBe(401)
    const list = await call<ChecklistResponse>('POST', `${s.base}/checklists`, s.owner, {
      kind: 'pretrip',
      title: 'mine',
    })
    // Another trip's token cannot reach it, nor can its own trip path with this list id
    expect(
      (await call('PATCH', `${other.base}/checklists/${list.body.checklist.id}`, other.owner, {
        title: 'x',
      })).status,
    ).toBe(404)
    expect((await call('GET', `${s.base}/checklists`, other.owner)).status).toBe(404)
  })
})

describe('budget', () => {
  it('replaces the table, computes group and per-person totals', async () => {
    const s = await setup()
    const empty = await call<BudgetResponse>('GET', `${s.base}/budget`, s.viewer)
    expect(empty.body).toMatchObject({ currency: 'AUD', memberCount: 3, rows: [] })
    const put = await call<BudgetResponse>('PUT', `${s.base}/budget`, s.editor, {
      rows: [
        { category: 'food', plannedMinor: 30000, perPerson: true },
        { category: 'lodging', plannedMinor: 200000 },
      ],
    })
    expect(put.status).toBe(200)
    // lodging first (category order), food per person
    expect(put.body.rows.map((r) => r.category)).toEqual(['lodging', 'food'])
    expect(put.body.totals).toEqual({
      plannedMinor: 200000 + 30000 * 3,
      perPersonMinor: Math.round(200000 / 3) + 30000,
    })
    // A second PUT replaces, not merges
    const again = await call<BudgetResponse>('PUT', `${s.base}/budget`, s.editor, {
      rows: [{ category: 'fuel', plannedMinor: 500 }],
    })
    expect(again.body.rows.map((r) => r.category)).toEqual(['fuel'])
    const dup = await call('PUT', `${s.base}/budget`, s.editor, {
      rows: [
        { category: 'fuel', plannedMinor: 1 },
        { category: 'fuel', plannedMinor: 2 },
      ],
    })
    expect(dup.status).toBe(422)
    expect((await call('PUT', `${s.base}/budget`, s.viewer, { rows: [] })).status).toBe(403)
  })

  it('compares planned with actual, per person, and burns down by day', async () => {
    const s = await setup()
    await call('PUT', `${s.base}/budget`, s.owner, {
      rows: [
        { category: 'lodging', plannedMinor: 200000 },
        { category: 'food', plannedMinor: 10000, perPerson: true },
        { category: 'flights', plannedMinor: 300000 },
      ],
    })
    const participants = [{ memberId: s.ownerId }, { memberId: s.editorId }, { memberId: s.viewerId }]
    const expense = (body: Record<string, unknown>) =>
      call('POST', `${s.base}/expenses`, s.owner, {
        currency: 'AUD',
        payerMemberId: s.ownerId,
        splitMethod: 'equal',
        participants,
        ...body,
      })
    expect((await expense({ amountMinor: 50000, category: 'lodging', date: '2026-12-20' })).status).toBe(201)
    await expense({ amountMinor: 3000, category: 'food', date: '2026-12-20' })
    await expense({ amountMinor: 6000, category: 'food', date: '2026-12-22' })
    // Before the trip: counts from day 1
    await expense({ amountMinor: 1000, category: 'shopping', date: '2026-12-01' })
    const deleted = await expense({ amountMinor: 99999, category: 'food', date: '2026-12-21' })
    await call('DELETE', `${s.base}/expenses/${(deleted.body as { expense: { id: string } }).expense.id}`, s.owner)

    const { status, body } = await call<BudgetProgressResponse>(
      'GET',
      `${s.base}/budget/progress`,
      s.viewer,
    )
    expect(status).toBe(200)
    expect(body.hasBudget).toBe(true)
    const by = Object.fromEntries(body.categories.map((c) => [c.category, c]))
    expect(by.lodging).toMatchObject({ plannedMinor: 200000, actualMinor: 50000, remainingMinor: 150000 })
    expect(by.food).toMatchObject({ plannedMinor: 30000, actualMinor: 9000, remainingMinor: 21000 })
    expect(by.flights).toMatchObject({ plannedMinor: 300000, actualMinor: null, remainingMinor: null })
    // Not budgeted but spent
    expect(by.shopping).toMatchObject({ plannedMinor: 0, actualMinor: 1000, remainingMinor: -1000 })
    expect(body.totals).toEqual({
      plannedMinor: 530000,
      trackedPlannedMinor: 230000,
      actualMinor: 60000,
      remainingMinor: 170000,
      plannedPerPersonMinor: Math.round(200000 / 3) + 10000 + 100000,
      actualPerPersonMinor: 20000,
    })
    expect(body.members.reduce((sum, m) => sum + m.shareMinor, 0)).toBe(60000)
    expect(body.burn.map((p) => p.date)).toEqual([
      '2026-12-20',
      '2026-12-21',
      '2026-12-22',
      '2026-12-23',
    ])
    expect(body.burn.map((p) => p.spentMinor)).toEqual([53000, 0, 6000, 0])
    expect(body.burn.map((p) => p.cumulativeMinor)).toEqual([54000, 54000, 60000, 60000])
    expect(body.burn.map((p) => p.remainingMinor)).toEqual([176000, 176000, 170000, 170000])
    expect(body.burn.map((p) => p.idealRemainingMinor)).toEqual([172500, 115000, 57500, 0])
  })

  it('computeProgress: no budget, spending after the trip lands on the last day', () => {
    const progress = computeProgress({
      rows: [],
      members: 2,
      actualByCategory: new Map([['food', 700]]),
      actualByDate: new Map([
        ['2026-01-01', 200],
        ['2026-01-05', 500],
      ]),
      startDate: '2026-01-01',
      endDate: '2026-01-02',
    })
    expect(progress.hasBudget).toBe(false)
    expect(progress.burn.map((p) => p.cumulativeMinor)).toEqual([200, 700])
    expect(progress.totals.actualPerPersonMinor).toBe(350)
    expect(progress.categories).toEqual([
      { category: 'food', plannedMinor: 0, actualMinor: 700, remainingMinor: -700 },
    ])
  })
})

describe('notes', () => {
  it('applies the New Zealand template once, edits and marks a note shareable', async () => {
    const s = await setup()
    const first = await call<ApplyNotesResponse>('POST', `${s.base}/notes/apply-template`, s.editor, {
      destination: 'nz',
    })
    expect(first.status).toBe(201)
    expect(first.body.notes.map((n) => n.section)).toEqual(
      expect.arrayContaining(['emergency', 'power', 'driving', 'customs', 'campervan']),
    )
    expect(first.body.notes.every((n) => !n.shareable)).toBe(true)
    const again = await call<ApplyNotesResponse>('POST', `${s.base}/notes/apply-template`, s.owner, {
      destination: 'nz',
      locale: 'en',
    })
    expect(again.status).toBe(200)
    expect(again.body.added).toBe(0)
    expect(again.body.notes).toHaveLength(first.body.notes.length)

    const driving = first.body.notes.find((n) => n.section === 'driving')!
    const edited = await call<NoteResponse>('PATCH', `${s.base}/notes/${driving.id}`, s.editor, {
      body: '- 單線橋：看紅色小箭頭那方讓行',
      shareable: true,
    })
    expect(edited.body.note).toMatchObject({ shareable: true, body: '- 單線橋：看紅色小箭頭那方讓行' })

    const custom = await call<NoteResponse>('POST', `${s.base}/notes`, s.editor, { title: '我們的暗號' })
    expect(custom.status).toBe(201)
    expect(custom.body.note).toMatchObject({ section: 'custom', body: '', templateKey: null })
    expect(custom.body.note.order).toBeGreaterThan(driving.order)
    expect((await call('DELETE', `${s.base}/notes/${custom.body.note.id}`, s.editor)).status).toBe(200)
    expect((await call('POST', `${s.base}/notes`, s.viewer, { title: 'x' })).status).toBe(403)
    expect(
      (await call('PATCH', `${s.base}/notes/${driving.id}`, s.viewer, { title: 'x' })).status,
    ).toBe(403)
  })
})

describe('documents', () => {
  /** A ready attachment row, as /complete would leave it */
  function attachment(tripId: string, uploader: string, id: string, fields: Record<string, string | null> = {}) {
    const row: Record<string, string | number | null> = {
      id,
      tripId,
      kind: 'document',
      r2Key: `test/trips/${tripId}/document/${id}.pdf`,
      mime: 'application/pdf',
      bytes: 10,
      uploaderMemberId: uploader,
      visibility: 'members-only',
      status: 'ready',
      createdAt: `2026-11-0${id.length % 9}T00:00:00Z`,
      updatedAt: '2026-11-01T00:00:00Z',
      ...fields,
    }
    const keys = Object.keys(row)
    const values = keys.map((k) => (row[k] === null ? 'NULL' : `'${String(row[k])}'`))
    sqlite.exec(`INSERT INTO attachments (${keys.join(', ')}) VALUES (${values.join(', ')})`)
  }

  it('lists only ready documents of the trip, categorises them, and keeps them off share pages', async () => {
    const s = await setup()
    const other = await setup()
    attachment(s.tripId, s.ownerId, 'doc1')
    attachment(s.tripId, s.ownerId, 'doc22', { docCategory: 'passport' })
    attachment(s.tripId, s.ownerId, 'photo1', {
      kind: 'photo',
      mime: 'image/webp',
      visibility: 'trip',
    })
    attachment(s.tripId, s.ownerId, 'receipt1', { kind: 'receipt' })
    attachment(s.tripId, s.ownerId, 'pending1', { status: 'pending' })
    attachment(s.tripId, s.ownerId, 'gone1', { deletedAt: '2026-11-02T00:00:00Z' })
    attachment(other.tripId, other.ownerId, 'theirs1')

    const list = await call<DocumentsResponse>('GET', `${s.base}/documents`, s.viewer)
    expect(list.status).toBe(200)
    expect(list.headers.get('cache-control')).toBe('no-store')
    expect(list.body.documents.map((d) => d.id).sort()).toEqual(['doc1', 'doc22'])
    expect(list.body.documents.find((d) => d.id === 'doc22')?.docCategory).toBe('passport')

    const patched = await call<DocumentResponse>('PATCH', `${s.base}/documents/doc1`, s.editor, {
      docCategory: 'insurance',
    })
    expect(patched.status).toBe(200)
    expect(patched.body.document).toMatchObject({ id: 'doc1', docCategory: 'insurance' })
    expect(
      (await call('PATCH', `${s.base}/documents/doc1`, s.editor, { docCategory: 'diary' })).status,
    ).toBe(422)
    expect(
      (await call('PATCH', `${s.base}/documents/doc1`, s.viewer, { docCategory: 'visa' })).status,
    ).toBe(403)
    // A photo, or another trip's document, is not a document of this trip
    expect(
      (await call('PATCH', `${s.base}/documents/photo1`, s.editor, { docCategory: 'visa' })).status,
    ).toBe(404)
    expect(
      (await call('PATCH', `${s.base}/documents/theirs1`, s.editor, { docCategory: 'visa' })).status,
    ).toBe(404)

    // AC-9.3: the share payload never mentions a document, and a share token cannot read one
    const day = sqlite
      .prepare(`SELECT id FROM days WHERE tripId = '${s.tripId}' AND idx = 1`)
      .all()[0].id as string
    sqlite.exec(`UPDATE attachments SET dayId = '${day}' WHERE tripId = '${s.tripId}'`)
    const share = await call<{ shareToken: string }>('POST', `${s.base}/shares`, s.owner, {})
    expect(share.status).toBe(201)
    const payload = await call<SharePayload>('GET', `/api/share/${share.body.shareToken}`)
    expect(payload.status).toBe(200)
    const text = JSON.stringify(payload.body)
    expect(text).toContain('photo1')
    for (const id of ['doc1', 'doc22', 'receipt1']) expect(text).not.toContain(id)
    const media = await call('GET', `/api/media/doc1?s=${share.body.shareToken}`)
    expect(media.status).toBe(403)
  })
})

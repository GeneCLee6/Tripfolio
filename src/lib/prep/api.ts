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
  NotesResponse,
} from '../../../shared/api/prep.ts'
import type { Rev } from '../../../shared/api/types.ts'
import type {
  ApplyChecklistTemplate,
  ApplyNotesTemplate,
  BudgetPut,
  ChecklistCreate,
  ChecklistItemCreate,
  ChecklistItemPatch,
  ChecklistPatch,
  DocumentPatch,
  NoteCreate,
  NotePatch,
} from '../../../shared/schema/prep.ts'
import { ApiError, request } from '../api.ts'
import { getToken } from '../tokens.ts'

// Typed calls for the pre-trip prep API (worker/trips/{checklists,budget,notes,documents}.ts, E9).
// Only types come from shared/schema, so zod stays out of the bundle. Uploading a document is
// src/lib/upload/upload.ts (kind 'document'); deleting one is mediaApi.remove.

function tokenFor(tripId: string): string {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  return token
}

const base = (tripId: string) => `/api/trips/${encodeURIComponent(tripId)}`
const enc = encodeURIComponent

type Ok = Rev & { ok: true }

export const checklistsApi = {
  list(tripId: string, signal?: AbortSignal): Promise<ChecklistsResponse> {
    return request('GET', `${base(tripId)}/checklists`, { token: tokenFor(tripId), signal })
  },
  create(tripId: string, body: ChecklistCreate): Promise<ChecklistResponse> {
    return request('POST', `${base(tripId)}/checklists`, { token: tokenFor(tripId), body })
  },
  patch(tripId: string, listId: string, body: ChecklistPatch): Promise<ChecklistResponse> {
    return request('PATCH', `${base(tripId)}/checklists/${enc(listId)}`, {
      token: tokenFor(tripId),
      body,
    })
  },
  remove(tripId: string, listId: string): Promise<Ok> {
    return request('DELETE', `${base(tripId)}/checklists/${enc(listId)}`, {
      token: tokenFor(tripId),
    })
  },
  applyTemplate(tripId: string, body: ApplyChecklistTemplate): Promise<ApplyTemplateResponse> {
    return request('POST', `${base(tripId)}/checklists/apply-template`, {
      token: tokenFor(tripId),
      body,
    })
  },
  createItem(tripId: string, listId: string, body: ChecklistItemCreate): Promise<ChecklistItemResponse> {
    return request('POST', `${base(tripId)}/checklists/${enc(listId)}/items`, {
      token: tokenFor(tripId),
      body,
    })
  },
  patchItem(
    tripId: string,
    listId: string,
    itemId: string,
    body: ChecklistItemPatch,
  ): Promise<ChecklistItemResponse> {
    return request('PATCH', `${base(tripId)}/checklists/${enc(listId)}/items/${enc(itemId)}`, {
      token: tokenFor(tripId),
      body,
    })
  },
  removeItem(tripId: string, listId: string, itemId: string): Promise<Ok> {
    return request('DELETE', `${base(tripId)}/checklists/${enc(listId)}/items/${enc(itemId)}`, {
      token: tokenFor(tripId),
    })
  },
}

export const budgetApi = {
  get(tripId: string, signal?: AbortSignal): Promise<BudgetResponse> {
    return request('GET', `${base(tripId)}/budget`, { token: tokenFor(tripId), signal })
  },
  put(tripId: string, body: BudgetPut): Promise<BudgetResponse> {
    return request('PUT', `${base(tripId)}/budget`, { token: tokenFor(tripId), body })
  },
  progress(tripId: string, signal?: AbortSignal): Promise<BudgetProgressResponse> {
    return request('GET', `${base(tripId)}/budget/progress`, { token: tokenFor(tripId), signal })
  },
}

export const notesApi = {
  list(tripId: string, signal?: AbortSignal): Promise<NotesResponse> {
    return request('GET', `${base(tripId)}/notes`, { token: tokenFor(tripId), signal })
  },
  create(tripId: string, body: NoteCreate): Promise<NoteResponse> {
    return request('POST', `${base(tripId)}/notes`, { token: tokenFor(tripId), body })
  },
  patch(tripId: string, noteId: string, body: NotePatch): Promise<NoteResponse> {
    return request('PATCH', `${base(tripId)}/notes/${enc(noteId)}`, {
      token: tokenFor(tripId),
      body,
    })
  },
  remove(tripId: string, noteId: string): Promise<Ok> {
    return request('DELETE', `${base(tripId)}/notes/${enc(noteId)}`, { token: tokenFor(tripId) })
  },
  applyTemplate(tripId: string, body: ApplyNotesTemplate): Promise<ApplyNotesResponse> {
    return request('POST', `${base(tripId)}/notes/apply-template`, {
      token: tokenFor(tripId),
      body,
    })
  },
}

export const documentsApi = {
  list(tripId: string, signal?: AbortSignal): Promise<DocumentsResponse> {
    return request('GET', `${base(tripId)}/documents`, { token: tokenFor(tripId), signal })
  },
  patch(tripId: string, attachmentId: string, body: DocumentPatch): Promise<DocumentResponse> {
    return request('PATCH', `${base(tripId)}/documents/${enc(attachmentId)}`, {
      token: tokenFor(tripId),
      body,
    })
  },
}

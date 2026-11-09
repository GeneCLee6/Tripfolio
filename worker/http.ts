import type { z } from 'zod'
import type { ApiErrorBody } from '../shared/api/types.ts'

export const noStore = { 'cache-control': 'no-store' }

/** Thrown by handlers; the router turns it into `{ error: { code, message } }` */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const unauthorized = (message = 'missing or invalid member token') =>
  new ApiError(401, 'unauthorized', message)
export const forbidden = (message = 'not allowed for this role') =>
  new ApiError(403, 'forbidden', message)
export const notFound = (message = 'not found') => new ApiError(404, 'not_found', message)
export const invalid = (message: string, details?: unknown) =>
  new ApiError(422, 'invalid', message, details)

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: noStore })
}

export function errorResponse(error: ApiError): Response {
  const body: ApiErrorBody = { error: { code: error.code, message: error.message } }
  if (error.details !== undefined) body.error.details = error.details
  return json(body, error.status)
}

/** Parses and validates a JSON body; 422 on malformed JSON or schema errors */
export async function readBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown
  try {
    const text = await request.text()
    raw = text === '' ? {} : JSON.parse(text)
  } catch {
    throw new ApiError(422, 'invalid_json', 'request body is not valid JSON')
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    const first = result.error.issues[0]
    const where = first?.path.length ? `${first.path.join('.')}: ` : ''
    throw invalid(`${where}${first?.message ?? 'invalid body'}`, result.error.issues)
  }
  return result.data
}

export const nowIso = () => new Date().toISOString()

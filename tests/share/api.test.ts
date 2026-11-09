import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadShare, tokenFromPath } from '../../share/api.ts'

describe('share page loading', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the token from /s/<token>', () => {
    expect(tokenFromPath('/s/AbC_12-x')).toBe('AbC_12-x')
    expect(tokenFromPath('/s/AbC_12-x/')).toBe('AbC_12-x')
    expect(tokenFromPath('/s/')).toBeNull()
    expect(tokenFromPath('/s/a/b')).toBeNull()
    expect(tokenFromPath('/trip/1')).toBeNull()
  })

  it('maps 404 to notFound, other failures to error, and skips the request without a token', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await loadShare(null)).toEqual({ kind: 'notFound' })
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    expect(await loadShare('tok')).toEqual({ kind: 'notFound' })
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    expect(await loadShare('tok')).toEqual({ kind: 'error' })
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    expect(await loadShare('tok')).toEqual({ kind: 'error' })
    fetchMock.mockResolvedValueOnce(Response.json({ trip: { name: 'NZ' }, days: [] }))
    expect(await loadShare('tok')).toMatchObject({ kind: 'ok', payload: { trip: { name: 'NZ' } } })
    expect(fetchMock).toHaveBeenLastCalledWith('/api/share/tok', expect.anything())
  })
})

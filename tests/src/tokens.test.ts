import { afterEach, describe, expect, it } from 'vitest'
import {
  clearTokens,
  getToken,
  getTokens,
  parseTokenMap,
  prunedTokens,
  removeToken,
  setToken,
  tokensForList,
} from '../../src/lib/tokens.ts'

afterEach(() => clearTokens())

describe('token store', () => {
  it('keeps one token per trip (in memory when there is no localStorage)', () => {
    setToken('t1', 'aaa')
    setToken('t2', 'bbb')
    setToken('t1', 'ccc')
    expect(getTokens()).toEqual({ t1: 'ccc', t2: 'bbb' })
    expect(getToken('t2')).toBe('bbb')
    removeToken('t2')
    expect(getToken('t2')).toBeNull()
  })

  it('ignores stored junk', () => {
    expect(parseTokenMap(null)).toEqual({})
    expect(parseTokenMap('not json')).toEqual({})
    expect(parseTokenMap('[1,2]')).toEqual({})
    expect(parseTokenMap('{"a":"x","b":3,"c":""}')).toEqual({ a: 'x' })
  })

  it('sends the newest tokens first, at most 50', () => {
    const tokens = Object.fromEntries(Array.from({ length: 60 }, (_, i) => ['t' + i, 'k' + i]))
    const sent = tokensForList(tokens)
    expect(sent).toHaveLength(50)
    expect(sent[0]).toEqual({ tripId: 't59', token: 'k59' })
  })

  it('drops the tokens the list did not answer for', () => {
    const tokens = { a: 'ka', b: 'kb', c: 'kc' }
    const sent = tokensForList(tokens) // c, b, a
    const response = { trips: [{ tokenIndex: 0 }, { tokenIndex: 2 }] } as never
    expect(prunedTokens(tokens, sent, response)).toEqual({ a: 'ka', c: 'kc' })
    // A token replaced since the call was sent is kept
    expect(prunedTokens({ ...tokens, b: 'new' }, sent, response)).toEqual({
      a: 'ka',
      b: 'new',
      c: 'kc',
    })
  })
})

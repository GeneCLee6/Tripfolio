import { describe, expect, it } from 'vitest'
import { compare, paragraphs } from '../../../src/lib/recap/compare.ts'

describe('recap compare (e8-t04)', () => {
  it('scales both bars to the larger amount and signs the difference', () => {
    expect(compare(10000, 12500)).toEqual({
      estimateRatio: 0.8,
      actualRatio: 1,
      diffMinor: 2500,
      tone: 'over',
    })
    expect(compare(4000, 1000)).toMatchObject({
      actualRatio: 0.25,
      diffMinor: -3000,
      tone: 'under',
    })
    expect(compare(500, 500).tone).toBe('even')
    expect(compare(0, 0)).toEqual({ estimateRatio: 0, actualRatio: 0, diffMinor: 0, tone: 'none' })
  })

  it('splits recap text into paragraphs and lines', () => {
    expect(paragraphs('Lake walk.\nPies after.\r\n\r\n\n  \nStars.  ')).toEqual([
      ['Lake walk.', 'Pies after.'],
      ['Stars.'],
    ])
    expect(paragraphs('   ')).toEqual([])
  })
})

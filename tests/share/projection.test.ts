import { describe, expect, it } from 'vitest'
import { fitProjection, unwrapLongitudes } from '../../share/projection.ts'

// The static route sketch's projection (e8-t01b)

const box = { width: 600, height: 360, padding: 30 }
const CHRISTCHURCH = { lat: -43.5321, lng: 172.6362 }
const TEKAPO = { lat: -44.0046, lng: 170.4771 }
const QUEENSTOWN = { lat: -45.0312, lng: 168.6626 }

describe('fitProjection', () => {
  it('keeps every point inside the padded box and touches at least one pair of edges', () => {
    const points = [CHRISTCHURCH, TEKAPO, QUEENSTOWN]
    const project = fitProjection(points, box)
    const xy = points.map(project)
    for (const { x, y } of xy) {
      expect(x).toBeGreaterThanOrEqual(box.padding - 1e-9)
      expect(x).toBeLessThanOrEqual(box.width - box.padding + 1e-9)
      expect(y).toBeGreaterThanOrEqual(box.padding - 1e-9)
      expect(y).toBeLessThanOrEqual(box.height - box.padding + 1e-9)
    }
    const xs = xy.map((p) => p.x)
    const ys = xy.map((p) => p.y)
    const fillsWidth = Math.max(...xs) - Math.min(...xs) === box.width - 2 * box.padding
    const fillsHeight =
      Math.abs(Math.max(...ys) - Math.min(...ys) - (box.height - 2 * box.padding)) < 1e-9
    expect(fillsWidth || fillsHeight).toBe(true)
  })

  it('puts north up and east right', () => {
    const project = fitProjection([CHRISTCHURCH, QUEENSTOWN], box)
    const chc = project(CHRISTCHURCH)
    const zqn = project(QUEENSTOWN)
    expect(chc.x).toBeGreaterThan(zqn.x) // Christchurch is east
    expect(chc.y).toBeLessThan(zqn.y) // and north
  })

  it('scales longitude by the cosine of the mean latitude (no stretching)', () => {
    // One degree east and one degree north at 60°S: the east step is half as long on screen
    const a = { lat: -60, lng: 10 }
    const b = { lat: -60, lng: 11 }
    const c = { lat: -59, lng: 10 }
    const project = fitProjection([a, b, c], box)
    const dx = project(b).x - project(a).x
    const dy = project(a).y - project(c).y
    expect(dx / dy).toBeCloseTo(Math.cos((((-60 - 60 - 59) / 3) * Math.PI) / 180), 6)
  })

  it('centres one point, or several at one place', () => {
    expect(fitProjection([TEKAPO], box)(TEKAPO)).toEqual({ x: 300, y: 180 })
    expect(fitProjection([TEKAPO, TEKAPO], box)(TEKAPO)).toEqual({ x: 300, y: 180 })
    expect(fitProjection([], box)(TEKAPO)).toEqual({ x: 300, y: 180 })
  })

  it('centres a north-south line horizontally', () => {
    const project = fitProjection([{ lat: 0, lng: 5 }, { lat: 10, lng: 5 }], box)
    expect(project({ lat: 0, lng: 5 }).x).toBeCloseTo(300)
    expect(project({ lat: 10, lng: 5 }).y).toBeCloseTo(box.padding)
  })

  it('keeps a trip across the antimeridian together', () => {
    const fiji = { lat: -17.7, lng: 178.0 }
    const taveuni = { lat: -16.8, lng: -179.9 }
    const project = fitProjection([fiji, taveuni], box)
    // 2.1 degrees apart, not 358: Taveuni lies just east of Fiji's main island
    expect(project(taveuni).x).toBeGreaterThan(project(fiji).x)
    expect(project(taveuni).x - project(fiji).x).toBeLessThanOrEqual(box.width - 2 * box.padding)
  })
})

describe('unwrapLongitudes', () => {
  it('leaves ordinary spans alone and shifts across the antimeridian', () => {
    expect(unwrapLongitudes([168, 172])).toEqual([168, 172])
    expect(unwrapLongitudes([178, -179])).toEqual([178, 181])
    expect(unwrapLongitudes([])).toEqual([])
  })
})

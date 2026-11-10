import { describe, expect, it } from 'vitest'
import type { ShareLeg, ShareStop } from '../../shared/api/share.ts'
import { buildDaySketch, GRID_STEP } from '../../share/daySketch.ts'
import { fitProjection } from '../../share/projection.ts'

// The printed day map's geometry (e8-t02): share/projection.ts reused for one day's stops

const box = { width: 640, height: 300, padding: 28 }
const CHRISTCHURCH = { lat: -43.5321, lng: 172.6362 }
const TEKAPO = { lat: -44.0046, lng: 170.4771 }
const COOK = { lat: -43.7342, lng: 170.0966 }

const stop = (order: number, at?: { lat: number; lng: number }, extra: Partial<ShareStop> = {}) =>
  ({
    order,
    type: 'sight',
    name: `Stop ${order}`,
    note: '',
    booking: 'none',
    isBackup: false,
    ...(at ?? {}),
    ...extra,
  }) as ShareStop

const leg = (fromOrder: number, toOrder: number, extra: Partial<ShareLeg> = {}): ShareLeg => ({
  fromOrder,
  toOrder,
  mode: 'drive',
  distanceM: 1000,
  durationS: 600,
  source: 'route',
  ...extra,
})

describe('buildDaySketch', () => {
  it('places numbered pins with the route sketch projection and joins legs with lines', () => {
    const stops = [stop(1, CHRISTCHURCH), stop(2, TEKAPO), stop(3, COOK)]
    const sketch = buildDaySketch(
      { stops, legs: [leg(1, 2), leg(2, 3, { source: 'estimate' })] },
      box,
    )!
    const project = fitProjection([CHRISTCHURCH, TEKAPO, COOK], box)
    expect(sketch.pins.map((p) => p.n)).toEqual([1, 2, 3])
    expect(sketch.pins[1]).toMatchObject({ ...project(TEKAPO), n: 2, name: 'Stop 2' })
    for (const pin of sketch.pins) {
      expect(pin.x).toBeGreaterThanOrEqual(box.padding - 1e-9)
      expect(pin.x).toBeLessThanOrEqual(box.width - box.padding + 1e-9)
      expect(pin.y).toBeGreaterThanOrEqual(box.padding - 1e-9)
      expect(pin.y).toBeLessThanOrEqual(box.height - box.padding + 1e-9)
    }
    expect(sketch.lines).toHaveLength(2)
    expect(sketch.lines[0]).toMatchObject({
      x1: sketch.pins[0]!.x,
      y1: sketch.pins[0]!.y,
      x2: sketch.pins[1]!.x,
      y2: sketch.pins[1]!.y,
      estimate: false,
    })
    expect(sketch.lines[1]!.estimate).toBe(true)
  })

  it('numbers like the stops table: backups skipped, stops without a place keep their number', () => {
    const stops = [
      stop(1, CHRISTCHURCH),
      stop(1.5, undefined, { name: 'No place' }),
      stop(2, TEKAPO, { isBackup: true }),
      stop(3, COOK),
    ]
    const sketch = buildDaySketch({ stops, legs: [leg(1, 1.5), leg(1.5, 3)] }, box)!
    expect(sketch.pins.map((p) => [p.n, p.name])).toEqual([
      [1, 'Stop 1'],
      [3, 'Stop 3'],
    ])
    // A leg to a stop without a place has nowhere to go
    expect(sketch.lines).toEqual([])
  })

  it('fits tonight’s lodging into the box and draws it', () => {
    const sketch = buildDaySketch({ stops: [stop(1, CHRISTCHURCH)], legs: [] }, box, TEKAPO)!
    const project = fitProjection([CHRISTCHURCH, TEKAPO], box)
    expect(sketch.lodging).toEqual(project(TEKAPO))
    expect(sketch.pins[0]).toMatchObject(project(CHRISTCHURCH))
  })

  it('centres a single place, skips zero-length legs, and returns null without places', () => {
    const one = buildDaySketch(
      { stops: [stop(1, TEKAPO), stop(2, TEKAPO)], legs: [leg(1, 2)] },
      box,
    )!
    expect(one.pins.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 320, y: 150 },
      { x: 320, y: 150 },
    ])
    expect(one.lines).toEqual([])
    expect(buildDaySketch({ stops: [stop(1)], legs: [] }, box)).toBeNull()
    expect(buildDaySketch({ stops: [], legs: [] }, box)).toBeNull()
  })

  it('draws a light grid every GRID_STEP units inside the box', () => {
    const sketch = buildDaySketch({ stops: [stop(1, COOK)], legs: [] }, box)!
    expect(sketch.gridX[0]).toBe(GRID_STEP)
    expect(sketch.gridX.at(-1)).toBeLessThan(box.width)
    expect(sketch.gridY).toHaveLength(Math.floor((box.height - 1) / GRID_STEP))
  })
})

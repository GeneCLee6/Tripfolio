import { describe, expect, it, vi } from 'vitest'
import { cameraDuration, moveCamera, type CameraMap } from '../../../src/map/camera.ts'

// AC-10.5: with prefers-reduced-motion the map jumps instead of flying

function fakeMap() {
  const map = {
    fitBounds: vi.fn(),
    easeTo: vi.fn(),
    getContainer: () => ({ getBoundingClientRect: () => ({ width: 400, height: 300 }) }),
  }
  return map as typeof map & CameraMap
}

describe('camera moves', () => {
  it('take no time when less motion is asked for', () => {
    expect(cameraDuration(true, 600)).toBe(0)
    expect(cameraDuration(false, 600)).toBe(600)
  })

  it('fit bounds and ease with duration 0 under reduced motion', () => {
    const map = fakeMap()
    const bounds: [[number, number], [number, number]] = [
      [168, -46],
      [173, -43],
    ]
    moveCamera(map, { bounds }, true)
    expect(map.fitBounds.mock.calls[0]![1]).toMatchObject({ duration: 0 })
    moveCamera(map, { center: [170, -44], zoom: 9 }, true)
    expect(map.easeTo.mock.calls[0]![0]).toMatchObject({ duration: 0 })
  })

  it('animate otherwise', () => {
    const map = fakeMap()
    moveCamera(map, { center: [170, -44], zoom: 9 }, false)
    expect(map.easeTo.mock.calls[0]![0]).toMatchObject({ duration: 600 })
    moveCamera(map, null, false)
    expect(map.fitBounds).not.toHaveBeenCalled()
  })
})

import type { MapPlace, MapRoute, MapStop, OvernightLink } from './types.ts'

// A sample trip for /dev/ui and the tests: 14 days around New Zealand's South Island, abbreviated
// (one to three stops a day). Christchurch → Punakaiki → Fox Glacier → Wānaka → Queenstown →
// Te Anau → Tekapo → Christchurch. Coordinates are approximate; names are place names (data).

type StopRow = [name: string, type: string, lat: number, lng: number, time?: string]

const days: StopRow[][] = [
  [
    ['Christchurch Airport', 'transport', -43.4894, 172.5322, '10:30'],
    ['Christchurch Botanic Gardens', 'nature', -43.531, 172.6205, '14:00'],
  ],
  [
    ['Castle Hill', 'sight', -43.2253, 171.727, '09:30'],
    ["Arthur's Pass", 'nature', -42.942, 171.562, '12:00'],
    ['Punakaiki Pancake Rocks', 'sight', -42.1145, 171.327, '16:30'],
  ],
  [
    ['Hokitika', 'food', -42.7167, 170.9667, '11:00'],
    ['Hokitika Gorge', 'nature', -42.9544, 171.0186, '14:00'],
  ],
  [
    ['Franz Josef Glacier', 'nature', -43.4673, 170.1855, '10:00'],
    ['Fox Glacier', 'sight', -43.464, 170.017, '15:00'],
  ],
  [['Lake Matheson', 'nature', -43.4423, 169.965, '07:00']],
  [
    ['Blue Pools', 'nature', -44.1587, 169.2727, '12:30'],
    ['Wānaka', 'lodging', -44.699, 169.136, '17:00'],
  ],
  [
    ['Roys Peak', 'nature', -44.6555, 169.076, '06:00'],
    ['That Wanaka Tree', 'sight', -44.697, 169.118, '16:00'],
  ],
  [
    ['Arrowtown', 'shopping', -44.94, 168.834, '10:00'],
    ['Queenstown', 'food', -45.0312, 168.6626, '13:00'],
    ['Skyline Queenstown', 'sight', -45.027, 168.653, '18:30'],
  ],
  [['Glenorchy', 'nature', -44.851, 168.387, '11:00']],
  [
    ['Mirror Lakes', 'sight', -44.997, 168.013, '15:00'],
    ['Te Anau', 'lodging', -45.414, 167.718, '18:00'],
  ],
  [['Milford Sound', 'nature', -44.6414, 167.8974, '11:30']],
  [
    ["Peters Lookout", 'sight', -44.117, 170.125, '15:30'],
    ['Lake Tekapo', 'lodging', -44.004, 170.477, '18:00'],
  ],
  [
    ['Hooker Valley Track', 'nature', -43.718, 170.094, '08:00'],
    ['Church of the Good Shepherd', 'sight', -44.005, 170.48, '21:30'],
  ],
  [
    ['Geraldine', 'food', -44.092, 171.244, '11:00'],
    ['Christchurch Airport', 'transport', -43.4894, 172.5322, '16:00'],
  ],
]

export const sampleStops: MapStop[] = days.flatMap((rows, dayIndex) =>
  rows.map(([name, type, lat, lng, time], index) => ({
    id: `d${dayIndex + 1}s${index + 1}`,
    dayIndex,
    order: index + 1,
    lat,
    lng,
    type,
    name,
    time: time ?? null,
  })),
)

/** Where each night is spent (night of day i) */
const nights: [string, number, number][] = [
  ['Christchurch', -43.532, 172.636],
  ['Punakaiki', -42.11, 171.335],
  ['Hokitika', -42.7167, 170.9667],
  ['Fox Glacier', -43.464, 170.017],
  ['Haast', -43.881, 169.042],
  ['Wānaka', -44.699, 169.136],
  ['Wānaka', -44.699, 169.136],
  ['Queenstown', -45.0312, 168.6626],
  ['Queenstown', -45.0312, 168.6626],
  ['Te Anau', -45.414, 167.718],
  ['Te Anau', -45.414, 167.718],
  ['Lake Tekapo', -44.004, 170.477],
  ['Lake Tekapo', -44.004, 170.477],
]

export const sampleLodging: MapPlace[] = nights
  .map(([name, lat, lng], dayIndex) => ({ id: `n${dayIndex + 1}`, name, lat, lng, type: 'lodging', dayIndex }))
  .filter((night, index, all) => index === 0 || night.name !== all[index - 1].name)

/** Day i's line goes from the previous night to this one (day 0 starts at the airport) */
export const sampleOvernightLinks: OvernightLink[] = nights.slice(1).map(([, lat, lng], index) => ({
  dayIndex: index + 1,
  from: { lat: nights[index][1], lng: nights[index][2] },
  to: { lat, lng },
}))

/**
 * Each day's route through its stops. Real routes come from /api/trips/:id/geo/route(s); these are
 * the stops joined with a bend so they look like roads. Days 5 and 11 are straight-line estimates.
 */
export const sampleRoutes: MapRoute[] = days.map((rows, dayIndex) => {
  const points = rows.map(([, , lat, lng]) => [lng, lat] as [number, number])
  const start = dayIndex === 0 ? points[0] : ([nights[dayIndex - 1][2], nights[dayIndex - 1][1]] as [number, number])
  const path = dayIndex === 0 ? points : [start, ...points]
  const estimate = dayIndex === 4 || dayIndex === 10
  const coordinates = estimate
    ? path
    : path.flatMap((point, index) => {
        if (index === 0) return [point]
        const [lng0, lat0] = path[index - 1]
        const bend: [number, number] = [(lng0 + point[0]) / 2 + (lat0 - point[1]) * 0.08, (lat0 + point[1]) / 2]
        return [bend, point]
      })
  return { dayIndex, source: estimate ? 'estimate' : 'ors', geometry: { type: 'LineString', coordinates } }
})

export const samplePocket: MapPlace[] = [
  { id: 'p1', name: 'Akaroa', lat: -43.803, lng: 172.968, type: 'sight' },
  { id: 'p2', name: 'Kaikōura', lat: -42.4, lng: 173.681, type: 'nature' },
  { id: 'p3', name: 'Lake Hāwea', lat: -44.611, lng: 169.255, type: 'nature' },
]

export const samplePicks: MapPlace[] = [
  { id: 'k1', name: 'Fergburger', lat: -45.034, lng: 168.659, type: 'food', dayIndex: 7 },
  { id: 'k2', name: 'Patagonia Chocolates', lat: -45.0318, lng: 168.6597, type: 'food', dayIndex: 7 },
  { id: 'k3', name: 'Hokitika greenstone', lat: -42.718, lng: 170.964, type: 'shopping', dayIndex: 2 },
]

export const sampleFuel: MapPlace[] = [
  { id: 'f1', name: 'Haast fuel', lat: -43.88, lng: 169.042, type: 'fuel' },
  { id: 'f2', name: 'Te Anau fuel', lat: -45.416, lng: 167.72, type: 'fuel' },
  { id: 'f3', name: 'Twizel supplies', lat: -44.258, lng: 170.1, type: 'supplies' },
]

export const SAMPLE_DAY_COUNT = days.length

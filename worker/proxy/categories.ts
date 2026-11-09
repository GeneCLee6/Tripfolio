// OSM tags (Photon osm_key/osm_value, Nominatim category/type) → our place categories.

import type { GeoCategory } from '../../shared/api/geo.ts'

const byValue: Record<string, Record<string, GeoCategory>> = {
  amenity: {
    restaurant: 'food',
    cafe: 'food',
    fast_food: 'food',
    bar: 'food',
    pub: 'food',
    food_court: 'food',
    ice_cream: 'food',
    biergarten: 'food',
    fuel: 'fuel',
    charging_station: 'fuel',
    pharmacy: 'supplies',
    drinking_water: 'supplies',
    water_point: 'supplies',
    sanitary_dump_station: 'supplies',
    toilets: 'supplies',
    shower: 'supplies',
    atm: 'supplies',
    bank: 'supplies',
    marketplace: 'shopping',
    bus_station: 'transport',
    ferry_terminal: 'transport',
    parking: 'transport',
    car_rental: 'transport',
    taxi: 'transport',
    theatre: 'sight',
    arts_centre: 'sight',
    place_of_worship: 'sight',
    townhall: 'sight',
  },
  shop: {
    supermarket: 'supplies',
    convenience: 'supplies',
    greengrocer: 'supplies',
    butcher: 'supplies',
    chemist: 'supplies',
    hardware: 'supplies',
    gas: 'supplies',
    bakery: 'food',
    deli: 'food',
    confectionery: 'food',
    pastry: 'food',
    coffee: 'food',
  },
  tourism: {
    hotel: 'lodging',
    motel: 'lodging',
    hostel: 'lodging',
    guest_house: 'lodging',
    camp_site: 'lodging',
    caravan_site: 'lodging',
    apartment: 'lodging',
    chalet: 'lodging',
    alpine_hut: 'lodging',
    wilderness_hut: 'lodging',
    picnic_site: 'nature',
  },
  leisure: {
    park: 'nature',
    nature_reserve: 'nature',
    garden: 'nature',
    beach_resort: 'nature',
  },
  boundary: { national_park: 'nature', protected_area: 'nature' },
  highway: { bus_stop: 'transport', rest_area: 'supplies', services: 'fuel' },
  building: { hotel: 'lodging', train_station: 'transport' },
  waterway: { waterfall: 'nature' },
}

/** Keys whose other values all map to one category */
const byKey: Record<string, GeoCategory> = {
  shop: 'shopping',
  tourism: 'sight',
  historic: 'sight',
  natural: 'nature',
  mountain_pass: 'nature',
  aeroway: 'transport',
  railway: 'transport',
  public_transport: 'transport',
  aerialway: 'transport',
}

export function categoryFor(key: string | undefined, value: string | undefined): GeoCategory {
  if (!key) return 'other'
  return (value ? byValue[key]?.[value] : undefined) ?? byKey[key] ?? 'other'
}

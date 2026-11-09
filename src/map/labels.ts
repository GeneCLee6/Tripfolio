import { geoCategories, type GeoCategory } from '../../shared/api/geo.ts'
import type { MessageKey } from '../../shared/i18n/t.ts'
import type { MapLayerKey } from './types.ts'

// i18n keys for the map's labels (place types and layers)

const TYPE_KEYS: Record<GeoCategory, MessageKey> = {
  sight: 'map.type.sight',
  food: 'map.type.food',
  shopping: 'map.type.shopping',
  lodging: 'map.type.lodging',
  transport: 'map.type.transport',
  fuel: 'map.type.fuel',
  supplies: 'map.type.supplies',
  nature: 'map.type.nature',
  other: 'map.type.other',
}

const isCategory = (type: string): type is GeoCategory => (geoCategories as readonly string[]).includes(type)

/** The label key of a place type; anything outside GeoCategory is "other" */
export const typeLabelKey = (type: string | undefined): MessageKey =>
  TYPE_KEYS[type && isCategory(type) ? type : 'other']

export const LAYER_LABEL_KEYS: Record<MapLayerKey, MessageKey> = {
  itinerary: 'map.layer.itinerary',
  pocket: 'map.layer.pocket',
  lodging: 'map.layer.lodging',
  picks: 'map.layer.picks',
  fuel: 'map.layer.fuel',
}

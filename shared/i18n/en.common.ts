import type { CommonMessageKey } from './zh-TW.common.ts'

// The English keys both bundles use: the same keys as zh-TW.common.ts (see there)
export const enCommon: Record<CommonMessageKey, string> = {
  // App name
  'app.name': 'Tripfolio',

  // The trip map (src/map/**), shown on the share page and on /trips/:id/map
  'map.label': 'Trip map',
  'map.loading': 'Loading the map…',
  'map.error': 'The map did not load. Check the connection and reload.',
  'map.layer.itinerary': 'Itinerary',
  'map.layer.pocket': 'Pocket list',
  'map.layer.lodging': 'Lodging',
  'map.layer.picks': 'Picks',
  'map.layer.fuel': 'Fuel and supplies',
  'map.type.sight': 'Sight',
  'map.type.food': 'Food',
  'map.type.shopping': 'Shopping',
  'map.type.lodging': 'Lodging',
  'map.type.transport': 'Transport',
  'map.type.fuel': 'Fuel',
  'map.type.supplies': 'Supplies',
  'map.type.nature': 'Nature',
  'map.type.other': 'Other',
  'map.stopOrder': 'Stop {n}',
  'map.pinLabel': '{day} · stop {n} · {name}',
  'map.placeLabel': '{layer} · {name}',
  'map.pinList': 'Places on the map',
  'map.action.schedule': 'Add to this day',
  'map.action.openGoogleMaps': 'Open in Google Maps',
  'map.fullscreenEnter': 'Full screen',
  'map.fullscreenExit': 'Exit full screen',
  'map.locate': 'Show my location',
  'map.locateFailed': 'Could not get your location',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  'map.canvas': 'Map view (arrow keys move, + and - zoom)',

  // Glossary, chrome, formats and language names used by the share page or the map
  'term.drivingTime': 'Driving time',
  'common.close': 'Close',
  'day.short': 'Day {n}',
  'language.label': 'Language',
  'language.zh-TW': '中文',
  'language.en': 'EN',
  'format.money.withSecondary': '{primary} (≈ {secondary})',
  'format.date.withWeekday': '{weekday}, {date}',
  'format.duration.hoursMinutes': '{hours} h {minutes} min',
  'format.duration.hours': '{hours} h',
  'format.duration.minutes': '{minutes} min',
  'format.distance.km': '{value} km',
  'format.distance.m': '{value} m',
}

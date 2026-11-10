import type {
  ChecklistTemplate,
  ChecklistTemplateStyle,
  NoteDestination,
  NotesTemplate,
} from '../schema/prep.ts'
import campervan from './checklists/campervan.json'
import city from './checklists/city.json'
import general from './checklists/general.json'
import island from './checklists/island.json'
import privateDriver from './checklists/private-driver.json'
import rail from './checklists/rail.json'
import roadtrip from './checklists/roadtrip.json'
import winter from './checklists/winter.json'
import nz from './notes/nz.json'

// The bilingual templates (E9 design: copied into the trip when applied, never linked back). Their
// shape is shared/schema/prep.ts; tests/shared/templates.test.ts validates every file, so the casts
// below only restate what the tests prove. Pure data: no zod here, so the app chunk stays small.

export const CHECKLIST_TEMPLATES = {
  general,
  roadtrip,
  campervan,
  'private-driver': privateDriver,
  city,
  island,
  rail,
  winter,
} as unknown as Record<ChecklistTemplateStyle, ChecklistTemplate>

export const NOTE_TEMPLATES = { nz } as unknown as Record<NoteDestination, NotesTemplate>

/** What applying `style` copies: the general lists first, then the style's own */
export function checklistTemplateLists(style: ChecklistTemplateStyle): ChecklistTemplate['lists'] {
  const own = CHECKLIST_TEMPLATES[style].lists
  return style === 'general' ? own : [...CHECKLIST_TEMPLATES.general.lists, ...own]
}

/** YYYY-MM-DD minus `days` (calendar arithmetic in UTC, no time zone involved) */
export function dateMinusDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) - days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

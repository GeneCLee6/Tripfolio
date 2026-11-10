import type { RecapMessageKey } from './recap.zh-TW.ts'

// English for ./recap.zh-TW.ts (the source): the same keys and {placeholders}.
export const recapEn: Record<RecapMessageKey, string> = {
  'recap.title': 'Recap',
  'recap.lead':
    'Each day’s photos and recap, with actual spending against the estimate. Amounts are only shown here, never on share pages.',
  'recap.notEnded':
    'The trip has not ended yet. You can write recaps now; share links show them once the end date has passed.',
  'recap.back': 'Back to the trip',
  'recap.error': 'The recap could not be loaded. Try again later.',
  'recap.retry': 'Try again',
  'recap.empty': 'This trip has no dated days yet.',
  'recap.totals.heading': 'Whole trip',
  'recap.totals.estimate': 'Estimate',
  'recap.totals.actual': 'Actual',
  'recap.totals.diff': 'Difference',
  'recap.totals.other':
    '{amount} was spent outside the trip’s dates (paid before leaving, for example) and is not included above.',
  'recap.day.label': 'Day {index}',
  'recap.text.label': 'Recap of Day {index}',
  'recap.text.placeholder': 'What happened today? Leave a blank line between paragraphs.',
  'recap.text.save': 'Save recap',
  'recap.text.saving': 'Saving…',
  'recap.text.saved': 'Recap of Day {index} saved',
  'recap.text.count': '{count}/{max} characters',
  'recap.text.tooLong': 'At most {max} characters',
  'recap.text.empty': 'Nobody has written a recap for this day yet.',
  'recap.photos.label': 'Photos of Day {index}',
  'recap.photos.empty': 'No photos this day.',
  'recap.photo.open': 'View photo {index}',
  'recap.photo.alt': 'Photo {index} of Day {day}',
  'recap.money.label': 'Estimate vs actual',
  'recap.money.estimate': 'Estimate',
  'recap.money.actual': 'Actual',
  'recap.money.over': '{amount} over',
  'recap.money.under': '{amount} under',
  'recap.money.even': 'Right on the estimate',
  'recap.money.none': 'No estimate and no expenses.',
  'recap.money.unconverted': 'Also estimated, not converted: {list}',
}

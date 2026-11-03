// Fixes made with the UI redesign (rules shared with the backend). Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { EVENT_BEFORE_DEADLINE, validateDetailsUpdate } from '../src/domain/conversation.js'
import { eventLine } from '../src/domain/eventWords.js'

const TODAY = '2026-11-03'
const request = {
  id: 'PR-1', status: 'in_progress', clientId: 'CL-1', brand: 'teamup', service: 'team_building', eventName: null,
  eventDatePrecision: 'day', eventDate: '2026-12-20', eventEndDate: null, requiredBy: '2026-12-01', participants: 50,
  requirementsSummary: 'Offsite', specificRequirements: null, briefTags: [], opportunityId: null,
}

test('Update details: the event cannot move to on or before the unchanged proposal deadline', () => {
  assert.deepEqual(validateDetailsUpdate(request, { eventDate: '2026-11-30' }, { today: TODAY }).errors, { eventDate: EVENT_BEFORE_DEADLINE })
  assert.deepEqual(validateDetailsUpdate(request, { eventDate: '2026-12-10' }, { today: TODAY }).errors, {}, 'still after the deadline')
  assert.deepEqual(validateDetailsUpdate(request, { eventDate: '2026-11-30', requiredBy: '2026-11-20' }, { today: TODAY }).errors, {},
    'moving both together is fine')
  const old = { ...request, requiredBy: '2026-10-01' } // a deadline already in the past is not re-checked
  assert.deepEqual(validateDetailsUpdate(old, { participants: 60 }, { today: TODAY }).errors, {})
})

test('Every recorded request event reads as words, never as a code', () => {
  const users = { a: { name: 'Ahmed Seif' }, m: { name: 'Mariam Dimitri' } }
  assert.equal(eventLine({ event: 'reminder_sent', toUser: 'm' }, users), 'sent a reminder to Mariam Dimitri')
  assert.equal(eventLine({ event: 'event_status_set', details: { status: 'initial' } }, users), 'marked it initially confirmed')
  assert.equal(eventLine({ event: 'facilitators_needed_set', details: { from: null, to: 4 } }, users), 'set the facilitators needed to 4')
  assert.equal(eventLine({ event: 'bd_owner_transferred', fromUser: 'a', toUser: 'm' }, users), 'moved the BD owner from Ahmed Seif to Mariam Dimitri')
  assert.equal(eventLine({ event: 'something_new' }, users), 'something new')
})

import { brandsForType, guessClientType, occasionFor, suggestedDeadline, tagsFromBrief, tidyPhone } from '../src/domain/smartDefaults.js'
import { validateContactFields } from '../src/domain/crm.js'

test('New client: the type a name suggests, and the brands that type usually works with', () => {
  assert.equal(guessClientType('Sunstone British School'), 'school')
  assert.equal(guessClientType('Heliopolis Horizon Academy'), 'school')
  assert.equal(guessClientType('BrightWave Events Agency'), 'agency')
  assert.equal(guessClientType('Medora Pharma'), 'corporate')
  assert.equal(guessClientType('Obelisk Telecom'), 'corporate')
  assert.equal(guessClientType('Riverbend Community Club'), '', 'no guess when the name says nothing')
  assert.equal(guessClientType('Al'), '')
  assert.deepEqual(brandsForType('school'), ['grasshoppers'])
  assert.deepEqual(brandsForType('corporate'), ['teamup'])
  assert.deepEqual(brandsForType('other'), [])
})

test('New proposal: a deadline a week out, always before the event', () => {
  assert.equal(suggestedDeadline('2027-03-15', '2026-11-03'), '2026-11-10')
  assert.equal(suggestedDeadline('2026-11-06', '2026-11-03'), '2026-11-05', 'the day before a close event')
  assert.equal(suggestedDeadline('2026-11-04', '2026-11-03'), '2026-11-03', 'today when the event is tomorrow')
  assert.equal(suggestedDeadline('2026-11-03', '2026-11-03'), '', 'no room')
  assert.equal(suggestedDeadline('', '2026-11-03'), '2026-11-10', 'no event date yet')
})

test('New proposal: the occasion of the event date, and tags named in the brief', () => {
  const occasions = [{ id: 1, name: 'Ramadan', periods: [{ startsOn: '2027-02-08', endsOn: '2027-03-09' }] },
    { id: 2, name: 'Summer', periods: [{ startsOn: '2027-06-15', endsOn: '2027-09-15' }] }]
  assert.equal(occasionFor('2027-03-01', occasions)?.id, 1)
  assert.equal(occasionFor('2027-07-01', occasions)?.id, 2)
  assert.equal(occasionFor('2027-04-01', occasions), null)
  assert.equal(occasionFor('2027-04', occasions), null, 'a month alone picks nothing')
  const tags = [{ code: 'transport', label: 'Transport' }, { code: 'catering', label: 'Catering' }, { code: 'venue', label: 'Venue' }]
  assert.deepEqual(tagsFromBrief('Day out for 80 staff, with transport and catering.', tags), ['transport', 'catering'])
  assert.deepEqual(tagsFromBrief('No needs', tags), [])
})

test('New client: an Egyptian mobile typed any way is stored one way, and still valid', () => {
  for (const typed of ['01012345678', '+201012345678', '00201012345678', '010 1234 5678']) {
    assert.equal(tidyPhone(typed), '+20 10 1234 5678')
  }
  assert.equal(tidyPhone('+44 20 7946 0958'), '+44 20 7946 0958', 'other numbers are left as typed')
  assert.deepEqual(validateContactFields({ name: 'A', phone: tidyPhone('01012345678') }).errors, {})
})

import { factsSentence, morningFacts } from '../src/domain/morning.js'

test('Morning summary: what waits on Marketing, Operations and HR is never "all caught up"', () => {
  assert.equal(factsSentence(morningFacts({ waitingOnMe: 1 }, 'marketing')), '1 request waits on you.')
  assert.equal(factsSentence(morningFacts({ missingStaff: 2, eventsThisWeek: 1 }, 'hr')), '2 events are short of facilitators, and 1 event this week.')
  assert.equal(factsSentence(morningFacts({ needsCount: 3 }, 'operations')), '3 events need a facilitator count.')
  assert.deepEqual(morningFacts({ missingStaff: 2, needsCount: 3 }, 'business_development'), [], 'staffing facts are for HR and Operations')
})

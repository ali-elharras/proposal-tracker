/**
 * Every non-status event recorded on a request (request_events), in words: "moved the BD owner from A to B",
 * "sent a reminder to Mariam", "marked the event postponed". Used by the conversation and the full history,
 * so no raw code (details_updated, event_confirmed…) ever reaches the screen.
 */
import { EVENT_STATUS_LABELS } from './events.js'

const name = (usersById, id, fallback = 'someone') => usersById?.[id]?.name ?? fallback

const LINES = {
  details_updated: () => 'updated the details',
  details_seen: () => 'saw the changed details',
  waiting_on_set: () => 'changed who it is waiting on',
  waiting_on_cleared: () => 'marked it done (waiting on is automatic again)',
  bd_owner_transferred: (e, u) => `moved the BD owner from ${name(u, e.fromUser)} to ${name(u, e.toUser)}`,
  assigned_am_changed: (e, u) => `moved it from ${name(u, e.fromUser)} to ${name(u, e.toUser)} (Account Manager)`,
  client_merged: () => 'merged its client into another',
  clients_merged: () => 'merged its client into another',
  reminder_sent: (e, u) => (e.toUser ? `sent a reminder to ${name(u, e.toUser)}` : 'sent a reminder'),
  event_status_set: (e) => `marked it ${(EVENT_STATUS_LABELS[e.details?.status] ?? 'confirmed').toLowerCase()}`,
  event_confirmed: () => 'confirmed the event',
  event_postponed: () => 'marked the event postponed',
  event_date_changed: () => 'changed the event date',
  event_cancelled: () => 'marked the event cancelled',
  facilitators_needed_set: (e) => (e.details?.to === null || e.details?.to === undefined
    ? 'cleared the number of facilitators needed' : `set the facilitators needed to ${e.details.to}`),
  archived: () => 'archived it',
  created: () => 'created it',
}

/** One event as a short line after the person's name. Unknown codes read as plain words, never as code. */
export function eventLine(event, usersById = {}) {
  const line = LINES[event.event]
  return line ? line(event, usersById) : String(event.event ?? '').replace(/_/g, ' ')
}

/** The note to show under the line (a reminder's note only repeats the line, so it is left out). */
export function eventNote(event) {
  return event.event === 'reminder_sent' ? null : event.note ?? null
}

/**
 * One client at a glance, from the requests this viewer may see (never someone else's draft):
 * how many proposals (open, confirmed, lost), the win rate, the confirmed value (final price, else the
 * AM price; null when this viewer sees no prices), the next and the last event, and the last activity.
 * Used by the client page's summary strip and the Clients list's columns, so both always agree.
 */
import { PROPOSAL_STATUS as PS } from './status.js'
import { clientEvents, eventDay } from './events.js'
import { valueOf } from './scorecard.js'

export function clientStats(requests, today) {
  const { rows, counts } = clientEvents(requests, today)
  const won = rows.filter((e) => e.request.status === PS.ACCEPTED).map((e) => e.request)
  const decided = counts.won + counts.lost
  const values = won.map(valueOf).filter((v) => v !== null && v !== undefined)
  const dated = won.filter((r) => eventDay(r)).sort((a, b) => eventDay(a).localeCompare(eventDay(b)))
  const days = dated.map(eventDay)
  const last = rows.map((e) => e.request.lastUpdated).filter(Boolean).sort().at(-1) ?? null
  return {
    total: rows.length,
    open: counts.open,
    won: counts.won,
    lost: counts.lost,
    winRate: decided ? Math.round((counts.won / decided) * 100) : null,
    confirmedValue: values.length ? values.reduce((s, v) => s + v, 0) : null,
    nextEvent: days.find((d) => d >= today) ?? null,
    lastEvent: [...days].reverse().find((d) => d < today) ?? null,
    // the requests themselves, to show their date as the event page does ("Jun 2027" for a month-only date)
    nextEventRequest: dated.find((r) => eventDay(r) >= today) ?? null,
    lastEventRequest: [...dated].reverse().find((r) => eventDay(r) < today) ?? null,
    lastActivity: last,
  }
}

/** clientId -> clientStats, for a whole list at once. */
export function statsByClient(requests, today) {
  const groups = new Map()
  for (const r of requests) {
    if (!groups.has(r.clientId)) groups.set(r.clientId, [])
    groups.get(r.clientId).push(r)
  }
  return Object.fromEntries([...groups].map(([id, rs]) => [id, clientStats(rs, today)]))
}

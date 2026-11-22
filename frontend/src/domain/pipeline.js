/**
 * Where a proposal is, in plain words, for the list and the proposal page alike:
 *   the pipeline step (Request → Preparing → Ready → With client → Result),
 *   whether it is waiting, on whom and for how many days,
 *   why (the reason set by hand, else what its status means, with the codes chosen when it moved),
 *   and what happens next.
 * One function so the list and the page can never disagree.
 */
import { optionLabel } from './lists.js'
import { PROPOSAL_STATUS as PS, getStatus, lostReasonLabel } from './status.js'
import { effectiveWaiting, getTeam, waitingDays, waitingLabel } from './waiting.js'

export const PIPELINE = [
  { id: 'request', label: 'Request' },
  { id: 'preparing', label: 'Preparing' },
  { id: 'ready', label: 'Ready' },
  { id: 'client', label: 'With client' },
  { id: 'result', label: 'Result' },
]

const STEP_OF = {
  [PS.DRAFT]: 0, [PS.SUBMITTED]: 0,
  [PS.IN_PROGRESS]: 1, [PS.AWAITING_BD_INFO]: 1, [PS.REVISION_REQUESTED]: 1,
  [PS.READY_FOR_BD]: 2,
  [PS.SHARED_WITH_CLIENT]: 3, [PS.POSTPONED]: 3,
}

/** 0–4: the pipeline step a status sits in (every closed status is the Result). */
export function pipelineStep(status) {
  return STEP_OF[status] ?? 4
}

const OUTCOME = {
  [PS.ACCEPTED]: { tone: 'won', label: 'Confirmed' },
  [PS.REJECTED]: { tone: 'lost', label: 'Lost' },
  [PS.CANCELLED]: { tone: 'lost', label: 'Cancelled' },
  [PS.CLOSED_UNRECORDED]: { tone: 'closed', label: 'Closed · outcome not recorded' },
  [PS.CLOSED_POSTPONED]: { tone: 'closed', label: 'Closed · postponed' },
}

const ROLE_OF_TEAM = { bd: 'BD', am: 'Account Manager', client: 'Client', marketing: 'Marketing', operations: 'Operations', management: 'Management' }

/** The latest history entry with this status (its reasons and note explain the move). */
function lastEntry(r, status) {
  const h = r.statusHistory ?? r.history ?? []
  for (let i = h.length - 1; i >= 0; i -= 1) if (h[i].status === status) return h[i]
  return null
}

function reasonsText(r, status, list, lists) {
  const e = lastEntry(r, status)
  const codes = (e?.reasons ?? []).map((c) => optionLabel(lists, list, c)).filter(Boolean)
  const note = e?.note && !e.imported ? e.note.trim().replace(/[.;,\s]+$/, '') : null
  return [codes.join(', '), note].filter(Boolean).join(' — ')
}

const fmtDay = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  .format(new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)) : '')

/** Why it is where it is, in one sentence (no codes, no jargon). */
export function whyText(r, { lists = null, usersById = {} } = {}) {
  const w = effectiveWaiting(r)
  if (w?.kind === 'manual') {
    const team = getTeam(w.team)
    const reason = w.reason ? optionLabel(lists, team?.reasons, w.reason) : 'Waiting'
    return [reason, w.expectedBy ? `expected ${fmtDay(w.expectedBy)}` : null, w.note ? `“${w.note}”` : null].filter(Boolean).join(' · ')
  }
  const am = usersById[r.assignedAM]?.name?.split(' ')[0] ?? 'The Account Manager'
  const bd = usersById[r.bdOwner]?.name?.split(' ')[0] ?? 'BD'
  switch (r.status) {
    case PS.DRAFT: return 'A draft: not sent to the Account Manager yet'
    case PS.SUBMITTED: return `New: waiting for ${am} to start the proposal`
    case PS.IN_PROGRESS: return `${am} is preparing the proposal and the price`
    case PS.AWAITING_BD_INFO: {
      const what = reasonsText(r, PS.AWAITING_BD_INFO, 'whatsMissing', lists)
      return `${am} needs information from ${bd}${what ? `: ${what}` : ''}`
    }
    case PS.REVISION_REQUESTED: {
      const what = reasonsText(r, PS.REVISION_REQUESTED, 'whatShouldChange', lists)
      return `Changes needed${what ? `: ${what}` : ''}; ${am} is preparing a new version`
    }
    case PS.READY_FOR_BD: return `The proposal is ready: ${bd} needs to send it to the client`
    case PS.SHARED_WITH_CLIENT: return 'Sent to the client: waiting for their decision'
    case PS.POSTPONED: {
      const why = reasonsText(r, PS.POSTPONED, 'postponeWhy', lists)
      return `The client postponed${why ? ` (${why})` : ''}${r.followUpOn ? `: follow up on ${fmtDay(r.followUpOn)}` : ''}`
    }
    case PS.ACCEPTED: return 'The client confirmed: it is now an event'
    case PS.REJECTED: {
      const e = lastEntry(r, PS.REJECTED)
      const reason = e?.lostReason && e.lostReason !== 'not_recorded' ? lostReasonLabel(e.lostReason) : null
      return `The client said no${reason ? `: ${reason}` : ''}`
    }
    case PS.CANCELLED: return `Cancelled${lastEntry(r, PS.CANCELLED)?.note ? `: ${lastEntry(r, PS.CANCELLED).note}` : ''}`
    case PS.CLOSED_UNRECORDED: return 'Closed without a recorded result'
    case PS.CLOSED_POSTPONED: return 'Postponed and never followed up (closed)'
    default: return getStatus('proposal', r.status).description ?? ''
  }
}

/**
 * Everything the "Where it is now" panel and the list rows show:
 * { step, steps, closed, outcome, waiting: { who, role, days, kind } | null, why, next }
 */
export function whereIsIt(r, { lists = null, usersById = {}, now = new Date() } = {}) {
  const step = pipelineStep(r.status)
  const w = effectiveWaiting(r)
  const outcome = OUTCOME[r.status] ?? null
  return {
    step,
    steps: PIPELINE,
    closed: Boolean(outcome),
    outcome,
    waiting: w ? {
      who: waitingLabel(w, usersById), role: w.team === 'client' ? null : ROLE_OF_TEAM[w.team] ?? null,
      userId: w.userId ?? null, team: w.team, days: waitingDays(w, now), kind: w.kind,
    } : null,
    why: whyText(r, { lists, usersById }),
    next: getStatus('proposal', r.status).nextStep ?? null,
  }
}

/** "today" · "1 day" · "12 days" */
export const daysLabel = (n) => (n === null || n === undefined ? '' : n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`)

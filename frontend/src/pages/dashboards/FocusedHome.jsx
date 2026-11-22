import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import PageLayout from '../../components/layout/PageLayout.jsx'
import Card from '../../components/ui/Card.jsx'
import DataTable from '../../components/ui/DataTable.jsx'
import Icon from '../../components/ui/Icon.jsx'
import KpiCard from '../../components/dashboard/KpiCard.jsx'
import { ClientEvent, DueDate } from '../../components/dashboard/cells.jsx'
import DashboardLoading from './DashboardLoading.jsx'
import { useAllRequests, useCurrentUser, useEvents, useLists, useLookups, useNewCount, useRadar, useStaffing, useToRate, useTodos, useWaitingOnMe } from '../../data/hooks.js'
import MorningSummary from '../../components/MorningSummary.jsx'
import { MyTodos } from '../../components/Todos.jsx'
import { todosDueToday } from '../../domain/todos.js'
import { operationsSections } from '../../domain/events.js'
import { cairoTodayISO, eventCounts } from '../../domain/events.js'
import RemindButton from '../../components/proposal/RemindButton.jsx'
import { WaitingCell } from '../../components/proposal/WhereNow.jsx'
import { optionLabel } from '../../domain/lists.js'
import { isDeadlineUpcoming, isRequestOverdue } from '../../domain/metrics.js'
import { ROLE } from '../../domain/roles.js'
import { PERIODS, PERIOD_IDS, funnel, funnelChange, results } from '../../domain/scorecard.js'
import CountUp from '../../components/ui/CountUp.jsx'
import SegmentedControl from '../../components/ui/SegmentedControl.jsx'
import { PROPOSAL_STATUS as PS, getStage, getStatus, stageOf, subLabelFor } from '../../domain/status.js'
import { followUpDue } from '../../domain/tracker.js'
import { effectiveWaiting, getTeam, waitingDays } from '../../domain/waiting.js'
import { rowMarkers } from '../../domain/conversation.js'
import StatusPill, { RowMarkers } from '../../components/ui/StatusPill.jsx'
import { formatEventDate, formatShortDate } from '../../lib/format.js'
import { proposalLink, proposalsLink } from '../../lib/links.js'

const NEEDS_ATTENTION_MAX = 5
const PERIOD_SHORT = { month: 'Month', quarter: 'Quarter', year: 'Year', all: 'All time' }
const isOpen = (r) => r.status !== PS.DRAFT && !getStatus('proposal', r.status).closed

/** The period of the funnel strip (Home: this year by default), kept in the URL. */
function usePeriod() {
  const [params, setParams] = useSearchParams()
  const period = PERIOD_IDS.includes(params.get('period')) ? params.get('period') : 'year'
  const setPeriod = (p) => {
    const next = new URLSearchParams(params)
    if (p === 'year') next.delete('period')
    else next.set('period', p)
    setParams(next, { replace: true })
  }
  return [period, setPeriod]
}

/**
 * The pipeline for a period: Received → Prepared → Sent → Confirmed as bars sized against Received (with the
 * share that got that far), then the outcomes (Lost · Postponed · In progress) and the events. The period
 * (This month · quarter · year · All time) is one click; the change against the previous period sits under each number.
 */
export function FunnelStrip({ requests, period, onPeriod, today, scopeLabel, showPeriod = true }) {
  const f = funnel(requests, period, today)
  const ev = eventCounts(requests, today) // shown separately: never mixed into Done
  // "↑ 3 vs last month": the same days of the previous period; hidden when there is nothing to compare.
  const change = funnelChange(requests, period, today)
  const base = Math.max(f.received, 1)
  const pct = (n) => (f.received ? `${Math.round((n / f.received) * 100)}%` : '—')
  const stages = [
    { key: 'received', label: 'Received', value: f.received },
    { key: 'prepared', label: 'Prepared', value: f.prepared },
    { key: 'sent', label: 'Sent', value: f.sent },
    { key: 'won', label: 'Confirmed', value: f.won, tone: 'won' },
  ]
  const outcomes = [
    { key: 'lost', label: 'Lost', value: f.lost, upIsGood: false, tone: 'lost' },
    { key: 'postponed', label: 'Postponed', value: f.postponed, upIsGood: false },
    { key: null, label: 'In progress', value: f.inProgress },
  ]
  const periodLabel = PERIODS.find((p) => p.id === period)?.label ?? ''
  return (
    <section className="funnel funnel--v2" aria-label={`Funnel: ${scopeLabel}`}>
      <header className="funnel__head">
        <div>
          <h2 className="funnel__title">Pipeline</h2>
          <p className="funnel__sub">{scopeLabel} · {periodLabel.toLowerCase()}</p>
        </div>
        {showPeriod && <SegmentedControl label="Period" value={period} onChange={onPeriod}
          options={PERIODS.map((p) => ({ value: p.id, label: PERIOD_SHORT[p.id] ?? p.label }))} />}
      </header>
      <ol className="funnel__bars">
        {stages.map((st, i) => (
          <li key={st.key} className={`funnel__bar-row${st.tone ? ` funnel__bar-row--${st.tone}` : ''}`}>
            <span className="funnel__label">{st.label}</span>
            <span className="funnel__track" aria-hidden="true">
              <span className="funnel__fill" style={{ inlineSize: `${Math.max((st.value / base) * 100, st.value ? 2 : 0)}%` }} />
            </span>
            <span className="funnel__value tabular"><CountUp value={st.value} id={`funnel:${scopeLabel}:${st.label}`} /></span>
            <span className="funnel__pct tabular">{i === 0 ? '' : pct(st.value)}</span>
            <span className="funnel__delta">{change && <Change n={change[st.key]} label={change.label} upIsGood />}</span>
          </li>
        ))}
      </ol>
      <div className="funnel__outcomes">
        {outcomes.map((o) => (
          <span key={o.label} className={`funnel__outcome${o.tone ? ` funnel__outcome--${o.tone}` : ''}`}>
            <span className="funnel__outcome-value tabular"><CountUp value={o.value} id={`funnel:${scopeLabel}:${o.label}`} /></span>
            <span className="funnel__outcome-label">{o.label}</span>
            {change && o.key && <Change n={change[o.key]} label={change.label} upIsGood={o.upIsGood} />}
          </span>
        ))}
      </div>
      <p className="funnel__events">
        <Icon name="calendar" size={14} /> Events: <strong>{ev.upcoming}</strong> confirmed upcoming · <strong>{ev.initial}</strong> initially confirmed
        · <strong>{ev.done}</strong> done · <strong>{ev.cancelled}</strong> cancelled after confirmation
      </p>
    </section>
  )
}

/** "↑ 3 vs last month" (green when that is good news, red when not; "= vs last month" when unchanged). */
function Change({ n, label, upIsGood }) {
  if (n === 0) return <span className="funnel__change">= {label}</span>
  const good = n > 0 === upIsGood
  return (
    <span className={`funnel__change funnel__change--${good ? 'good' : 'bad'}`}>
      {n > 0 ? '↑' : '↓'} {Math.abs(n)} {label}
    </span>
  )
}

/** What's blocking it: the reason set by hand, else the detailed stage ("Preparing", "Awaiting reply"…). */
function blocking(r, lists) {
  const w = effectiveWaiting(r)
  if (w?.kind === 'manual') {
    const reason = optionLabel(lists, getTeam(w.team).reasons, w.reason)
    return w.expectedBy ? `${reason} · expected ${formatShortDate(w.expectedBy)}` : reason
  }
  return subLabelFor(r.status, r.version) ?? getStage(stageOf(r.status)).label
}

/**
 * Needs Attention: open requests in this Home's scope, overdue first then the longest wait.
 * At most 5 rows, then "View all (N)". Chips: Waiting on me · Overdue · All.
 */
export function NeedsAttention({ requests, today, defaultChip = 'me' }) {
  const { user, activeRole } = useCurrentUser()
  const viewer = { userId: user.id, activeRole }
  const { clientsById } = useLookups()
  const lists = useLists().data
  const [chip, setChip] = useState(defaultChip)
  const open = requests.filter((r) => isOpen(r) && !r.needsReview)
  const byChip = {
    me: open.filter((r) => effectiveWaiting(r)?.userId === user.id),
    overdue: open.filter((r) => isRequestOverdue(r, today)),
    all: open,
  }
  const now = new Date()
  const rows = [...byChip[chip]].sort((a, b) =>
    Number(isRequestOverdue(b, today)) - Number(isRequestOverdue(a, today))
    || (waitingDays(effectiveWaiting(b), now) ?? 0) - (waitingDays(effectiveWaiting(a), now) ?? 0))
  const links = { me: proposalsLink({ waiting: 'me' }), overdue: proposalsLink({ deadline: 'overdue' }), all: proposalsLink({ open: 'true' }) }
  const chips = [{ id: 'me', label: 'Waiting on me' }, { id: 'overdue', label: 'Overdue' }, { id: 'all', label: 'All' }]
  return (
    <Card title="Needs attention" flush
      actions={rows.length > NEEDS_ATTENTION_MAX ? <Link to={links[chip]}>View all ({rows.length})</Link> : null}>
      <div className="waiting-chips card-pad" role="group" aria-label="Show">
        {chips.map((c) => (
          <button key={c.id} type="button" aria-pressed={chip === c.id} className={`chip-toggle${chip === c.id ? ' is-on' : ''}`}
            onClick={() => setChip(c.id)}>
            {c.label} <span className="tabular muted">{byChip[c.id].length}</span>
          </button>
        ))}
      </div>
      <DataTable
        caption="Needs attention"
        rows={rows.slice(0, NEEDS_ATTENTION_MAX)}
        rowKey={(r) => r.id}
        rowHref={(r) => proposalLink(r.id)}
        emptyMessage={chip === 'me' ? 'Nothing waiting on you.' : chip === 'overdue' ? 'Nothing overdue.' : 'No open requests.'}
        columns={[
          {
            key: 'client', header: 'Client',
            render: (r) => (
              <span className="stack">
                <span>{r.newForYou && <span className="new-dot" aria-label="New for you" />}
                  <ClientEvent name={clientsById[r.clientId]?.name ?? r.clientName} eventName={r.eventName} /></span>
                {r.newForYou && <span className="new-line">{r.newForYou.line}</span>}
                <RowMarkers markers={rowMarkers(r, viewer)} />
              </span>
            ),
          },
          {
            key: 'blocking', header: "What's blocking it",
            render: (r) => (
              <span>{blocking(r, lists)}</span>
            ),
          },
          {
            key: 'who', header: 'Waiting on',
            render: (r) => (
              <span className="wait-cell">
                <WaitingCell request={r} />
                <RemindButton request={r} compact />
              </span>
            ),
          },
          { key: 'deadline', header: 'Deadline', nowrap: true, render: (r) => <DueDate date={r.requiredBy} active={isRequestOverdue(r, today) || isDeadlineUpcoming(r, today)} /> },
        ]}
      />
    </Card>
  )
}

function Cards({ items }) {
  return (
    <div className="kpi-grid kpi-grid--3">
      {items.map((c) => <KpiCard key={c.label} {...c} value={String(c.value)} tone={c.tone ?? 'default'} />)}
    </div>
  )
}

/** One small list card (Due this week · Last 5 results), at most 5 rows. */
function ShortList({ title, rows, empty, render, viewAll }) {
  const { clientsById } = useLookups()
  return (
    <Card title={title} actions={viewAll ?? null}>
      {rows.length === 0 ? <p className="muted">{empty}</p> : (
        <ul className="short-list">
          {rows.slice(0, 5).map((r) => (
            <li key={r.id}>
              <Link to={proposalLink(r.id)}><ClientEvent name={clientsById[r.clientId]?.name ?? r.clientName} eventName={r.eventName} /></Link>
              <span className="muted">{render(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function useHomeData() {
  const res = useAllRequests()
  return { requests: res.data, error: res.error, today: cairoTodayISO() }
}

// ---------------------------------------------------------------------------
// One Home per role
// ---------------------------------------------------------------------------

export function BdHome({ subtitle }) {
  const { user } = useCurrentUser()
  const { requests: all, error, today } = useHomeData()
  const [period, setPeriod] = usePeriod()
  if (!all) return <DashboardLoading subtitle={subtitle} error={error} />
  const mine = all.filter((r) => r.bdOwner === user.id)
  const open = mine.filter(isOpen)
  const mineLink = (extra) => proposalsLink({ bdOwner: user.id, ...extra })
  return (
    <PageLayout title="Dashboard" subtitle={subtitle}>
      <Cards items={[
        { label: 'Ready to send', icon: 'document', value: open.filter((r) => r.status === PS.READY_FOR_BD).length,
          note: 'Proposals the AM finished', to: mineLink({ status: PS.READY_FOR_BD }) },
        { label: 'Waiting for client reply', icon: 'clock', value: open.filter((r) => r.status === PS.SHARED_WITH_CLIENT).length,
          note: 'Shared with the client', to: mineLink({ status: PS.SHARED_WITH_CLIENT }) },
        { label: 'Postponed follow-ups due', icon: 'calendar', value: open.filter((r) => followUpDue(r)).length,
          note: 'Follow-up date reached', to: mineLink({ status: PS.POSTPONED }) },
      ]} />
      <NeedsAttention requests={mine} today={today} />
      <FunnelStrip requests={mine} period={period} onPeriod={setPeriod} today={today} scopeLabel="Your requests" />
      <RadarCount />
    </PageLayout>
  )
}

export function AmHome({ subtitle }) {
  const { user } = useCurrentUser()
  const { requests: all, error, today } = useHomeData()
  const [period, setPeriod] = usePeriod()
  if (!all) return <DashboardLoading subtitle={subtitle} error={error} />
  const mine = all.filter((r) => r.assignedAM === user.id)
  const open = mine.filter(isOpen)
  const overdue = open.filter((r) => isRequestOverdue(r, today))
  const dueThisWeek = open.filter((r) => isDeadlineUpcoming(r, today)).sort((a, b) => a.requiredBy.localeCompare(b.requiredBy))
  const mineLink = (extra) => proposalsLink({ assignedAM: user.id, ...extra })
  return (
    <PageLayout title="Dashboard" subtitle={subtitle}>
      <Cards items={[
        { label: 'New in my queue', icon: 'document', value: open.filter((r) => r.status === PS.SUBMITTED).length,
          note: 'Submitted, not started', to: mineLink({ status: PS.SUBMITTED }) },
        { label: 'Revisions', icon: 'clipboard', value: open.filter((r) => r.status === PS.REVISION_REQUESTED).length,
          note: 'The client wants changes', to: mineLink({ status: PS.REVISION_REQUESTED }) },
        { label: 'Overdue', icon: 'alert', value: overdue.length, tone: overdue.length ? 'danger' : 'default',
          note: 'Past the proposal deadline', to: mineLink({ deadline: 'overdue' }) },
      ]} />
      <div className="dash-grid">
        <div className="dash-grid__main"><NeedsAttention requests={mine} today={today} /></div>
        <div className="dash-grid__side">
          <ShortList title="Due this week" rows={dueThisWeek} empty="Nothing due in the next 7 days."
            render={(r) => `due ${formatShortDate(r.requiredBy)}`}
            viewAll={dueThisWeek.length > 5 ? <Link to={mineLink({ deadline: 'upcoming' })}>View all ({dueThisWeek.length})</Link> : null} />
        </div>
      </div>
      <FunnelStrip requests={mine} period={period} onPeriod={setPeriod} today={today} scopeLabel="Requests assigned to you" />
    </PageLayout>
  )
}

export function HeadHome({ subtitle }) {
  const { requests: all, error, today } = useHomeData()
  const [period, setPeriod] = usePeriod()
  if (!all) return <DashboardLoading subtitle={subtitle} error={error} />
  const open = all.filter((r) => isOpen(r) && !r.needsReview)
  const waitingOn = (team) => open.filter((r) => effectiveWaiting(r)?.team === team).length
  const overdue = open.filter((r) => isRequestOverdue(r, today)).length
  const last = results(all, 'all', today, 5)
  const lastFive = [...last.won, ...last.lost].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
  return (
    <PageLayout title="Dashboard" subtitle={subtitle}>
      <Cards items={[
        { label: 'Waiting on BD', icon: 'users', value: waitingOn('bd'), note: 'Open requests BD must move', to: proposalsLink({ waiting: 'bd' }) },
        { label: 'Waiting on AM', icon: 'clipboard', value: waitingOn('am'), note: 'Open requests an AM must move', to: proposalsLink({ waiting: 'am' }) },
        { label: 'Overdue', icon: 'alert', value: overdue, tone: overdue ? 'danger' : 'default', note: 'Past the proposal deadline',
          to: proposalsLink({ deadline: 'overdue' }) },
      ]} />
      <div className="dash-grid">
        <div className="dash-grid__main"><NeedsAttention requests={all} today={today} defaultChip="all" /></div>
        <div className="dash-grid__side">
          <ShortList title="Last 5 results" rows={lastFive.map((x) => ({ ...x.request, resultAt: x.at }))} empty="No results yet."
            render={(r) => (
              <>
                <StatusPill pill={r.status === PS.ACCEPTED ? { kind: 'won', label: 'Confirmed' } : { kind: 'lost', label: 'Lost' }} request={r} />
                {' '}{formatShortDate(r.resultAt)}
              </>
            )} />
          <RadarCount />
        </div>
      </div>
      <FunnelStrip requests={all} period={period} onPeriod={setPeriod} today={today} scopeLabel="The company" />
    </PageLayout>
  )
}

/**
 * Marketing, Operations and HR: what waits on them first ("Done — back to …" in one click), then their
 * staffing work (HR: events short of facilitators and ratings to give; Operations: events with no facilitator
 * count yet), then the next two weeks of events, then their own to-dos.
 */
export function WaitingOnYouHome({ subtitle }) {
  const { activeRole } = useCurrentUser()
  const { items, isLoading, error, done } = useWaitingOnMe()
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState(null)
  const finish = async (item) => {
    setBusy(item.id)
    const result = await done(item)
    setBusy(null)
    setMessage(result.ok ? result.message : result.error)
  }
  const team = activeRole === ROLE.MARKETING ? 'Marketing' : activeRole === ROLE.OPERATIONS ? 'Operations' : null
  const toRate = useToRate()
  const events = useEvents().data
  const staffing = useStaffing({ skip: ![ROLE.HR, ROLE.OPERATIONS].includes(activeRole) }).data // staffing is theirs only
  const newCount = useNewCount()
  const week = events ? operationsSections(events.items ?? [], [], {}, events.today ?? cairoTodayISO()).week.length : 0
  const isHR = activeRole === ROLE.HR
  const isOps = activeRole === ROLE.OPERATIONS
  const todos = useTodos()
  const staffItems = staffing?.items ?? []
  const short = staffItems.filter((e) => (e.facilitatorsNeeded ?? 0) > (e.assignedCount ?? 0))
  const noCount = staffItems.filter((e) => e.facilitatorsNeeded === null || e.facilitatorsNeeded === undefined)
  return (
    <PageLayout title="My Work" subtitle={subtitle}>
      <MorningSummary counts={{
        newItems: newCount, eventsThisWeek: week, todosDueToday: todosDueToday(todos.items, cairoTodayISO()),
        waitingOnMe: isHR ? 0 : items.length, missingStaff: short.length, needsCount: noCount.length,
      }} />
      {!isHR && (
        <Card id="waiting-on-you" title={`Waiting on you (${items.length})`} subtitle={team ? `Requests that need ${team} or you by name` : null}>
          {error && <p className="form-error" role="alert">{error.message}</p>}
          {message && <p className="muted" role="status">{message}</p>}
          {!isLoading && items.length === 0 ? (
            <p className="empty-inline"><Icon name="checkmark" size={16} strokeWidth={2.25} /> Nothing is waiting on you. When someone needs you on a request, it shows here.</p>
          ) : (
            <ul className="short-list short-list--actions">
              {items.map((it) => (
                <li key={it.id}>
                  <span className="stack">
                    {it.canOpen
                      ? <Link to={proposalLink(it.id)}><ClientEvent name={it.clientName} eventName={it.eventName} /></Link>
                      : <strong className="short-list__title"><ClientEvent name={it.clientName} eventName={it.eventName} /></strong>}
                    <span className="muted">
                      {it.reasonLabel}{it.expectedBy ? ` · expected ${formatShortDate(it.expectedBy)}` : ''}
                      {it.note ? ` · “${it.note}”` : ''} · {it.id}
                    </span>
                  </span>
                  <button type="button" className="btn btn--sm btn--primary" disabled={busy === it.id} aria-busy={busy === it.id}
                    onClick={() => finish(it)}>
                    <Icon name="checkmark" size={14} strokeWidth={2.25} /> Done — back to {it.backTo}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {isHR && <StaffingAttention short={short} />}
      {isOps && noCount.length > 0 && <FacilitatorCount events={noCount} />}
      {toRate.length > 0 && (
        <Card title={`Rate facilitators (${toRate.length})`} subtitle="Done events: stars, attended yes / no, and feedback (you can change it for 7 days)">
          <ul className="short-list">
            {toRate.map((e) => (
              <li key={e.id}>
                <Link to={`/events/${encodeURIComponent(e.id)}#staffing`}><ClientEvent name={e.clientName} eventName={e.eventName} /></Link>
                <span className="muted">{e.eventDate ? formatEventDate(e.eventDate, e.eventEndDate, e.eventDatePrecision) : '—'} · {e.missing} to rate</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <UpcomingEvents />
      <MyTodos />
    </PageLayout>
  )
}

/** Operations: coming events with no facilitator count yet (HR staffs them from that number). */
function FacilitatorCount({ events }) {
  return (
    <Card id="facilitator-count" title={`Set facilitators needed (${events.length})`}
      subtitle="HR staffs each event from this number; the ratio's suggestion is on the event">
      <ul className="short-list short-list--actions">
        {events.slice(0, 6).map((e) => (
          <li key={e.id}>
            <span className="stack">
              <Link to={`/events/${encodeURIComponent(e.id)}#staffing`}><ClientEvent name={e.clientName} eventName={e.eventName} /></Link>
              <span className="muted">{e.eventDate ? formatEventDate(e.eventDate, e.eventEndDate, e.eventDatePrecision) : 'Date not set'}{e.participants ? ` · ${e.participants} people` : ''}</span>
            </span>
            <Link to={`/events/${encodeURIComponent(e.id)}#staffing`} className="btn btn--sm">Set the number</Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** Marketing / Operations: confirmed events in the next 14 days (at most 5), soonest first. */
function UpcomingEvents() {
  const { data } = useEvents()
  const today = cairoTodayISO()
  const limit = new Date(`${today}T00:00:00Z`)
  limit.setUTCDate(limit.getUTCDate() + 14)
  const until = limit.toISOString().slice(0, 10)
  const soon = (data?.items ?? [])
    .filter((e) => e.timing === 'upcoming' && /^\d{4}-\d{2}-\d{2}$/.test(e.eventDate ?? '') && e.eventDate <= until)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
  return (
    <Card title="Upcoming events (next 14 days)" actions={soon.length > 5 ? <Link to="/events?tab=confirmed">View all ({soon.length})</Link> : null}>
      {soon.length === 0 ? <p className="muted">No events in the next 14 days.</p> : (
        <ul className="short-list">
          {soon.slice(0, 5).map((e) => (
            <li key={e.id}>
              <Link to={`/events/${encodeURIComponent(e.id)}`}><ClientEvent name={e.clientName} eventName={e.eventName} /></Link>
              <span className="muted">{formatShortDate(e.eventDate)}{e.participants ? ` · ${e.participants} people` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** HR: coming events still short of facilitators (the Staffing page has everything). */
function StaffingAttention({ short }) {
  return (
    <Card title={`Short of facilitators (${short.length})`} actions={<Link to="/staffing">Staffing</Link>}>
      {short.length === 0 ? (
        <p className="empty-inline"><Icon name="checkmark" size={16} strokeWidth={2.25} /> Every event with a number needed is staffed.</p>
      ) : (
        <ul className="short-list short-list--actions">
          {short.slice(0, 6).map((e) => (
            <li key={e.id}>
              <span className="stack">
                <Link to={`/events/${encodeURIComponent(e.id)}#staffing`}><ClientEvent name={e.clientName} eventName={e.eventName} /></Link>
                <span className="muted">{e.eventDate ? formatEventDate(e.eventDate, e.eventEndDate, e.eventDatePrecision) : 'Date not set'} · {e.assignedCount} of {e.facilitatorsNeeded} assigned</span>
              </span>
              <Link to={`/events/${encodeURIComponent(e.id)}#staffing`} className="btn btn--sm btn--primary">
                Assign {e.facilitatorsNeeded - e.assignedCount}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** "Radar: N clients · M turned into requests" (BD: their clients; Noha: all). */
export function RadarCount() {
  const radar = useRadar()
  if (!radar.available || !radar.data) return null
  return (
    <p className="quiet-line">
      <Link to="/clients?tab=radar">Likely to book soon: {radar.data.clients} {radar.data.clients === 1 ? 'client' : 'clients'}</Link>
      {' · '}{radar.data.turnedIntoRequests} turned into requests this year
    </p>
  )
}

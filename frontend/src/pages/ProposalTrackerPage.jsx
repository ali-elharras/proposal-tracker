import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import PageLayout from '../components/layout/PageLayout.jsx'
import Card from '../components/ui/Card.jsx'
import DataTable from '../components/ui/DataTable.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import Icon from '../components/ui/Icon.jsx'
import ScopeChip from '../components/ui/ScopeChip.jsx'
import StatusBadge from '../components/ui/StatusBadge.jsx'
import Badge from '../components/ui/Badge.jsx'
import SegmentedControl from '../components/ui/SegmentedControl.jsx'
import { FilterBar, FilterMenu, FilterToggle, SearchBox } from '../components/ui/Filters.jsx'
import DueByDate from '../components/proposal/DueByDate.jsx'
import { PastRecordPanel, usePastRecordAllowed } from '../components/proposal/DataFixes.jsx'
import BrandTag from '../components/ui/BrandTag.jsx'
import { SkeletonList } from '../components/ui/Skeleton.jsx'
import { ClientEvent, DueDate } from '../components/dashboard/cells.jsx'
import { usePageDescription } from './PlaceholderPage.jsx'
import { useCurrentUser, useLookups, useTracker, useUsers } from '../data/hooks.js'
import { API_MODE } from '../data/source.js'
import { findNavItem, labelFor } from '../navigation.js'
import { BRANDS, getBrand } from '../domain/brands.js'
import { ROLE } from '../domain/roles.js'
import { isClientOwnerKind } from '../domain/access.js'
import { stageList, statusList } from '../domain/status.js'
import {
  DEADLINE_STATE_LABELS, EMPTY_FILTERS, GROUP, PROPOSAL_TABS, PROPOSAL_TAB_IDS, SORT_OPTIONS, activeFilterCount, groupByStage,
  parseTrackerParams, proposalBucket, scopesFor, trackerParams,
} from '../domain/tracker.js'
import useTab from '../lib/useTab.js'
import useRememberedFilters from '../lib/useRememberedFilters.js'
import { WAITING_CHIPS, effectiveWaiting, groupByWaiting, viewerPill, waitingDays, waitingLabel } from '../domain/waiting.js'
import { rowMarkers } from '../domain/conversation.js'
import { todayISO } from '../domain/metrics.js'
import StatusPill, { RowMarkers } from '../components/ui/StatusPill.jsx'
import { WaitingBar, WaitingOnPanel, waitingPermissions } from '../components/proposal/WaitingOn.jsx'
import Toast, { useRouteToast } from '../components/ui/Toast.jsx'
import { newRequestLink } from '../lib/links.js'

const WAITING_LABELS = { am: 'Waiting on AM', bd: 'Waiting on BD' }
const PAGE_SIZE = 50
const GROUP_PAGE_SIZE = 100 // the server's maximum: grouping looks at as many rows as one page can hold
const daysText = (n) => (n === null ? '' : n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`)

/** Who it is waiting on (the same words as the request page's bar); a button for people who may change it. */
function WaitingOn({ row, usersById, viewer, onOpen }) {
  const w = effectiveWaiting(row.request)
  if (!w) return <span className="muted">—</span>
  const content = <WaitingBar request={row.request} small />
  const can = waitingPermissions(row.request, viewer, usersById)
  if (!can.set.allowed && !can.clear.allowed) return content
  return (
    <button type="button" className="cell-button" onClick={() => onOpen(row.id)}
      aria-label={`Change who ${row.id} is waiting on`}>
      {content}
    </button>
  )
}

function RequestCell({ row }) {
  return (
    <span className="stack">
      <Link to={row.href} onClick={(e) => e.stopPropagation()}>{row.id}</Link>
      {row.needsMyAction && <span className="tracker__action-flag">Needs my action</span>}
      {row.opensEditor && <span className="muted">Opens editor</span>}
    </span>
  )
}

/** Small-screen card for one request. */
function RequestCard({ row, usersById }) {
  const r = row.request
  return (
    <li>
      <Link to={row.href} className={`tracker-card${row.deadlineState === 'overdue' ? ' is-overdue' : ''}`}>
        <div className="tracker-card__top">
          <strong className="tabular">{row.id}</strong>
          <StatusBadge kind="proposal" status={r.status} version={r.version} compact />
        </div>
        <div className="tracker-card__client"><ClientEvent name={row.clientName} eventName={r.eventName} /></div>
        {row.subLabel && <div className="tracker-card__sub">{row.subLabel}</div>}
        <div className="muted">{row.brandName} · {row.serviceName} · Event {row.eventDateLabel}</div>
        {row.statusHint && <div className="muted">{row.statusHint}</div>}
        <div className="tracker-card__meta">
          <span>Deadline: <DueDate date={r.requiredBy} active={row.deadlineActive} /></span>
          <span>{effectiveWaiting(r) ? `Waiting on ${waitingLabel(effectiveWaiting(r), usersById)}` : 'Closed'}</span>
        </div>
        {row.needsMyAction && <span className="tracker__action-flag">Needs my action</span>}
      </Link>
    </li>
  )
}

/** Proposal Tracker: every request this viewer may see, with scope, tabs, search and filters kept in the URL. */
const SKIP_KEYS = ['page', 'peek', 'past'] // never remembered: the page number and one-off panels

export default function ProposalTrackerPage() {
  const [params, setParams] = useSearchParams()
  const { user, activeRole, createRequests } = useCurrentUser()
  const users = useUsers().data
  const { usersById } = useLookups()
  const viewer = { userId: user.id, activeRole }
  const subtitle = usePageDescription(findNavItem('/proposals'))
  const [waitingFor, setWaitingFor] = useState(null) // request id whose "Waiting on" panel is open
  const [pastOpen, setPastOpen] = useState(() => params.get('past') === '1') // Ctrl+K "Add past record"
  const pastAllowed = usePastRecordAllowed()
  const toast = useRouteToast()
  // Noha, Doaa and Tony track "where is each proposal right now?": grouped by stage by default,
  // or by who it's waiting on (by=waiting); by=none lists it plainly.
  const tracking = [ROLE.COMMERCIAL_HEAD, ROLE.EXECUTIVE].includes(activeRole)
  const byWaiting = tracking && params.get('by') === 'waiting'
  const byStage = tracking && !byWaiting && params.get('by') !== 'none'
  useRememberedFilters(`iee.filters.proposals.${user.id}:${activeRole}`, SKIP_KEYS)
  const [bucket, setBucket] = useTab(PROPOSAL_TAB_IDS, 'open')
  const dueView = params.get('view') === 'due' // "Due by date": open requests grouped by deadline
  const setView = (v) => {
    const next = new URLSearchParams(params)
    if (v === 'due') next.set('view', 'due')
    else next.delete('view')
    setParams(next, { replace: true })
  }

  // Proposals: everything not yet confirmed. A confirmed proposal is an Event and is listed under Events.
  const parsed = parseTrackerParams(params, viewer, users)
  const state = { ...parsed, tab: 'all', filters: { ...parsed.filters, hideEvents: true, bucket } }
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  // Demo: computed from the demo store. API: the server's rows, tab counts and pages.
  const pageSize = byWaiting || byStage ? GROUP_PAGE_SIZE : PAGE_SIZE
  const { data: result, isLoading, error } = useTracker(state, { page, pageSize })
  const rows = result?.rows ?? []
  const counts = result?.bucketCounts ?? Object.fromEntries(PROPOSAL_TABS.map((t) => [t.id, 0]))
  const scopeSize = result?.scopeSize ?? 0
  const total = result?.total ?? 0
  const goToPage = (n) => {
    const next = new URLSearchParams(params)
    if (n > 1) next.set('page', String(n))
    else next.delete('page')
    setParams(next, { replace: true })
  }

  const scopes = scopesFor(activeRole, user) // an AM gets the other brand only with "See all brands"
  const currentScope = scopes.find((s) => s.id === state.scope)
  const filterCount = activeFilterCount(parsed.filters)
  // Brand matters only when more than one brand is in view (an AM without "See all brands" sees one).
  const showBrand = !(activeRole === ROLE.ACCOUNT_MANAGER && scopes.length < 2)

  const update = (patch) => {
    const next = { ...state, ...patch, filters: { ...state.filters, ...(patch.filters ?? {}) } }
    const out = new URLSearchParams(trackerParams(next, viewer))
    for (const keep of ['tab', 'by']) if (params.get(keep)) out.set(keep, params.get(keep)) // the tab and grouping stay
    setParams(out, { replace: true })
  }
  const clearFilters = () => update({ filters: { ...EMPTY_FILTERS, hideEvents: true }, tab: 'all' })

  const ams = users.filter((u) => u.roles.includes(ROLE.ACCOUNT_MANAGER))
  const bds = users.filter(isClientOwnerKind) // BD role or "Brings in clients"
  const statuses = statusList('proposal')

  const setGrouping = (v) => {
    const next = new URLSearchParams(params)
    if (v === 'waiting') next.set('by', 'waiting')
    else if (v === 'none') next.set('by', 'none')
    else next.delete('by')
    next.delete('page')
    setParams(next, { replace: true })
  }

  // Tracking (Noha, Doaa, Tony): where each proposal is now; no actions here.
  const trackingColumns = [
    {
      key: 'client', header: 'Client · Event · Brand',
      render: (row) => (
        <span className="stack">
          <span>{row.request.newForYou && <span className="new-dot" aria-label="New for you" />}
            <ClientEvent name={row.clientName} eventName={row.request.eventName} /></span>
          <BrandTag brand={row.request.brand} muted />
        </span>
      ),
    },
    {
      // One column: who it is waiting on and since when; Overdue / Your turn / results shown as a pill above it.
      key: 'status', header: 'Status · waiting on',
      render: (row) => {
        const pill = viewerPill(row.request, viewer, usersById, todayISO())
        return (
          <span className="stack stack--gap">
            {pill.kind !== 'waiting' && <StatusPill pill={pill} request={row.request} />}
            <WaitingBar request={row.request} small />
          </span>
        )
      },
    },
    { key: 'deadline', header: 'Deadline', nowrap: true, render: (row) => <DueDate date={row.request.requiredBy} active={row.deadlineActive} /> },
    {
      key: 'people', header: 'BD owner · AM', nowrap: true,
      render: (row) => (
        <span className="stack">
          <span>{usersById[row.request.bdOwner]?.name ?? '—'}</span>
          <span className="muted">{usersById[row.request.assignedAM]?.name ?? '—'}</span>
        </span>
      ),
    },
  ]
  const columns = [
    { key: 'id', header: 'Request', nowrap: true, render: (row) => <RequestCell row={row} /> },
    {
      key: 'client', header: 'Client · Brand · Service',
      render: (row) => (
        <span className="stack">
          <span>{row.request.newForYou && <span className="new-dot" aria-label="New for you" />}
            <ClientEvent name={row.clientName} eventName={row.request.eventName} /></span>
          {row.request.newForYou && <span className="new-line">{row.request.newForYou.line}</span>}
          <span className="muted">{row.brandName} · {row.serviceName} · {row.eventDateLabel}</span>
          <RowMarkers markers={rowMarkers(row.request, viewer)} />
        </span>
      ),
    },
    {
      key: 'deadline', header: 'Proposal deadline', nowrap: true,
      render: (row) => <DueDate date={row.request.requiredBy} active={row.deadlineActive} />,
    },
    {
      key: 'status', header: 'Status', nowrap: true,
      render: (row) => <StatusPill pill={viewerPill(row.request, viewer, usersById, todayISO())} request={row.request} />,
    },
    {
      key: 'waiting', header: 'Waiting on', nowrap: true,
      render: (row) => <WaitingOn row={row} usersById={usersById} viewer={viewer} onOpen={setWaitingFor} />,
    },
    {
      key: 'people', header: 'BD owner · Assigned AM', nowrap: true,
      render: (row) => (
        <span className="stack">
          <span><span className="muted">BD</span> {usersById[row.request.bdOwner]?.name ?? '—'}</span>
          <span><span className="muted">AM</span> {usersById[row.request.assignedAM]?.name ?? '—'}</span>
        </span>
      ),
    },
  ]

  return (
    <PageLayout
      title={labelFor(findNavItem('/proposals'), activeRole)}
      subtitle={subtitle}
      actions={(
        <>
          {pastAllowed && <button type="button" className="btn" onClick={() => setPastOpen(true)}>+ Add past record</button>}
          {createRequests.allowed && (
            <Link to={newRequestLink()} className="btn btn--primary">
              <Icon name="plus" size={16} strokeWidth={2} /> New proposal
            </Link>
          )}
        </>
      )}
    >
      <div className="tracker-bar">
        <div className="tracker-scopes" role="group" aria-label="Scope">
          {scopes.length > 1
            ? scopes.map((s) => (
                <ScopeChip key={s.id} scope={s.kind} label={s.label} selected={s.id === state.scope}
                  onClick={() => update({ scope: s.id })} />
              ))
            : currentScope && <ScopeChip scope={currentScope.kind} label={`${currentScope.label} · all requests you can view`} />}
        </div>
        <SegmentedControl label="Show as" value={dueView ? 'due' : 'list'} onChange={setView}
          options={[{ value: 'list', label: 'List' }, { value: 'due', label: 'Due by date' }]} />
        <div className="tracker-tabs" role="tablist" aria-label="Proposals">
          {PROPOSAL_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={bucket === t.id}
              className={`tracker-tab${bucket === t.id ? ' is-active' : ''}`} onClick={() => setBucket(t.id)}>
              {t.label} <span className="tracker-tab__count tabular">{counts[t.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {currentScope?.readOnly && (
        <p className="tracker-note">
          <Icon name="info" size={14} /> Company requests are view-only for you: they belong to other{' '}
          {activeRole === ROLE.ACCOUNT_MANAGER ? 'brands' : 'BD owners'}.
        </p>
      )}

      <Card flush>
        <FilterBar
          active={filterCount}
          onClear={clearFilters}
          count={isLoading && !result ? 'Loading…' : `${total} ${total === 1 ? 'request' : 'requests'}`}
          end={(
            <>
              {tracking ? (
                <FilterMenu label="Group" clearable={false} icon="sliders"
                  value={byWaiting ? 'waiting' : byStage ? 'stage' : 'none'}
                  onChange={(v) => setGrouping(v)}
                  options={[{ value: 'stage', label: 'By stage' }, { value: 'waiting', label: "By who it's waiting on" }, { value: 'none', label: 'No grouping' }]} />
              ) : (
                <FilterToggle label="Group by stage" icon="sliders" on={state.group === GROUP.STAGE}
                  onChange={(on) => update({ group: on ? GROUP.STAGE : GROUP.NONE })} />
              )}
              <FilterMenu label="Sort" clearable={false} icon="arrowDown" value={state.sort}
                onChange={(v) => update({ sort: v || SORT_OPTIONS[0].id })}
                options={SORT_OPTIONS.map((o) => ({ value: o.id, label: o.label }))} />
            </>
          )}
        >
          <SearchBox value={state.filters.q} onChange={(v) => update({ filters: { q: v } })} placeholder="Client, event or request ID" />
          <FilterMenu label="Waiting on" value={state.filters.waiting} anyLabel="Anyone"
            onChange={(v) => update({ filters: { waiting: v } })}
            options={WAITING_CHIPS.map((c) => ({ value: c.id, label: c.id === 'me' ? 'Me' : c.label }))} />
          {showBrand && (
            <FilterMenu label="Brand" value={state.filters.brand} anyLabel="Both brands"
              onChange={(v) => update({ filters: { brand: v } })} options={BRANDS.map((b) => ({ value: b.id, label: b.name }))} />
          )}
          <FilterMenu label="Stage" multiple value={state.filters.stage}
            onChange={(v) => update({ filters: { stage: v } })} options={stageList().map((st) => ({ value: st.id, label: st.label }))} />
          <FilterMenu label="Deadline" value={state.filters.deadline} anyLabel="Any deadline"
            onChange={(v) => update({ filters: { deadline: v } })}
            options={Object.entries(DEADLINE_STATE_LABELS).map(([id, label]) => ({ value: id, label }))} />
          {activeRole !== ROLE.ACCOUNT_MANAGER && (
            <FilterMenu label="AM" value={state.filters.assignedAM} anyLabel="Any Account Manager"
              onChange={(v) => update({ filters: { assignedAM: v } })} options={ams.map((u) => ({ value: u.id, label: u.name }))} />
          )}
          {!(activeRole === ROLE.BUSINESS_DEVELOPMENT && state.scope === 'mine') && (
            <FilterMenu label="BD owner" value={state.filters.bdOwner} anyLabel="Any BD owner"
              onChange={(v) => update({ filters: { bdOwner: v } })} options={bds.map((u) => ({ value: u.id, label: u.name }))} />
          )}
          <FilterMenu label="Status" multiple value={state.filters.status}
            onChange={(v) => update({ filters: { status: v } })} options={statuses.map((x) => ({ value: x.id, label: x.label }))} />
        </FilterBar>

        {error && <p className="form-error" role="alert">{error.message}</p>}

        {rows.length === 0 ? (
          isLoading ? <SkeletonList /> : scopeSize === 0 ? (
            <EmptyState icon="document" title="No requests here yet">
              {currentScope?.readOnly
                ? 'There are no requests in this scope.'
                : 'Requests you can see will appear here once they exist.'}
            </EmptyState>
          ) : (
            <EmptyState
              icon="search"
              title="No requests match"
              meta={
                <div className="tracker-empty-actions">
                  {filterCount > 0 && <button type="button" className="btn" onClick={clearFilters}>Clear all filters</button>}
                  {bucket !== 'open' && <button type="button" className="btn" onClick={() => setBucket('open')}>Show all open</button>}
                </div>
              }
            >
              Try a different search, or remove some filters.
            </EmptyState>
          )
        ) : dueView ? (
          <div className="card-pad"><DueByDate requests={rows.map((row) => row.request)} today={todayISO()} /></div>
        ) : (
          <>
            {(byWaiting ? waitingGroups(rows, usersById) : byStage ? bucketGroups(rows)
              : state.group === GROUP.STAGE ? groupByStage(rows) : [{ stage: null, label: null, rows }]).map((g) => (
              <section key={g.stage ?? 'all'} className="tracker-group">
                {g.label && (
                  <h3 className="tracker-group__title">
                    {g.label} <span className="tracker-tab__count tabular">{g.rows.length}</span>
                    {g.longest !== undefined && <span className="muted"> · longest {daysText(g.longest)}</span>}
                  </h3>
                )}
                <div className="tracker-table">
                  <DataTable
                    caption={g.label ? `Proposal requests: ${g.label}` : 'Proposal requests'}
                    rows={g.rows}
                    rowKey={(row) => row.id}
                    rowHref={(row) => row.href}
                    rowPeek={(row) => (row.opensEditor ? null : row.request.id)}
                    rowBrand={(row) => row.request.brand}
                    rowClassName={(row) => (row.request.newForYou ? 'is-new' : undefined)}
                    columns={tracking ? trackingColumns : columns}
                  />
                </div>
                <ul className="tracker-cards">
                  {g.rows.map((row) => <RequestCard key={row.id} row={row} usersById={usersById} />)}
                </ul>
              </section>
            ))}
          </>
        )}
      </Card>
      {total > rows.length && (
        <nav className="tracker-pager" aria-label="Pages">
          <button type="button" className="btn btn--sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>Previous</button>
          <span className="muted">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <button type="button" className="btn btn--sm" disabled={page * pageSize >= total} onClick={() => goToPage(page + 1)}>Next</button>
        </nav>
      )}
      {waitingFor && (
        <WaitingOnPanel requestId={waitingFor} onClose={() => setWaitingFor(null)}
          onSaved={(_r, text) => { setWaitingFor(null); toast.show(text) }} />
      )}
      {pastOpen && <PastRecordPanel onClose={() => setPastOpen(false)} />}
      <Toast message={toast.message} />
      {!API_MODE && (
        <p className="tracker-footnote">
          <Badge tone="warning" icon="info">Demo</Badge> Data is kept in memory and resets when the page is reloaded.
        </p>
      )}
    </PageLayout>
  )
}

/** Noha, Doaa and Tony: one group per stage (With AM · Waiting · Ready for BD · With client · Postponed …), each with its count. */
function bucketGroups(rows) {
  return PROPOSAL_TABS.filter((t) => t.id !== 'open')
    .map((t) => ({ stage: t.id, label: t.label, rows: rows.filter((r) => proposalBucket(r.request) === t.id) }))
    .filter((g) => g.rows.length)
}

/** Sections per person / team / Client, longest wait first (closed requests are not waiting on anyone). */
function waitingGroups(rows, usersById) {
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  return groupByWaiting(rows.map((r) => r.request), usersById)
    .map((g) => ({ stage: g.key, label: g.label, longest: g.longestDays, rows: g.requests.map((r) => byId[r.id]) }))
}

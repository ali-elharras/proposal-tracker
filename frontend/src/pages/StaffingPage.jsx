import { useState } from 'react'
import { Link } from 'react-router-dom'
import PageLayout from '../components/layout/PageLayout.jsx'
import Card from '../components/ui/Card.jsx'
import DataTable from '../components/ui/DataTable.jsx'
import KpiCard from '../components/dashboard/KpiCard.jsx'
import BrandTag from '../components/ui/BrandTag.jsx'
import { peekToken } from '../lib/peek.js'
import SegmentedControl from '../components/ui/SegmentedControl.jsx'
import { usePageDescription } from './PlaceholderPage.jsx'
import { useCurrentUser, useStaffing } from '../data/hooks.js'
import { findNavItem } from '../navigation.js'
import { BRANDS, getBrand } from '../domain/brands.js'
import { PRELIMINARY, cairoTodayISO } from '../domain/events.js'
import { plusDays } from '../domain/radar.js'
import { canManageFacilitators, staffingOf, staffingTotals } from '../domain/staffing.js'
import { formatEventDate, formatShortDate } from '../lib/format.js'

const PERIODS = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'Next 4 weeks' },
  { id: 'later', label: 'Later' },
]

/** Which period an event falls in (from its first day; no date: Later). */
function periodOf(e, today) {
  if (!e.eventDate || e.eventDatePrecision === 'month') return 'later'
  const end = e.eventEndDate || e.eventDate
  if (e.eventDate <= plusDays(today, 6) && end >= today) return 'week'
  if (e.eventDate <= plusDays(today, 34)) return 'month'
  return 'later'
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const line = (t) => `${plural(t.events, 'event', 'events')} · ${plural(t.needed, 'facilitator', 'facilitators')} needed · ${t.assigned} assigned · ${t.missing} missing`

/**
 * Staffing (HR's first page): initially confirmed and confirmed events still to come, by period, each with
 * facilitators needed · assigned · missing. "By date": one row per day with totals; days short of people
 * are highlighted. HR's numbers on top; staffing ratios (one facilitator per N participants) below.
 */
export default function StaffingPage() {
  const { user, activeRole } = useCurrentUser()
  const subtitle = usePageDescription(findNavItem('/staffing'))
  const staffing = useStaffing()
  const [view, setView] = useState('list')
  const today = staffing.data?.today ?? cairoTodayISO()
  const items = staffing.data?.items ?? []
  const n = staffing.numbers

  const columns = [
    {
      key: 'date', header: 'Date', nowrap: true,
      render: (e) => (
        <span className="stack">
          <span>{e.eventDate ? formatEventDate(e.eventDate, e.eventEndDate, e.eventDatePrecision) : 'Date not set'}</span>
          {e.eventStatus === 'initial' && <span className="status-pill status-pill--initial" title={PRELIMINARY}>Preliminary</span>}
        </span>
      ),
    },
    { key: 'client', header: 'Client · Event', render: (e) => <span className="stack"><span>{e.clientName ?? '—'}</span><span className="muted">{e.eventName ?? '—'}</span></span> },
    { key: 'brand', header: 'Brand', nowrap: true, render: (e) => <BrandTag brand={e.brand} /> },
    { key: 'people', header: 'Participants', align: 'end', render: (e) => <span className="tabular">{e.participants ?? '—'}</span> },
    { key: 'needed', header: 'Needed · Assigned', align: 'end', nowrap: true,
      render: (e) => <span className="tabular">{e.facilitatorsNeeded ?? '—'} · {e.assignedCount}</span> },
    {
      key: 'missing', header: 'Missing', align: 'end', nowrap: true,
      render: (e) => {
        const s = staffingOf(e.facilitatorsNeeded, e.assignedCount)
        return <span className={`tabular${s.missing > 0 ? ' text-danger' : ''}`}>{e.facilitatorsNeeded === null ? '—' : s.missing}</span>
      },
    },
  ]
  const days = [...new Set(items.filter((e) => e.eventDate && e.eventDatePrecision !== 'month').map((e) => e.eventDate))].sort()
    .map((d) => ({ day: d, ...staffingTotals(items.filter((e) => e.eventDate === d)) }))

  return (
    <PageLayout title="Staffing" subtitle={subtitle}
      actions={<SegmentedControl label="Show as" value={view} onChange={setView} options={[{ value: 'list', label: 'By event' }, { value: 'days', label: 'By date' }]} />}>
      {n && (
        <div className="kpi-grid">
          <KpiCard label="Facilitators active" icon="users" value={String(n.active)} to="/facilitators" />
          <KpiCard label="Events staffed this month" icon="calendar" value={`${n.staffedThisMonth} of ${n.eventsThisMonth}`} />
          <KpiCard label="Shortage this month" icon="alert" value={String(n.shortageThisMonth)} tone={n.shortageThisMonth ? 'danger' : 'default'}
            note="Facilitators still missing" />
        </div>
      )}
      {staffing.error && <p className="form-error" role="alert">{staffing.error.message}</p>}
      {view === 'list' ? PERIODS.map((p) => {
        const rows = items.filter((e) => periodOf(e, today) === p.id)
          .sort((a, b) => String(a.eventDate ?? '9999').localeCompare(String(b.eventDate ?? '9999')))
        return (
          <Card key={p.id} flush title={`${p.label} (${rows.length})`} subtitle={line(staffingTotals(rows))}>
            <DataTable caption={p.label} rows={rows} rowKey={(e) => e.id} rowHref={(e) => `/events/${encodeURIComponent(e.id)}#staffing`}
              rowPeek={(e) => peekToken('event', e.id)} rowBrand={(e) => e.brand}
              columns={columns} emptyMessage="No events." />
          </Card>
        )
      }) : (
        <Card flush title="By date" subtitle="Days short of facilitators are highlighted">
          <DataTable caption="By date" rows={days} rowKey={(d) => d.day} rowClassName={(d) => (d.missing > 0 ? 'is-overdue' : undefined)}
            columns={[
              { key: 'day', header: 'Day', nowrap: true, render: (d) => formatShortDate(d.day) },
              { key: 'events', header: 'Events', align: 'end', render: (d) => <span className="tabular">{d.events}</span> },
              { key: 'needed', header: 'Needed', align: 'end', render: (d) => <span className="tabular">{d.needed}</span> },
              { key: 'assigned', header: 'Assigned', align: 'end', render: (d) => <span className="tabular">{d.assigned}</span> },
              { key: 'missing', header: 'Missing', align: 'end', render: (d) => <span className={`tabular${d.missing ? ' text-danger' : ''}`}>{d.missing}</span> },
            ]} emptyMessage="No dated events." />
        </Card>
      )}
      {n && (n.topAttended.length > 0 || n.topRated.length > 0) && (
        <div className="dash-grid">
          <div className="span-6"><Card title="Most events attended"><TopList rows={n.topAttended} render={(p) => `${p.eventsAttended} events`} /></Card></div>
          {n.topRated.length > 0 && (
            <div className="span-6"><Card title="Best rated" subtitle="At least 3 ratings"><TopList rows={n.topRated} render={(p) => `★ ${p.average.toFixed(1)} from ${p.ratingCount}`} /></Card></div>
          )}
        </div>
      )}
      {canManageFacilitators({ userId: user.id, activeRole }) && <Ratios ratios={staffing.data?.ratios ?? {}} setRatio={staffing.setRatio} />}
    </PageLayout>
  )
}

function TopList({ rows, render }) {
  return (
    <ul className="short-list">
      {rows.map((p) => <li key={p.id}><Link to={`/facilitators/${p.id}`}>{p.name}</Link><span className="muted">{render(p)}</span></li>)}
    </ul>
  )
}

/**
 * Staffing ratios: one facilitator per N participants, per brand and service (a suggestion on each event).
 * One table per brand; change any numbers, then one "Save changes" (only the changed ones are sent).
 */
function Ratios({ ratios, setRatio }) {
  const [draft, setDraft] = useState({})
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const changed = Object.entries(draft).filter(([key, v]) => String(v ?? '').trim() !== String(ratios[key] ?? ''))
  const bad = changed.filter(([, v]) => String(v).trim() !== '' && !/^[1-9]\d*$/.test(String(v).trim()))
  const saveAll = async () => {
    if (bad.length) { setMessage({ tone: 'error', text: 'Use whole numbers (1 or more), or leave a box empty.' }); return }
    setBusy(true)
    let saved = 0
    for (const [key, v] of changed) {
      const [brand, service] = key.split(':')
      const raw = String(v).trim()
      const result = await setRatio(brand, service, raw === '' ? null : Number(raw))
      if (!result.ok) {
        setBusy(false)
        setMessage({ tone: 'error', text: Object.values(result.errors ?? {})[0] ?? result.error })
        return
      }
      saved += 1
    }
    setBusy(false)
    setDraft({})
    setMessage({ tone: 'ok', text: `Saved ${saved} ${saved === 1 ? 'ratio' : 'ratios'}.` })
  }
  return (
    <Card title="Staffing ratios" subtitle="Suggested on each event: one facilitator per N participants"
      actions={changed.length > 0 ? (
        <span className="ratio-actions">
          <button type="button" className="link-btn" onClick={() => { setDraft({}); setMessage(null) }} disabled={busy}>Undo</button>
          <button type="button" className="btn btn--sm btn--primary" onClick={saveAll} disabled={busy}>
            {busy ? 'Saving…' : `Save ${changed.length} ${changed.length === 1 ? 'change' : 'changes'}`}
          </button>
        </span>
      ) : null}>
      {message && <p className={message.tone === 'error' ? 'form-field__error' : 'muted'} role="status">{message.text}</p>}
      <div className="ratio-grid">
        {BRANDS.map((b) => (
          <section key={b.id} className="ratio-brand" aria-label={b.name}>
            <h3 className="ratio-brand__title"><BrandTag brand={b.id} /></h3>
            <ul className="ratio-list">
              {b.services.map((s) => {
                const key = `${b.id}:${s.id}`
                const value = draft[key] ?? ratios[key] ?? ''
                const isChanged = key in draft && String(draft[key]).trim() !== String(ratios[key] ?? '')
                return (
                  <li key={key} className={isChanged ? 'is-changed' : undefined}>
                    <span>{s.label}</span>
                    <span className="ratio-edit">1 per
                      <input aria-label={`${b.name} ${s.label}: participants per facilitator`} inputMode="numeric" size={4}
                        placeholder="—" value={value} onChange={(e) => { setMessage(null); setDraft((d) => ({ ...d, [key]: e.target.value })) }} />
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  )
}

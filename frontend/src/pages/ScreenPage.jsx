import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import PageLayout from '../components/layout/PageLayout.jsx'
import Card from '../components/ui/Card.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import Icon from '../components/ui/Icon.jsx'
import BrandTag from '../components/ui/BrandTag.jsx'
import KpiCard from '../components/dashboard/KpiCard.jsx'
import { SkeletonCards, SkeletonList } from '../components/ui/Skeleton.jsx'
import { usePageDescription } from './PlaceholderPage.jsx'
import { useCurrentUser, useScreen } from '../data/hooks.js'
import { findNavItem } from '../navigation.js'
import { BRANDS } from '../domain/brands.js'
import { formatEventDate, formatNumber } from '../lib/format.js'

const CAIRO = 'Africa/Cairo'
const time = (iso) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: CAIRO }).format(new Date(iso))
const longDay = (iso) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  .format(new Date(`${iso}T00:00:00Z`))
const shortDay = (iso) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  .format(new Date(`${iso}T00:00:00Z`))
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

function ago(iso, now) {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** "Today" · "Tomorrow" · "Thursday 5 November" for a day of this week. */
function dayLabel(day, today) {
  if (day === today) return 'Today'
  if (day === plusDays(today, 1)) return 'Tomorrow'
  return longDay(day)
}

/** One event row: client and event · service, participants, dates for multi-day, brand, preliminary. */
function EventRow({ e, link, showDate = false }) {
  return (
    <li className={`office__event brand--${e.brand}`}>
      {showDate && <span className="office__date tabular">{shortDay(e.date)}</span>}
      <span className="office__event-main">
        <span className="office__event-client">{link ? <Link to={link}>{e.client ?? '—'}</Link> : e.client ?? '—'}</span>
        <span className="muted">{[e.eventName, e.service].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="office__event-meta">
        {e.participants ? <span className="tabular"><Icon name="users" size={14} /> {formatNumber(e.participants)}</span> : null}
        {e.endDate && e.endDate !== e.date && <span className="muted">{formatEventDate(e.date, e.endDate)}</span>}
        <BrandTag brand={e.brand} />
        {e.initial && <span className="status-pill status-pill--initial" title="Not approved for execution yet">Preliminary</span>}
      </span>
    </li>
  )
}

/** The page fills the screen (the office TV) on request, and leaves it with Esc or the button. */
function useFullscreen(ref) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const sync = () => setOn(document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [ref])
  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else ref.current?.requestFullscreen?.().catch(() => {})
  }
  return [on, toggle, Boolean(typeof document !== 'undefined' && document.fullscreenEnabled)]
}

/** The clock in TV mode (Cairo time), ticking each half minute. */
function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/**
 * The office screen: a page like any other (the menu stays), and "TV mode" puts the same page full screen
 * for the office TV (Esc leaves). What is happening this week, what is being prepared and for how long,
 * the latest confirmations (a new one is highlighted once), and this month's numbers. Refreshes every
 * minute. No prices, client contacts, drafts or conversations (the server sends none).
 */
export default function ScreenPage() {
  const { pages } = useCurrentUser()
  const { data, error } = useScreen()
  const subtitle = usePageDescription(findNavItem('/screen'))
  const ref = useRef(null)
  const [tv, toggleTv, canTv] = useFullscreen(ref)
  const now = useNow()
  const seen = useRef(null)
  const [fresh, setFresh] = useState(() => new Set())

  // A confirmation that arrives while the screen is open is highlighted for a minute.
  useEffect(() => {
    if (!data) return undefined
    const ids = data.confirmations.map((c) => c.id)
    const added = seen.current ? ids.filter((id) => !seen.current.has(id)) : []
    seen.current = new Set(ids)
    if (!added.length) return undefined
    setFresh(new Set(added))
    const t = setTimeout(() => setFresh(new Set()), 60000)
    return () => clearTimeout(t)
  }, [data])

  const updated = data ? `Updated ${time(data.updatedAt)} · refreshes every minute` : null
  const actions = (
    <>
      {updated && <span className="office__updated">{updated}</span>}
      {canTv && (
        <button type="button" className="btn btn--primary" onClick={toggleTv}>
          <Icon name="monitor" size={16} /> {tv ? 'Leave TV mode' : 'TV mode'}
        </button>
      )}
    </>
  )

  if (!data) {
    return (
      <PageLayout title="Office screen" subtitle={subtitle}>
        {error ? <Card><EmptyState icon="alert" title="The office screen could not load">{error.message}</EmptyState></Card>
          : <><SkeletonCards /><SkeletonList rows={5} /></>}
      </PageLayout>
    )
  }

  const m = data.month
  const rate = m.decided ? Math.round((m.confirmed / m.decided) * 100) : null
  const byDay = new Map()
  for (const e of data.week) {
    const day = e.date < data.today ? data.today : e.date // a multi-day event already running counts today
    byDay.set(day, [...(byDay.get(day) ?? []), e])
  }
  const days = [...byDay.keys()].sort()
  const later = data.later ?? []
  const perBrand = BRANDS.map((b) => `${b.name} ${data.preparing.perBrand[b.id] ?? 0}`).join(' · ')
  const eventLink = (id) => (pages?.events && id ? `/events/${encodeURIComponent(id)}` : null)
  const requestLink = (id) => (pages?.proposals && id ? `/proposals/${encodeURIComponent(id)}` : null)
  const maybeLink = (to, children) => (to && !tv ? <Link to={to}>{children}</Link> : children)
  const nowIso = new Date(now).toISOString()

  return (
    <div ref={ref} className={`office${tv ? ' office--tv' : ''}`}>
      {tv && (
        <header className="office__tv-head">
          <span className="sidebar__logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="18" height="18"><path d="M10 9h12v3H13.5v2.5H21v3h-7.5V20H22v3H10z" fill="currentColor" /></svg>
          </span>
          <div className="office__tv-title">
            <strong>IEE</strong>
            <span>{longDay(data.today)}</span>
          </div>
          <span className="office__clock tabular">{time(nowIso)}</span>
          <span className="office__updated">{updated}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={toggleTv}>Leave TV mode</button>
        </header>
      )}
      <PageLayout title="Office screen" subtitle={tv ? null : subtitle} actions={tv ? null : actions}>
        <div className="kpi-grid office__kpis">
          <KpiCard label="Events this week" icon="calendar" value={String(data.week.length)}
            note={`${data.upcoming} in the next 30 days`} />
          <KpiCard label="In preparation now" icon="clipboard" value={String(data.preparing.count)} note={perBrand} />
          <KpiCard label="Confirmed this month" icon="trophy" value={String(m.confirmed)}
            note={m.decided ? `${rate}% of ${m.decided} decided · ${m.lost} lost` : 'Nothing decided yet this month'} />
          <KpiCard label="Requests received this month" icon="inbox" value={String(m.received)} note="Submitted to the Account Managers" />
        </div>

        <div className="office__grid">
          <Card title={days.length || !later.length ? 'This week' : 'Coming up'} subtitle={`${shortDay(data.today)} – ${shortDay(plusDays(data.today, 6))}${later.length ? ` · ${data.upcoming} in the next 30 days` : ''}`} className="office__week">
            {days.length === 0 && later.length === 0 && (
              <EmptyState icon="calendar" title="No events this week">Nothing booked in the next 30 days yet.</EmptyState>
            )}
            {days.length === 0 && later.length > 0 && (
              <>
                <p className="quiet-line office__none">No events this week. Coming up next:</p>
                <ul className="office__events">{later.map((e) => <EventRow key={e.id} e={e} link={tv ? null : eventLink(e.id)} showDate />)}</ul>
              </>
            )}
            {days.length > 0 && (
              <ol className="office__days">
                {days.map((day) => (
                  <li key={day} className={day === data.today ? 'office__day is-today' : 'office__day'}>
                    <h3 className="office__day-label">{dayLabel(day, data.today)}</h3>
                    <ul className="office__events">
                      {byDay.get(day).map((e) => <EventRow key={`${e.id ?? e.client}-${e.date}`} e={e} link={tv ? null : eventLink(e.id)} />)}
                    </ul>
                  </li>
                ))}
                {later.length > 0 && (
                  <li className="office__day office__day--later">
                    <h3 className="office__day-label">Later this month</h3>
                    <ul className="office__events">{later.slice(0, 3).map((e) => <EventRow key={e.id} e={e} link={tv ? null : eventLink(e.id)} showDate />)}</ul>
                  </li>
                )}
              </ol>
            )}
          </Card>

          <div className="office__side">
            <Card title="Latest confirmations">
              {data.confirmations.length === 0 ? <p className="muted">None yet.</p> : (
                <ul className="office__list">
                  {data.confirmations.map((c) => (
                    <li key={c.id} className={`office__confirm brand--${c.brand}${fresh.has(c.id) ? ' is-fresh' : ''}`}>
                      <span className="office__confirm-icon" aria-hidden="true"><Icon name="checkmark" size={14} strokeWidth={2.5} /></span>
                      <span className="office__event-main">
                        <span className="office__event-client">{maybeLink(eventLink(c.id), c.client ?? '—')}{fresh.has(c.id) ? ' 🎉' : ''}</span>
                        <span className="muted">{[c.eventName, c.by && `by ${c.by}`, ago(c.at, now)].filter(Boolean).join(' · ')}</span>
                      </span>
                      <BrandTag brand={c.brand} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Waiting longest in preparation" subtitle={`${data.preparing.count} with the Account Managers`}>
              {data.preparing.oldest.length === 0 ? <p className="muted">Nothing is being prepared right now.</p> : (
                <ul className="office__list">
                  {data.preparing.oldest.map((p, i) => (
                    <li key={p.id ?? i} className="office__prep">
                      <span className={`office__days-badge${p.days >= 7 ? ' is-long' : ''}`}>
                        <strong className="tabular">{p.days}</strong><span>{p.days === 1 ? 'day' : 'days'}</span>
                      </span>
                      <span className="office__event-main">
                        <span className="office__event-client">{maybeLink(requestLink(p.id), p.client ?? '—')}</span>
                        <span className="muted">{[p.stage, p.am].filter(Boolean).join(' · ')}</span>
                      </span>
                      {p.overdue ? <span className="status-pill status-pill--overdue">Overdue</span> : <BrandTag brand={p.brand} />}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </PageLayout>
    </div>
  )
}

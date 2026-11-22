import Avatar from '../ui/Avatar.jsx'
import Icon from '../ui/Icon.jsx'
import RemindButton from './RemindButton.jsx'
import { WaitingQuickMenu } from './WaitingOn.jsx'
import { useLists, useLookups } from '../../data/hooks.js'
import { PIPELINE, daysLabel, pipelineStep, whereIsIt } from '../../domain/pipeline.js'
import { isRequestOverdue } from '../../domain/metrics.js'
import { cairoTodayISO } from '../../domain/events.js'

const fmt = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Cairo' })
  .format(new Date(iso)) : '')

/** The day each pipeline step was first reached (from the status history). */
function stepDates(request) {
  const out = []
  for (const e of request.statusHistory ?? []) {
    const s = pipelineStep(e.status)
    if (out[s] === undefined && e.changedAt) out[s] = e.changedAt
  }
  return out
}

/**
 * The list's pipeline: five short segments (done · now · later) and the step's name underneath.
 * Green when confirmed, red when lost, grey when closed otherwise.
 */
export function PipelineBar({ request }) {
  const lists = useLists().data
  const { usersById } = useLookups()
  const w = whereIsIt(request, { lists, usersById })
  const tone = w.outcome?.tone ?? 'open'
  return (
    <span className={`pipe pipe--${tone}`} title={`${PIPELINE[w.step].label}: ${w.why}`}>
      <span className="pipe__track" aria-hidden="true">
        {PIPELINE.map((s, i) => (
          <span key={s.id} className={`pipe__seg${i < w.step ? ' is-done' : i === w.step ? ' is-now' : ''}`} />
        ))}
      </span>
      <span className="pipe__label">{w.outcome ? w.outcome.label : PIPELINE[w.step].label}</span>
    </span>
  )
}

/** The list's "Waiting on": who and how long, or "Not waiting" (closed). */
export function WaitingCell({ request }) {
  const { usersById } = useLookups()
  const w = whereIsIt(request, { usersById })
  if (!w.waiting) return <span className="wait-chip wait-chip--none">Not waiting</span>
  const overdue = isRequestOverdue(request, cairoTodayISO())
  return (
    <span className={`wait-chip wait-chip--${w.waiting.team === 'client' ? 'client' : 'team'}${overdue ? ' is-overdue' : ''}`}>
      <span className="wait-chip__who">{w.waiting.who}</span>
      {w.waiting.days !== null && <span className="wait-chip__days">{daysLabel(w.waiting.days)}</span>}
    </span>
  )
}

/** The list's "Why": one sentence. */
export function WhyCell({ request }) {
  const lists = useLists().data
  const { usersById } = useLookups()
  const why = whereIsIt(request, { lists, usersById }).why
  return <span className="why-cell" title={why}>{why}</span>
}

/**
 * The status card at the top of a proposal: everything to read and do in one place.
 *   1. the pipeline, with the day each step was reached;
 *   2. Waiting on (who, their role, how long; click the name to change it in one click) and Why;
 *   3. actions: the viewer's next step and its buttons (ActionsPanel), or what happens next.
 * onMore opens the full "Waiting on" form (a date, a note, "Other"); onSaved(result, text) after a quick change.
 */
export default function WhereNow({ request, actions = null, onMore, onSaved }) {
  const lists = useLists().data
  const { usersById } = useLookups()
  const w = whereIsIt(request, { lists, usersById })
  const dates = stepDates(request)
  const overdue = isRequestOverdue(request, cairoTodayISO())
  const person = w.waiting?.userId ? usersById[w.waiting.userId] : null
  const who = w.waiting && (
    <span className="where-now__who">
      {person ? <Avatar initials={person.initials} tone={person.avatarTone} size="sm" />
        : <span className="where-now__icon"><Icon name={w.waiting.team === 'client' ? 'building' : 'users'} size={16} /></span>}
      <span className="stack">
        <strong>{w.waiting.who}</strong>
        <span className={overdue ? 'where-now__days is-overdue' : 'muted'}>
          {[w.waiting.role, w.waiting.days !== null ? `for ${daysLabel(w.waiting.days)}` : null, overdue ? 'overdue' : null]
            .filter(Boolean).join(' · ')}
        </span>
      </span>
    </span>
  )
  return (
    <section className={`where-now where-now--${w.outcome?.tone ?? 'open'}`} aria-label="Where it is now">
      <ol className="where-now__steps">
        {w.steps.map((s, i) => {
          const state = i < w.step ? 'done' : i === w.step ? 'now' : 'later'
          return (
            <li key={s.id} className={`where-now__step is-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="where-now__dot" aria-hidden="true">
                {state === 'done' && <Icon name="checkmark" size={14} strokeWidth={3} />}
                {state === 'now' && i === 4 && w.outcome?.tone === 'won' && <Icon name="checkmark" size={14} strokeWidth={3} />}
                {state === 'now' && i === 4 && w.outcome?.tone === 'lost' && <Icon name="x" size={14} strokeWidth={3} />}
              </span>
              <span className="where-now__label">{i === 4 && w.outcome ? w.outcome.label : s.label}</span>
              <span className="where-now__date">{state !== 'later' && dates[i] ? fmt(dates[i]) : ''}</span>
            </li>
          )
        })}
      </ol>
      <div className="where-now__facts">
        <div className="where-now__fact">
          <span className="where-now__q">Waiting on</span>
          {w.waiting ? (
            <span className="where-now__who-row">
              <WaitingQuickMenu request={request} onSaved={onSaved} onMore={onMore}>{who}</WaitingQuickMenu>
              <RemindButton request={request} compact />
            </span>
          ) : (
            <span className="where-now__who"><span className={`status-pill status-pill--${w.outcome?.tone === 'won' ? 'won' : 'closed'}`}>Not waiting</span>
              <span className="muted">{w.outcome?.label}</span></span>
          )}
        </div>
        <div className="where-now__fact">
          <span className="where-now__q">Why</span>
          <span className="where-now__a">{w.why}</span>
        </div>
      </div>
      {actions && <div className="where-now__do">{actions}</div>}
    </section>
  )
}

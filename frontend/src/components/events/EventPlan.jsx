import { useState } from 'react'
import Card from '../ui/Card.jsx'
import Avatar from '../ui/Avatar.jsx'
import SegmentedControl from '../ui/SegmentedControl.jsx'
import { useEventPlan, useUsers } from '../../data/hooks.js'
import { todayISO } from '../../domain/metrics.js'
import { formatCurrency, formatShortDate } from '../../lib/format.js'

/**
 * The event plan on an event's page (backend: app/routers/event_plan.py):
 *   EventChecklist — what has to happen before the day: tick, assign, date, add, remove, "standard steps";
 *   RunSheet      — the day's timings ("09:00 Arrival"), shown as a timeline, edited as text;
 *   EventMoney    — final price, received so far, balance, and the payments (only for people who see prices).
 * Who may change what comes from the server (plan.canEdit, payments.canRecord).
 */

const PAYMENT_KINDS = [
  { id: 'deposit', label: 'Deposit' },
  { id: 'balance', label: 'Balance' },
  { id: 'other', label: 'Other' },
]

const fail = (result) => result.errors && Object.values(result.errors).filter(Boolean)[0] || result.error || 'It could not be saved.'

/** Checklist progress, e.g. { done: 3, total: 6 } (for the page's summary strip too). */
export function checklistProgress(plan) {
  const tasks = plan?.tasks ?? []
  return { done: tasks.filter((t) => t.doneAt).length, total: tasks.length }
}

export function EventChecklist({ event, onMessage }) {
  const plan = event.plan
  const actions = useEventPlan(event)
  const users = (useUsers().data ?? []).filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name))
  const usersById = Object.fromEntries(users.map((u) => [u.id, u]))
  const [title, setTitle] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)
  if (!plan) return null
  const can = plan.canEdit && actions.available
  const { done, total } = checklistProgress(plan)
  const today = todayISO()
  const missingStandard = (plan.standardTasks ?? []).some((s) => !plan.tasks.some((t) => t.title.toLowerCase() === s.toLowerCase()))

  const run = async (call) => {
    setBusy(true)
    const result = await call()
    setBusy(false)
    if (!result.ok) { setError(fail(result)); return false }
    setError(null)
    if (result.message) onMessage?.(result.message)
    return true
  }
  const add = async (e) => {
    e.preventDefault()
    if (!title.trim()) { setError('Write the step.'); return }
    if (await run(() => actions.addTask({ title }))) setTitle('')
  }

  return (
    <Card title="Checklist" className="plan-card"
      actions={total > 0 ? <span className={`plan-progress__label${done === total ? ' is-done' : ''}`}>{done} of {total} done</span> : null}>
      {total > 0 && (
        <div className="plan-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
          aria-label="Checklist progress">
          <span style={{ inlineSize: `${(done / total) * 100}%` }} />
        </div>
      )}
      {total === 0 && (
        <p className="muted plan-empty">
          {can ? 'Nothing planned yet. Start with the usual steps, or add your own.' : 'Nothing planned yet.'}
        </p>
      )}
      {total > 0 && (
        <ul className="checklist">
          {plan.tasks.map((t) => {
            const overdue = !t.doneAt && t.dueOn && t.dueOn < today
            const who = usersById[t.assigneeId]
            return (
              <li key={t.id} className={`checklist__item${t.doneAt ? ' is-done' : ''}`}>
                <input type="checkbox" className="todo__check" checked={Boolean(t.doneAt)} disabled={!can || busy}
                  aria-label={t.doneAt ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}
                  onChange={() => run(() => actions.editTask(t.id, { done: !t.doneAt }))} />
                <span className="checklist__body">
                  {editing === t.id ? (
                    <TitleEdit initial={t.title} onCancel={() => setEditing(null)}
                      onSave={async (v) => { if (await run(() => actions.editTask(t.id, { title: v }))) setEditing(null) }} />
                  ) : can && !t.doneAt ? (
                    <button type="button" className="todo__text todo__text--edit" onClick={() => setEditing(t.id)}>{t.title}</button>
                  ) : <span className="checklist__title">{t.title}</span>}
                  <span className="checklist__meta">
                    {can ? (
                      <>
                        <label className="checklist__pick">
                          {who ? <Avatar initials={who.initials} tone={who.avatarTone} size="sm" /> : <span className="checklist__nobody">+</span>}
                          <span>{who ? who.name.split(' ')[0] : 'Assign'}</span>
                          <select value={t.assigneeId ?? ''} aria-label={`Who does "${t.title}"`}
                            onChange={(e) => run(() => actions.editTask(t.id, { assigneeId: e.target.value || null }))}>
                            <option value="">Nobody yet</option>
                            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                        </label>
                        <label className={`checklist__pick${overdue ? ' is-overdue' : ''}`}>
                          <span>{t.dueOn ? `${overdue ? 'Overdue · ' : 'By '}${formatShortDate(t.dueOn)}` : 'Add a date'}</span>
                          <input type="date" value={t.dueOn ?? ''} aria-label={`When "${t.title}" is due`}
                            onChange={(e) => run(() => actions.editTask(t.id, { dueOn: e.target.value || null }))} />
                        </label>
                      </>
                    ) : (
                      <>
                        {who && <span>{who.name}</span>}
                        {t.dueOn && <span className={overdue ? 'text-danger' : undefined}>{overdue ? 'Overdue · ' : 'By '}{formatShortDate(t.dueOn)}</span>}
                      </>
                    )}
                  </span>
                </span>
                {can && (
                  <button type="button" className="todo__delete" aria-label={`Remove "${t.title}"`}
                    onClick={() => run(() => actions.deleteTask(t.id))}>×</button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {can && (
        <form className="checklist__add" onSubmit={add}>
          <input value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setError(null) }}
            placeholder="Add a step and press Enter" aria-label="New step" />
          {title.trim() && <button type="submit" className="btn btn--sm btn--primary" disabled={busy}>Add</button>}
          {missingStandard && !title.trim() && (
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => run(() => actions.addStandard())}>
              {total ? 'Add the missing usual steps' : 'Add the usual steps'}
            </button>
          )}
        </form>
      )}
      {error && <p className="form-field__error" role="alert">{error}</p>}
    </Card>
  )
}

function TitleEdit({ initial, onSave, onCancel }) {
  const [v, setV] = useState(initial)
  return (
    <form className="checklist__edit" onSubmit={(e) => { e.preventDefault(); onSave(v) }}>
      <input autoFocus value={v} maxLength={200} onChange={(e) => setV(e.target.value)} aria-label="Step"
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }} />
      <button type="submit" className="btn btn--sm">Save</button>
      <button type="button" className="link-btn" onClick={onCancel}>Cancel</button>
    </form>
  )
}

/** "09:00 Arrival" -> { time: '09:00', what: 'Arrival' }; lines without a time keep their text. */
function runLines(text) {
  return (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\d{1,2}[:.]\d{2}(?:\s*[-–]\s*\d{1,2}[:.]\d{2})?)\s*[-–:]?\s*(.*)$/)
    return m ? { time: m[1].replace('.', ':'), what: m[2] } : { time: null, what: l }
  })
}

export function RunSheet({ event, onMessage }) {
  const plan = event.plan
  const actions = useEventPlan(event)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!plan) return null
  const can = plan.canEdit && actions.available
  const lines = runLines(plan.runSheet)
  const start = () => { setText(plan.runSheet ?? ''); setError(null); setEditing(true) }
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    const result = await actions.saveRunSheet(text)
    setBusy(false)
    if (!result.ok) { setError(fail(result)); return }
    setEditing(false)
    onMessage?.(result.message)
  }
  return (
    <Card title="Run sheet" className="plan-card"
      actions={can && !editing ? <button type="button" className="link-btn" onClick={start}>{lines.length ? 'Edit' : 'Write it'}</button> : null}>
      {editing ? (
        <form className="runsheet__form" onSubmit={save}>
          <textarea rows={8} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder={'09:00 Arrival and registration\n09:30 Welcome and warm-up\n10:00 Team challenges\n12:30 Lunch'}
            aria-label="Run sheet: one line per time" />
          <p className="form-field__hint">One line per moment of the day, starting with the time.</p>
          {error && <p className="form-field__error" role="alert">{error}</p>}
          <div className="runsheet__buttons">
            <button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      ) : lines.length === 0 ? (
        <p className="muted plan-empty">{can ? 'No timings yet. Write the plan for the day, one line per time.' : 'No timings yet.'}</p>
      ) : (
        <ol className="runsheet">
          {lines.map((l, i) => (
            <li key={i} className="runsheet__line">
              <span className="runsheet__time tabular">{l.time ?? ''}</span>
              <span className="runsheet__dot" aria-hidden="true" />
              <span className="runsheet__what">{l.what}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

export function EventMoney({ event, onMessage }) {
  const money = event.plan?.payments
  const actions = useEventPlan(event)
  const [adding, setAdding] = useState(false)
  const [values, setValues] = useState({ kind: 'deposit', amount: '', receivedOn: todayISO(), note: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  if (!money) return null
  const can = money.canRecord && actions.available
  const paidPct = money.finalPrice ? Math.min(100, Math.round((money.received / money.finalPrice) * 100)) : null
  const set = (k) => (e) => { setValues((v) => ({ ...v, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })) }
  const save = async (e) => {
    e.preventDefault()
    const local = {}
    if (!/^\d+$/.test(String(values.amount).trim()) || Number(values.amount) <= 0) local.amount = 'Enter the amount in whole EGP.'
    if (!values.receivedOn) local.receivedOn = 'Enter the day it was received.'
    if (Object.keys(local).length) { setErrors(local); return }
    setBusy(true)
    const result = await actions.addPayment({ ...values, amount: Number(values.amount) })
    setBusy(false)
    if (!result.ok) { setErrors(result.errors && Object.keys(result.errors).length ? result.errors : { amount: result.error }); return }
    setAdding(false)
    setValues({ kind: 'deposit', amount: '', receivedOn: todayISO(), note: '' })
    onMessage?.(result.message)
  }
  const remove = async (id) => {
    const result = await actions.deletePayment(id)
    if (result.ok) onMessage?.(result.message)
  }
  return (
    <Card title="Money" className="plan-card"
      actions={can && !adding ? <button type="button" className="link-btn" onClick={() => setAdding(true)}>Record a payment</button> : null}>
      <div className="money">
        <div className="money__row">
          <span className="money__label">Final price</span>
          <strong className="tabular">{money.finalPrice ? formatCurrency(money.finalPrice) : 'Not set'}</strong>
        </div>
        <div className="money__row">
          <span className="money__label">Received</span>
          <strong className="tabular money__in">{formatCurrency(money.received)}</strong>
        </div>
        {money.balance !== null && (
          <div className="money__row">
            <span className="money__label">Balance due</span>
            <strong className={`tabular${money.balance > 0 ? ' money__due' : ' money__clear'}`}>
              {money.balance > 0 ? formatCurrency(money.balance) : money.balance === 0 ? 'Paid in full' : `${formatCurrency(-money.balance)} over`}
            </strong>
          </div>
        )}
        {paidPct !== null && (
          <div className="plan-progress plan-progress--money" role="progressbar" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={paidPct} aria-label="Paid so far">
            <span style={{ inlineSize: `${paidPct}%` }} />
          </div>
        )}
      </div>
      {money.items.length > 0 && (
        <ul className="money__list">
          {money.items.map((p) => (
            <li key={p.id}>
              <span className="money__kind">{PAYMENT_KINDS.find((k) => k.id === p.kind)?.label ?? p.kind}</span>
              <span className="muted">{formatShortDate(p.receivedOn)}{p.note ? ` · ${p.note}` : ''}</span>
              <strong className="tabular">{formatCurrency(p.amount)}</strong>
              {can && <button type="button" className="todo__delete" aria-label="Remove this payment" onClick={() => remove(p.id)}>×</button>}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form className="money__form" onSubmit={save} noValidate>
          <SegmentedControl label="Payment" value={values.kind} onChange={(kind) => setValues((v) => ({ ...v, kind }))}
            options={PAYMENT_KINDS.map((k) => ({ value: k.id, label: k.label }))} />
          <div className="money__fields">
            <label className="form-field">
              <span className="form-field__label">Amount (EGP)</span>
              <input inputMode="numeric" value={values.amount} onChange={set('amount')} aria-invalid={Boolean(errors.amount)} autoFocus />
              {errors.amount && <span className="form-field__error">{errors.amount}</span>}
            </label>
            <label className="form-field">
              <span className="form-field__label">Received on</span>
              <input type="date" max={todayISO()} value={values.receivedOn} onChange={set('receivedOn')} aria-invalid={Boolean(errors.receivedOn)} />
              {errors.receivedOn && <span className="form-field__error">{errors.receivedOn}</span>}
            </label>
          </div>
          <label className="form-field">
            <span className="form-field__label">Note (optional)</span>
            <input maxLength={300} value={values.note} onChange={set('note')} placeholder="e.g. bank transfer" />
          </label>
          <div className="runsheet__buttons">
            <button type="button" className="btn" onClick={() => setAdding(false)} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save payment'}</button>
          </div>
        </form>
      )}
    </Card>
  )
}

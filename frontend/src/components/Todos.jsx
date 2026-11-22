import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from './ui/Card.jsx'
import { ClientSource, EventSource, RequestSource } from './layout/CommandBox.jsx'
import { useCurrentUser, useTodos } from '../data/hooks.js'
import { commandMatches } from '../domain/command.js'
import { cairoTodayISO } from '../domain/events.js'
import { TODO_TEXT_MAX, isTodoOverdue, todoGroups, validateTodo } from '../domain/todos.js'
import { addDays } from '../domain/smartDefaults.js'
import { formatShortDate } from '../lib/format.js'

const LINK_KIND = { cl: 'client', req: 'request', ev: 'event' }
const PICKED = 8
const doneDay = (t) => cairoTodayISO(new Date(t.doneAt))
export const todoLink = (t) => (t.linkKind === 'client' ? `/clients/${encodeURIComponent(t.linkId)}`
  : t.linkKind === 'event' ? `/events/${encodeURIComponent(t.linkId)}` : `/proposals/${encodeURIComponent(t.linkId)}`)

/** Due-date shortcuts: one tap instead of a date picker for the usual cases. */
const DUE_CHIPS = [
  { id: 'today', label: 'Today', days: 0 },
  { id: 'tomorrow', label: 'Tomorrow', days: 1 },
  { id: 'week', label: 'Next week', days: 7 },
]

/** "Overdue · 3 Nov" · "Today" · "Tomorrow" · "10 Nov" */
function dueLabel(t, today) {
  if (!t.dueOn) return null
  if (isTodoOverdue(t, today)) return `Overdue · ${formatShortDate(t.dueOn)}`
  if (t.dueOn === today) return 'Today'
  if (t.dueOn === addDays(today, 1)) return 'Tomorrow'
  return formatShortDate(t.dueOn)
}

/** Open to-dos in four plain groups (only the ones that have something). */
function dueGroups(open, today) {
  const groups = [
    { id: 'overdue', label: 'Overdue', items: open.filter((t) => isTodoOverdue(t, today)) },
    { id: 'today', label: 'Today', items: open.filter((t) => t.dueOn === today) },
    { id: 'upcoming', label: 'Upcoming', items: open.filter((t) => t.dueOn && t.dueOn > today) },
    { id: 'someday', label: 'No date', items: open.filter((t) => !t.dueOn) },
  ]
  return groups.filter((g) => g.items.length)
}

/**
 * "My to-dos" on My Work (every person, every role). Type and press Enter to add; the due-date shortcuts
 * and "Link" appear while typing. Tick to complete ("Done today" until the day ends; "Completed": the
 * last 30 days). Click a to-do to edit it in place; × deletes it (asks once). Private: only the owner sees them.
 */
export function MyTodos() {
  const todos = useTodos()
  const [showCompleted, setShowCompleted] = useState(false)
  const [editing, setEditing] = useState(null)
  const [message, setMessage] = useState(null)
  if (!todos.available) return null
  const today = cairoTodayISO()
  const { open, doneToday, completed } = todoGroups(todos.items, today, doneDay)
  const run = async (promise) => {
    const result = await promise
    setMessage(result.ok ? null : result.error)
    return result
  }
  const row = (t) => (
    <TodoRow key={t.id} todo={t} today={today} editing={editing === t.id}
      onEdit={() => setEditing(t.id)} onCancelEdit={() => setEditing(null)}
      onSave={async (values) => { const r = await todos.update(t.id, values); if (r.ok) setEditing(null); return r }}
      onToggle={() => run(todos.setDone(t.id, !t.doneAt))} onDelete={() => run(todos.remove(t.id))} />
  )
  const groups = dueGroups(open, today)
  return (
    <Card id="todos" title={<>My to-dos {open.length > 0 && <span className="todo-count tabular">{open.length}</span>}</>}
      actions={completed.length > 0 ? (
        <button type="button" className="link-btn" onClick={() => setShowCompleted((v) => !v)}>
          {showCompleted ? 'Hide completed' : `Completed (${completed.length})`}
        </button>
      ) : null}>
      <TodoForm submitLabel="Add" onSubmit={(values) => todos.add(values)} quick />
      {message && <p className="form-field__error" role="alert">{message}</p>}
      {open.length === 0 && doneToday.length === 0 && <p className="todo-empty muted">Nothing on your list. Only you can see it.</p>}
      {groups.map((g) => (
        <section key={g.id} aria-label={g.label} className={`todo-group todo-group--${g.id}`}>
          {(groups.length > 1 || g.id === 'overdue') && (
            <h3 className="todo-group__title">{g.label} <span className="tabular">{g.items.length}</span></h3>
          )}
          <ul className="todo-list">{g.items.map(row)}</ul>
        </section>
      ))}
      {doneToday.length > 0 && (
        <section aria-label="Done today" className="todo-group">
          <h3 className="todo-group__title">Done today <span className="tabular">{doneToday.length}</span></h3>
          <ul className="todo-list">{doneToday.map(row)}</ul>
        </section>
      )}
      {showCompleted && completed.length > 0 && (
        <section aria-label="Completed" className="todo-group">
          <h3 className="todo-group__title">Completed · last 30 days <span className="tabular">{completed.length}</span></h3>
          <ul className="todo-list">{completed.map(row)}</ul>
        </section>
      )}
    </Card>
  )
}

/** One to-do: round tick · text (click to edit) · due and link underneath · × to delete (asks once). */
function TodoRow({ todo: t, today, editing, onEdit, onCancelEdit, onSave, onToggle, onDelete, showLink = true }) {
  const [confirming, setConfirming] = useState(false)
  if (editing) {
    return (
      <li className="todo todo--editing">
        <TodoForm initial={t} submitLabel="Save" onCancel={onCancelEdit} onSubmit={onSave} />
      </li>
    )
  }
  const due = dueLabel(t, today)
  const overdue = isTodoOverdue(t, today)
  return (
    <li className={`todo${t.doneAt ? ' is-done' : ''}`}>
      <input type="checkbox" className="todo__check" checked={Boolean(t.doneAt)}
        aria-label={t.doneAt ? `Mark "${t.text}" not done` : `Mark "${t.text}" done`} onChange={onToggle} />
      <span className="todo__body">
        {t.doneAt ? <span className="todo__text">{t.text}</span> : (
          <button type="button" className="todo__text todo__text--edit" onClick={onEdit} title="Click to edit">{t.text}</button>
        )}
        {(due || (showLink && t.linkKind)) && (
          <span className="todo__meta">
            {due && <span className={`todo__due tabular${overdue ? ' is-overdue' : t.dueOn === today ? ' is-today' : ''}`}>{due}</span>}
            {showLink && t.linkKind && (t.linkLabel
              ? <Link className="todo__link" to={todoLink(t)}>{t.linkLabel}</Link>
              : <span className="todo__link muted">No longer available</span>)}
          </span>
        )}
      </span>
      {confirming ? (
        <span className="todo__confirm">
          <button type="button" className="link-btn text-danger" onClick={() => { setConfirming(false); onDelete() }}>Delete</button>
          <button type="button" className="link-btn" onClick={() => setConfirming(false)}>Keep</button>
        </span>
      ) : (
        <button type="button" className="todo__delete" aria-label={`Delete "${t.text}"`} onClick={() => setConfirming(true)}>×</button>
      )}
    </li>
  )
}

/**
 * Add / edit a to-do. Quick (add): one line; Enter adds; the date shortcuts and "Link" show while typing.
 * Edit: the same fields, always shown, with Save and Cancel. presetLink: a link that is already chosen
 * (on a client, request or event page).
 */
function TodoForm({ initial = null, submitLabel, onSubmit, onCancel, quick = false, presetLink = null, placeholder }) {
  const today = cairoTodayISO()
  const startLink = initial?.linkKind ? { kind: initial.linkKind, id: initial.linkId, label: initial.linkLabel ?? initial.linkId } : presetLink
  const [text, setText] = useState(initial?.text ?? '')
  const [dueOn, setDueOn] = useState(initial?.dueOn ?? '')
  const [link, setLink] = useState(startLink)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    const input = { text, dueOn: dueOn || null, linkKind: link?.kind ?? null, linkId: link?.id ?? null }
    const local = validateTodo(input)
    if (Object.keys(local.errors).length) { setErrors(local.errors); return }
    setBusy(true)
    const result = await onSubmit(local.values)
    setBusy(false)
    if (!result.ok) { setErrors(result.errors && Object.keys(result.errors).length ? result.errors : { text: result.error }); return }
    setErrors({})
    if (quick) { setText(''); setDueOn(''); setLink(presetLink) }
  }
  const error = errors.text ?? errors.dueOn ?? errors.link
  const showOptions = !quick || text.trim() || dueOn || (link && link !== presetLink)
  const chipOn = (c) => dueOn === addDays(today, c.days)
  const otherDate = dueOn && !DUE_CHIPS.some(chipOn)
  return (
    <form className={`todo-form${quick ? ' todo-form--quick' : ''}`} onSubmit={submit} noValidate>
      <div className="todo-form__line">
        {quick && <span className="todo-form__plus" aria-hidden="true">+</span>}
        <input className="todo-form__text" value={text} maxLength={TODO_TEXT_MAX} onChange={(e) => setText(e.target.value)}
          placeholder={placeholder ?? (quick ? 'Add a to-do and press Enter' : undefined)} aria-label="To-do"
          aria-invalid={Boolean(errors.text)} autoFocus={!quick || Boolean(presetLink)} />
        {(!quick || text.trim()) && (
          <button type="submit" className={`btn btn--sm${quick ? ' btn--primary' : ''}`} disabled={busy}>{submitLabel}</button>
        )}
        {onCancel && <button type="button" className="link-btn" onClick={onCancel}>Cancel</button>}
      </div>
      {showOptions && (
        <div className="todo-form__options">
          <span className="todo-form__due" role="group" aria-label="Due">
            {DUE_CHIPS.map((c) => (
              <button key={c.id} type="button" aria-pressed={chipOn(c)} className={`chip-toggle chip-toggle--sm${chipOn(c) ? ' is-on' : ''}`}
                onClick={() => setDueOn(chipOn(c) ? '' : addDays(today, c.days))}>{c.label}</button>
            ))}
            <label className={`chip-toggle chip-toggle--sm todo-form__date${otherDate ? ' is-on' : ''}`}>
              <span>{otherDate ? formatShortDate(dueOn) : 'Pick a date'}</span>
              <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} aria-label="Due date (optional)"
                aria-invalid={Boolean(errors.dueOn)} />
            </label>
          </span>
          {!presetLink && <LinkPicker value={link} onChange={setLink} />}
        </div>
      )}
      {error && <span className="form-field__error todo-form__error" role="alert">{error}</span>}
    </form>
  )
}

/** "Link…": search the clients, requests and events this person can open (the server filters each list). */
function LinkPicker({ value, onChange }) {
  const { pages } = useCurrentUser()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [found, setFound] = useState({})
  const report = useCallback((key, items) => setFound((f) => (f[key] === items ? f : { ...f, [key]: items })), [])
  const term = q.trim()
  if (value) {
    return (
      <span className="todo-form__linked">
        <span className="todo__link">{value.label}</span>
        <button type="button" className="link-btn" onClick={() => onChange(null)} aria-label="Remove the link">×</button>
      </span>
    )
  }
  if (!open) return <button type="button" className="chip-toggle chip-toggle--sm" onClick={() => setOpen(true)}>Link to a client or proposal</button>
  const results = term ? [
    ...(found.requests ?? []), ...commandMatches(found.events ?? [], term), ...(found.clients ?? []),
  ].slice(0, PICKED) : []
  const pick = (item) => {
    const [prefix, ...rest] = item.id.split(':')
    onChange({ kind: LINK_KIND[prefix], id: rest.join(':'), label: item.label || rest.join(':') })
    setOpen(false)
    setQ('')
  }
  return (
    <span className="todo-picker popover-anchor">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Client, request or event"
        aria-label="Link to a client, request or event" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }} />
      {results.length > 0 && (
        <ul className="popover todo-picker__list" role="listbox">
          {results.map((item) => (
            <li key={item.id} role="option" aria-selected="false">
              <button type="button" className="todo-picker__item" onClick={() => pick(item)}>
                <span>{item.label}</span> <span className="muted">{LINK_KIND[item.id.split(':')[0]]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {term && pages?.proposals && <RequestSource q={term} report={report} />}
      {term && pages?.events && <EventSource report={report} />}
      {term && pages?.clients && <ClientSource q={term} report={report} />}
    </span>
  )
}

/**
 * On a client, request or event page: my open to-dos linked to it (tick, edit, delete right there) and
 * "Add a to-do for this", already linked. Only the owner's.
 */
export function LinkedTodos({ kind, id, label }) {
  const todos = useTodos()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  if (!todos.available) return null
  const today = cairoTodayISO()
  const mine = todos.items.filter((t) => !t.doneAt && t.linkKind === kind && t.linkId === id)
    .sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999'))
  const preset = { kind, id, label: label ?? id }
  return (
    <section className="todo-strip" aria-label="My to-dos for this">
      {mine.length > 0 && (
        <ul className="todo-list">
          {mine.map((t) => (
            <TodoRow key={t.id} todo={t} today={today} showLink={false} editing={editing === t.id}
              onEdit={() => setEditing(t.id)} onCancelEdit={() => setEditing(null)}
              onSave={async (values) => { const r = await todos.update(t.id, values); if (r.ok) setEditing(null); return r }}
              onToggle={() => todos.setDone(t.id, true)} onDelete={() => todos.remove(t.id)} />
          ))}
        </ul>
      )}
      {adding ? (
        <TodoForm quick presetLink={preset} submitLabel="Add" placeholder="A to-do for this (only you see it)"
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => { const r = await todos.add(values); if (r.ok) setAdding(false); return r }} />
      ) : (
        <button type="button" className="link-btn todo-strip__add" onClick={() => setAdding(true)}>+ Add a to-do for this</button>
      )}
    </section>
  )
}

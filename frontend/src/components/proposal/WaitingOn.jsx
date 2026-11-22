import { useCallback, useRef, useState } from 'react'
import useDismiss from '../../lib/useDismiss.js'
import SidePanel from '../ui/SidePanel.jsx'
import Icon from '../ui/Icon.jsx'
import RemindButton from './RemindButton.jsx'
import { Field, FormAlert, PanelButtons, successText, usePanelForm } from '../crm/formParts.jsx'
import { useCurrentUser, useLists, useLookups, useProposalRequest, useUsers, useWaitingActions } from '../../data/hooks.js'
import { OTHER, optionLabel } from '../../domain/lists.js'
import { todayISO } from '../../domain/metrics.js'
import {
  WAITING_NOTE_MAX, WAITING_TEAMS, backTo, canClearWaitingOn, canSetWaitingOn, effectiveWaiting, getTeam, teamPeople,
  teamReasons, validateWaitingOn, waitingDays, waitingLabel,
} from '../../domain/waiting.js'
import { formatShortDate } from '../../lib/format.js'

const daysText = (n) => (n === null ? null : n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`)

/** "Mariam Dimitri · since 3 days" or "Marketing — Nada · Design / creative · since 3 days · expected 25 Oct". */
export function waitingText(request, usersById, lists, now = new Date()) {
  const w = effectiveWaiting(request)
  if (!w) return null
  const parts = [waitingLabel(w, usersById)]
  const reason = w.kind === 'manual' ? optionLabel(lists, getTeam(w.team).reasons, w.reason) : null
  if (reason) parts.push(reason)
  const days = daysText(waitingDays(w, now))
  if (days) parts.push(`since ${days}`)
  if (w.kind === 'manual' && w.expectedBy) parts.push(`expected ${formatShortDate(w.expectedBy)}`)
  if (w.team === 'client' && request.followUpOn) parts.push(`follow up ${formatShortDate(request.followUpOn)}`)
  return parts.join(' · ')
}

/**
 * "Waiting on: Marketing — Nada · Design / creative · since 3 days · expected 25 Oct". The large bar
 * sits under the request's title with Change and Remind; the small one is the same words in list rows.
 * Waiting for the client's reply has its own colour, apart from waiting on people.
 */
export function WaitingBar({ request, onChange, canChange = false, small = false }) {
  const { usersById } = useLookups()
  const lists = useLists().data
  const w = effectiveWaiting(request)
  if (!w) return null
  const tone = w.team === 'client' ? 'client' : 'team'
  const text = waitingText(request, usersById, lists)
  if (small) return <span className={`waiting-tag waiting-tag--${tone}`}>{text}</span>
  return (
    <div className={`waiting-bar waiting-bar--${tone}`} role="status">
      <p className="waiting-bar__text"><strong>{w.team === 'client' ? "Waiting for the client's reply:" : 'Waiting on:'}</strong> {text}</p>
      <div className="waiting-bar__buttons">
        {canChange && <button type="button" className="btn btn--sm" onClick={onChange}>Change</button>}
        <RemindButton request={request} compact />
      </div>
    </div>
  )
}

/** Who may change it here: the server's answer when the request has one (detail), else the shared rule. */
export function waitingPermissions(request, viewer, usersById) {
  return {
    set: request.waitingPermissions?.set ?? canSetWaitingOn(request, viewer, usersById),
    clear: request.waitingPermissions?.clear ?? canClearWaitingOn(request, viewer, usersById),
  }
}

const FORM_ID = 'waiting-on-form'

/**
 * "Set waiting on": Team → Person (filtered by team; hidden for Client) → Reason (filtered by team) →
 * Expected by (optional) → Note (optional; required for "Other"). "Clear" returns it to automatic.
 * request: a loaded request (with rowVersion); or requestId to load it here (from the Proposals table).
 */
export function WaitingOnPanel({ request: given = null, requestId = null, onClose, onSaved }) {
  const loaded = useProposalRequest(given ? null : requestId)
  const request = given ?? loaded.data
  if (!request) {
    return (
      <SidePanel open title="Waiting on" onClose={onClose}>
        <p className="muted" role="status">{loaded.isLoading ? 'Loading…' : 'This request is not available.'}</p>
      </SidePanel>
    )
  }
  return <WaitingForm request={request} onClose={onClose} onSaved={onSaved} />
}

function WaitingForm({ request, onClose, onSaved }) {
  const { user, activeRole } = useCurrentUser()
  const { usersById } = useLookups()
  const users = useUsers().data
  const lists = useLists().data
  const actions = useWaitingActions(request)
  const viewer = { userId: user.id, activeRole }
  const can = waitingPermissions(request, viewer, usersById)
  const w = request.waiting ?? {}
  const form = usePanelForm({
    team: w.team ?? '', userId: w.userId ?? '', reason: w.reason ?? '', expectedBy: w.expectedBy ?? '', note: w.note ?? '',
  })
  const { values, setValues, set, errors, failure, busy, submit, fieldProps } = form
  const [clearing, setClearing] = useState(false)
  const team = getTeam(values.team)
  const people = team ? teamPeople(team.id, users) : []
  const reasons = team ? teamReasons(lists, team.id) : []

  const pickTeam = (e) => {
    const id = e.target.value
    const only = teamPeople(id, users)
    setValues((prev) => ({ ...prev, team: id, reason: '', userId: only.length === 1 && id !== 'client' ? only[0].id : '' }))
  }
  const onSubmit = (e) => {
    e.preventDefault()
    const { errors: local } = validateWaitingOn(values, { lists, usersById, today: todayISO() })
    submit(local, () => actions.set(values), (result) => onSaved(result, successText(result)))
  }
  const clear = async () => {
    setClearing(true)
    const result = await actions.clear()
    setClearing(false)
    if (result.ok) onSaved(result, successText(result))
  }

  return (
    <SidePanel
      open
      title="Waiting on"
      subtitle={`${request.id} · now: ${waitingText(request, usersById, lists) ?? '—'}`}
      onClose={onClose}
      busy={busy || clearing}
      footer={can.set.allowed
        ? <PanelButtons formId={FORM_ID} busy={busy} onCancel={onClose} submitLabel="Save" />
        : <button type="button" className="btn" onClick={onClose}>Close</button>}
    >
      <form id={FORM_ID} className="stack-form" onSubmit={onSubmit} noValidate>
        <FormAlert failure={failure} />
        {!can.set.allowed && <p className="muted">{can.set.reason}</p>}
        {can.set.allowed && (
          <>
            <Field id="wo-team" label="Waiting on" required error={errors.team}>
              <select {...fieldProps('wo-team', 'team')} value={values.team} onChange={pickTeam}>
                <option value="">Choose…</option>
                {WAITING_TEAMS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
            {team && team.id !== 'client' && (
              <Field id="wo-person" label="Person" required={team.id === 'bd' || team.id === 'am'} error={errors.userId}
                hint={team.id === 'bd' || team.id === 'am' ? null : 'Optional: leave empty for anyone in the team.'}>
                <select {...fieldProps('wo-person', 'userId')} value={values.userId} onChange={set('userId')}>
                  <option value="">{team.id === 'bd' || team.id === 'am' ? 'Choose…' : `Anyone in ${team.label}`}</option>
                  {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
            )}
            {team && (
              <Field id="wo-reason" label="Reason" required error={errors.reason}>
                <select {...fieldProps('wo-reason', 'reason')} value={values.reason} onChange={set('reason')}>
                  <option value="">Choose…</option>
                  {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                </select>
              </Field>
            )}
            {team && (
              <Field id="wo-expected" label="Expected by (optional)" error={errors.expectedBy}>
                <input type="date" min={todayISO()} {...fieldProps('wo-expected', 'expectedBy')} value={values.expectedBy}
                  onChange={set('expectedBy')} />
              </Field>
            )}
            {team && (
              <Field id="wo-note" label={values.reason === 'other' ? 'Note' : 'Note (optional)'} required={values.reason === 'other'}
                error={errors.note}>
                <textarea rows={2} maxLength={WAITING_NOTE_MAX} {...fieldProps('wo-note', 'note')} value={values.note}
                  onChange={set('note')} />
              </Field>
            )}
          </>
        )}
        {request.waiting?.team && can.clear.allowed && (
          <div className="waiting-clear">
            <button type="button" className="btn" onClick={clear} disabled={clearing} aria-busy={clearing}>
              {can.set.allowed ? 'Clear: back to automatic' : `Done — back to ${backTo(request) ?? 'the team'}`}
            </button>
            <span className="form-field__hint">It then follows the status again.</span>
          </div>
        )}
      </form>
    </SidePanel>
  )
}

/** Who a quick choice waits on: this proposal's BD owner or AM for those teams; anyone in the team otherwise. */
function defaultPerson(request, teamId) {
  if (teamId === 'bd') return request.bdOwner ?? ''
  if (teamId === 'am') return request.assignedAM ?? ''
  return ''
}

const QUICK_ORDER = ['client', 'bd', 'am', 'marketing', 'operations', 'management']

/**
 * "Waiting on" in one click: the name itself opens a short menu of who + why. Picking a reason saves it
 * straight away (the BD owner / AM of this proposal for those teams, anyone in the team otherwise).
 * "Other, a date or a note…" opens the full form. Rules and validation are the same as the full form.
 * children: what the trigger shows (who it waits on now). variant 'button': a "Waiting on" button instead
 * (next to the main action); hidden for people who may not change it.
 */
export function WaitingQuickMenu({ request, onSaved, onMore, children, variant = 'name' }) {
  const { user, activeRole } = useCurrentUser()
  const { usersById } = useLookups()
  const lists = useLists().data
  const actions = useWaitingActions(request)
  const can = waitingPermissions(request, { userId: user.id, activeRole }, usersById)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const ref = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)

  const manual = request.waiting?.team ? request.waiting : null
  const canSet = can.set.allowed
  const canClear = Boolean(manual) && can.clear.allowed
  if (!canSet && !canClear) return variant === 'button' ? null : children

  const run = async (call) => {
    setBusy(true)
    setError(null)
    const result = await call()
    setBusy(false)
    if (result?.ok) { setOpen(false); onSaved?.(result, successText(result)) } else setError(result?.error ?? 'It could not be saved.')
  }
  const pick = (teamId, reason) => {
    const values = { team: teamId, userId: defaultPerson(request, teamId), reason, expectedBy: '', note: '' }
    const { errors } = validateWaitingOn(values, { lists, usersById, today: todayISO() })
    if (Object.keys(errors).length) { setOpen(false); onMore?.(); return } // needs more than one click: the full form
    run(() => actions.set(values))
  }
  const teams = QUICK_ORDER.map(getTeam).filter(Boolean)

  return (
    <div className="popover-anchor wait-quick" ref={ref}>
      <button type="button" className={variant === 'button' ? 'btn' : 'wait-quick__trigger'} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} disabled={busy} aria-busy={busy}>
        {variant === 'button' ? (busy ? 'Saving…' : 'Waiting on') : children}
        <Icon name="chevronDown" size={14} className="wait-quick__caret" />
      </button>
      {open && (
        <div className="popover popover--start more-menu wait-quick__menu" role="menu" aria-label="Waiting on">
          {canSet && teams.map((t) => {
            const reasons = teamReasons(lists, t.id).filter((r) => r.code !== OTHER)
            if (!reasons.length) return null
            const who = t.id === 'bd' || t.id === 'am' ? usersById[defaultPerson(request, t.id)]?.name : null
            return (
              <div key={t.id} role="group" aria-label={t.label} className="wait-quick__group">
                <div className="wait-quick__team">{t.id === 'client' ? 'The client' : t.label}{who ? ` · ${who}` : ''}</div>
                {reasons.map((r) => {
                  const current = manual?.team === t.id && manual?.reason === r.code
                  return (
                    <button key={r.code} type="button" role="menuitemradio" aria-checked={current}
                      className={`more-menu__item${current ? ' is-current' : ''}`} onClick={() => pick(t.id, r.code)}>
                      {r.label}{current ? ' ✓' : ''}
                    </button>
                  )
                })}
              </div>
            )
          })}
          <div className="wait-quick__foot">
            {canSet && (
              <button type="button" role="menuitem" className="more-menu__item" onClick={() => { setOpen(false); onMore?.() }}>
                Other, a date or a note…
              </button>
            )}
            {canClear && (
              <button type="button" role="menuitem" className="more-menu__item" onClick={() => run(() => actions.clear())}>
                {canSet ? 'Back to automatic' : `Done — back to ${backTo(request) ?? 'the team'}`}
              </button>
            )}
          </div>
          {error && <p className="form-field__error wait-quick__error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import PageLayout from '../components/layout/PageLayout.jsx'
import Card from '../components/ui/Card.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import Icon from '../components/ui/Icon.jsx'
import RelTime from '../components/ui/RelTime.jsx'
import SegmentedControl from '../components/ui/SegmentedControl.jsx'
import StatusBadge from '../components/ui/StatusBadge.jsx'
import { Person } from '../components/dashboard/cells.jsx'
import ClientPicker from '../components/crm/ClientPicker.jsx'
import { useConfig, useCurrentUser, useLastClientRequest, useLists, useLookups, useOccasions, useProposalRequest, useRequestForm } from '../data/hooks.js'
import { visibleOptions } from '../domain/lists.js'
import { API_MODE } from '../data/source.js'
import { BRANDS, getBrand, serviceLabel } from '../domain/brands.js'
import { ROLE } from '../domain/roles.js'
import { getStatus } from '../domain/status.js'
import { isActiveOpportunity, todayISO } from '../domain/metrics.js'
import { resolveAssignedAM } from '../domain/routing.js'
import { EVENT_DATE_PRECISION, EVENT_NAME_MAX, canEditDraft, findPossibleDuplicates, requestFields } from '../domain/workflow.js'
import { formatCurrency } from '../lib/format.js'
import { plusDays, prefillFrom } from '../domain/radar.js'
import { occasionFor, suggestedDeadline, tagsFromBrief } from '../domain/smartDefaults.js'
import { cairoTodayISO } from '../domain/events.js'
import { formatShortDate } from '../lib/format.js'
import { editDraftLink, proposalLink } from '../lib/links.js'

const EMPTY = {
  clientId: '', eventName: '', brand: '', service: '', opportunityId: '', eventDatePrecision: EVENT_DATE_PRECISION.DAY,
  eventDate: '', eventEndDate: '', requiredBy: '', briefTags: [], participants: '', requirementsSummary: '', specificRequirements: '',
  occasionId: '', fromRadar: false,
}

/**
 * A new request started from a client or an opportunity (?client=… / ?opportunity=…), or from a previous
 * request ("Create request from previous" on the radar: ?from=PR-…&radar=1, dates left empty): only
 * choices the form offers this person anyway are taken; anything else starts empty.
 */
function prefill(search, clients, opportunities, requests = []) {
  const params = new URLSearchParams(search)
  const previous = requests.find((r) => r.id === params.get('from'))
  if (previous && clients.some((c) => c.id === previous.clientId)) {
    const f = prefillFrom(previous)
    return { ...EMPTY, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Array.isArray(v) ? v : v === null || v === undefined ? '' : String(v)])),
      fromRadar: params.get('radar') === '1' }
  }
  const opp = opportunities.find((o) => o.id === params.get('opportunity') && isActiveOpportunity(o))
  const clientId = opp?.clientId ?? params.get('client')
  if (!clients.some((c) => c.id === clientId)) return EMPTY
  if (!opp) return { ...EMPTY, clientId }
  return { ...EMPTY, clientId, brand: opp.brand, service: opp.service, opportunityId: opp.id, eventName: opp.eventName ?? '' }
}

/** Form values are always strings for the inputs; the workflow normalises them. */
function toFormValues(request) {
  const f = { ...requestFields(request), occasionId: request.occasionId ?? null }
  return Object.fromEntries(Object.entries({ ...EMPTY, ...f })
    .map(([k, v]) => [k, Array.isArray(v) ? v : v === null || v === undefined ? '' : String(v)]))
}

function Field({ id, label, required, hint, error, children }) {
  return (
    <div className="form-field">
      <label className="form-field__label" htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && <span className="form-field__hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="form-field__error" id={`${id}-error`} role="alert">{error}</span>}
    </div>
  )
}

function Blocked({ title, children }) {
  return (
    <PageLayout title="New proposal">
      <Card>
        <EmptyState icon="lock" title={title} meta={<Link to="/" className="btn">Back to dashboard</Link>}>
          {children}
        </EmptyState>
      </Card>
    </PageLayout>
  )
}

/**
 * New Proposal Request (/proposals/new) and Edit draft (/proposals/:id/edit).
 * All rules (validation, ownership, routing, submission) come from domain/workflow.js;
 * this page only collects input and calls the store's single save path.
 */
export default function ProposalRequestFormPage() {
  const { id: draftId } = useParams()
  const form = useRequestForm()
  const { data: draft, isLoading: draftLoading, reload: reloadDraft } = useProposalRequest(draftId)
  // "Create request from previous" (radar): the previous request is read on its own, so it prefills in API mode too.
  const { search } = useLocation()
  const fromId = draftId ? null : new URLSearchParams(search).get('from')
  const previous = useProposalRequest(fromId || undefined)

  // ---- access ----
  if (!form.access.allowed) {
    return <Blocked title="You can't create proposal requests">{form.access.reason}</Blocked>
  }
  if ((draftId && draftLoading && !draft) || form.isLoading || (fromId && previous.isLoading && !previous.data)) {
    return <PageLayout title={draftId ? `Edit draft ${draftId}` : 'New proposal'}><Card><p className="muted" role="status">Loading…</p></Card></PageLayout>
  }
  // API mode: the server says whether this viewer may edit the draft (canEditDraft); demo mode: the rules.
  const editable = draft && (draft.canEditDraft ?? canEditDraft(draft, form.viewer, form.usersById))
  if (draftId && !editable) {
    return (
      <Blocked title="Draft not available to edit">
        &ldquo;{draftId}&rdquo; can't be edited by you. Only a draft's creator can edit it, and only while it is still a
        draft. {draft && <Link to={proposalLink(draft.id)}>Open the request</Link>}
      </Blocked>
    )
  }
  return <RequestForm key={draftId ?? 'new'} draftId={draftId} draft={draft} form={form} reloadDraft={reloadDraft} previous={previous.data} />
}

/** Quick picks for the proposal deadline: from today (Cairo), never on or after the event day. */
const DEADLINE_PICKS = [{ days: 2, label: 'In 2 days' }, { days: 3, label: 'In 3 days' }, { days: 7, label: 'In a week' }, { days: 14, label: 'In 2 weeks' }]

function RequestForm({ draftId, draft, form, reloadDraft, previous = null }) {
  const { routing } = useConfig().data
  const navigate = useNavigate()
  const location = useLocation()
  const { viewer, clients, opportunities, allRequests, usersById, save } = form
  const { createClients } = useCurrentUser()
  const { clientsById } = useLookups()
  const briefTags = visibleOptions(useLists().data, 'briefTags')
  const toggleTag = (code) => {
    setManual((m) => ({ ...m, briefTags: true }))
    setValues((prev) => ({
      ...prev, briefTags: prev.briefTags.includes(code) ? prev.briefTags.filter((c) => c !== code) : [...prev.briefTags, code],
    }))
  }
  const allClients = useMemo(() => Object.values(clientsById).filter((c) => !c.archivedAt), [clientsById])
  const isHead = viewer.activeRole === ROLE.COMMERCIAL_HEAD

  const [values, setValues] = useState(() => (draft ? toFormValues(draft)
    : prefill(location.search, clients, opportunities, previous ? [previous, ...allRequests] : allRequests)))
  const [showEndDate, setShowEndDate] = useState(() => Boolean(draft?.eventEndDate))
  // Fields the person set by hand: a smart default never overwrites them (a saved draft counts as set).
  const [manual, setManual] = useState(() => (draft ? { requiredBy: true, occasionId: true, briefTags: true } : {}))
  const markManual = (field) => setManual((m) => (m[field] ? m : { ...m, [field]: true }))
  // An unsent new request is kept on this computer while typing; reopening the form offers it back.
  const storeKey = `iee.newRequest.${viewer.userId}`
  const prefilled = /[?&](client|opportunity|from)=/.test(location.search)
  const [saved, setSaved] = useState(() => {
    if (draft || prefilled) return null
    try { return JSON.parse(window.localStorage.getItem(storeKey) ?? 'null') } catch { return null }
  })
  const occasions = useOccasions().items
  const [errors, setErrors] = useState({})
  const [newClient, setNewClient] = useState(null) // "+ Add '<name>' as a new client": created with the request
  const [error, setError] = useState(null)
  const [stale, setStale] = useState(false) // 409: the draft changed elsewhere; typed values are kept
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false) // guards double clicks before React re-renders

  const client = clients.find((c) => c.id === values.clientId) ?? null
  const brand = values.brand ? getBrand(values.brand) : null
  const openOpps = useMemo(
    () => opportunities.filter((o) => o.clientId === values.clientId && o.brand === values.brand && isActiveOpportunity(o)),
    [opportunities, values.clientId, values.brand],
  )
  const duplicates = findPossibleDuplicates(values, allRequests, draftId ?? null)
  const am = brand ? usersById[resolveAssignedAM(brand.id, routing)] : null // the live routing (Settings)

  // Smart defaults: the client's last request fills brand and service (while the person has not chosen
  // them), and offers its participants in one click. Everything stays editable.
  const last = useLastClientRequest(client, draftId ?? null).data
  const [autoFill, setAutoFill] = useState(null) // { clientId, requestId, brand, service }
  useEffect(() => {
    if (!last || last.clientId !== values.clientId) return
    const untouched = !values.brand || (autoFill && values.brand === autoFill.brand && values.service === autoFill.service)
    if (!untouched) return
    setValues((prev) => ({ ...prev, brand: last.brand, service: last.service, opportunityId: prev.brand === last.brand ? prev.opportunityId : '' }))
    setAutoFill({ clientId: last.clientId, requestId: last.id, brand: last.brand, service: last.service })
    // Runs when the client (or what we know about its last request) changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id, values.clientId])
  const filledFromLast = autoFill && autoFill.clientId === values.clientId && values.brand === autoFill.brand && values.service === autoFill.service
  const lastParticipants = last && last.clientId === values.clientId ? (last.confirmedParticipants ?? last.participants ?? null) : null
  const today = cairoTodayISO()
  const eventStart = values.eventDatePrecision === 'day' ? values.eventDate
    : values.eventDatePrecision === 'month' && values.eventDate ? `${values.eventDate}-01` : ''
  const deadlinePicks = DEADLINE_PICKS.map((p) => ({ ...p, date: plusDays(today, p.days) }))
    .filter((p) => !eventStart || p.date < eventStart)

  const set = (field) => (e) => {
    const value = e.target.value
    if (['requiredBy', 'occasionId'].includes(field)) markManual(field)
    setValues((prev) => {
      const next = { ...prev, [field]: value }
      // Keep dependent choices consistent: service follows brand; opportunity follows client + brand.
      if (field === 'brand' && prev.brand !== value) { next.service = ''; next.opportunityId = '' }
      if (field === 'clientId' && prev.clientId !== value) next.opportunityId = ''
      if (field === 'eventDatePrecision' && prev.eventDatePrecision !== value) { next.eventDate = ''; next.eventEndDate = '' }
      // The event date suggests the proposal deadline (a week out, before the event) and the occasion
      // (from Settings → Occasions), until the person sets either by hand.
      if (field === 'eventDate' || field === 'eventDatePrecision') {
        const start = next.eventDatePrecision === 'day' ? next.eventDate
          : next.eventDatePrecision === 'month' && next.eventDate ? `${next.eventDate}-01` : ''
        if (!manual.requiredBy) next.requiredBy = suggestedDeadline(start, today)
        if (!manual.occasionId && next.eventDatePrecision === 'day') {
          const found = occasionFor(next.eventDate, occasions)
          next.occasionId = found ? String(found.id) : ''
        }
      }
      return next
    })
    setErrors((prev) => ({ ...prev, [field]: undefined, ...(field === 'eventDate' ? { requiredBy: undefined } : {}) }))
  }
  // Tags named in the brief are ticked when the brief is left (until the person ticks tags themselves).
  const tagsFromText = () => {
    if (manual.briefTags) return
    const found = tagsFromBrief(values.requirementsSummary, briefTags)
    if (found.length) setValues((prev) => ({ ...prev, briefTags: [...new Set([...prev.briefTags, ...found])] }))
  }
  // "Use last brief": the client's previous brief, requirements and tags, to edit rather than retype.
  const lastBrief = last && last.clientId === values.clientId && last.requirementsSummary ? last : null
  const useLastBrief = () => setValues((prev) => ({
    ...prev,
    requirementsSummary: lastBrief.requirementsSummary ?? prev.requirementsSummary,
    specificRequirements: prev.specificRequirements || lastBrief.specificRequirements || '',
    briefTags: prev.briefTags.length ? prev.briefTags : [...(lastBrief.briefTags ?? [])],
  }))

  // Keep the unsent new request on this computer while typing (never for a saved draft).
  useEffect(() => {
    if (draftId || saved) return undefined
    const t = setTimeout(() => {
      try {
        const empty = !values.clientId && !newClient && !values.requirementsSummary && !values.eventDate
        if (empty) window.localStorage.removeItem(storeKey)
        else window.localStorage.setItem(storeKey, JSON.stringify({ values, newClient, at: new Date().toISOString() }))
      } catch { /* not kept */ }
    }, 600)
    return () => clearTimeout(t)
  }, [values, newClient, draftId, saved, storeKey])
  const forgetSaved = () => {
    try { window.localStorage.removeItem(storeKey) } catch { /* nothing kept */ }
  }

  async function run(submit) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    let result
    try {
      result = await save({ ...values, newClient }, { draftId: draftId ?? null, submit, rowVersion: draft?.rowVersion })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
    if (!result.ok) {
      // Keep everything the user typed; show what to fix.
      setErrors(result.errors ?? {})
      setError(result.error)
      setStale(Boolean(result.stale))
      return
    }
    // Saved (demo store updated, or the server answered 2xx) before we get here.
    forgetSaved()
    const flash = [result.message, ...(result.warnings ?? []).map((w) => w.message)].join(' ')
    if (submit) navigate(proposalLink(result.request.id), { state: { flash } })
    else navigate(editDraftLink(result.request.id), { replace: true, state: { flash } })
  }

  const flash = location.state?.flash
  const ownerUser = client ? usersById[client.owner]
    : newClient ? usersById[isHead ? newClient.owner : viewer.userId] ?? null : null
  const fieldProps = (name) => ({
    id: `f-${name}`,
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': [errors[name] && `f-${name}-error`, `f-${name}-hint`].filter(Boolean).join(' '),
  })

  return (
    <PageLayout
      title={draftId ? `Edit draft ${draftId}` : 'New proposal'}
      subtitle={draftId ? 'Only you can see this draft until it is submitted.' : 'Ask the Account Manager for a proposal. Save as a draft or submit now.'}
      actions={draftId ? <StatusBadge kind="proposal" status={draft.status} version={draft.version} /> : null}
    >
      {!API_MODE && (
        <div className="notice" role="note">
          <Icon name="info" size={16} strokeWidth={2} />
          <p>
            <strong>Demo:</strong> requests are kept in memory only and reset when the page is reloaded.
          </p>
        </div>
      )}

      {flash && (
        <div className="action-feedback action-feedback--success" role="status">
          <Icon name="checkmark" size={16} strokeWidth={2.25} />
          <span>{flash}</span>
        </div>
      )}
      {saved && (
        <div className="details-banner restore-banner" role="status">
          <span>You started a request <RelTime value={saved.at} /> and did not send it.</span>
          <span className="restore-banner__buttons">
            <button type="button" className="btn btn--sm btn--primary" onClick={() => {
              setValues({ ...EMPTY, ...saved.values })
              setNewClient(saved.newClient ?? null)
              if (saved.values?.eventEndDate) setShowEndDate(true)
              setSaved(null)
            }}>Continue it</button>
            <button type="button" className="btn btn--sm" onClick={() => { forgetSaved(); setSaved(null) }}>Start fresh</button>
          </span>
        </div>
      )}

      <form className="request-form" onSubmit={(e) => { e.preventDefault(); run(true) }} noValidate>
        <div className="dash-grid detail-grid request-form__grid">
          <div className="span-8 detail-col">
            <Card title="Client & service">
              <div className="form-grid">
                <Field id="f-clientId" label="Client" required error={errors.clientId}
                  hint={ownerUser
                    ? `BD owner: ${ownerUser.name} (the client's relationship owner)${viewer.userId !== ownerUser.id ? '. You are creating this on their behalf.' : '.'}`
                    : isHead ? 'Type to search all clients.' : 'Type to search the clients you own.'}>
                  <ClientPicker
                    id="f-clientId"
                    clients={clients}
                    allClients={allClients}
                    value={values.clientId}
                    onChoose={(cid) => set('clientId')({ target: { value: cid } })}
                    newClient={newClient}
                    onNewClient={setNewClient}
                    canAdd={createClients.allowed}
                    isHead={isHead}
                    usersById={usersById}
                    brandName={brand?.name}
                    errors={errors}
                    describedBy={fieldProps('clientId')['aria-describedby']}
                    selfId={viewer.userId}
                  />
                </Field>

                <Field id="f-brand" label="Brand" required error={errors.brand}
                  hint={filledFromLast ? `As in ${client?.name ?? 'this client'}'s last request (${autoFill.requestId}). Change it if needed.` : null}>
                  <SegmentedControl
                    label="Brand"
                    options={BRANDS.map((b) => ({ value: b.id, label: b.name }))}
                    value={values.brand}
                    onChange={(v) => set('brand')({ target: { value: v } })}
                  />
                </Field>

                <Field id="f-service" label="Service" required error={errors.service}
                  hint={brand ? `${brand.name} services` : 'Choose a brand first.'}>
                  <select {...fieldProps('service')} value={values.service} onChange={set('service')} disabled={!brand}>
                    <option value="">Choose a service…</option>
                    {brand?.services.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </Field>

                {(openOpps.length > 0 || values.opportunityId) && (
                <Field id="f-opportunityId" label="Linked opportunity (optional)" error={errors.opportunityId}
                  hint={`Open ${brand?.name ?? ''} opportunities for ${client?.name ?? 'this client'}.`}>
                  <select {...fieldProps('opportunityId')} value={values.opportunityId} onChange={set('opportunityId')}
                    disabled={!client || !brand}>
                    <option value="">None</option>
                    {openOpps.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.id} · {serviceLabel(o.brand, o.service)} · {getStatus('opportunity', o.stage).label} · est. {formatCurrency(o.estimatedValue)}
                      </option>
                    ))}
                  </select>
                </Field>
                )}
              </div>
            </Card>

            <Card title="Event & proposal deadline" subtitle="The event date is when the event happens. The proposal deadline is when the AM must send the proposal to BD.">
              <div className="form-grid">
                <Field id="f-eventDate" label="Event date" error={errors.eventDate}
                  hint={values.eventDatePrecision === 'month' ? 'Month and year only; the exact day is not known yet.'
                    : values.eventDatePrecision === 'unset' ? 'The client has not chosen a date yet.' : 'The day the event starts.'}>
                  <SegmentedControl
                    label="Event date precision"
                    options={[{ value: 'day', label: 'Exact date' }, { value: 'month', label: 'Month only' }, { value: 'unset', label: 'Not set yet' }]}
                    value={values.eventDatePrecision}
                    onChange={(v) => set('eventDatePrecision')({ target: { value: v } })}
                  />
                  {values.eventDatePrecision === 'month' && (
                    <input type="month" placeholder="YYYY-MM" min={todayISO().slice(0, 7)} {...fieldProps('eventDate')}
                      value={values.eventDate} onChange={set('eventDate')} />
                  )}
                  {values.eventDatePrecision === 'day' && (
                    <input type="date" min={todayISO()} {...fieldProps('eventDate')} value={values.eventDate} onChange={set('eventDate')} />
                  )}
                </Field>

                {values.eventDatePrecision === 'day' && (showEndDate || values.eventEndDate || errors.eventEndDate) ? (
                  <Field id="f-eventEndDate" label="End date (optional)" error={errors.eventEndDate}
                    hint="Only for events over more than one day.">
                    <input type="date" min={values.eventDate || todayISO()} {...fieldProps('eventEndDate')}
                      value={values.eventEndDate} onChange={set('eventEndDate')} />
                  </Field>
                ) : values.eventDatePrecision === 'day' ? (
                  <div className="form-field form-field--aside">
                    <button type="button" className="link-btn" onClick={() => setShowEndDate(true)}>+ Several days? Add an end date</button>
                  </div>
                ) : <div className="form-field form-field--aside" />}

                <Field id="f-requiredBy" label="Proposal deadline" error={errors.requiredBy}
                  hint={!manual.requiredBy && values.requiredBy
                    ? 'Set to a week from today (before the event); change it if needed.'
                    : 'When the AM must send the proposal to BD. Today or later, and before the event.'}>
                  <input type="date" min={todayISO()} {...fieldProps('requiredBy')} value={values.requiredBy} onChange={set('requiredBy')} />
                  {deadlinePicks.length > 0 && (
                    <span className="quick-picks" role="group" aria-label="Quick deadline">
                      {deadlinePicks.map((p) => (
                        <button key={p.days} type="button" className={`quick-pick${values.requiredBy === p.date ? ' is-on' : ''}`}
                          title={formatShortDate(p.date)} onClick={() => set('requiredBy')({ target: { value: p.date } })}>{p.label}</button>
                      ))}
                    </span>
                  )}
                </Field>

                <Field id="f-participants" label="Expected participants" error={errors.participants} hint="Whole number.">
                  <input type="number" inputMode="numeric" min="1" step="1" {...fieldProps('participants')}
                    value={values.participants} onChange={set('participants')} />
                  {lastParticipants > 0 && String(lastParticipants) !== String(values.participants) && (
                    <span className="quick-picks">
                      <button type="button" className="quick-pick" onClick={() => set('participants')({ target: { value: String(lastParticipants) } })}>
                        Same as last time: {lastParticipants}
                      </button>
                    </span>
                  )}
                </Field>

                <Field id="f-eventName" label="Event name (optional)" error={errors.eventName}
                  hint="Shown next to the client in lists.">
                  <input type="text" maxLength={EVENT_NAME_MAX} placeholder="e.g. Summer team day" {...fieldProps('eventName')}
                    value={values.eventName} onChange={set('eventName')} />
                </Field>
                {occasions.length > 0 && (
                  <Field id="f-occasion" label="Occasion (optional)" error={errors.occasionId} hint={!manual.occasionId && values.occasionId ? 'From the event date; change it if needed.' : 'Ramadan, Easter, Summer…: helps us call back next time.'}>
                    <select {...fieldProps('occasionId')} value={values.occasionId} onChange={set('occasionId')}>
                      <option value="">None</option>
                      {occasions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </Field>
                )}
              </div>
            </Card>

            <Card title="Requirements">
              <div className="form-stack">
                <Field id="f-requirementsSummary" label="Event brief" error={errors.requirementsSummary}
                  hint="What the client wants: format, audience, location, duration.">
                  <textarea rows={4} {...fieldProps('requirementsSummary')} value={values.requirementsSummary}
                    onChange={set('requirementsSummary')} onBlur={tagsFromText}
                    placeholder="Format, audience, location, duration…" />
                  {lastBrief && !values.requirementsSummary && (
                    <span className="quick-picks">
                      <button type="button" className="quick-pick" onClick={useLastBrief} title={lastBrief.requirementsSummary}>
                        Use the brief from {lastBrief.id}
                      </button>
                    </span>
                  )}
                </Field>
                <fieldset className="form-field reason-picker">
                  <legend className="form-field__label">Quick tags (optional)</legend>
                  <div className="reason-picker__options">
                    {briefTags.map((t) => (
                      <label key={t.code} className={`chip-toggle${values.briefTags.includes(t.code) ? ' is-on' : ''}`}>
                        <input type="checkbox" checked={values.briefTags.includes(t.code)} onChange={() => toggleTag(t.code)} />
                        {t.label}
                      </label>
                    ))}
                  </div>
                  {errors.briefTags && <span className="form-field__error" role="alert">{errors.briefTags}</span>}
                </fieldset>
                <Field id="f-specificRequirements" label="Specific requirements (optional)" error={errors.specificRequirements}
                  hint="Dietary needs, accessibility, timing constraints, etc.">
                  <textarea rows={3} {...fieldProps('specificRequirements')} value={values.specificRequirements}
                    onChange={set('specificRequirements')} />
                </Field>
              </div>
            </Card>
          </div>

          <div className="span-4 detail-col request-form__aside">

            {duplicates.length > 0 && (
              <div className="notice" role="note">
                <Icon name="alert" size={16} strokeWidth={2} />
                <div>
                  <strong>Possible duplicate.</strong> An open request already exists for this client, brand, service and
                  event date:{' '}
                  {duplicates.map((d, i) => (
                    <span key={d.id}>
                      {i > 0 && ', '}
                      <Link to={proposalLink(d.id)}>{d.id}</Link> ({getStatus('proposal', d.status).label})
                    </span>
                  ))}
                  . You can still continue.
                </div>
              </div>
            )}

            <Card title={draftId ? 'Save or submit' : 'Send to the Account Manager'}>
              <div className="form-stack">
                <div className="routing">
                  {brand && am ? (
                    <>
                      <span className="form-field__hint">Prepared by (set by the brand's routing)</span>
                      <Person user={am} suffix={`Account Manager — ${brand.name}`} />
                    </>
                  ) : (
                    <p className="muted">Choose a brand to see which Account Manager will prepare the proposal.</p>
                  )}
                </div>
                <p className="form-field__hint">
                  <strong>Submit</strong> sends it now. <strong>Save draft</strong> keeps it private to you (it needs only client, brand and service).
                </p>
                {error && (
                  <div className="form-error" role="alert">
                    {error}
                    {stale && (
                      <button type="button" className="btn btn--sm form-error__reload"
                        onClick={() => { setStale(false); setError(null); reloadDraft() }}>
                        Reload
                      </button>
                    )}
                  </div>
                )}
                <div className="form-buttons">
                  <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => run(false)}>
                    {busy ? 'Saving…' : draftId ? 'Save draft changes' : 'Save draft'}
                  </button>
                  <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
                    {busy ? 'Saving…' : 'Submit request'}
                  </button>
                </div>
                <Link to={draftId ? proposalLink(draftId) : '/'} className="link-btn form-cancel">
                  Cancel: discard unsaved changes
                </Link>
              </div>
            </Card>
          </div>
        </div>
      </form>
    </PageLayout>
  )
}

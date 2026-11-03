import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLists } from '../../data/hooks.js'
import { visibleOptions } from '../../domain/lists.js'
import SidePanel from '../ui/SidePanel.jsx'
import SegmentedControl from '../ui/SegmentedControl.jsx'
import { Field, FormAlert, MoreDetails, successText, usePanelForm } from './formParts.jsx'
import { useClientActions, useCreateClient, useCurrentUser, useLookups, useUsers } from '../../data/hooks.js'
import { BRANDS } from '../../domain/brands.js'
import { CLIENT_TYPES } from '../../domain/catalog.js'
import { findPossibleDuplicateClients, newClientOwner, validateClientFields, validateContactFields } from '../../domain/crm.js'
import { brandsForType, guessClientType, tidyPhone } from '../../domain/smartDefaults.js'
import { ROLE } from '../../domain/roles.js'
import { canOwnClients } from '../../domain/access.js'
import { clientLink } from '../../lib/links.js'

const FORM_ID = 'client-form'
const CONTACT_FIELDS = ['name', 'title', 'phone', 'email']
const TYPE_OPTIONS = Object.entries(CLIENT_TYPES).map(([value, t]) => ({ value, label: t.label }))

/**
 * New client (client = null) or Edit details.
 *
 * New: the name first; the type is guessed from it (School, Agency, Corporate) and the brands from the
 * type (schools work with Grasshoppers, companies with Team Up), both one click to change. The main contact
 * (name, phone, email) sits right there; phones are tidied to one format. Job title, city and notes are under
 * "More details". Clients already in IEE with a similar name, phone or email show while typing, with a link.
 * People who may create requests for the client can "Add and start a proposal" in one step.
 *
 * onSaved(result, text, { propose }) gets the server's { client, message }.
 */
export default function ClientForm({ client = null, onClose, onSaved, onReload, canPropose = false }) {
  const cities = visibleOptions(useLists().data, 'cities')
  const editing = Boolean(client)
  const { user, activeRole } = useCurrentUser()
  const { usersById, clientsById } = useLookups()
  const users = useUsers().data
  const creator = useCreateClient()
  const actions = useClientActions(client)
  const chooseOwner = !editing && activeRole === ROLE.COMMERCIAL_HEAD
  const bds = users.filter(canOwnClients) // BD role or "Brings in clients" (the Head herself too)
  const [propose, setPropose] = useState(false)
  // What the person chose by hand is never overwritten by a guess.
  const [touched, setTouched] = useState({ type: editing, brands: editing })

  const form = usePanelForm({
    name: client?.name ?? '', type: client?.type ?? '', brands: client?.brands ?? [],
    city: client?.city ?? '', notes: client?.notes ?? '',
    owner: chooseOwner && bds.some((u) => u.id === user.id) ? user.id : '',
    contactName: '', contactTitle: '', contactPhone: '', contactEmail: '',
  })
  const { values, set, setValues, errors, failure, busy, submit, fieldProps } = form

  const duplicates = useMemo(() => findPossibleDuplicateClients(
    { name: values.name, contacts: [{ phone: values.contactPhone, email: values.contactEmail }] },
    Object.values(clientsById).filter((c) => !c.archivedAt), client?.id ?? null,
  ), [values.name, values.contactPhone, values.contactEmail, clientsById, client?.id])

  const guessed = !editing && !touched.type && values.type && values.type === guessClientType(values.name)
  const setName = (e) => {
    const name = e.target.value
    setValues((prev) => {
      const next = { ...prev, name }
      if (!editing && !touched.type) {
        next.type = guessClientType(name)
        if (!touched.brands) next.brands = brandsForType(next.type)
      }
      return next
    })
    form.setErrors((prev) => ({ ...prev, name: undefined }))
  }
  const setType = (type) => {
    setTouched((t) => ({ ...t, type: true }))
    setValues((prev) => ({ ...prev, type, brands: touched.brands ? prev.brands : brandsForType(type) }))
    form.setErrors((prev) => ({ ...prev, type: undefined }))
  }
  const toggleBrand = (id) => () => {
    setTouched((t) => ({ ...t, brands: true }))
    setValues((prev) => ({ ...prev, brands: prev.brands.includes(id) ? prev.brands.filter((b) => b !== id) : [...prev.brands, id] }))
    form.setErrors((prev) => ({ ...prev, brands: undefined }))
  }

  const onSubmit = (e) => {
    e.preventDefault()
    const fields = { name: values.name, type: values.type, brands: values.brands, city: values.city, notes: values.notes }
    const local = { ...validateClientFields(fields).errors }
    const contact = Object.fromEntries(CONTACT_FIELDS.map((f) => [f, values[`contact${f[0].toUpperCase()}${f.slice(1)}`]]))
    contact.phone = tidyPhone(contact.phone)
    const hasContact = !editing && CONTACT_FIELDS.some((f) => contact[f].trim())
    if (hasContact) {
      for (const [k, v] of Object.entries(validateContactFields(contact).errors)) local[`contact.${k}`] = v
    }
    if (chooseOwner) {
      const owner = newClientOwner({ userId: user.id, activeRole }, values.owner, usersById)
      if (owner.errors) Object.assign(local, owner.errors)
    }
    const body = {
      ...fields,
      ...(chooseOwner ? { owner: values.owner } : {}),
      ...(hasContact ? { contact } : {}),
    }
    submit(local, () => (editing ? actions.update(form.changedFields(fields)) : creator.create(body)),
      (result) => onSaved(result, successText(result), { propose }))
  }

  const contactField = (f) => `contact${f[0].toUpperCase()}${f.slice(1)}`
  const contactInput = (f, label, type, auto, extra = {}) => (
    <Field key={f} id={`cf-contact-${f}`} label={label} error={errors[`contact.${f}`]}>
      <input type={type} autoComplete={auto} {...fieldProps(`cf-contact-${f}`, `contact.${f}`)} {...extra}
        value={values[contactField(f)]} onChange={set(contactField(f))} />
    </Field>
  )
  // The owner a BD-created client gets is the creator; the panel says so instead of asking.
  const ownerLine = !editing && !chooseOwner ? 'You will be its relationship owner.' : null

  return (
    <SidePanel
      open
      title={editing ? 'Edit client' : 'New client'}
      subtitle={editing ? client.name : ownerLine}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {!editing && canPropose && (
            <button type="submit" form={FORM_ID} className="btn" disabled={busy} onClick={() => setPropose(true)}>
              Add and start a proposal
            </button>
          )}
          <button type="submit" form={FORM_ID} className="btn btn--primary" disabled={busy} aria-busy={busy} onClick={() => setPropose(false)}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add client'}
          </button>
        </>
      )}
    >
      <form id={FORM_ID} className="stack-form" onSubmit={onSubmit} noValidate>
        <FormAlert failure={failure} onReload={onReload} />

        <Field id="cf-name" label="Client name" required error={errors.name}>
          <input type="text" autoComplete="organization" maxLength={200} autoFocus={!editing} placeholder="e.g. Sunstone British School"
            {...fieldProps('cf-name', 'name')} value={values.name} onChange={setName} />
        </Field>
        {duplicates.length > 0 && (
          <div className="data-notice data-notice--stack" role="status">
            <strong>Already in IEE?</strong>
            {duplicates.slice(0, 3).map((d) => (
              <span key={d.id}>
                <Link to={clientLink(d.id)} target="_blank" rel="noreferrer">{d.name}</Link>
                <span className="muted"> · same {d.matches.join(' and ')} · {usersById[clientsById[d.id]?.owner]?.name ?? 'someone else'}</span>
              </span>
            ))}
            <span className="muted">You can still add it.</span>
          </div>
        )}

        <Field id="cf-type" label="Type" required error={errors.type}
          hint={guessed ? 'Guessed from the name; change it if needed.' : null}>
          <SegmentedControl label="Client type" options={TYPE_OPTIONS} value={values.type} onChange={setType} />
        </Field>

        <fieldset className="form-field reason-picker" aria-describedby={errors.brands ? 'cf-brands-error' : undefined}>
          <legend className="form-field__label">Brands <span aria-hidden="true">*</span></legend>
          <div className="reason-picker__options">
            {BRANDS.map((b) => (
              <label key={b.id} className={`chip-toggle${values.brands.includes(b.id) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={values.brands.includes(b.id)} onChange={toggleBrand(b.id)} />
                {b.name}
              </label>
            ))}
          </div>
          {!touched.brands && !editing && values.brands.length > 0 && (
            <span className="form-field__hint">Usual for a {CLIENT_TYPES[values.type]?.label.toLowerCase()}; tap to change.</span>
          )}
          {errors.brands && <span className="form-field__error" id="cf-brands-error" role="alert">{errors.brands}</span>}
        </fieldset>

        {chooseOwner && (
          <Field id="cf-owner" label="Relationship owner" required error={errors.owner}>
            <select {...fieldProps('cf-owner', 'owner')} value={values.owner} onChange={set('owner')}>
              <option value="">Choose…</option>
              {bds.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === user.id ? ' (you)' : ''}</option>)}
            </select>
          </Field>
        )}

        {!editing && (
          <fieldset className="form-field form-group">
            <legend className="form-field__label">Main contact <span className="muted">(optional)</span></legend>
            <div className="form-grid form-grid--contact">
              {contactInput('name', 'Name', 'text', 'name')}
              {contactInput('phone', 'Phone', 'tel', 'tel', {
                placeholder: '010 1234 5678',
                onBlur: (e) => set('contactPhone')({ target: { value: tidyPhone(e.target.value) } }),
              })}
              {contactInput('email', 'Email', 'email', 'email')}
            </div>
          </fieldset>
        )}

        <MoreDetails open={Boolean(errors.city || errors.notes || errors['contact.title'])}>
          {!editing && contactInput('title', "Contact's job title", 'text', 'organization-title')}
          <Field id="cf-city" label="City" error={errors.city}>
            <select {...fieldProps('cf-city', 'city')} value={values.city} onChange={set('city')}>
              <option value="">—</option>
              {/* A city typed before the list existed stays selectable as it was. */}
              {values.city && !cities.some((c) => c.code === values.city) && <option value={values.city}>{values.city}</option>}
              {cities.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </Field>
          <Field id="cf-notes" label="Notes" error={errors.notes}>
            <textarea rows={3} maxLength={2000} {...fieldProps('cf-notes', 'notes')} value={values.notes} onChange={set('notes')} />
          </Field>
        </MoreDetails>
      </form>
    </SidePanel>
  )
}

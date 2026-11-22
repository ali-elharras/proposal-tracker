import Card from '../ui/Card.jsx'
import { useCurrentUser, useLists } from '../../data/hooks.js'
import { optionLabel } from '../../domain/lists.js'
import { Link } from 'react-router-dom'
import Badge from '../ui/Badge.jsx'
import { Person } from '../dashboard/cells.jsx'
import { CLIENT_TYPES } from '../../domain/catalog.js'
import { ROLE, roleLabel } from '../../domain/roles.js'
import RelTime from '../ui/RelTime.jsx'

function Field({ label, children, hint }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>
        {children}
        {hint && <span className="field__hint">{hint}</span>}
      </dd>
    </div>
  )
}

/** Who is responsible for what. BD owner and assigned AM are always separate rows, even for one person. */
export default function RequestOverview({ request, client, usersById }) {
  const bdOwner = usersById[request.bdOwner]
  const creator = usersById[request.createdBy]
  // The BD owner when the request was created and submitted: before any transfer with its client
  // (only open requests move, so a transfer always comes after submission).
  const transfers = (request.events ?? []).filter((e) => e.event === 'bd_owner_transferred')
    .sort((a, b) => a.changedAt.localeCompare(b.changedAt))
  const originalOwner = transfers[0]?.fromUser ?? request.bdOwner
  const am = usersById[request.assignedAM]
  const samePerson = request.bdOwner === request.assignedAM
  const lists = useLists().data
  const { pages } = useCurrentUser()

  return (
    <Card title="People and dates">
      <dl className="field-list">
        <Field label="Client" hint={client ? [CLIENT_TYPES[client.type]?.label, optionLabel(lists, 'cities', client.city)].filter(Boolean).join(' · ') : null}>
          {client && pages?.clients ? <Link to={`/clients/${encodeURIComponent(client.id)}`}>{client.name}</Link> : client?.name ?? '—'}
        </Field>
        <Field label="BD owner" hint={transfers.length ? `Transferred from ${usersById[originalOwner]?.name ?? originalOwner}` : null}>
          <Person user={bdOwner} suffix={roleLabel(ROLE.BUSINESS_DEVELOPMENT)} />
        </Field>
        {request.createdBy !== originalOwner && (
          <Field label="Created by" hint="Created on behalf of the BD owner">
            <Person user={creator} suffix={creator ? roleLabel(creator.roles[0], creator) : null} />
          </Field>
        )}
        <Field label="Assigned AM">
          <Person user={am} suffix={roleLabel(ROLE.ACCOUNT_MANAGER, am)} />
        </Field>
        <Field
          label="Submitted"
          hint={
            request.imported ? 'Imported from the 2026 tracker' : request.submittedBy
              ? `by ${usersById[request.submittedBy]?.name}${request.submittedBy !== originalOwner ? ` on behalf of ${usersById[originalOwner]?.name}` : ''}`
              : null
          }
        >
          {request.submittedAt ? <RelTime value={request.submittedAt} /> : <span className="muted">Not submitted yet</span>}
        </Field>
      </dl>
      {samePerson && (
        <p className="overview__note">
          <Badge tone="info" icon="info">One person, two roles</Badge>{' '}
          {bdOwner?.name} is both the BD owner and the assigned AM for this request. The two
          responsibilities stay separate: BD steps are done as Business Development, AM steps as Account Manager.
        </p>
      )}
    </Card>
  )
}

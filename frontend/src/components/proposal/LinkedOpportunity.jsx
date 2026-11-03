import { Link } from 'react-router-dom'
import Card from '../ui/Card.jsx'
import StatusBadge from '../ui/StatusBadge.jsx'
import { Person } from '../dashboard/cells.jsx'
import { serviceLabel } from '../../domain/brands.js'
import { formatCurrency, formatEventDate } from '../../lib/format.js'
import { clientLink, opportunityLink } from '../../lib/links.js'
import { useCurrentUser } from '../../data/hooks.js'

/** The opportunity this request belongs to (nothing when there is none). Links only to pages this person may open. */
export default function LinkedOpportunity({ opportunity, client, usersById }) {
  const { pages } = useCurrentUser()
  if (!opportunity) return null
  return (
    <Card title="Linked opportunity">
      {(
        <dl className="field-list field-list--1">
          <div className="field">
            <dt>Opportunity</dt>
            <dd>
              {pages?.opportunities ? <Link to={opportunityLink(opportunity.id)}>{opportunity.id}</Link> : <span className="tabular">{opportunity.id}</span>}
              <span className="field__hint">
                {client ? (pages?.clients ? <Link to={clientLink(client.id)}>{client.name}</Link> : client.name) : null} · {serviceLabel(opportunity.brand, opportunity.service)}
              </span>
            </dd>
          </div>
          <div className="field">
            <dt>Stage</dt>
            <dd><StatusBadge kind="opportunity" status={opportunity.stage} /></dd>
          </div>
          <div className="field">
            <dt>Estimated value</dt>
            <dd>
              {formatCurrency(opportunity.estimatedValue)}
              <span className="field__hint">Sales estimate, not the AM price</span>
            </dd>
          </div>
          <div className="field">
            <dt>Owner</dt>
            <dd><Person user={usersById[opportunity.owner]} /></dd>
          </div>
          <div className="field">
            <dt>Event</dt>
            <dd>{formatEventDate(opportunity.eventDate, opportunity.eventEndDate)}</dd>
          </div>
        </dl>
      )}
    </Card>
  )
}

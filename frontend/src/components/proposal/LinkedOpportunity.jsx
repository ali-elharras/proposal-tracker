import { Link } from 'react-router-dom'
import Card from '../ui/Card.jsx'
import StatusBadge from '../ui/StatusBadge.jsx'
import { Person } from '../dashboard/cells.jsx'
import { formatCurrency, formatEventDate } from '../../lib/format.js'
import { opportunityLink } from '../../lib/links.js'
import { useCurrentUser } from '../../data/hooks.js'

/** The opportunity this request belongs to (nothing when there is none). Links only to pages this person may open. */
export default function LinkedOpportunity({ opportunity, client, usersById }) {
  const { pages } = useCurrentUser()
  if (!opportunity) return null
  return (
    <Card title="Opportunity" actions={pages?.opportunities ? <Link to={opportunityLink(opportunity.id)}>Open</Link> : null}>
      {(
        <dl className="field-list">
          <div className="field">
            <dt>Stage</dt>
            <dd><StatusBadge kind="opportunity" status={opportunity.stage} /></dd>
          </div>
          <div className="field">
            <dt>Estimated value (sales)</dt>
            <dd>
              {formatCurrency(opportunity.estimatedValue)}
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

import { Link } from 'react-router-dom'
import Card from '../ui/Card.jsx'
import EmptyState from '../ui/EmptyState.jsx'
import PageLayout from './PageLayout.jsx'
import { useCurrentUser } from '../../data/hooks.js'
import { canAccess, findNavItem } from '../../navigation.js'

const OFF_FOR_EVERYONE = ['opportunities', 'tasks']

/**
 * Shows a page (and its sub-pages) only when this person's access includes it: their role
 * and privileges (in API mode the server's /api/me "pages"). The server refuses the data too.
 */
export default function RoleGate({ path, children }) {
  const { pages } = useCurrentUser()
  const item = findNavItem(path)
  if (canAccess(item, pages)) return children
  return (
    <PageLayout title={item.label}>
      <Card>
        <EmptyState icon="lock" title="Not available to you" meta={<Link to="/" className="btn">Go to My Work</Link>}>
          {/* Opportunities and Tasks are switched off for everyone; other pages follow the person's role. */}
          {OFF_FOR_EVERYONE.includes(item.key)
            ? `${item.label} is not in use in IEE; ${item.key === 'opportunities' ? 'open opportunities are listed on each client' : 'use My to-dos on My Work'}.`
            : `${item.label} is not part of your role's access.`}
        </EmptyState>
      </Card>
    </PageLayout>
  )
}

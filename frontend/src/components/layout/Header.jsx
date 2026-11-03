import Badge from '../ui/Badge.jsx'
import Icon from '../ui/Icon.jsx'
import NotificationsMenu from './NotificationsMenu.jsx'
import RoleToggle from './RoleToggle.jsx'
import { CommandButton } from './CommandBox.jsx'
import { API_MODE } from '../../data/source.js'
import { useCurrentUser } from '../../data/hooks.js'

/** Which data is shown: nothing for the real data (the normal case), a clear tag for everything else. */
function DataTag() {
  const { dataKind } = useCurrentUser()
  if (!API_MODE) {
    return <span title="Everything shown is fictional sample data. It resets when the page reloads."><Badge tone="warning" icon="info">Demo data</Badge></span>
  }
  if (dataKind === 'demo') {
    return <span title="The server is using the demo database (fictional sample data for presentations)."><Badge tone="warning" icon="info">Demo data</Badge></span>
  }
  if (dataKind === 'test') {
    return <span title="Your own copy of the real data for testing; it is kept between starts. The real data is not changed."><Badge tone="info" icon="info">Test copy</Badge></span>
  }
  if (dataKind === 'presentation') {
    return <span title="A copy of the real data made for this presentation; the real data is not changed."><Badge tone="info" icon="info">Presentation copy</Badge></span>
  }
  return null
}

/**
 * Top bar: the menu button and page name (small screens), search (Ctrl K) front and centre, which data is
 * shown (only when it is not the real data), the BD | Account Manager switch for people with two roles,
 * and the bell. Who you are and the theme sit at the bottom of the menu.
 */
export default function Header({ title, onOpenNav }) {
  return (
    <header className="header">
      <button type="button" className="icon-btn header__menu-btn" onClick={onOpenNav} aria-label="Open navigation">
        <Icon name="menu" size={20} />
      </button>
      <div className="header__title">{title}</div>
      <div className="header__search"><CommandButton /></div>
      <div className="header__actions">
        <DataTag />
        <RoleToggle />
        <NotificationsMenu />
      </div>
    </header>
  )
}

import { NavLink, useLocation } from 'react-router-dom'
import Icon from '../ui/Icon.jsx'
import { APP_NAME } from '../../config.js'
import { NAV_GROUP_LABELS, visibleSections } from '../../navigation.js'
import { useCurrentUser, useNewCount } from '../../data/hooks.js'
import DemoUserSwitcher from './DemoUserSwitcher.jsx'
import ThemeToggle from './ThemeToggle.jsx'

/** Pages that live under another menu item (Admin: Team & Users and Settings). */
const ALSO_ACTIVE = { '/team': ['/settings'] }

function SidebarLink({ item, newCount }) {
  const { pathname } = useLocation()
  const extra = (ALSO_ACTIVE[item.path] ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`))
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      title={item.label}
      className={({ isActive }) => `sidebar__link${isActive || extra ? ' is-active' : ''}`}
    >
      <Icon name={item.icon} size={18} />
      <span className="sidebar__label">{item.label}</span>
      {item.countsNew && newCount > 0 && (
        <span className="sidebar__count" aria-label={`${newCount} new`}>{newCount > 99 ? '99+' : newCount}</span>
      )}
    </NavLink>
  )
}

/**
 * The menu: the role's pages in the role's order (MENUS in domain/access.js), with a quiet group heading
 * where the menu moves from one kind of page to the next (Work · Insights · People · Workspace).
 * At the bottom: who you are (the development identity switcher) and the theme.
 */
export default function Sidebar({ onClose }) {
  const { pages, activeRole } = useCurrentUser()
  const all = visibleSections(pages, activeRole).flatMap((s) => s.items)
  // Dashboard sits first in the menu for every role that has one, on its own above the groups. Only the
  // menu's order: the page a role opens on (MENUS' first entry) and what it may open are unchanged.
  const dashboard = all.find((i) => i.key === 'dashboard')
  const items = dashboard ? [{ ...dashboard, group: null }, ...all.filter((i) => i !== dashboard)] : all
  const newCount = useNewCount()

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar__brand">
        <span className="sidebar__logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="18" height="18"><path d="M10 9h12v3H13.5v2.5H21v3h-7.5V20H22v3H10z" fill="currentColor" /></svg>
        </span>
        <div className="sidebar__brand-text">
          <span className="sidebar__brand-name">{APP_NAME}</span>
          <span className="sidebar__brand-tag">Grasshoppers · Team Up</span>
        </div>
        <button type="button" className="sidebar__close" onClick={onClose} aria-label="Close navigation">
          <Icon name="x" size={18} />
        </button>
      </div>

      <nav className="sidebar__nav">
        {items.map((item, i) => {
          const heading = item.group && item.group !== items[i - 1]?.group && items.length > 4 ? NAV_GROUP_LABELS[item.group] : null
          return (
            <div key={item.path} className={heading && i > 0 ? 'sidebar__group-start' : undefined}>
              {heading && <div className="sidebar__section-label">{heading}</div>}
              <SidebarLink item={item} newCount={newCount} />
            </div>
          )
        })}
      </nav>

      <div className="sidebar__footer">
        <ThemeToggle withLabel />
        <DemoUserSwitcher placement="sidebar" />
      </div>
    </aside>
  )
}

import { useCallback, useRef, useState } from 'react'
import Avatar from '../ui/Avatar.jsx'
import Icon from '../ui/Icon.jsx'
import SegmentedControl from '../ui/SegmentedControl.jsx'
import useDismiss from '../../lib/useDismiss.js'
import { useCurrentUser, useUsers } from '../../data/hooks.js'
import { ROLE_CONFIG, ROLE_IDS, roleLabel } from '../../domain/roles.js'
import { API_MODE } from '../../data/source.js'

const NOT_AUTH_NOTE = API_MODE
  ? 'Development identity, not a login. Requests are sent to the backend as this person and role (development only).'
  : 'Demo switcher, not a login. It only changes whose view you are previewing.'
const LABEL = 'Development identity — not a login'

/**
 * "Development identity — not a login" picker. Chooses which team member (and, for people
 * with several roles, which active role) the app acts as: the X-Dev-User / X-Dev-Role headers
 * in API mode, the demo viewer in demo mode.
 */
export default function DemoUserSwitcher({ placement = 'header' }) {
  const { user, activeRole, activeRoleLabel, hasMultipleRoles, switchUser, switchRole } = useCurrentUser()
  const { data: users } = useUsers()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  const [q, setQ] = useState('')
  // Grouped by role (Commercial Head, Executives, BD, Account Managers, Marketing, Operations, HR, Office
  // screen); someone with two roles is listed under their first. Typing filters by name or role.
  const needle = q.trim().toLowerCase()
  const matches = users.filter((u) => !needle || u.name.toLowerCase().includes(needle)
    || u.roles.some((r) => roleLabel(r, u).toLowerCase().includes(needle)))
  const groups = ROLE_IDS.map((role) => ({
    role, label: ROLE_CONFIG[role]?.label ?? role,
    users: matches.filter((u) => u.roles[0] === role).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.users.length)

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        type="button"
        className={`viewer-trigger viewer-trigger--${placement}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={NOT_AUTH_NOTE}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar initials={user.initials} tone={user.avatarTone} />
        <span className="viewer-trigger__text">
          <span className="viewer-trigger__eyebrow">Dev identity</span>
          <span className="viewer-trigger__name">{user.name}</span>
          <span className="viewer-trigger__role">{activeRoleLabel}</span>
        </span>
        <Icon name={placement === 'sidebar' ? 'sliders' : 'chevronDown'} size={16} />
      </button>

      {open && (
        <div className={`popover viewer-menu${placement === 'sidebar' ? ' popover--up popover--start' : ''}`} role="dialog" aria-label={LABEL}>
          <div className="popover__section">
            <div className="viewer-menu__title">{LABEL}</div>
            <p className="popover__text">{NOT_AUTH_NOTE}</p>
          </div>

          {users.length > 6 && (
            <div className="viewer-menu__search">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person or role…"
                aria-label="Find a person or role" autoFocus />
            </div>
          )}
          <div className="viewer-menu__list" role="listbox" aria-label="Team members">
            {groups.map((g) => (
              <div key={g.role} role="group" aria-label={g.label}>
                <div className="viewer-menu__group">{g.label}</div>
                {g.users.map((u) => {
                  const selected = u.id === user.id
                  return (
                    <button
                      key={u.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`viewer-menu__item${selected ? ' is-selected' : ''}`}
                      onClick={() => switchUser(u.id)}
                    >
                      <Avatar initials={u.initials} tone={u.avatarTone} size="sm" />
                      <span className="viewer-menu__person">
                        <span className="viewer-menu__name">{u.name}</span>
                        <span className="viewer-menu__roles">{u.roles.map((r) => roleLabel(r, u)).join(' · ')}</span>
                      </span>
                      {selected && <Icon name="checkmark" size={16} strokeWidth={2.25} className="viewer-menu__check" />}
                    </button>
                  )
                })}
              </div>
            ))}
            {groups.length === 0 && <p className="popover__text viewer-menu__none">No one matches “{q}”.</p>}
          </div>

          {hasMultipleRoles && (
            <div className="popover__section">
              <div className="viewer-menu__label">Working as</div>
              <SegmentedControl
                label="Working as"
                options={user.roles.map((r) => ({ value: r, label: roleLabel(r, user) }))}
                value={activeRole}
                onChange={switchRole}
                stacked
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

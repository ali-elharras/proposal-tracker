import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../ui/Icon.jsx'
import useDismiss from '../../lib/useDismiss.js'
import { useNotifications } from '../../data/hooks.js'
import { formatWhen, formatWhenFull } from '../../lib/format.js'
import { groupNotifications } from '../../domain/notifications.js'

/**
 * The bell: unread count (at most "9+"), the latest 20 grouped by page; Unread / All; opening a group marks
 * all of it read and goes to it; "Mark all as read". In-app only. Hidden where the server has none (demo).
 */
export default function NotificationsMenu() {
  const { available, items, unread, read, readAll } = useNotifications()
  const [open, setOpen] = useState(false)
  const [onlyUnread, setOnlyUnread] = useState(true)
  const ref = useRef(null)
  const navigate = useNavigate()
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  if (!available) return null

  const groups = groupNotifications(items)
  const shown = onlyUnread && unread > 0 ? groups.filter((g) => g.unread > 0) : groups
  const go = async (g) => {
    setOpen(false)
    for (const n of g.items) if (!n.readAt) await read(n.id)
    if (g.latest.link) navigate(g.latest.link)
  }
  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className="icon-btn bell" aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" size={20} />
        {unread > 0 && <span className="bell__count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="popover bell__panel" role="dialog" aria-label="Notifications">
          <div className="bell__head">
            <span className="popover__title">Notifications</span>
            {unread > 0 && <button type="button" className="link-btn" onClick={() => readAll()}>Mark all as read</button>}
          </div>
          {unread > 0 && (
            <div className="bell__tabs" role="group" aria-label="Show">
              <button type="button" aria-pressed={onlyUnread} className={`bell__tab${onlyUnread ? ' is-on' : ''}`}
                onClick={() => setOnlyUnread(true)}>Unread <span className="tabular">{unread}</span></button>
              <button type="button" aria-pressed={!onlyUnread} className={`bell__tab${!onlyUnread ? ' is-on' : ''}`}
                onClick={() => setOnlyUnread(false)}>All</button>
            </div>
          )}
          {shown.length === 0 ? <p className="popover__text">Nothing new. You are all caught up.</p> : (
            <ul className="bell__list">
              {shown.map((g) => (
                <li key={g.key}>
                  <button type="button" className={`bell__item${g.unread ? ' is-unread' : ''}`} onClick={() => go(g)}>
                    <span className="bell__title">{g.latest.title}</span>
                    {g.latest.body && <span className="bell__body">{g.latest.body.split('\n').slice(0, 3).join(' · ')}</span>}
                    <span className="bell__time" title={formatWhenFull(g.latest.createdAt)}>
                      {formatWhen(g.latest.createdAt)}
                      {g.items.length > 1 && <span className="bell__more"> · +{g.items.length - 1} more {g.items.length === 2 ? 'update' : 'updates'}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

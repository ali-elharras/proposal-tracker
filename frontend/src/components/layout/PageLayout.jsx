import { Link, useLocation, useNavigate } from 'react-router-dom'
import Icon from '../ui/Icon.jsx'
import { WorkingAs } from './RoleToggle.jsx'

/**
 * Where Back goes when there is no earlier page in this tab (a link opened directly):
 * one level up, e.g. /clients/CL-0001 -> /clients, /proposals/PR-1/edit -> /proposals/PR-1, /clients -> /.
 */
export function parentPath(pathname) {
  const parts = pathname.split('/').filter(Boolean)
  return parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : '/'
}

/** Back to the previous page in the app; one level up when the page was opened directly. */
function BackButton() {
  const navigate = useNavigate()
  const location = useLocation()
  // React Router gives the first page of a tab the key "default": there is nothing in the app to go back to.
  const hasHistory = location.key !== 'default'
  return (
    <button type="button" className="back-button" aria-label="Back"
      onClick={() => (hasHistory ? navigate(-1) : navigate(parentPath(location.pathname)))}>
      <Icon name="arrowLeft" size={16} strokeWidth={2} />
    </button>
  )
}

/**
 * Standard page frame used by every screen. Pages from the menu show just their title; pages inside them
 * show where they are (crumbs, e.g. Proposals / PR-2026-0007) with a Back arrow. Then the title, an
 * optional subtitle and meta line (pills, tags), the actions on the right, and the content.
 */
export default function PageLayout({ title, subtitle, meta, actions, crumbs, children }) {
  const { pathname } = useLocation()
  const nested = pathname.split('/').filter(Boolean).length > 1
  return (
    <div className="page">
      {(nested || crumbs) && (
        <div className="page-crumbs">
          <BackButton />
          {crumbs && (
            <nav className="breadcrumb" aria-label="Breadcrumb">
              {crumbs.map((c, i) => (
                <span key={`${c.label}-${i}`} className="breadcrumb__item">
                  {i > 0 && <Icon name="chevronRight" size={14} className="breadcrumb__sep" />}
                  {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
                </span>
              ))}
            </nav>
          )}
        </div>
      )}
      <WorkingAs />
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title">{title}</h1>
          {/* Menu pages need no explanation line; pages inside them keep theirs (e.g. "School · New Cairo"). */}
          {subtitle && (nested || crumbs) && <p className="page-header__subtitle">{subtitle}</p>}
          {meta && <div className="page-header__meta">{meta}</div>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
      <div className="page__content">{children}</div>
    </div>
  )
}

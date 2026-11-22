import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import PageLayout from '../components/layout/PageLayout.jsx'
import Card from '../components/ui/Card.jsx'
import DataTable from '../components/ui/DataTable.jsx'
import Icon from '../components/ui/Icon.jsx'
import SegmentedControl from '../components/ui/SegmentedControl.jsx'
import Toast, { useRouteToast } from '../components/ui/Toast.jsx'
import { Person } from '../components/dashboard/cells.jsx'
import ClientForm from '../components/crm/ClientForm.jsx'
import { usePageDescription } from './PlaceholderPage.jsx'
import { useAllRequests, useClients, useCurrentUser, useLists, useLookups, useUsers } from '../data/hooks.js'
import { statsByClient } from '../domain/clientStats.js'
import { cairoTodayISO } from '../domain/events.js'
import { formatCurrency } from '../lib/format.js'
import RelTime from '../components/ui/RelTime.jsx'
import { findNavItem } from '../navigation.js'
import { BRANDS } from '../domain/brands.js'
import { CLIENT_TYPES } from '../domain/catalog.js'
import { ROLE } from '../domain/roles.js'
import { isClientOwnerKind } from '../domain/access.js'
import { FilterBar, FilterMenu, SearchBox } from '../components/ui/Filters.jsx'
import { optionLabel } from '../domain/lists.js'
import BrandTag from '../components/ui/BrandTag.jsx'
import { clientLink, newRequestLink } from '../lib/links.js'
import Tabs from '../components/ui/Tabs.jsx'
import RadarSection from '../components/RadarSection.jsx'
import useTab from '../lib/useTab.js'
import useRememberedFilters from '../lib/useRememberedFilters.js'

/**
 * Clients: search and filters in the URL; BD can switch between their own and all clients.
 * The one main action is "New client" (BD, who becomes the owner, or the Commercial Head).
 * Archived clients are not listed.
 */
const SKIP_KEYS = ['page', 'peek', 'past'] // never remembered: the page number and one-off panels

export default function ClientsPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, activeRole, createClients, createRequests } = useCurrentUser()
  const { usersById } = useLookups()
  const users = useUsers().data
  const lists = useLists().data
  const subtitle = usePageDescription(findNavItem('/clients'))
  const [creating, setCreating] = useState(false)
  const toast = useRouteToast() // e.g. after archiving a client
  const isBD = activeRole === ROLE.BUSINESS_DEVELOPMENT
  // "Likely to book soon": BD (their clients), Noha and the Executives (all, by BD owner).
  const radarRole = [ROLE.BUSINESS_DEVELOPMENT, ROLE.COMMERCIAL_HEAD, ROLE.EXECUTIVE].includes(activeRole)
  useRememberedFilters(`iee.filters.clients.${user.id}:${activeRole}`, SKIP_KEYS)
  const [tab, setTab] = useTab(radarRole ? ['all', 'radar'] : ['all'], 'all')

  const view = isBD && params.get('view') !== 'all' ? 'mine' : 'all'
  const filters = {
    q: params.get('q') ?? '',
    type: params.get('type') ?? '',
    brand: params.get('brand') ?? '',
    owner: view === 'mine' ? user.id : params.get('owner') ?? '',
  }
  const filtered = Boolean(filters.q || filters.type || filters.brand || (view === 'all' && filters.owner))
  const { data: clients, isLoading, error } = useClients(filters)
  // Activity per client (only for people who see proposals): open proposals, confirmed value, last activity.
  const { pages } = useCurrentUser()
  const allRequests = useAllRequests() // only what this viewer may see
  const stats = pages?.proposals && allRequests.data ? statsByClient(allRequests.data, cairoTodayISO()) : null
  const setValue = (key) => (value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const setView = (v) => {
    const next = new URLSearchParams(params)
    if (v === 'all') next.set('view', 'all')
    else { next.delete('view'); next.delete('owner') }
    setParams(next, { replace: true })
  }
  const bds = users.filter(isClientOwnerKind) // BD role or "Brings in clients"
  const newClientButton = createClients.allowed && (
    <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
      <Icon name="plus" size={16} strokeWidth={2.25} /> New client
    </button>
  )

  return (
    <PageLayout title="Clients" subtitle={subtitle} actions={newClientButton || null}>
      {radarRole && (
        <Tabs label="Clients" value={tab} onChange={setTab}
          tabs={[{ id: 'all', label: 'Clients' }, { id: 'radar', label: 'Likely to book soon' }]} />
      )}
      {tab === 'radar' ? <RadarSection /> : (
      <Card flush>
        <FilterBar
          active={[filters.q, filters.type, filters.brand, view === 'all' && filters.owner].filter(Boolean).length}
          onClear={() => {
            const next = new URLSearchParams(params)
            for (const k of ['q', 'type', 'brand', 'owner']) next.delete(k)
            setParams(next, { replace: true })
          }}
          count={error ? error.message : isLoading && !clients ? 'Loading…' : `${clients.length} ${clients.length === 1 ? 'client' : 'clients'}`}
        >
          {isBD && (
            <SegmentedControl label="Which clients" value={view} onChange={setView}
              options={[{ value: 'mine', label: 'My clients' }, { value: 'all', label: 'All clients' }]} />
          )}
          <SearchBox value={filters.q} onChange={setValue('q')} placeholder="Search clients" />
          <FilterMenu label="Type" value={filters.type} anyLabel="Any type" onChange={setValue('type')}
            options={Object.entries(CLIENT_TYPES).map(([id, t]) => ({ value: id, label: t.label }))} />
          <FilterMenu label="Brand" value={filters.brand} anyLabel="Both brands" onChange={setValue('brand')}
            options={BRANDS.map((b) => ({ value: b.id, label: b.name }))} />
          {view === 'all' && (
            <FilterMenu label="Owner" value={filters.owner} anyLabel="Anyone" onChange={setValue('owner')}
              options={bds.map((u) => ({ value: u.id, label: u.name }))} />
          )}
        </FilterBar>
        {clients && clients.length === 0 && !filtered && !isLoading ? (
          <div className="empty-line card-pad">
            <span>{view === 'mine' ? 'You have no clients yet.' : 'No clients yet.'}</span>
            {newClientButton}
          </div>
        ) : clients && (
          <DataTable
            caption="Clients"
            rows={clients}
            rowKey={(c) => c.id}
            rowHref={(c) => clientLink(c.id)}
            emptyMessage="No clients match these filters."
            columns={[
              {
                key: 'name', header: 'Client',
                render: (c) => (
                  <span className="stack">
                    <span><Link to={clientLink(c.id)}>{c.name}</Link></span>
                    <span className="muted">{CLIENT_TYPES[c.type]?.label}{c.city ? ` · ${optionLabel(lists, 'cities', c.city)}` : ''}</span>
                  </span>
                ),
              },
              { key: 'brands', header: 'Brands', render: (c) => (c.brands.length
                ? <span className="brand-list">{c.brands.map((b) => <BrandTag key={b} brand={b} />)}</span> : <span className="muted">—</span>) },
              { key: 'owner', header: 'Relationship owner', nowrap: true, render: (c) => <Person user={usersById[c.owner]} /> },
              ...(stats ? [
                {
                  key: 'activity', header: 'Proposals', nowrap: true,
                  render: (c) => {
                    const s = stats[c.id]
                    if (!s?.total) return <span className="muted">None yet</span>
                    return (
                      <span className="stack">
                        <span>{s.open ? <strong className="client-open">{s.open} open</strong> : <span className="muted">None open</span>}
                          <span className="muted"> · {s.won} won</span></span>
                        <span className="muted">{s.lastActivity ? <>Active <RelTime value={s.lastActivity} /></> : '—'}</span>
                      </span>
                    )
                  },
                },
                {
                  key: 'value', header: 'Confirmed value', align: 'end', nowrap: true,
                  render: (c) => (stats[c.id]?.confirmedValue
                    ? <span className="tabular">{formatCurrency(stats[c.id].confirmedValue)}</span> : <span className="muted">—</span>),
                },
              ] : []),
              {
                key: 'contact', header: 'Main contact',
                render: (c) => (c.contact?.name
                  ? <span className="stack"><span>{c.contact.name}</span><span className="muted">{c.contact.title}</span></span>
                  : <span className="muted">—</span>),
              },
            ]}
          />
        )}
      </Card>
      )}

      {creating && (
        <ClientForm
          onClose={() => setCreating(false)}
          canPropose={createRequests.allowed}
          onSaved={(result, text, { propose } = {}) => (propose
            ? navigate(newRequestLink({ client: result.client.id }), { state: { flash: text } })
            : navigate(clientLink(result.client.id), { state: { toast: text } }))}
        />
      )}
      <Toast message={toast.message} />
    </PageLayout>
  )
}

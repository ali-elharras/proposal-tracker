import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import PageLayout from '../components/layout/PageLayout.jsx'
import Card from '../components/ui/Card.jsx'
import DataTable from '../components/ui/DataTable.jsx'
import { FilterBar, FilterMenu, FilterToggle, SearchBox } from '../components/ui/Filters.jsx'
import { usePageDescription } from './PlaceholderPage.jsx'
import { useFacilitators, useListActions, useLists } from '../data/hooks.js'
import { findNavItem } from '../navigation.js'
import { BRANDS } from '../domain/brands.js'
import { optionLabel, visibleOptions } from '../domain/lists.js'
import { formatShortDate } from '../lib/format.js'
import { AddFacilitatorPanel } from '../components/staffing/Staffing.jsx'

const SORTS = [
  { id: 'attended', label: 'Most attended' },
  { id: 'rated', label: 'Best rated' },
  { id: 'recent', label: 'Recent' },
]

/** "★ 4.5 from 6 ratings" (or "No ratings yet"). */
export const stars = (f) => (f.average === null || f.average === undefined ? 'No ratings yet'
  : `★ ${f.average.toFixed(1)} from ${f.ratingCount} rating${f.ratingCount === 1 ? '' : 's'}`)

/**
 * Facilitators (HR): everyone we book for events. They never log in; archived, never deleted.
 * Sort by most attended (default), best rated, or recent; search by name or skill; filters in one row.
 */
export default function FacilitatorsPage() {
  const subtitle = usePageDescription(findNavItem('/facilitators'))
  const { data, error } = useFacilitators()
  const lists = useLists().data
  const [sort, setSort] = useState('attended')
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('')
  const [skill, setSkill] = useState('')
  const [status, setStatus] = useState('active')
  const [good, setGood] = useState(false)
  const [regular, setRegular] = useState(false)
  const [params] = useSearchParams()
  const [adding, setAdding] = useState(() => params.get('add') === '1') // Ctrl+K "Add facilitator"
  const items = data?.items ?? []
  const skillLabel = (c) => optionLabel(lists, 'facilitatorSkills', c)
  const needle = q.trim().toLowerCase()
  const rows = items
    .filter((f) => !needle || f.name.toLowerCase().includes(needle) || f.skills.some((s) => skillLabel(s).toLowerCase().includes(needle)))
    .filter((f) => (!brand || f.brands.includes(brand)) && (!skill || f.skills.includes(skill)) && (!status || f.status === status))
    .filter((f) => (!good || (f.average ?? 0) >= 4) && (!regular || f.eventsAttended >= 5))
    .sort((a, b) => (sort === 'rated' ? (b.average ?? 0) - (a.average ?? 0)
      : sort === 'recent' ? String(b.lastEvent ?? '').localeCompare(String(a.lastEvent ?? '')) : b.eventsAttended - a.eventsAttended)
      || a.name.localeCompare(b.name))

  return (
    <PageLayout title="Facilitators" subtitle={subtitle}
      actions={data?.canManage ? <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>+ Add facilitator</button> : null}>
      <FilterBar active={[q, brand, skill, status !== 'active' && 'status', good, regular].filter(Boolean).length}
        onClear={() => { setQ(''); setBrand(''); setSkill(''); setStatus('active'); setGood(false); setRegular(false) }}
        count={data ? `${rows.length} ${rows.length === 1 ? 'facilitator' : 'facilitators'}` : null}
        end={<FilterMenu label="Sort" icon="arrowDown" clearable={false} value={sort} onChange={(v) => setSort(v || 'attended')}
          options={SORTS.map((x) => ({ value: x.id, label: x.label }))} />}>
        <SearchBox value={q} onChange={setQ} placeholder="Name or skill" />
        <FilterMenu label="Status" value={status} anyLabel="Active and inactive" onChange={setStatus}
          options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        <FilterMenu label="Brand" value={brand} anyLabel="Both brands" onChange={setBrand}
          options={BRANDS.map((b) => ({ value: b.id, label: b.name }))} />
        <FilterMenu label="Skill" value={skill} anyLabel="Any skill" onChange={setSkill}
          options={visibleOptions(lists, 'facilitatorSkills').map((o) => ({ value: o.code, label: o.label }))} />
        {data?.seeRatings && <FilterToggle label="4★ and up" on={good} onChange={setGood} />}
        <FilterToggle label="5+ events" on={regular} onChange={setRegular} />
      </FilterBar>
      {error && <p className="form-error" role="alert">{error.message}</p>}
      <Card flush>
        <DataTable caption="Facilitators" rows={rows} rowKey={(f) => f.id} rowHref={(f) => `/facilitators/${f.id}`}
          emptyMessage={items.length ? 'No one matches.' : 'No facilitators yet.'}
          columns={[
            { key: 'name', header: 'Name', render: (f) => <Link to={`/facilitators/${f.id}`}>{f.name}</Link> },
            { key: 'events', header: 'Events attended', align: 'end', render: (f) => <span className="tabular">{f.eventsAttended}</span> },
            ...(data?.seeRatings ? [{ key: 'rating', header: 'Rating', nowrap: true, render: (f) => stars(f) }] : []),
            { key: 'last', header: 'Last event', nowrap: true, render: (f) => (f.lastEvent ? formatShortDate(f.lastEvent) : '—') },
            { key: 'skills', header: 'Skills', render: (f) => (f.skills.length ? f.skills.map(skillLabel).join(', ') : '—') },
            { key: 'status', header: 'Status', nowrap: true, render: (f) => (f.status === 'active' ? 'Active' : <span className="muted">Inactive</span>) },
          ]} />
      </Card>
      {data?.canManage && <Skills />}
      {adding && <AddFacilitatorPanel onClose={() => setAdding(false)} />}
    </PageLayout>
  )
}

/** The skills list (HR and Operations): add a skill; names are kept for every facilitator who has one. */
function Skills() {
  const lists = useLists().data
  const { change } = useListActions()
  const [label, setLabel] = useState('')
  const [message, setMessage] = useState(null)
  const add = async (e) => {
    e.preventDefault()
    const result = await change('facilitatorSkills', { action: 'add', label })
    setMessage(result.ok ? 'Skill added.' : Object.values(result.errors ?? {})[0] ?? result.error)
    if (result.ok) setLabel('')
  }
  return (
    <Card title="Skills" subtitle={visibleOptions(lists, 'facilitatorSkills').map((o) => o.label).join(' · ')}>
      <form className="inline-form" onSubmit={add}>
        <input aria-label="New skill" placeholder="New skill" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="submit" className="btn btn--sm">Add skill</button>
        {message && <span className="muted" role="status">{message}</span>}
      </form>
    </Card>
  )
}

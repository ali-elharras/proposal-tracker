import { useState } from 'react'
import Card from '../ui/Card.jsx'
import ConfirmDialog from '../ui/ConfirmDialog.jsx'
import { useOccasions } from '../../data/hooks.js'
import { formatShortDate } from '../../lib/format.js'

/**
 * Settings → Occasions: each occasion's start and end, per year (nothing is hard-coded). The radar uses the
 * next occurrence to say "Ramadan starts in about 6 weeks".
 */
export default function OccasionsEditor() {
  const occasions = useOccasions()
  const [draft, setDraft] = useState({})
  const [message, setMessage] = useState(null)
  const add = async (o) => {
    const d = draft[o.id] ?? {}
    const result = await occasions.addPeriod(o.id, { startsOn: d.startsOn ?? '', endsOn: d.endsOn ?? '' })
    setMessage(result.ok ? `${o.name}: dates saved.` : Object.values(result.errors ?? {})[0] ?? result.error)
    if (result.ok) setDraft((x) => ({ ...x, [o.id]: {} }))
  }
  const [removing, setRemoving] = useState(null) // { occasion, period }
  const remove = async () => {
    const { occasion, period } = removing
    setRemoving(null)
    const result = await occasions.removePeriod(period.id)
    setMessage(result?.ok === false ? result.error : `${occasion.name}: dates removed.`)
  }
  const set = (id, key) => (e) => setDraft((x) => ({ ...x, [id]: { ...(x[id] ?? {}), [key]: e.target.value } }))
  return (
    <Card title="Occasions" subtitle="Dates per year, used for “likely to book soon”">
      {message && <p className="muted" role="status">{message}</p>}
      <ul className="short-list short-list--actions">
        {occasions.items.map((o) => (
          <li key={o.id} className="occasion-row">
            <span className="stack"><strong>{o.name}</strong>
              <span className="muted">
                {o.periods.length ? o.periods.map((p) => (
                  <span key={p.id} className="occasion-period">{formatShortDate(p.startsOn)} – {formatShortDate(p.endsOn)}{' '}
                    <button type="button" className="link-btn" onClick={() => setRemoving({ occasion: o, period: p })} aria-label={`Remove ${o.name} ${p.startsOn}`}>remove</button></span>
                )) : 'No dates yet'}
              </span></span>
            <span className="inline-form">
              <input type="date" aria-label={`${o.name} starts`} value={draft[o.id]?.startsOn ?? ''} onChange={set(o.id, 'startsOn')} />
              <input type="date" aria-label={`${o.name} ends`} value={draft[o.id]?.endsOn ?? ''} onChange={set(o.id, 'endsOn')} />
              <button type="button" className="btn btn--sm" onClick={() => add(o)}>Add dates</button>
            </span>
          </li>
        ))}
      </ul>
      <ConfirmDialog open={Boolean(removing)} title={`Remove these ${removing?.occasion.name ?? ''} dates?`} confirmLabel="Remove" tone="danger"
        onCancel={() => setRemoving(null)} onConfirm={remove}>
        <p>{removing ? `${formatShortDate(removing.period.startsOn)} – ${formatShortDate(removing.period.endsOn)}. ` : ''}The radar stops using them.</p>
      </ConfirmDialog>
    </Card>
  )
}

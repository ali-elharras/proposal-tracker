import { useState } from 'react'
import ConfirmDialog from './ui/ConfirmDialog.jsx'

/**
 * "Delete permanently?": says exactly what goes, that it cannot be undone, and asks the person to type the
 * name to confirm (a deliberate step for something that cannot come back). onDelete() -> { ok, message, error }.
 */
export default function DeleteDialog({ open, title, name, items = [], onDelete, onDone, onCancel }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const matches = typed.trim().toLowerCase() === String(name ?? '').trim().toLowerCase()
  const confirm = async () => {
    if (!matches) { setError(`Type “${name}” to confirm.`); return }
    setBusy(true)
    setError(null)
    const result = await onDelete()
    setBusy(false)
    if (result?.ok) onDone(result)
    else setError(result?.error ?? 'It could not be deleted.')
  }
  return (
    <ConfirmDialog open={open} title={title} confirmLabel="Delete permanently" tone="danger" busy={busy}
      onConfirm={confirm} onCancel={() => { setTyped(''); setError(null); onCancel() }}>
      <p>This cannot be undone. Deleting removes, for good:</p>
      <ul className="delete-list">
        {items.filter(Boolean).map((t) => <li key={t}>{t}</li>)}
      </ul>
      <label className="form-field delete-confirm">
        <span className="form-field__label">Type <strong>{name}</strong> to confirm</span>
        <input value={typed} onChange={(e) => { setTyped(e.target.value); setError(null) }} autoComplete="off" />
      </label>
      {error && <p className="form-field__error" role="alert">{error}</p>}
    </ConfirmDialog>
  )
}

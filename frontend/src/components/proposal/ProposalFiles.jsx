import { useRef, useState } from 'react'
import Badge from '../ui/Badge.jsx'
import Card from '../ui/Card.jsx'
import { useProposalFileUpload } from '../../data/hooks.js'
import RelTime from '../ui/RelTime.jsx'

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Proposal files (API mode): the files this viewer may see, each downloadable, and, for the
 * assigned AM while the request is with the AM, a drop zone: choosing or dropping a file uploads it
 * for the version being prepared (one step). Who may upload, for which version, and what is accepted all come
 * from the server (request.upload and its error messages).
 * Minimal on purpose: the combined upload + price + Mark ready panel is Phase 4B.
 */
export default function ProposalFiles({ request, usersById }) {
  const { available, upload, download, reload } = useProposalFileUpload(request)
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState(null) // { ok, message | error, stale }
  const inputRef = useRef(null)
  const pendingRef = useRef(false)
  if (!available) return null

  const target = request.upload
  const files = request.files ?? []

  // One step: choosing (or dropping) a file uploads it.
  async function send(chosen) {
    if (!chosen || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setResult(null)
    try {
      const res = await upload(chosen)
      setResult(res)
    } finally {
      pendingRef.current = false
      setPending(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function get(f) {
    try {
      await download(f)
    } catch (err) {
      setResult({ ok: false, error: err.message })
    }
  }

  return (
    <Card title="Proposal file">
      {files.length === 0 ? (
        target?.allowed ? null : <p className="muted">No proposal file has been uploaded yet.</p>
      ) : (
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.id} className="file-list__item">
              <span className="file-list__main">
                <strong>v{f.version}</strong> {f.originalName}
                <span className="muted">
                  {' '}· {formatSize(f.sizeBytes)} · {usersById[f.uploadedBy]?.name ?? f.uploadedBy} · <RelTime value={f.uploadedAt} />
                </span>
              </span>
              {f.current ? <Badge tone="info">Current</Badge> : <Badge tone="neutral">Replaced</Badge>}
              <button type="button" className="btn btn--sm" onClick={() => get(f)}>Download</button>
            </li>
          ))}
        </ul>
      )}

      {target?.allowed && (
        <label className={`dropzone${dragging ? ' is-over' : ''}${pending ? ' is-busy' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); send(e.dataTransfer.files?.[0]) }}>
          <input ref={inputRef} id="proposal-upload" type="file" className="sr-only"
            accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            onChange={(e) => send(e.target.files?.[0])} disabled={pending} />
          <strong>{pending ? 'Uploading…' : target.replaces ? `Replace the file for version ${target.version}` : `Upload the file for version ${target.version}`}</strong>
          <span className="muted">
            Drop it here or click to choose · PDF or PowerPoint, up to 25 MB
            {target.startsWork && ' · moves it to Preparing'}
          </span>
        </label>
      )}

      {result && (
        <div className={`action-feedback ${result.ok ? 'action-feedback--success' : 'form-error'}`} role={result.ok ? 'status' : 'alert'}>
          <span>
            {result.ok ? result.message : result.errors?.file ?? result.error}
          </span>
          {result.stale && (
            <button type="button" className="btn btn--sm" onClick={() => { setResult(null); reload() }}>Reload</button>
          )}
        </div>
      )}
    </Card>
  )
}

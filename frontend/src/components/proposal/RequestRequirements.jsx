import Card from '../ui/Card.jsx'
import { useLists } from '../../data/hooks.js'
import { optionLabel } from '../../domain/lists.js'
import { DueDate } from '../dashboard/cells.jsx'
import { isDeadlinePending, isDraft } from '../../domain/metrics.js'
import { formatEventDate, formatNumber } from '../../lib/format.js'

/**
 * The event: the three numbers people look for first (size, date, proposal deadline), then the brief,
 * its tags, and the specific requirements (shown only when there are some).
 */
export default function RequestRequirements({ request }) {
  const pending = isDeadlinePending(request)
  const monthOnly = /^\d{4}-\d{2}$/.test(request.eventDate ?? '')
  const lists = useLists().data
  const tags = (request.briefTags ?? []).map((c) => optionLabel(lists, 'briefTags', c))
  return (
    <Card title="The event">
      <dl className="fact-strip">
        <div className="fact-strip__item">
          <dt>Participants</dt>
          <dd className="tabular">{request.participants ? formatNumber(request.participants) : '—'}</dd>
        </div>
        <div className="fact-strip__item">
          <dt>Event date</dt>
          <dd>
            {formatEventDate(request.eventDate, request.eventEndDate, request.eventDatePrecision)}
            {monthOnly && <span className="field__hint">Day not confirmed yet</span>}
          </dd>
        </div>
        <div className="fact-strip__item">
          <dt>Proposal due</dt>
          <dd>
            <DueDate date={request.requiredBy} active={pending} />
            {!pending && (
              <span className="field__hint">{isDraft(request) ? 'Counts once submitted' : 'No longer tracked'}</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="requirements">
        <section>
          <h3 className="section-label">Brief</h3>
          <p className="prose">{request.requirementsSummary || <span className="muted">No brief provided.</span>}</p>
          {tags.length > 0 && (
            <ul className="tag-row" aria-label="Tags">{tags.map((t) => <li key={t} className="tag">{t}</li>)}</ul>
          )}
        </section>
        {request.specificRequirements && (
          <section>
            <h3 className="section-label">Specific requirements</h3>
            <p className="prose">{request.specificRequirements}</p>
          </section>
        )}
      </div>
    </Card>
  )
}

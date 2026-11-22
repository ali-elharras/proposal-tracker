import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import MoreMenu from '../components/ui/MoreMenu.jsx'
import DeleteDialog from '../components/DeleteDialog.jsx'
import BrandTag from '../components/ui/BrandTag.jsx'
import Icon from '../components/ui/Icon.jsx'
import PageLayout from '../components/layout/PageLayout.jsx'
import Card from '../components/ui/Card.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import Badge from '../components/ui/Badge.jsx'
import RequestOverview from '../components/proposal/RequestOverview.jsx'
import RequestRequirements from '../components/proposal/RequestRequirements.jsx'
import ProposalVersions from '../components/proposal/ProposalVersions.jsx'
import ProposalFiles from '../components/proposal/ProposalFiles.jsx'
import ActivityTimeline from '../components/proposal/ActivityTimeline.jsx'
import LinkedOpportunity from '../components/proposal/LinkedOpportunity.jsx'
import ActionsPanel from '../components/proposal/ActionsPanel.jsx'
import { useCurrentUser, useDelete, useLookups, useMarkRead, useProposalRequest } from '../data/hooks.js'
import { WaitingOnPanel, WaitingQuickMenu } from '../components/proposal/WaitingOn.jsx'
import WhereNow from '../components/proposal/WhereNow.jsx'
import { Conversation, DetailsBanner, OpenCards, UpdateDetailsPanel } from '../components/proposal/RequestFlow.jsx'
import SidePanel from '../components/ui/SidePanel.jsx'
import { CorrectStatusPanel } from '../components/proposal/DataFixes.jsx'
import { canCorrectStatus } from '../domain/corrections.js'
import { canUpdateDetails } from '../domain/conversation.js'
import { ROLE } from '../domain/roles.js'
import { PROPOSAL_STATUS as PS, getStatus } from '../domain/status.js'
import Toast, { useRouteToast } from '../components/ui/Toast.jsx'
import { API_MODE } from '../data/source.js'
import { canViewRequest } from '../domain/proposals.js'
import { serviceLabel } from '../domain/brands.js'
import { SkeletonRequest } from '../components/ui/Skeleton.jsx'
import { LinkedTodos } from '../components/Todos.jsx'

function NotAvailable({ id }) {
  // Same message whether the id doesn't exist or is someone else's draft, so drafts don't leak.
  return (
    <PageLayout title="Proposal">
      <Card>
        <EmptyState
          icon="document"
          title="Proposal not available"
          meta={<Link to="/" className="btn">Back to dashboard</Link>}
        >
          No request &ldquo;{id}&rdquo; is available to you. It may not exist, or it may be a draft
          that only its creator can see.
        </EmptyState>
      </Card>
    </PageLayout>
  )
}

/**
 * Detail page for one proposal request (/proposals/:id), with the actions this viewer may take.
 * Keyed by the id: going straight from one request to another (bell, links) starts fresh, so what was
 * new, half-typed messages and forms never carry over, and the second request is marked read too.
 */
export default function ProposalDetailPage() {
  const { id } = useParams()
  return <ProposalDetail key={id} id={id} />
}

function ProposalDetail({ id }) {
  const flash = useLocation().state?.flash // success message from the request form
  const { user, activeRole } = useCurrentUser()
  const { data: request, isLoading, error, notFound } = useProposalRequest(id)
  const { clientsById, usersById, opportunitiesById } = useLookups()
  const [waitingOpen, setWaitingOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [correctOpen, setCorrectOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const remove = useDelete()
  const navigate = useNavigate()
  // When this person last opened it (captured once, so what was new stays highlighted for this visit).
  const [lastReadAt, setLastReadAt] = useState(undefined)
  const markRead = useMarkRead(id)
  useEffect(() => {
    if (!request || lastReadAt !== undefined) return
    setLastReadAt(request.lastReadAt ?? null)
    markRead() // opening the request clears "New for you" for this person
  }, [request, lastReadAt, markRead])
  const toast = useRouteToast()

  if (!request && isLoading) {
    return <PageLayout title="Proposal" crumbs={[{ label: 'Proposals', to: '/proposals' }]}><SkeletonRequest /></PageLayout>
  }
  if (error && !request) {
    return (
      <PageLayout title="Proposal">
        <Card>
          <EmptyState icon="alert" title="Could not load the request">{error.message}</EmptyState>
        </Card>
      </PageLayout>
    )
  }
  if (notFound || !request || !canViewRequest(request, user.id)) return <NotAvailable id={id} />

  const client = clientsById[request.clientId]
  // API mode: the linked opportunity comes with the request.
  const opportunity = request.opportunity ?? (request.opportunityId ? opportunitiesById[request.opportunityId] : null)
  const viewer = { userId: user.id, activeRole }
  const details = request.conversationPermissions?.updateDetails ?? canUpdateDetails(request, viewer, usersById)
  // The AM while preparing: "Upload proposal" is a visible button, not in "More" (waiting on: click the name).
  const preparing = activeRole === ROLE.ACCOUNT_MANAGER && request.assignedAM === user.id
    && [PS.SUBMITTED, PS.IN_PROGRESS, PS.REVISION_REQUESTED].includes(request.status)
  const uploadAllowed = request.upload?.allowed ?? false
  const openUpload = () => {
    const input = document.getElementById('proposal-upload')
    input?.scrollIntoView?.({ block: 'center' })
    input?.click()
  }

  return (
    <PageLayout
      title={client?.name ?? request.clientName ?? 'Unknown client'}
      crumbs={[{ label: 'Proposals', to: '/proposals' }]}
      meta={(
        <>
          {/* Status and who it waits on are in the panel right below; the header just names it. */}
          <BrandTag brand={request.brand} />
          <span className="muted">{serviceLabel(request.brand, request.service)}</span>
          {request.eventName && <><span className="meta-sep" aria-hidden="true" /><span>{request.eventName}</span></>}
          {request.version > 1 && <><span className="meta-sep" aria-hidden="true" /><span className="muted">Version {request.version}</span></>}
          {request.needsReview && <Badge tone="info">Needs review</Badge>}
        </>
      )}
      actions={(
        <>
          <button type="button" className="btn btn--ghost" onClick={() => setHistoryOpen(true)}>
            <Icon name="clock" size={16} /> History
          </button>
          {request.canDelete?.allowed && remove.available && (
            <MoreMenu items={[{ label: 'Delete permanently', tone: 'danger', onSelect: () => setDeleting(true) }]} />
          )}
          {request.status === PS.ACCEPTED && <Link to={`/events/${encodeURIComponent(request.id)}`} className="btn btn--primary">Open the event</Link>}
        </>
      )}
    >
      {flash && (
        <div className="action-feedback action-feedback--success" role="status">
          <Icon name="checkmark" size={16} strokeWidth={2.25} />
          <span>
            {flash}
            {!API_MODE && <span className="action-feedback__note">Demo: kept in memory only; resets when you reload.</span>}
          </span>
        </div>
      )}

      {request.status === PS.ACCEPTED && (
        <p className="details-banner">This proposal is now an event. <Link to={`/events/${encodeURIComponent(request.id)}`}>Open the event page</Link></p>
      )}
      {/* The status card: where it is, who it waits on (one click to change), why, and this person's buttons. */}
      <WhereNow request={request}
        onMore={() => setWaitingOpen(true)}
        onSaved={(_r, text) => toast.show(text)}
        actions={(
          // Remount per viewer so one person's form or success message never shows for another.
          <ActionsPanel key={`${user.id}:${activeRole}`} request={request} bare
            idleText={getStatus('proposal', request.status).nextStep ?? null}
            waitingButton={<WaitingQuickMenu request={request} variant="button"
              onMore={() => setWaitingOpen(true)} onSaved={(_r, text) => toast.show(text)} />}
            extras={[
              ...(preparing && uploadAllowed ? [{ label: 'Upload proposal', onSelect: openUpload, visible: true }] : []),
              ...(details.allowed ? [{ label: 'Update details', onSelect: () => setDetailsOpen(true) }] : []),
              ...((request.correctStatus ?? canCorrectStatus(request, viewer, usersById)).allowed
                ? [{ label: 'Correct status (data fix)', onSelect: () => setCorrectOpen(true) }] : []),
            ]} />
        )} />
      <DetailsBanner key={`banner:${user.id}:${activeRole}`} request={request} />
      <div className="request-columns request-columns--details-first">
        <div className="request-columns__left">
          <RequestRequirements request={request} />
          <ProposalFiles request={request} usersById={usersById} />
          <ProposalVersions request={request} usersById={usersById} />
          <RequestOverview request={request} client={client} usersById={usersById} />
          <LinkedOpportunity opportunity={opportunity} client={client} usersById={usersById} />
        </div>
        <div className="request-columns__right">
          <LinkedTodos kind="request" id={request.id} label={client?.name ?? request.clientName ?? request.id} />
          <OpenCards key={`cards:${user.id}:${activeRole}`} request={request} lastReadAt={lastReadAt} />
          <Conversation key={`thread:${user.id}:${activeRole}`} request={request} lastReadAt={lastReadAt} />
        </div>
      </div>
      {correctOpen && (
        <CorrectStatusPanel request={request} onClose={() => setCorrectOpen(false)}
          onSaved={(_r, text) => { setCorrectOpen(false); toast.show(text) }} />
      )}
      {historyOpen && (
        <SidePanel open title="Full history" subtitle={request.id} onClose={() => setHistoryOpen(false)}>
          <ActivityTimeline request={request} usersById={usersById} />
        </SidePanel>
      )}
      {detailsOpen && (
        <UpdateDetailsPanel request={request} onClose={() => setDetailsOpen(false)}
          onSaved={(_r, text) => { setDetailsOpen(false); toast.show(text) }} />
      )}
      {waitingOpen && (
        <WaitingOnPanel request={request} onClose={() => setWaitingOpen(false)}
          onSaved={(_r, text) => { setWaitingOpen(false); toast.show(text) }} />
      )}
      <DeleteDialog open={deleting} title={`Delete ${request.id} permanently?`} name={request.id}
        items={[
          `the proposal ${request.id} for ${client?.name ?? request.clientName ?? 'this client'}`,
          'its full history, conversation and proposal files',
          request.status === PS.ACCEPTED ? 'its event, with the facilitators assigned to it' : null,
          request.opportunityId ? 'its opportunity, when no other proposal uses it' : null,
        ]}
        onDelete={() => remove.request(request)} onCancel={() => setDeleting(false)}
        onDone={(result) => navigate('/proposals', { state: { toast: result.message } })} />
      <Toast message={toast.message} />
    </PageLayout>
  )
}

"""
Permanent delete of a proposal request (an event is a confirmed request) or a client, with everything
attached. Asked for by the business (Nov 2026): it cannot be undone.

Who: whoever may edit it. A draft: its creator. A submitted request or event: the Commercial Head or the BD
owner acting as BD. A client: whoever may edit the client (crm.can_edit_client).

History tables are append-only (database triggers refuse UPDATE and DELETE). A delete lifts those triggers
inside its own transaction only and puts them back before it commits, so nothing else can ever change history.
Everything runs in one transaction: all of it goes, or nothing does. Uploaded files are removed from storage
after the commit (delete_files), so a failed delete never loses a file.
"""

from sqlalchemy import delete, select, text, update
from sqlalchemy.orm import Session

from ..models import (
    Client, ClientBrand, ClientContact, ClientHistory, FacilitatorAssignment, FacilitatorRating,
    FacilitatorRatingHistory, Notification, Opportunity, OpportunityHistory, ProposalFile, ProposalRequest,
    RadarDismissal, RequestComment, RequestEvent, RequestRead, RequestStatusHistory, Todo,
)

LOCKED = ("request_status_history", "request_events", "request_comments", "proposal_files", "opportunity_history",
          "client_history")


def _unlock(db: Session) -> list:
    """Lifts the append-only triggers of LOCKED for this transaction. -> what to put back."""
    bind = db.get_bind()
    if bind.dialect.name == "sqlite":
        db.execute(text("PRAGMA defer_foreign_keys = ON"))
        rows = db.execute(text("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ("
                               + ", ".join(f"'{t}'" for t in LOCKED) + ")")).all()
        for name, _ in rows:
            db.execute(text(f'DROP TRIGGER "{name}"'))
        return [sql for _, sql in rows]
    for t in LOCKED:
        db.execute(text(f'ALTER TABLE "{t}" DISABLE TRIGGER USER'))
    return list(LOCKED)


def _relock(db: Session, saved: list) -> None:
    if db.get_bind().dialect.name == "sqlite":
        for sql in saved:
            db.execute(text(sql))
        return
    for t in saved:
        db.execute(text(f'ALTER TABLE "{t}" ENABLE TRIGGER USER'))


def _remove_requests(db: Session, ids: list[str]) -> dict:
    """Deletes these requests and what hangs off them. -> {"files": [storage keys], "opportunities": {ids}}"""
    if not ids:
        return {"files": [], "opportunities": set()}
    opp_ids = {o for o in db.scalars(select(ProposalRequest.opportunity_id).where(ProposalRequest.id.in_(ids))) if o}
    keys = list(db.scalars(select(ProposalFile.storage_key).where(ProposalFile.request_id.in_(ids))))
    ratings = list(db.scalars(select(FacilitatorRating.id).where(FacilitatorRating.request_id.in_(ids))))
    if ratings:
        db.execute(delete(FacilitatorRatingHistory.__table__).where(FacilitatorRatingHistory.rating_id.in_(ratings)))
    for model in (FacilitatorRating, FacilitatorAssignment, RequestRead, RequestComment, ProposalFile, RequestEvent,
                  RequestStatusHistory):
        db.execute(delete(model.__table__).where(model.request_id.in_(ids)))
    db.execute(update(OpportunityHistory.__table__).where(OpportunityHistory.source_request_id.in_(ids))
               .values(source_request_id=None))
    # Notifications about these requests: dropped when only about them, otherwise they lose the reference.
    gone = set(ids)
    for n in db.scalars(select(Notification).where(Notification.request_ids.is_not(None))).all():
        refs = [r for r in (n.request_ids or []) if r not in gone]
        if len(refs) != len(n.request_ids or []):
            if refs:
                n.request_ids = refs
            else:
                db.delete(n)
    db.flush()
    # A to-do linked to a request or event keeps its text and loses the link.
    db.execute(update(Todo.__table__).where(Todo.link_kind.in_(("request", "event")), Todo.link_id.in_(ids))
               .values(link_kind=None, link_id=None))
    db.execute(delete(ProposalRequest.__table__).where(ProposalRequest.id.in_(ids)))
    return {"files": keys, "opportunities": opp_ids}


def _remove_opportunities(db: Session, opp_ids: set) -> int:
    if not opp_ids:
        return 0
    db.execute(delete(OpportunityHistory.__table__).where(OpportunityHistory.opportunity_id.in_(opp_ids)))
    return db.execute(delete(Opportunity.__table__).where(Opportunity.id.in_(opp_ids))).rowcount or 0


def delete_request(db: Session, row: ProposalRequest) -> dict:
    """The request (or event) and everything attached; its opportunity too when nothing else uses it."""
    rid, client_id = row.id, row.client_id
    db.expunge(row)
    saved = _unlock(db)
    done = _remove_requests(db, [rid])
    orphans = {o for o in done["opportunities"]
               if db.scalar(select(ProposalRequest.id).where(ProposalRequest.opportunity_id == o).limit(1)) is None}
    _remove_opportunities(db, orphans)
    _relock(db, saved)
    db.flush()
    return {"files": done["files"], "client_id": client_id}


def delete_client(db: Session, client: Client) -> dict:
    """The client and everything of theirs: proposals and events, opportunities, contacts, history."""
    cid = client.id
    db.expunge(client)
    saved = _unlock(db)
    request_ids = list(db.scalars(select(ProposalRequest.id).where(ProposalRequest.client_id == cid)))
    done = _remove_requests(db, request_ids)
    opp_ids = set(db.scalars(select(Opportunity.id).where(Opportunity.client_id == cid))) | done["opportunities"]
    _remove_opportunities(db, opp_ids)
    for model in (ClientContact, ClientBrand, ClientHistory, RadarDismissal):
        db.execute(delete(model.__table__).where(model.client_id == cid))
    db.execute(update(Todo.__table__).where(Todo.link_kind == "client", Todo.link_id == cid)
               .values(link_kind=None, link_id=None))
    db.execute(delete(Client.__table__).where(Client.id == cid))
    _relock(db, saved)
    db.flush()
    return {"files": done["files"], "requests": len(request_ids), "opportunities": len(opp_ids)}


def delete_files(storage, keys: list[str]) -> None:
    """After the commit: the uploaded files of what was deleted (a missing file is not an error)."""
    for key in keys:
        try:
            storage.delete(key)
        except (FileNotFoundError, OSError):
            pass


def what_a_client_delete_removes(db: Session, client_id: str) -> dict:
    """For the confirmation: how many proposals (and events), opportunities and contacts would go."""
    requests = list(db.scalars(select(ProposalRequest.status).where(ProposalRequest.client_id == client_id)))
    return {
        "proposals": len(requests),
        "events": sum(1 for s in requests if s == "accepted"),
        "contacts": len(list(db.scalars(select(ClientContact.id).where(ClientContact.client_id == client_id)))),
    }

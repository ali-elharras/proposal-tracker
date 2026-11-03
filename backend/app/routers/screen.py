"""
The office screen (TV mode): GET /api/screen. Noha, Executives and the read-only "Office screen" account.

Areas: this week's events (with participants and service) · events in the next 30 days (count, and the next 6) · proposals in
preparation now (count per brand + the 5 waiting longest, with days, stage, Account Manager and deadline) ·
the latest 5 confirmations · this month (confirmed, lost, decided, received).
Privacy: no prices, no client contacts, no drafts, no conversations: only the fields listed here.
"""

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import config_domain as cfg
from ..clock import cairo_today_iso, get_now, iso_z
from ..database import get_db
from ..domain import events as event_rules
from ..domain import rules
from ..domain.views import request_from_orm
from ..errors import forbidden
from ..identity import Actor, get_current_actor
from ..models import Client, ProposalRequest
from .proposal_requests import _users

router = APIRouter(prefix="/api", tags=["screen"])
SCREEN_ROLES = ("commercial_head", "executive", "office_screen")
PREPARING = ("submitted", "in_progress", "awaiting_bd_info", "revision_requested")
LOST = ("rejected", "cancelled")
STAGE_WORDS = {"submitted": "New", "in_progress": "Preparing", "awaiting_bd_info": "Needs BD info",
               "revision_requested": "Revision"}
SERVICE_LABELS = {(b["id"], s["id"]): s["label"] for b in cfg.BRANDS for s in b["services"]}


def _cairo_day(ts: datetime | None) -> str | None:
    return cairo_today_iso(ts) if ts else None


def _first(r, statuses) -> datetime | None:
    return next((h.changed_at for h in sorted(r.history, key=lambda h: h.seq) if h.status in statuses), None)


@router.get("/screen")
def screen(actor: Actor = Depends(get_current_actor), now: datetime = Depends(get_now), db: Session = Depends(get_db)):
    if actor.active_role not in SCREEN_ROLES:
        raise forbidden("The office screen is for the Commercial Head, Executives and the office screen account.")
    today = cairo_today_iso(now)
    week_end = (date.fromisoformat(today) + timedelta(days=6)).isoformat()
    month_ahead = (date.fromisoformat(today) + timedelta(days=30)).isoformat()
    names = {c.id: c.name for c in db.scalars(select(Client)).all()}
    users = _users(db)
    rows = db.scalars(select(ProposalRequest).where(ProposalRequest.status != "draft")
                      .options(selectinload(ProposalRequest.history))).all()

    week, later = [], []
    upcoming = 0
    for r in rows:
        v = request_from_orm(r)
        if r.status != "accepted" or event_rules.view_event_status(v) not in ("initial", "confirmed"):
            continue
        if v.event_date_precision != "day" or not v.event_date:
            continue
        end = v.event_end_date or v.event_date
        if v.event_date <= month_ahead and end >= today:
            upcoming += 1
        people = r.confirmed_participants if r.confirmed_participants is not None else r.participants
        if week_end < v.event_date <= month_ahead:
            later.append({"id": r.id, "date": v.event_date, "endDate": v.event_end_date, "client": names.get(r.client_id),
                          "eventName": r.event_name, "brand": r.brand, "service": SERVICE_LABELS.get((r.brand, r.service)),
                          "participants": people, "initial": r.event_status == "initial"})
        if v.event_date <= week_end and end >= today:
            week.append({"id": r.id, "date": v.event_date, "endDate": v.event_end_date, "client": names.get(r.client_id),
                         "eventName": r.event_name, "brand": r.brand, "service": SERVICE_LABELS.get((r.brand, r.service)),
                         "participants": people, "initial": r.event_status == "initial"})
    week.sort(key=lambda e: (e["date"], e["client"] or ""))
    later.sort(key=lambda e: (e["date"], e["client"] or ""))

    preparing = [r for r in rows if r.status in PREPARING and not r.needs_review]
    per_brand = {}
    for r in preparing:
        per_brand[r.brand] = per_brand.get(r.brand, 0) + 1
    since = lambda r: r.submitted_at or r.created_at  # noqa: E731
    oldest = sorted(preparing, key=since)[:5]

    confirmations = sorted(((r, _first(r, ("accepted",))) for r in rows if r.status == "accepted"),
                           key=lambda x: x[1] or datetime.min.replace(tzinfo=now.tzinfo), reverse=True)
    latest = []
    for r, at in confirmations[:5]:
        by = next((h.changed_by_id for h in sorted(r.history, key=lambda h: h.seq, reverse=True)
                   if h.status == "accepted" and not h.imported), None)
        latest.append({"id": r.id, "client": names.get(r.client_id), "eventName": r.event_name, "brand": r.brand,
                       "by": users[by].name if by in users else None, "at": iso_z(at)})

    month = today[:7]
    in_month = lambda ts: (_cairo_day(ts) or "")[:7] == month  # noqa: E731
    won = sum(1 for r in rows if in_month(_first(r, ("accepted",))))
    lost = sum(1 for r in rows if in_month(_first(r, LOST)))
    received = sum(1 for r in rows if in_month(r.submitted_at or _first(r, ("submitted",))))
    return {
        "updatedAt": iso_z(now), "today": today,
        "week": week,
        "preparing": {"count": len(preparing), "perBrand": per_brand,
                      "oldest": [{"id": r.id, "client": names.get(r.client_id), "eventName": r.event_name, "brand": r.brand,
                                  "days": max(0, (now - since(r)).days), "stage": STAGE_WORDS.get(r.status),
                                  "am": users[r.assigned_am_id].name if r.assigned_am_id in users else None,
                                  "deadline": r.required_by.isoformat() if r.required_by else None,
                                  "overdue": rules.is_request_overdue(request_from_orm(r), today)}
                                 for r in oldest]},
        "upcoming": upcoming,
        "later": later[:6],  # the next events after this week (within 30 days), soonest first
        "confirmations": latest,
        "month": {"confirmed": won, "lost": lost, "decided": won + lost, "received": received},
    }

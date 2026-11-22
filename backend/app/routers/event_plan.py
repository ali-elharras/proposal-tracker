"""
The event plan on a confirmed event's page (rules: app/domain/event_plan.py).

  POST  /api/events/{id}/tasks                    add { title, assigneeId?, dueOn? }
  POST  /api/events/{id}/tasks/standard           add the usual steps that are not there yet
  PATCH /api/events/{id}/tasks/{task_id}          edit { title?, assigneeId?, dueOn?, done? }
  POST  /api/events/{id}/tasks/{task_id}/delete   remove a step
  PATCH /api/events/{id}/run-sheet                { runSheet } the day's timings
  POST  /api/events/{id}/payments                 add { kind, amount, receivedOn, note? }
  POST  /api/events/{id}/payments/{pid}/delete    remove a payment recorded by mistake

Every answer is { plan, message } with the event's whole plan, so the page simply replaces it.
"""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..clock import cairo_today_iso, get_now, iso_z
from ..database import begin_write, get_db
from ..domain import event_plan as rules
from ..domain.events import can_see_event_price
from ..domain.views import iso_date, request_from_orm
from ..errors import ApiError, not_found, validation
from ..identity import Actor, get_current_actor
from ..models import EventPayment, EventTask
from .events import _load

router = APIRouter(prefix="/api/events", tags=["event plan"])


class _In(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class TaskIn(_In):
    title: Any = None
    assignee_id: Any = None
    due_on: Any = None
    done: Any = None


class RunSheetIn(_In):
    run_sheet: Any = None


class PaymentIn(_In):
    kind: Any = None
    amount: Any = None
    received_on: Any = None
    note: Any = None


def plan_of(db: Session, row, actor: Actor, users: dict) -> dict:
    """The plan part of an event's page: checklist, run sheet and (for those who see prices) payments."""
    view = request_from_orm(row)
    tasks = db.scalars(select(EventTask).where(EventTask.request_id == row.id)
                       .order_by(EventTask.position, EventTask.id)).all()
    out = {
        "tasks": [{"id": t.id, "title": t.title, "assigneeId": t.assignee_id, "dueOn": iso_date(t.due_on),
                   "doneAt": iso_z(t.done_at) if t.done_at else None, "doneBy": t.done_by_id} for t in tasks],
        "runSheet": row.run_sheet,
        "canEdit": rules.can_edit_plan(view, actor, users)["allowed"],
        "standardTasks": list(rules.STANDARD_TASKS),
    }
    if can_see_event_price(actor):
        payments = db.scalars(select(EventPayment).where(EventPayment.request_id == row.id)
                              .order_by(EventPayment.received_on, EventPayment.id)).all()
        price = row.final_price if row.final_price is not None else row.am_price  # as the event page shows it
        out["payments"] = {
            "items": [{"id": p.id, "kind": p.kind, "amount": p.amount, "receivedOn": iso_date(p.received_on),
                       "note": p.note, "recordedBy": p.recorded_by_id} for p in payments],
            "finalPrice": price,
            **rules.payments_summary(price, [p.amount for p in payments]),
            "canRecord": rules.can_record_payments(view, actor, users)["allowed"],
        }
    return out


def _for_plan(db: Session, event_id: str, actor: Actor, check):
    begin_write(db)
    row, users = _load(db, event_id, actor)
    permission = check(request_from_orm(row), actor, users)
    if not permission["allowed"]:
        raise ApiError(403, "forbidden", permission["reason"])
    return row, users


def _done(db: Session, event_id: str, actor: Actor, message: str) -> dict:
    db.commit()
    db.expire_all()
    row, users = _load(db, event_id, actor)
    return {"plan": plan_of(db, row, actor, users), "message": message}


def _task(db: Session, row, task_id: int) -> EventTask:
    t = db.get(EventTask, task_id)
    if t is None or t.request_id != row.id:
        raise not_found("That task is not on this event.")
    return t


def _date(v):
    return datetime.fromisoformat(v).date() if v else None


@router.post("/{event_id}/tasks", status_code=201)
def add_task(event_id: str, body: TaskIn, actor: Actor = Depends(get_current_actor), now: datetime = Depends(get_now),
             db: Session = Depends(get_db)):
    row, users = _for_plan(db, event_id, actor, rules.can_edit_plan)
    checked = rules.validate_task(body.model_dump(by_alias=True, exclude_none=True), users)
    if checked["errors"]:
        raise validation("Please fix the highlighted fields.", checked["errors"])
    v = checked["values"]
    last = db.scalar(select(func.max(EventTask.position)).where(EventTask.request_id == row.id)) or 0
    db.add(EventTask(request_id=row.id, title=v["title"], assignee_id=v["assigneeId"], due_on=_date(v["dueOn"]),
                     position=last + 1, created_by_id=actor.user_id, created_at=now))
    return _done(db, event_id, actor, "Added to the checklist.")


@router.post("/{event_id}/tasks/standard", status_code=201)
def add_standard_tasks(event_id: str, actor: Actor = Depends(get_current_actor), now: datetime = Depends(get_now),
                       db: Session = Depends(get_db)):
    row, _ = _for_plan(db, event_id, actor, rules.can_edit_plan)
    have = {t.title.lower() for t in db.scalars(select(EventTask).where(EventTask.request_id == row.id)).all()}
    last = db.scalar(select(func.max(EventTask.position)).where(EventTask.request_id == row.id)) or 0
    added = 0
    for title in rules.STANDARD_TASKS:
        if title.lower() not in have:
            added += 1
            db.add(EventTask(request_id=row.id, title=title, position=last + added, created_by_id=actor.user_id, created_at=now))
    return _done(db, event_id, actor, f"Added {added} standard {'step' if added == 1 else 'steps'}." if added
                 else "The standard steps are already there.")


@router.patch("/{event_id}/tasks/{task_id}")
def edit_task(event_id: str, task_id: int, body: TaskIn, actor: Actor = Depends(get_current_actor),
              now: datetime = Depends(get_now), db: Session = Depends(get_db)):
    row, users = _for_plan(db, event_id, actor, rules.can_edit_plan)
    t = _task(db, row, task_id)
    checked = rules.validate_task(body.model_dump(by_alias=True, exclude_unset=True), users, partial=True)
    if checked["errors"]:
        raise validation("Please fix the highlighted fields.", checked["errors"])
    v = checked["values"]
    if "title" in v:
        t.title = v["title"]
    if "assigneeId" in v:
        t.assignee_id = v["assigneeId"]
    if "dueOn" in v:
        t.due_on = _date(v["dueOn"])
    if "done" in v:
        t.done_at, t.done_by_id = (now, actor.user_id) if v["done"] else (None, None)
    return _done(db, event_id, actor, "Saved.")


@router.post("/{event_id}/tasks/{task_id}/delete")
def delete_task(event_id: str, task_id: int, actor: Actor = Depends(get_current_actor), db: Session = Depends(get_db)):
    row, _ = _for_plan(db, event_id, actor, rules.can_edit_plan)
    db.delete(_task(db, row, task_id))
    return _done(db, event_id, actor, "Removed from the checklist.")


@router.patch("/{event_id}/run-sheet")
def save_run_sheet(event_id: str, body: RunSheetIn, actor: Actor = Depends(get_current_actor),
                   now: datetime = Depends(get_now), db: Session = Depends(get_db)):
    row, _ = _for_plan(db, event_id, actor, rules.can_edit_plan)
    checked = rules.validate_run_sheet(body.model_dump(by_alias=True))
    if checked["errors"]:
        raise validation("Please fix the highlighted fields.", checked["errors"])
    row.run_sheet = checked["values"]["runSheet"]
    row.updated_at = now
    return _done(db, event_id, actor, "Run sheet saved.")


@router.post("/{event_id}/payments", status_code=201)
def add_payment(event_id: str, body: PaymentIn, actor: Actor = Depends(get_current_actor),
                now: datetime = Depends(get_now), db: Session = Depends(get_db)):
    row, _ = _for_plan(db, event_id, actor, rules.can_record_payments)
    checked = rules.validate_payment(body.model_dump(by_alias=True), cairo_today_iso(now))
    if checked["errors"]:
        raise validation("Please fix the highlighted fields.", checked["errors"])
    v = checked["values"]
    db.add(EventPayment(request_id=row.id, kind=v["kind"], amount=v["amount"], received_on=_date(v["receivedOn"]),
                        note=v["note"], recorded_by_id=actor.user_id, created_at=now))
    return _done(db, event_id, actor, "Payment recorded.")


@router.post("/{event_id}/payments/{payment_id}/delete")
def delete_payment(event_id: str, payment_id: int, actor: Actor = Depends(get_current_actor),
                   db: Session = Depends(get_db)):
    row, _ = _for_plan(db, event_id, actor, rules.can_record_payments)
    p = db.get(EventPayment, payment_id)
    if p is None or p.request_id != row.id:
        raise not_found("That payment is not on this event.")
    db.delete(p)
    return _done(db, event_id, actor, "Payment removed.")

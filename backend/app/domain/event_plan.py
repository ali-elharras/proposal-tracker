"""
The event plan: what has to happen before a confirmed event (a checklist), the day's timings (a run sheet)
and the money received (payments). Same rules as frontend/src/domain/eventPlan.js.

Who edits the checklist and the run sheet: the Commercial Head, Operations, the BD owner (as BD) and the
assigned AM (as AM). Who records payments: the Commercial Head and the BD owner (as BD). Payments are
shown only to people who see event prices. Nothing is editable once the event is cancelled.
"""

from .events import ACCEPTED, CANCELLED, can_see_event_price, view_event_status
from .request_form import is_real_date

TASK_TITLE_MAX = 200
RUN_SHEET_MAX = 4000
PAYMENT_NOTE_MAX = 300
PAYMENT_KINDS = ("deposit", "balance", "other")

# "Add the standard checklist": the usual steps before an event (only the ones not there yet are added).
STANDARD_TASKS = (
    "Venue confirmed",
    "Transport arranged",
    "Supplies and equipment ready",
    "Facilitators confirmed",
    "Final numbers from the client",
    "Client briefed on the day's plan",
)

_ok = {"allowed": True, "reason": None}


def _open_event(r) -> dict | None:
    if r.status != ACCEPTED:
        return {"allowed": False, "reason": "Only confirmed events have a plan."}
    if view_event_status(r) == CANCELLED:
        return {"allowed": False, "reason": "This event was cancelled."}
    return None


def can_edit_plan(r, viewer, users: dict) -> dict:
    from .access import acts_as_business_development
    closed = _open_event(r)
    if closed:
        return closed
    if viewer.active_role in ("commercial_head", "operations"):
        return _ok
    if viewer.user_id == r.bd_owner and acts_as_business_development(viewer, users.get(viewer.user_id)):
        return _ok
    if viewer.active_role == "account_manager" and viewer.user_id == r.assigned_am:
        return _ok
    return {"allowed": False, "reason": "Only the Commercial Head, Operations, the BD owner or the AM edit the plan."}


def can_record_payments(r, viewer, users: dict) -> dict:
    from .access import acts_as_business_development
    if not can_see_event_price(viewer):
        return {"allowed": False, "reason": "Payments are shown only to people who see prices."}
    closed = _open_event(r)
    if closed:
        return closed
    if viewer.active_role == "commercial_head":
        return _ok
    if viewer.user_id == r.bd_owner and acts_as_business_development(viewer, users.get(viewer.user_id)):
        return _ok
    return {"allowed": False, "reason": "Only the BD owner or the Commercial Head records payments."}


def _text(v, limit):
    return v.strip()[:limit] if isinstance(v, str) and v.strip() else None


def validate_task(data: dict, users: dict, partial: bool = False) -> dict:
    """{ title, assigneeId?, dueOn?, done? } -> { errors, values } (only the given fields when partial)."""
    errors, values = {}, {}
    if not partial or "title" in data:
        title = data.get("title")
        if not isinstance(title, str) or not title.strip():
            errors["title"] = "Write the task."
        elif len(title.strip()) > TASK_TITLE_MAX:
            errors["title"] = f"Use at most {TASK_TITLE_MAX} characters."
        else:
            values["title"] = title.strip()
    if not partial or "assigneeId" in data:
        who = data.get("assigneeId") or None
        if who is not None and (who not in users or users[who].active is False):
            errors["assigneeId"] = "Choose someone from the team."
        values["assigneeId"] = who
    if not partial or "dueOn" in data:
        due = data.get("dueOn") or None
        if due is not None and not (isinstance(due, str) and is_real_date(due)):
            errors["dueOn"] = "Enter a valid date."
        values["dueOn"] = due
    if "done" in data:
        if not isinstance(data["done"], bool):
            errors["done"] = "Send true or false."
        values["done"] = data["done"]
    return {"errors": errors, "values": values}


def validate_run_sheet(data: dict) -> dict:
    text = data.get("runSheet")
    if text is not None and not isinstance(text, str):
        return {"errors": {"runSheet": "Send text."}, "values": {}}
    text = (text or "").strip()
    if len(text) > RUN_SHEET_MAX:
        return {"errors": {"runSheet": f"Use at most {RUN_SHEET_MAX} characters."}, "values": {}}
    return {"errors": {}, "values": {"runSheet": text or None}}


def validate_payment(data: dict, today: str) -> dict:
    errors = {}
    kind = data.get("kind")
    if kind not in PAYMENT_KINDS:
        errors["kind"] = "Choose deposit, balance or other."
    amount = data.get("amount")
    if isinstance(amount, str) and amount.strip().isdigit():
        amount = int(amount.strip())
    if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
        errors["amount"] = "Enter the amount in whole EGP (more than 0)."
    received = data.get("receivedOn")
    if not (isinstance(received, str) and is_real_date(received)):
        errors["receivedOn"] = "Enter the day it was received."
    elif received > today:
        errors["receivedOn"] = "The day received cannot be in the future."
    note = data.get("note")
    if note is not None and not isinstance(note, str):
        errors["note"] = "Send text."
    return {"errors": errors, "values": {"kind": kind, "amount": amount, "receivedOn": received,
                                         "note": _text(note, PAYMENT_NOTE_MAX)}}


def payments_summary(final_price, amounts: list[int]) -> dict:
    """Received so far and what is left (None when there is no final price)."""
    received = sum(amounts)
    return {"received": received, "balance": None if final_price is None else final_price - received}

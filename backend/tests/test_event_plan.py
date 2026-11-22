"""
The event plan: checklist, run sheet and payments on a confirmed event (app/domain/event_plan.py,
app/routers/event_plan.py). Who may edit, what is validated, who sees money, and that a permanent
delete removes it all.
"""

from .conftest import AHMED, MD_AM, NOHA, SHERINE
from .test_radar_staffing_screen import CLARA, OPS, add_people
from .write_helpers import act, cl, create, future, ok, sample_pdf, upload


def event_with_price(api, price=100000):
    rid = ok(create(api, AHMED, submit=True, clientId=cl(8), brand="teamup", service="team_building", eventDatePrecision="day",
                    eventDate=future(40), requiredBy=future(10), participants=60, requirementsSummary="Offsite"))["request"]["id"]
    ok(act(api, rid, "start_work", MD_AM))
    ok(upload(api, rid, MD_AM, data=sample_pdf()))
    ok(act(api, rid, "mark_ready", MD_AM, amPrice=90000))
    ok(act(api, rid, "share_with_client", AHMED, confirmShared=True, channel="email"))
    ok(act(api, rid, "record_accepted", AHMED, eventDate=future(20), finalParticipants=60, finalPrice=price))
    return rid


def plan(api, rid, who):
    return ok(api.get(f"/api/events/{rid}", headers=who))["plan"]


def test_checklist_standard_steps_edit_tick_and_delete(api, session):
    add_people(session)
    rid = event_with_price(api)
    p = plan(api, rid, AHMED)
    assert p["tasks"] == [] and p["canEdit"] is True and p["runSheet"] is None

    out = ok(api.post(f"/api/events/{rid}/tasks/standard", headers=AHMED))
    assert [t["title"] for t in out["plan"]["tasks"]][:2] == ["Venue confirmed", "Transport arranged"]
    n = len(out["plan"]["tasks"])
    again = ok(api.post(f"/api/events/{rid}/tasks/standard", headers=NOHA))
    assert len(again["plan"]["tasks"]) == n and again["message"] == "The standard steps are already there."

    # Operations adds its own step with an owner and a date; the AM ticks it.
    added = ok(api.post(f"/api/events/{rid}/tasks", headers=OPS,
                        json={"title": "  Print name tags  ", "assigneeId": "u-omar", "dueOn": future(15)}))["plan"]["tasks"]
    tag = next(t for t in added if t["title"] == "Print name tags")
    assert tag["assigneeId"] == "u-omar" and tag["dueOn"] == future(15) and tag["doneAt"] is None
    ticked = ok(api.patch(f"/api/events/{rid}/tasks/{tag['id']}", headers=MD_AM, json={"done": True}))["plan"]["tasks"]
    tag = next(t for t in ticked if t["id"] == tag["id"])
    assert tag["doneAt"] and tag["doneBy"] == "u-mariam-dimitri"
    # Editing one field leaves the others alone; unticking clears who did it.
    edited = ok(api.patch(f"/api/events/{rid}/tasks/{tag['id']}", headers=AHMED, json={"done": False, "title": "Print tags"}))
    tag = next(t for t in edited["plan"]["tasks"] if t["id"] == tag["id"])
    assert tag == {**tag, "title": "Print tags", "doneAt": None, "doneBy": None, "assigneeId": "u-omar"}

    # Validation
    bad = api.post(f"/api/events/{rid}/tasks", headers=AHMED, json={"title": " ", "assigneeId": "nobody", "dueOn": "2026-02-30"})
    assert bad.status_code == 422 and set(bad.json()["error"]["fields"]) == {"title", "assigneeId", "dueOn"}

    ok(api.post(f"/api/events/{rid}/tasks/{tag['id']}/delete", headers=NOHA))
    assert all(t["id"] != tag["id"] for t in plan(api, rid, NOHA)["tasks"])


def test_who_may_edit_the_plan(api, session):
    add_people(session)
    rid = event_with_price(api)
    # Another BD and HR see the checklist but may not change it.
    assert plan(api, rid, SHERINE)["canEdit"] is False
    assert plan(api, rid, CLARA)["canEdit"] is False
    assert api.post(f"/api/events/{rid}/tasks", headers=SHERINE, json={"title": "x"}).status_code == 403
    assert api.post(f"/api/events/{rid}/tasks", headers=CLARA, json={"title": "x"}).status_code == 403
    assert api.patch(f"/api/events/{rid}/run-sheet", headers=CLARA, json={"runSheet": "x"}).status_code == 403
    # A task id from another event is not found here.
    other = event_with_price(api)
    t = ok(api.post(f"/api/events/{other}/tasks", headers=AHMED, json={"title": "Other"}))["plan"]["tasks"][0]
    assert api.patch(f"/api/events/{rid}/tasks/{t['id']}", headers=AHMED, json={"done": True}).status_code == 404


def test_run_sheet_saves_trims_and_clears(api, session):
    add_people(session)
    rid = event_with_price(api)
    out = ok(api.patch(f"/api/events/{rid}/run-sheet", headers=OPS, json={"runSheet": "  09:00 Arrival\n10:00 Games  "}))
    assert out["plan"]["runSheet"] == "09:00 Arrival\n10:00 Games"
    assert ok(api.patch(f"/api/events/{rid}/run-sheet", headers=OPS, json={"runSheet": ""}))["plan"]["runSheet"] is None
    assert api.patch(f"/api/events/{rid}/run-sheet", headers=OPS, json={"runSheet": "x" * 4001}).status_code == 422


def test_payments_balance_and_who_sees_money(api, session):
    add_people(session)
    rid = event_with_price(api, price=100000)
    money = plan(api, rid, AHMED)["payments"]
    assert money == {**money, "items": [], "finalPrice": 100000, "received": 0, "balance": 100000, "canRecord": True}

    out = ok(api.post(f"/api/events/{rid}/payments", headers=AHMED,
                      json={"kind": "deposit", "amount": 30000, "receivedOn": future(0), "note": "Bank transfer"}))
    money = out["plan"]["payments"]
    assert money["received"] == 30000 and money["balance"] == 70000 and money["items"][0]["note"] == "Bank transfer"

    # Validation: kind, amount, a day received (not in the future)
    bad = api.post(f"/api/events/{rid}/payments", headers=NOHA, json={"kind": "tip", "amount": 0, "receivedOn": future(3)})
    assert bad.status_code == 422 and set(bad.json()["error"]["fields"]) == {"kind", "amount", "receivedOn"}

    # Operations and HR never see money; the AM sees it but does not record it.
    assert "payments" not in plan(api, rid, OPS) and "payments" not in plan(api, rid, CLARA)
    assert plan(api, rid, MD_AM)["payments"]["canRecord"] is False
    assert api.post(f"/api/events/{rid}/payments", headers=OPS,
                    json={"kind": "deposit", "amount": 5, "receivedOn": future(0)}).status_code == 403
    assert api.post(f"/api/events/{rid}/payments", headers=MD_AM,
                    json={"kind": "deposit", "amount": 5, "receivedOn": future(0)}).status_code == 403

    pid = money["items"][0]["id"]
    after = ok(api.post(f"/api/events/{rid}/payments/{pid}/delete", headers=NOHA))["plan"]["payments"]
    assert after["items"] == [] and after["balance"] == 100000


def test_cancelled_event_plan_is_read_only_and_delete_removes_it(api, session):
    add_people(session)
    rid = event_with_price(api)
    ok(api.post(f"/api/events/{rid}/tasks", headers=AHMED, json={"title": "Venue"}))
    ok(api.post(f"/api/events/{rid}/payments", headers=AHMED, json={"kind": "deposit", "amount": 1000, "receivedOn": future(0)}))
    ev = ok(api.get(f"/api/events/{rid}", headers=AHMED))
    ok(api.post(f"/api/events/{rid}/cancel", headers=AHMED,
                json={"expectedRowVersion": ev["rowVersion"], "reason": "other", "note": "Client cancelled"}))
    p = plan(api, rid, AHMED)
    assert p["canEdit"] is False and p["payments"]["canRecord"] is False
    assert api.post(f"/api/events/{rid}/tasks", headers=NOHA, json={"title": "x"}).status_code == 403

    # A permanent delete takes the plan with it (no orphan rows left behind).
    ev = ok(api.get(f"/api/proposal-requests/{rid}", headers=AHMED))
    ok(api.post(f"/api/proposal-requests/{rid}/delete", headers=AHMED, json={"expectedRowVersion": ev["rowVersion"]}))
    from app.models import EventPayment, EventTask
    from sqlalchemy import select
    assert session.scalars(select(EventTask).where(EventTask.request_id == rid)).all() == []
    assert session.scalars(select(EventPayment).where(EventPayment.request_id == rid)).all() == []


def test_events_list_shows_checklist_progress_and_facilitators(api, session):
    add_people(session)
    rid = event_with_price(api)
    ok(api.post(f"/api/events/{rid}/tasks/standard", headers=AHMED))
    first = plan(api, rid, AHMED)["tasks"][0]
    ok(api.patch(f"/api/events/{rid}/tasks/{first['id']}", headers=AHMED, json={"done": True}))
    item = next(e for e in ok(api.get("/api/events", headers=NOHA))["items"] if e["id"] == rid)
    assert item["checklist"] == {"done": 1, "total": 6}
    assert item["facilitators"] == {"needed": None, "assigned": 0}


def test_facilitator_list_shows_the_days_each_person_is_booked(api, session):
    add_people(session)
    rid = event_with_price(api)
    fid = ok(api.post("/api/facilitators", headers=CLARA, json={"name": "Lina Booked", "phone": "01001112223"}))["facilitator"]["id"]
    ok(api.post(f"/api/events/{rid}/facilitators", headers=CLARA, json={"facilitatorId": fid}))
    item = next(f for f in ok(api.get("/api/facilitators", headers=CLARA))["items"] if f["id"] == fid)
    assert item["booked"] == [{"eventId": rid, "start": future(20), "end": future(20)}]

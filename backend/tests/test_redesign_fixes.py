"""
Fixes made with the UI redesign. One test per bug so it cannot come back:
- "Change needed" by the Commercial Head: allowed while the AM is preparing (only a card), refused once the
  proposal is ready (it would move the status, a BD-owner step) instead of failing half-way with a 403.
- The request form's client list (creatable=true) includes the clients of someone with "Brings in clients".
- "Update details" refuses moving the event to on or before the unchanged proposal deadline.
(Migration 0019, every role on the history tables, is covered in test_migrations.py.)
"""

from .conftest import AHMED, MD_AM, NOHA
from .write_helpers import act, cl, create, detail, edit, error, future, ok, sample_pdf, upload


def _submitted(api):
    rid = ok(create(api, AHMED, clientId=cl(8), brand="teamup", service="team_building", eventDatePrecision="day",
                    eventDate=future(40), requiredBy=future(10), participants=120, requirementsSummary="Offsite"))["request"]["id"]
    ok(edit(api, rid, AHMED, submit=True))
    return rid


def _change(api, rid, who):
    return api.post(f"/api/proposal-requests/{rid}/comments", headers=who,
                    json={"kind": "change", "about": "internal", "reasons": ["price"], "body": "Too high"})


def test_head_change_needed_is_a_card_while_preparing_and_refused_once_ready(api):
    rid = _submitted(api)
    ok(upload(api, rid, MD_AM, data=sample_pdf()))  # Preparing
    ok(_change(api, rid, NOHA))
    assert detail(api, rid, NOHA)["status"] == "in_progress", "while preparing it is only a card for the AM"

    ok(act(api, rid, "mark_ready", MD_AM, amPrice=95000))
    refused = _change(api, rid, NOHA)
    assert refused.status_code == 403
    assert error(refused)["message"] == "Once the proposal is ready, only the BD owner can send it back for changes."
    assert detail(api, rid, NOHA)["status"] == "ready_for_bd", "nothing moved"

    ok(_change(api, rid, AHMED))  # the BD owner still can
    assert detail(api, rid, AHMED)["status"] == "revision_requested"


def test_the_request_form_lists_the_clients_of_someone_who_brings_in_clients(api, session):
    """Doaa (Executive with "Brings in clients") may create requests for her own clients: the form must list them."""
    from app.models import Client
    from .conftest import as_user
    doaa = as_user("u-doaa", "executive")
    session.get(Client, cl(8)).owner_id = "u-doaa"
    session.commit()
    items = api.get("/api/clients", params={"creatable": "true"}, headers=doaa).json()["items"]
    assert [c["id"] for c in items] == [cl(8)], "only her own clients"
    tony = as_user("u-tony", "executive")  # no "Brings in clients": none
    assert api.get("/api/clients", params={"creatable": "true"}, headers=tony).json()["items"] == []


def test_update_details_refuses_moving_the_event_before_the_unchanged_deadline(api):
    rid = _submitted(api)  # event in 40 days, deadline in 10
    v = detail(api, rid, AHMED)["rowVersion"]
    moved = api.patch(f"/api/proposal-requests/{rid}/details", headers=AHMED,
                      json={"eventDate": future(5), "expectedRowVersion": v})
    assert moved.status_code == 422
    assert error(moved)["fields"] == {"eventDate": "The event must start after the proposal deadline. Change the deadline too."}
    ok(api.patch(f"/api/proposal-requests/{rid}/details", headers=AHMED,
                 json={"eventDate": future(5), "requiredBy": future(2), "expectedRowVersion": v}))


# ---------- Permanent delete (requests, events, clients) ----------

def test_the_bd_owner_deletes_a_request_and_everything_attached_goes_for_good(api, engine):
    from sqlalchemy import text
    from .conftest import SHERINE
    rid = _submitted(api)
    ok(upload(api, rid, MD_AM, data=sample_pdf()))
    ok(api.post(f"/api/proposal-requests/{rid}/comments", headers=AHMED, json={"kind": "comment", "body": "hello"}))
    assert detail(api, rid, AHMED)["canDelete"]["allowed"] is True
    assert detail(api, rid, MD_AM)["canDelete"]["allowed"] is False, "the AM cannot delete it"
    other = api.post(f"/api/proposal-requests/{rid}/delete", headers=SHERINE,
                     json={"expectedRowVersion": detail(api, rid, NOHA)["rowVersion"]})
    assert other.status_code == 403, "another BD sees it but cannot delete it"
    am = api.post(f"/api/proposal-requests/{rid}/delete", headers=MD_AM,
                  json={"expectedRowVersion": detail(api, rid, MD_AM)["rowVersion"]})
    assert am.status_code == 403
    done = ok(api.post(f"/api/proposal-requests/{rid}/delete", headers=AHMED,
                       json={"expectedRowVersion": detail(api, rid, AHMED)["rowVersion"]}))
    assert done["deleted"] == rid
    assert api.get(f"/api/proposal-requests/{rid}", headers=NOHA).status_code == 404
    with engine.connect() as conn:
        for table in ("request_status_history", "request_comments", "proposal_files"):
            assert conn.execute(text(f"SELECT count(*) FROM {table} WHERE request_id = :r"), {"r": rid}).scalar() == 0
        # History is still append-only afterwards: the guard was lifted for that one delete only.
        import pytest
        from sqlalchemy.exc import IntegrityError, OperationalError
        with pytest.raises((IntegrityError, OperationalError), match="append-only"):
            conn.execute(text("DELETE FROM request_status_history WHERE id = (SELECT min(id) FROM request_status_history)"))
        conn.rollback()


def test_the_head_deletes_a_client_with_its_proposals_events_and_contacts(api, engine):
    from sqlalchemy import text
    rid = _submitted(api)  # a request for CL-0008
    client = api.get(f"/api/clients/{cl(8)}", headers=NOHA).json()
    assert client["canDelete"]["allowed"] is True and client["deleteImpact"]["proposals"] >= 1
    stale = api.post(f"/api/clients/{cl(8)}/delete", headers=NOHA, json={"expectedRowVersion": client["rowVersion"] - 1})
    assert stale.status_code == 409
    ok(api.post(f"/api/clients/{cl(8)}/delete", headers=NOHA, json={"expectedRowVersion": client["rowVersion"]}))
    assert api.get(f"/api/clients/{cl(8)}", headers=NOHA).status_code == 404
    assert api.get(f"/api/proposal-requests/{rid}", headers=NOHA).status_code == 404
    with engine.connect() as conn:
        for table, col in (("client_contacts", "client_id"), ("opportunities", "client_id"), ("proposal_requests", "client_id"),
                           ("client_history", "client_id")):
            assert conn.execute(text(f"SELECT count(*) FROM {table} WHERE {col} = :c"), {"c": cl(8)}).scalar() == 0


def test_a_draft_is_deleted_only_by_its_creator(api):
    rid = ok(create(api, AHMED, clientId=cl(8), brand="teamup", service="team_building"))["request"]["id"]
    noha = api.post(f"/api/proposal-requests/{rid}/delete", headers=NOHA, json={"expectedRowVersion": 1})
    assert noha.status_code == 404, "someone else's draft stays invisible"
    ok(api.post(f"/api/proposal-requests/{rid}/delete", headers=AHMED,
                json={"expectedRowVersion": detail(api, rid, AHMED)["rowVersion"]}))

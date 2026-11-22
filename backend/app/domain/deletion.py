"""
Who may delete permanently (the business's rule, Nov 2026: whoever may edit it).

  A draft: its creator. A submitted request, or an event (a confirmed request): the Commercial Head, or its
  BD owner acting as BD. A client: the Commercial Head, or its relationship owner acting as BD.
"""

from ..config_domain import COMMERCIAL_HEAD
from .access import acts_as_business_development
from .permissions import BD_OWNER, check_actors
from .workflow import can_edit_draft

OK = {"allowed": True, "reason": None}


def _deny(reason: str) -> dict:
    return {"allowed": False, "reason": reason}


def can_delete_request(r, viewer, users: dict) -> dict:
    if r.status == "draft":
        return OK if can_edit_draft(r, viewer, users) else _deny("Only the person who created this draft can delete it.")
    if viewer.active_role == COMMERCIAL_HEAD:
        return OK
    if check_actors([BD_OWNER], r, viewer, users)["allowed"]:
        return OK
    return _deny("Only the BD owner or the Commercial Head can delete this.")


def can_delete_client(client: dict, viewer, users: dict) -> dict:
    if viewer.active_role == COMMERCIAL_HEAD:
        return OK
    if viewer.user_id == client["owner"] and acts_as_business_development(viewer, users.get(viewer.user_id)):
        return OK
    return _deny("Only the client's owner or the Commercial Head can delete this client.")

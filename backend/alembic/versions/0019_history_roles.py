"""History and comments accept every role (HR and the office screen too)

0017 added 'hr' and 'office_screen' to user_roles only. The models allow every role on the history tables and
comments, so the database is brought in line: a write by someone acting as HR (e.g. HR with "Manage accounts"
changing an account or the routing) is recorded instead of failing on the old CHECK.

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-03 10:00:00
"""

import importlib.util
from pathlib import Path

revision = '0019'
down_revision = '0018'
branch_labels = None
depends_on = None

_spec = importlib.util.spec_from_file_location("_m0007", Path(__file__).with_name("0007_real_data_import.py"))
_m0007 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_m0007)
_replace_checks = _m0007._replace_checks

OLD_ROLES = "role IN ('commercial_head', 'account_manager', 'business_development', 'executive', 'marketing', 'operations')"
NEW_ROLES = ("role IN ('commercial_head', 'account_manager', 'business_development', 'executive', 'marketing', 'operations', "
             "'hr', 'office_screen')")
TABLES = ('request_status_history', 'request_events', 'request_comments', 'opportunity_history', 'client_history',
          'user_history', 'routing_history')


def upgrade() -> None:
    for table in TABLES:
        _replace_checks(table, [(OLD_ROLES, NEW_ROLES)])


def downgrade() -> None:
    for table in reversed(TABLES):
        _replace_checks(table, [(NEW_ROLES, OLD_ROLES)], [f"DELETE FROM {{t}} WHERE NOT ({OLD_ROLES})"])

"""The event plan: a checklist, payments received and a run sheet per confirmed event

- event_tasks: title, optional assignee and due date, done (when, by whom), position.
- event_payments: deposit / balance / other, amount (whole EGP, > 0), received on, optional note.
- proposal_requests.run_sheet: the day's timings as text (one line each).
Additive only: nothing existing changes.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-22 10:00:00
"""

from alembic import op
import sqlalchemy as sa

revision = '0020'
down_revision = '0019'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('proposal_requests', sa.Column('run_sheet', sa.Text(), nullable=True))
    op.create_table(
        'event_tasks',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('request_id', sa.String(length=16), sa.ForeignKey('proposal_requests.id'), nullable=False, index=True),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('assignee_id', sa.String(length=50), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('due_on', sa.Date(), nullable=True),
        sa.Column('done_at', sa.DateTime(), nullable=True),
        sa.Column('done_by_id', sa.String(length=50), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('created_by_id', sa.String(length=50), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_table(
        'event_payments',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('request_id', sa.String(length=16), sa.ForeignKey('proposal_requests.id'), nullable=False, index=True),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('received_on', sa.Date(), nullable=False),
        sa.Column('note', sa.String(length=300), nullable=True),
        sa.Column('recorded_by_id', sa.String(length=50), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("kind IN ('deposit', 'balance', 'other')", name='ck_event_payments_kind'),
        sa.CheckConstraint('amount > 0', name='ck_event_payments_amount'),
    )


def downgrade() -> None:
    op.drop_table('event_payments')
    op.drop_table('event_tasks')
    with op.batch_alter_table('proposal_requests') as batch:
        batch.drop_column('run_sheet')

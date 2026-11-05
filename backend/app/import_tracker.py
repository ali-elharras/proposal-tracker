"""
Imports the Proposal Tracker spreadsheet (the 2026 sheet, and earlier years' sheets) into the REAL database.

    python -m app.import_tracker <file.xlsx>                         dry run: prints what it would create, skip and merge
    python -m app.import_tracker <file.xlsx> --apply                 does it, in one transaction (all or nothing)
    python -m app.import_tracker <file.xlsx> --sheet 2025,2026       several sheets in one run (clients shared)

Options: --sheet (default "Sheet1"; a comma list for several), --as <user id> (who runs the import; default u-noha).

Earlier years (a sheet named for a year before 2026, e.g. "2025") are history: every row is closed. Their
layout may differ: the header row is found by its "#" column, "Person in Charge" is the BD who brought the
brief, and when there is no Status column the status is the row's colour (the sheet's legend: Done, Confirmed,
Pending, Postponed, Cancelled). A 2025 row keeps its own key (2025 * 1000 + its "#"), so years never clash.
With --close-pending-older-than N, a 2026 "Pending" brief older than N days is closed as lost (never answered).

Repeatable: every request keeps the sheet's "#" (import_row, unique), so a second run creates
nothing it created before. Clients are matched by name ignoring case, spaces and punctuation.
Only a database marked data_kind = 'real' is ever written (python -m app.setup_real).

The 2026 tracker is our live starting point (not history): open rows stay open work.
What the sheet never had is never invented: no prices, participants, files or lost reasons.
Each request gets history steps from the sheet's own dates (sheet_history), each marked
"From the 2026 tracker (row #N)"; who ran the import is stored but never shown.
"""

import argparse
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from .clock import cairo_today_iso
from .config_domain import BRANDS
from .database import begin_write, make_engine, make_sessionmaker, utcnow
from .domain.access import default_privileges, set_privileges
from .domain.accounts import initials_for, new_account_id
from .domain.crm import _similar_names, normalize_name
from .domain.events import event_timing
from .identity import Actor
from .models import Client, ClientBrand, ClientHistory, ProposalRequest, RequestStatusHistory, User, UserRole
from .seed.guards import data_kind
from .services.ids import next_client_id, next_request_id
from .services.opportunities import create_opportunity
from .services.routing import current_routing
from .setup_real import real_database_url

CAIRO = ZoneInfo("Africa/Cairo")
SHEET = "Sheet1"
IMPORT_NOTE = "From the 2026 tracker (row #{n})"
YEAR_NOTE = "From the {year} tracker (row #{n})"
LIVE_YEAR = 2026  # the live tracker; earlier sheets are closed history
PENDING_STALE_DAYS = None  # --close-pending-older-than N: a 2026 "Pending" brief older than N days is closed as lost
FORMER = "Former team member"

# "Brief Sent by" -> account. Anyone else becomes an INACTIVE account ("Former team member").
SENDERS = {"noha": "u-noha", "doaa": "u-doaa", "seif": "u-ahmed", "shams": "u-abdelrahman",
           "sherine": "u-sherine", "mariam": "u-mariam-elkhayat"}
BRAND_CODES = {"tgh": "grasshoppers", "team-up": "teamup", "teamup": "teamup", "team up": "teamup",
               # Grip 'N Climb is another company's brand: a row shared with TGH is imported as Grasshoppers only.
               "gnc & tgh": "grasshoppers", "tgh, gnc & tgh": "grasshoppers", "tgh & gnc": "grasshoppers",
               "team up, tgh": "teamup"}
SKIPPED_BRANDS = {"gnc", "grip 'n climb", "grip n climb"}
BLANK_SENDER = "noha"  # a row with nobody in charge belongs to the Commercial Head
BRAND_NAMES = {b["id"]: b["name"] for b in BRANDS}
SERVICE_LABELS = {(b["id"], s["id"]): s["label"] for b in BRANDS for s in b["services"]}

# Sheet status -> (request status, opportunity stage). The tracker is our live starting point:
#   Event Completed / Approved -> Confirmed (the event is Done once its date has passed)
#   Canceled                   -> Lost (reason "Not recorded" until corrected)
#   Postponed                  -> Postponed (active; follow-up in 7 days)
#   Preparing Phase            -> In Progress (with the assigned AM, in their queue)
#   Pending                    -> Shared with Client (waiting for the client's reply)
STATUS = {
    "event completed": ("accepted", "won"),
    "approved": ("accepted", "won"),
    "preparing phase": ("in_progress", "proposal_requested"),
    "canceled": ("rejected", "lost"),
    "cancelled": ("rejected", "lost"),
    "postponed": ("postponed", "negotiation"),
    "pending": ("shared_with_client", "negotiation"),
}
STATUS_LABELS = {"accepted": "Confirmed", "rejected": "Lost", "postponed": "Postponed", "in_progress": "In Progress",
                 "shared_with_client": "Shared with Client", "closed_postponed": "Closed · postponed"}

# An earlier year's sheet (closed history): its status -> (request status, opportunity stage). Done is the
# event done ("Event Completed"); Postponed was never followed up, so it is closed, not a live follow-up.
PAST_STATUS = {
    "done": ("accepted", "won"),
    "confirmed": ("accepted", "won"),
    "event completed": ("accepted", "won"),
    "approved": ("accepted", "won"),
    "cancelled": ("rejected", "lost"),
    "canceled": ("rejected", "lost"),
    "pending": ("rejected", "lost"),
    "postponed": ("closed_postponed", "closed_no_result"),
}
# The sheets' colour legend (when a sheet has no Status column): fill colour -> status.
FILL_STATUS = {"FF00FFFF": "Done", "FF00FF00": "Confirmed", "FFFFFF00": "Pending", "FFFF9900": "Postponed",
               "FFFF0000": "Cancelled"}
FOLLOW_UP_DAYS = 7

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november",
     "december"], start=1)}
MONTHS.update({name[:3]: n for name, n in list(MONTHS.items())})
MONTHS["sept"] = 9

# Clients merged on Noha's instruction (name -> rule on the sheet's client text, lower case). What the
# sheet added to the client name becomes the request's event name (see event_name). No other names are merged.
RAMADAN_IFTAR = ("ramadan iftar", "ramadan iftar - onsite", "ramadan iftar - women rooftop")  # rows 19-21: Talabat's
MERGES = {
    # Every "Talabat ..." row (not "Instashop / Talabat", its own client), the three Ramadan Iftar rows and
    # the Ramadan Riders Football Tournament rows (10-12); their event name is the sheet's whole client text.
    "Talabat": lambda t: (t == "talabat" or t.startswith("talabat ") or t in RAMADAN_IFTAR
                          or t.startswith("ramadan riders football tournament")),
    "Fade": lambda t: t in ("fade", "fade easter", "fade eid fitr", "fade summer season", "fade activation", "etisal (fade)"),
    "Mountain View": lambda t: t in ("mountain view", "mountain view icity"),
    "Capgemini": lambda t: t in ("capgemini", "capgemini architect summit", "capgemini social wellbeing"),
    "Sodic": lambda t: t in ("sodic", "june by sodic"),
    "Azha": lambda t: t in ("azha", "teb (azha)"),
    # Merged when the 2025 and 2026 sheets were imported together (approved by the user, Nov 2026).
    "Cadmus": lambda t: t in ("cadmus", "cadmus el borouj", "cadmus school activation", "cadmus team building"),
    "Sinai Cement": lambda t: t in ("sinai cement", "sinai cement cairo", "sinai cement el 3areesh"),
    "Siemens Healthineers": lambda t: t == "siemens healthineers" or t.startswith("siemens healthineers -"),
    "Wadi Degla": lambda t: t in ("wadi degla", "wadi degla easter", "wadi degla sahel season"),
    "Instashop": lambda t: t in ("instashop", "instashop sports day"),  # "Instashop / Talabat" stays its own client
    "Misr American College": lambda t: t in ("misr american", "misr american college"),
    "Makadi Heights": lambda t: t in ("makadi heights", "shift experience (makadi heights)"),
}
# Event names that are not "the client text without the client's name" (lower-case sheet text -> name).
MERGED_EVENT_NAMES = {"teb (azha)": "TEB", "misr american": "", "misr american college": ""}  # "": the brief text
# Client names cleaned on Noha's instruction (sheet text -> name).
CLIENT_FIXES = {'General Motors (GM) "GlobalStars Agency': "General Motors (GM) – GlobalStars Agency"}


def client_name(client: str) -> str:
    """The client as it will be named: merged, cleaned, or the sheet's text."""
    return merged_name(client) or CLIENT_FIXES.get(client, client)


def merged_name(client: str) -> str | None:
    low = " ".join(client.lower().replace("–", "-").split())
    return next((name for name, rule in MERGES.items() if rule(low)), None)


EVENT_NAME_MAX = 80
_SEPARATORS = " -–—:|,·"


def event_name(client_text: str, brief: str) -> str | None:
    """
    The request's event name. A merged client: the sheet's client text without the client's name
    ("Talabat Ramadan Iftar Riders – Alex" -> "Ramadan Iftar Riders – Alex", "Fade Easter" -> "Easter"),
    or the whole text when it does not start with it ("June by Sodic", "Ramadan Iftar - Onsite"; "TEB (Azha)" -> "TEB").
    Otherwise, or when nothing is left: the brief text. At most 80 characters.
    """
    name = merged_name(client_text)
    text = ""
    if name:
        low = " ".join(client_text.lower().replace("–", "-").split())
        if low in MERGED_EVENT_NAMES:
            text = MERGED_EVENT_NAMES[low]
        elif client_text.lower().startswith(name.lower()):
            text = client_text[len(name):].strip(_SEPARATORS)
        else:
            text = client_text
    text = " ".join((text or brief or "").split())
    if len(text) > EVENT_NAME_MAX:
        text = text[:EVENT_NAME_MAX - 1].rstrip() + "…"
    return text or None


def client_type(name: str, brands: list[str]) -> str:
    """Team Up (or both brands) -> Corporate; a name with "School" -> School; otherwise Other."""
    if "teamup" in brands:
        return "corporate"
    if "school" in name.lower():
        return "school"
    return "other"


COLUMNS = {  # header text (lower case) -> field
    "brief sent by": "sender", "#": "number", "brief date": "brief_date", "client": "client",
    "brief details": "brief", "iee brand": "brand", "deadline": "deadline",
    "propsal send to bd date": "proposal_date", "proposal send to bd date": "proposal_date",
    "expected operation date": "expected", "actual operation date": "actual", "status": "status",
    # earlier years' layout
    "person in charge": "sender", "finacial propsal date": "financial_date", "financial proposal date": "financial_date",
    "sent to client": "sent_date",
}


class ImportRefused(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Reading the sheet
# ---------------------------------------------------------------------------

@dataclass
class Row:
    number: int
    sender: str
    brief_date: date | None
    client: str
    brief: str
    brand_code: str
    deadline: date | None
    proposal_date: date | None
    expected: object
    actual: object
    status: str
    year: int = LIVE_YEAR  # the sheet's year (an earlier year is closed history)
    key: int = 0  # import_row: the "#" for the live year, year * 1000 + "#" for an earlier one

    @property
    def label(self) -> str:
        return f"#{self.number}" if self.year == LIVE_YEAR else f"{self.year} #{self.number}"


def _excel_date(value) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        return date(1899, 12, 30) + timedelta(days=int(value))
    text = str(value).strip()
    if re.fullmatch(r"\d+(\.0+)?", text):
        return date(1899, 12, 30) + timedelta(days=int(float(text)))
    return None


def _sheet_year(sheet: str) -> int:
    return int(sheet) if sheet.strip().isdigit() else LIVE_YEAR


def read_rows(path: str, sheet: str = SHEET) -> list[Row]:
    from openpyxl import load_workbook  # only the import needs it

    wb = load_workbook(path, data_only=True)  # not read-only: an earlier year's status is the row's colour
    if sheet not in wb.sheetnames:
        raise ImportRefused(f'The workbook has no sheet named "{sheet}" (it has: {", ".join(wb.sheetnames)}).')
    ws = wb[sheet]
    year = _sheet_year(sheet)
    all_rows = list(ws.iter_rows())
    # The header is the first row with a "#" column (the 2025 sheet has a title and a colour legend above it).
    header_at = next((i for i, cells in enumerate(all_rows[:8])
                      if "#" in [str(c.value or "").strip() for c in cells]), 0)
    header = [str(c.value or "").strip().lower() for c in all_rows[header_at]]
    index = {COLUMNS[h]: i for i, h in enumerate(header) if h in COLUMNS}
    required = {"sender", "number", "brief_date", "client", "brief", "brand"} | ({"status"} if year == LIVE_YEAR else set())
    missing = required - set(index)
    if missing:
        raise ImportRefused(f"The sheet is missing these columns: {', '.join(sorted(missing))}.")

    def cell(cells, name):
        i = index.get(name)
        return cells[i].value if i is not None and i < len(cells) else None

    def colour_status(cells):
        i = index.get("client", 0)
        fill = cells[i].fill if i < len(cells) else None
        rgb = fill.fgColor.rgb if fill is not None and fill.fill_type not in (None, "none") else None
        return FILL_STATUS.get(rgb, "") if isinstance(rgb, str) else ""

    out = []
    for cells in all_rows[header_at + 1:]:
        values = [c.value for c in cells]
        if not any(v not in (None, "") and str(v).strip() for v in values[:14]):
            continue
        number = cell(cells, "number")
        n = int(float(number)) if number not in (None, "") and str(number).strip() else 0
        proposal = _excel_date(cell(cells, "proposal_date")) or _excel_date(cell(cells, "financial_date"))
        status = str(cell(cells, "status") or "").strip() if "status" in index else colour_status(cells)
        out.append(Row(
            number=n,
            sender=str(cell(cells, "sender") or "").strip(),
            brief_date=_excel_date(cell(cells, "brief_date")),
            client=" ".join(str(cell(cells, "client") or "").split()),
            brief=" ".join(str(cell(cells, "brief") or "").split()),
            brand_code=" ".join(str(cell(cells, "brand") or "").split()).lower(),
            deadline=_excel_date(cell(cells, "deadline")),
            proposal_date=proposal,
            expected=cell(cells, "expected"),
            actual=cell(cells, "actual"),
            status=status,
            year=year,
            key=n if year == LIVE_YEAR else year * 1000 + n,
        ))
    return out


# ---------------------------------------------------------------------------
# Interpreting one row
# ---------------------------------------------------------------------------

@dataclass
class EventDate:
    precision: str  # day | month | unset
    start: date | None = None
    end: date | None = None
    kind: str = ""  # exact | range | month | tbd | empty | unparsed
    text: str = ""


def _year_for(month: int, day: int, brief: date | None) -> int:
    """The brief's year, or the next one when that would put the event well before the brief."""
    year = (brief or date.today()).year
    if brief and date(year, month, min(day, 28)) < brief - timedelta(days=60):
        year += 1
    return year


def parse_event(value, brief: date | None) -> EventDate:
    exact = _excel_date(value)
    if exact:
        return EventDate("day", exact, None, "exact")
    text = " ".join(str(value or "").split())
    low = text.lower()
    if not text:
        return EventDate("unset", kind="empty")
    if low in ("tbd", "tba", "to be decided", "not set"):
        return EventDate("unset", kind="tbd", text=text)
    m = re.fullmatch(r"(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?", low)
    if m and m.group(3) in MONTHS:
        d1, d2, month = int(m.group(1)), int(m.group(2)), MONTHS[m.group(3)]
        year = int(m.group(4)) if m.group(4) else _year_for(month, d1, brief)
        try:
            start, end = date(year, month, d1), date(year, month, d2)
            if end >= start:
                return EventDate("day", start, end, "range", text)
        except ValueError:
            pass
    m = re.fullmatch(r"(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?", low)
    if m and m.group(2) in MONTHS:
        day, month = int(m.group(1)), MONTHS[m.group(2)]
        year = int(m.group(3)) if m.group(3) else _year_for(month, day, brief)
        try:
            return EventDate("day", date(year, month, day), None, "exact", text)
        except ValueError:
            pass
    m = re.fullmatch(r"([a-z]+)\.?(?:\s+(\d{4}))?", low)
    if m and m.group(1) in MONTHS:
        month = MONTHS[m.group(1)]
        year = int(m.group(2)) if m.group(2) else _year_for(month, 1, brief)
        return EventDate("month", date(year, month, 1), None, "month", text)
    return EventDate("unset", kind="unparsed", text=text)


def map_service(brand: str, brief: str) -> str:
    """Best match from the brand's services; otherwise the brand's general one. Never a new service."""
    t = brief.lower()
    if brand == "teamup":
        if "team bonding" in t or "team building" in t:
            return "team_building"
        if "family day" in t:
            return "family_day"
        if "town hall" in t or "get together" in t or "get-together" in t:
            return "corporate_event"
        return "event_activation"  # activations, giveaways, awareness days, office events
    if "day camp" in t or "summer camp" in t:
        return "summer_camp"
    if "family day" in t:
        return "family_day"
    if "activation" in t:
        return "activation"
    return "kids_activity"  # one-off events: Christmas, Halloween, Sports Day, Bring Your Child to Work, ...


def map_status(text: str, has_proposal_date: bool = False) -> tuple[str, str] | None:
    return STATUS.get(text.strip().lower())


def row_status(row: Row, today: date, stale_days: int | None = PENDING_STALE_DAYS) -> tuple[str, str, str | None] | None:
    """
    (request status, opportunity stage, why it differs from the sheet or None). An earlier year's row is
    closed history (PAST_STATUS); in the live sheet, when stale_days is given, a "Pending" brief older than
    that was never answered and is closed as lost.
    """
    if row.year != LIVE_YEAR:
        mapped = PAST_STATUS.get(row.status.strip().lower())
        return (*mapped, None) if mapped else None
    mapped = map_status(row.status, row.proposal_date is not None)
    if mapped is None:
        return None
    if stale_days is not None and mapped[0] == "shared_with_client" and row.brief_date             and (today - row.brief_date).days > stale_days:
        return ("rejected", "lost", f"pending since {row.brief_date.isoformat()}, closed as cancelled on import")
    return (*mapped, None)


def _cell_day(value, brief: date | None) -> date | None:
    """A date column (exact date, "12 March", a range's last day, or a month's first day), else None."""
    ev = parse_event(value, brief)
    return ev.end or ev.start


def sheet_history(row: Row, status: str, today: date) -> list[tuple[str, date]]:
    """
    The history steps of an imported row, from the sheet's own dates:
      Submitted = Brief Date; Ready for BD and Shared = the proposal date (when present);
      the outcome (Confirmed, Lost, Postponed) = Actual, else Expected Operation Date, else Brief Date.
    Never in the future and never before the step before it. -> [(status, day)]
    """
    brief = row.brief_date
    steps = [("submitted", brief)]
    if status == "in_progress":
        steps.append(("in_progress", brief))
    else:
        if row.proposal_date:
            steps += [("ready_for_bd", row.proposal_date), ("shared_with_client", row.proposal_date)]
        elif status == "shared_with_client":
            steps.append(("shared_with_client", brief))
        if status in ("accepted", "rejected", "postponed", "closed_postponed"):
            outcome = _cell_day(row.actual, brief) or _cell_day(row.expected, brief) or brief
            steps.append((status, outcome))
    out, prev = [], brief
    for st, day in steps:
        day = max(min(day or brief, today), prev)
        out.append((st, day))
        prev = day
    return out


def _at(day: date, hour: int) -> datetime:
    return datetime.combine(day, time(hour, 0), tzinfo=CAIRO).astimezone(ZoneInfo("UTC"))


# ---------------------------------------------------------------------------
# The plan (what a run would do) and applying it
# ---------------------------------------------------------------------------

@dataclass
class Planned:
    row: Row
    brand: str
    service: str
    status: str
    stage: str
    event: EventDate
    owner_key: str  # sender key (lower case)
    client_key: str  # normalised client name
    client_name: str  # the client as it will be named (after a merge)
    needs_review: bool = False  # Pending without a proposal date: imported as In Progress, to be checked
    event_name: str | None = None  # see event_name()
    status_note: str | None = None  # e.g. a long-pending row closed as cancelled on import


@dataclass
class Plan:
    rows_read: int = 0
    create: list[Planned] = field(default_factory=list)
    skipped: list[tuple[Row, str]] = field(default_factory=list)
    already: int = 0
    new_people: dict = field(default_factory=dict)  # sender key -> display name
    clients_new: dict = field(default_factory=dict)  # key -> {"name", "brands", "owner_key", "spellings"}
    clients_existing: dict = field(default_factory=dict)  # key -> client id
    similar: list[tuple[str, str]] = field(default_factory=list)


def _sender_key(name: str) -> str:
    return name.strip().lower()


def build_plan(db: Session, rows: list[Row], today: date | None = None, stale_days: int | None = None) -> Plan:
    today = today or date.today()
    plan = Plan(rows_read=len(rows))
    imported = set(db.scalars(select(ProposalRequest.import_row).where(ProposalRequest.import_row.is_not(None))).all())
    existing = {normalize_name(c.name): c.id for c in db.scalars(select(Client)).all()}
    users = {u.id: u for u in db.scalars(select(User)).all()}
    groups = defaultdict(list)
    for row in sorted(rows, key=lambda r: (r.year, r.number)):
        if row.brand_code in SKIPPED_BRANDS:
            plan.skipped.append((row, f"{row.brand_code.upper()} is not one of our brands"))
            continue
        brand = BRAND_CODES.get(row.brand_code)
        mapped = row_status(row, today, stale_days)
        if brand is None:
            plan.skipped.append((row, f'unknown brand "{row.brand_code}"'))
            continue
        if mapped is None:
            plan.skipped.append((row, f'unknown status "{row.status}"'))
            continue
        if not row.client or not row.brief_date:
            plan.skipped.append((row, "no client or no brief date"))
            continue
        if row.key in imported:
            plan.already += 1
            continue
        key = _sender_key(row.sender) or BLANK_SENDER
        if key not in SENDERS:
            plan.new_people[key] = row.sender.strip().title()
        event = parse_event(row.actual if row.actual not in (None, "") else row.expected, row.brief_date)
        name = client_name(row.client)
        planned = Planned(row, brand, map_service(brand, row.brief), mapped[0], mapped[1], event, key,
                          normalize_name(name), name, False, event_name(row.client, row.brief), mapped[2])
        plan.create.append(planned)
        groups[planned.client_key].append(planned)

    def active_sender(key):
        uid = SENDERS.get(key)
        return uid is not None and uid in users and users[uid].active

    for key, items in groups.items():
        if key in existing:
            plan.clients_existing[key] = existing[key]
            continue
        latest_first = sorted(items, key=lambda p: (p.row.brief_date, p.row.key), reverse=True)
        owner = next((p.owner_key for p in latest_first if active_sender(p.owner_key)), "noha")
        brands = []
        for p in sorted(items, key=lambda p: (p.row.year, p.row.number)):
            if p.brand not in brands:
                brands.append(p.brand)
        plan.clients_new[key] = {"name": latest_first[0].client_name, "brands": brands, "owner_key": owner,
                                 "spellings": sorted({p.row.client for p in items}),
                                 "merged": merged_name(latest_first[0].row.client) is not None,
                                 "type": client_type(latest_first[0].client_name, brands)}
    names = sorted({v["name"] for v in plan.clients_new.values()})
    plan.similar = [(a, b) for i, a in enumerate(names) for b in names[i + 1:] if _similar_names(a, b)]
    return plan


def _user_id_for(db: Session, key: str, display: str, people: dict, now: datetime) -> str:
    if key in SENDERS:
        return SENDERS[key]
    if key in people:
        return people[key]
    existing = db.scalars(select(User).where(User.job_title == FORMER, User.name == display)).first()
    if existing:
        people[key] = existing.id
        return existing.id
    ids = list(db.scalars(select(User.id)).all())
    uid = new_account_id(display, ids)
    email = f"{uid.removeprefix('u-')}@eventflow.example"
    user = User(id=uid, name=display, initials=initials_for(display), avatar_tone=(len(ids) % 6) + 1, brand=None,
                active=False, email=email, job_title=FORMER, created_at=now, updated_at=now)
    set_privileges(user, default_privileges(["business_development"]))
    user.roles = [UserRole(role="business_development", position=0)]
    db.add(user)
    db.flush()
    people[key] = uid
    return uid


def _brief(row: Row) -> str | None:
    """The brief exactly as the sheet has it (the event name is its own field)."""
    return row.brief or None


def import_note(number: int, year: int = LIVE_YEAR) -> str:
    return IMPORT_NOTE.format(n=number) if year == LIVE_YEAR else YEAR_NOTE.format(year=year, n=number)


def history_entries(steps, number: int, actor: Actor, follow_up: date | None, year: int = LIVE_YEAR,
                    extra: str | None = None) -> list[RequestStatusHistory]:
    """One imported entry per step (shown as "From the 2026 tracker (row #N)", never with a name)."""
    note = import_note(number, year) + (f" · {extra}" if extra else "")
    return [RequestStatusHistory(
        seq=i + 1, status=st, changed_by_id=actor.user_id, role=actor.active_role, changed_at=_at(day, 9 + i),
        note=note if i == len(steps) - 1 else import_note(number, year), version=1,
        lost_reason="not_recorded" if st == "rejected" else None,
        follow_up_on=follow_up if st == "postponed" else None, imported=True,
    ) for i, (st, day) in enumerate(steps)]


def apply_plan(db: Session, plan: Plan, importer: str, now: datetime) -> dict:
    begin_write(db)
    me = db.get(User, importer)
    if me is None:
        raise ImportRefused(f"Unknown account {importer!r} for --as.")
    actor = Actor(importer, me.role_ids[0])
    today = date.fromisoformat(cairo_today_iso(now))
    routing = current_routing(db)
    people: dict = {}
    client_ids = dict(plan.clients_existing)
    for key, c in plan.clients_new.items():
        client = Client(id=next_client_id(db), name=c["name"], client_type=c["type"], city=None,
                        owner_id=_user_id_for(db, c["owner_key"], plan.new_people.get(c["owner_key"], c["owner_key"]),
                                              people, now),
                        notes=None, created_at=now, updated_at=now)
        client.brands = [ClientBrand(brand=b, position=i) for i, b in enumerate(c["brands"])]
        db.add(client)
        db.flush()
        db.add(ClientHistory(client_id=client.id, event="created", changed_by_id=actor.user_id, role=actor.active_role,
                             changed_at=now, details={"importedFrom": "Proposal Tracker", "owner": client.owner_id}))
        client_ids[key] = client.id

    created = Counter()
    for p in plan.create:
        row, ev = p.row, p.event
        owner = _user_id_for(db, p.owner_key, plan.new_people.get(p.owner_key, row.sender), people, now)
        steps = sheet_history(row, p.status, today)
        when = _at(steps[-1][1], 12)
        submitted = _at(row.brief_date, 9)
        follow_up = today + timedelta(days=FOLLOW_UP_DAYS) if p.status == "postponed" else None
        opp = create_opportunity(
            db, actor=actor, client_id=client_ids[p.client_key], brand=p.brand, service=p.service, owner_id=owner,
            stage=p.stage, event_date=ev.start, event_date_precision="month" if ev.precision == "month" else "day",
            lost_reason="not_recorded" if p.stage == "lost" else None, reason_code="imported",
            note=import_note(row.number, row.year), now=when, allow_inactive_owner=True,
        )
        opp.imported = True
        opp.event_end_date = ev.end
        opp.event_name = p.event_name
        request = ProposalRequest(
            id=next_request_id(db, submitted), opportunity_id=opp.id, client_id=client_ids[p.client_key],
            brand=p.brand, service=p.service, bd_owner_id=owner, created_by_id=owner, assigned_am_id=routing[p.brand],
            submitted_by_id=owner, submitted_at=submitted, status=p.status, required_by=row.deadline,
            event_date=ev.start, event_date_precision=ev.precision, event_end_date=ev.end, follow_up_on=follow_up,
            participants=None, requirements_summary=_brief(row), specific_requirements=None, am_price=None,
            version=1, price_change=None, last_updated=when, imported=True, import_row=row.key,
            # An earlier year's "Done" is an event done (the Events page reads "Event Completed" as Done).
            original_status=("Event Completed" if row.year != LIVE_YEAR and p.status == "accepted" else row.status),
            needs_review=False, event_name=p.event_name,
            event_status="confirmed" if p.status == "accepted" else None, created_at=submitted, updated_at=when,
        )
        request.history = history_entries(steps, row.number, actor, follow_up, row.year, p.status_note)
        db.add(request)
        db.flush()
        created[p.status] += 1
    db.flush()
    return {"requests": sum(created.values()), "by_status": dict(created), "clients": len(plan.clients_new),
            "people": len(people) - sum(1 for k in people if k in SENDERS)}


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def planned_timing(p: Planned, today: str) -> str | None:
    """The Events page tab this row lands on (shared rule: domain/events.py)."""
    start = None
    if p.event.start:
        start = p.event.start.strftime("%Y-%m") if p.event.precision == "month" else p.event.start.isoformat()
    original = "Event Completed" if p.row.year != LIVE_YEAR and p.status == "accepted" else p.row.status
    return event_timing({"status": p.status, "imported": True, "originalStatus": original,
                         "eventDate": start, "eventEndDate": p.event.end.isoformat() if p.event.end else None,
                         "eventDatePrecision": p.event.precision}, today)


def report(plan: Plan, applied: dict | None = None, today: str | None = None) -> str:
    lines = []
    add = lines.append
    add(f"Rows read: {plan.rows_read}")
    add(f"Requests to create: {len(plan.create)}" + (f"   (already imported before: {plan.already})" if plan.already else ""))
    add(f"Skipped: {len(plan.skipped)}")
    for row, reason in plan.skipped:
        add(f"  {row.year} row #{row.number}: {row.client} ({reason})")
    add("")
    add("Status (sheet -> EventFlow):")
    pairs = Counter((f"{p.row.year} {p.row.status}" + (" (old)" if p.status_note else ""), STATUS_LABELS[p.status])
                    for p in plan.create)
    for (sheet, ours), n in sorted(pairs.items(), key=lambda x: (x[0][1], x[0][0])):
        add(f"  {sheet:<26} -> {ours:<24} {n:>3}")
    totals = Counter(STATUS_LABELS[p.status] for p in plan.create)
    add("  Totals: " + " · ".join(f"{k} {v}" for k, v in sorted(totals.items())))
    stale = [p for p in plan.create if p.status_note]
    if stale:
        add(f"  Pending for a long time, closed as cancelled ({len(stale)}):")
        for p in sorted(stale, key=lambda p: p.row.brief_date):
            add(f"    {p.row.label:<5} {p.row.brief_date}  {p.client_name}")
    add("")
    add("People (Brief Sent by -> account):")
    for key, n in sorted(Counter(p.owner_key for p in plan.create).items()):
        target = SENDERS.get(key)
        add(f"  {key.title():<10} {n:>3}  -> {target or 'NEW inactive account: ' + plan.new_people[key] + ' (Former team member)'}")
    add("")
    add(f"Clients: {len(plan.clients_new)} new, {len(plan.clients_existing)} already in EventFlow")
    owners = Counter(c["owner_key"] for c in plan.clients_new.values())
    add("  Owners (most recent active sender): " + " · ".join(f"{k.title()} {v}" for k, v in sorted(owners.items())))
    types = Counter(c["type"] for c in plan.clients_new.values())
    add("  Types: " + " · ".join(f"{k.title()} {v}" for k, v in sorted(types.items())))
    merges = [c for c in plan.clients_new.values() if len(c["spellings"]) > 1]
    add(f"  Merged ({len(merges)} clients; what the sheet added to the name becomes the event name):")
    for c in merges:
        add(f"    {c['name']} <- {', '.join(s for s in c['spellings'] if s != c['name'])}")
    add(f"  Similar names, NOT merged (please check): {len(plan.similar)}")
    for a, b in plan.similar:
        add(f"    {a}  |  {b}")
    add("")
    add("Services:")
    for brand in ("grasshoppers", "teamup"):
        counts = Counter(p.service for p in plan.create if p.brand == brand)
        add(f"  {BRAND_NAMES[brand]}: " + " · ".join(f"{SERVICE_LABELS[(brand, s)]} {n}" for s, n in counts.most_common()))
    add("  Brief text -> service:")
    by_text = Counter((p.brand, p.row.brief, p.service) for p in plan.create)
    for (brand, text, service), n in sorted(by_text.items()):
        add(f"    {BRAND_NAMES[brand]:<12} {text:<48} -> {SERVICE_LABELS[(brand, service)]:<16} {n:>3}")
    add("")
    kinds = Counter(p.event.kind for p in plan.create)
    add("Event dates: " + " · ".join(f"{k} {v}" for k, v in [
        ("exact date", kinds["exact"]), ("date range", kinds["range"]), ("month only", kinds["month"]),
        ("TBD -> not set", kinds["tbd"]), ("empty -> not set", kinds["empty"]), ("unparsed -> not set", kinds["unparsed"])]))
    for p in plan.create:
        if p.event.kind == "unparsed":
            add(f"  unparsed: row {p.row.label}: {p.event.text!r}")
    add(f"Deadlines missing: {sum(1 for p in plan.create if not p.row.deadline)} · "
        f"proposal dates missing: {sum(1 for p in plan.create if not p.row.proposal_date)}")
    add(f"Opportunities to create: {len(plan.create)} (one per request)")
    add("")
    named = [p for p in plan.create if p.event_name]
    add(f"Event names: {len(named)} of {len(plan.create)} (the brief is kept exactly as in the sheet). Examples:")
    by_number = sorted(plan.create, key=lambda p: (p.row.year, p.row.number))
    one_per_merge = list({p.client_name: p for p in reversed(by_number) if p.client_name != p.row.client}.values())
    others = [p for p in by_number if p.client_name == p.row.client]
    step = max(1, len(others) // max(1, 10 - len(one_per_merge)))
    examples = sorted(one_per_merge, key=lambda p: p.row.number) + others[::step][:10 - len(one_per_merge)]
    for p in examples:
        add(f"  {p.row.label:<5} {p.client_name} · {p.event_name or '—'}   (sheet client: {p.row.client!r})")
    today = today or date.today().isoformat()
    timing = {p.row.key: planned_timing(p, today) for p in plan.create}
    counts = Counter(timing.values())
    upcoming = counts["upcoming"] + counts["undated"]
    done_this_year = sum(1 for p in plan.create if timing[p.row.key] == "done"
                         and (p.event.end or p.event.start or p.row.brief_date).year == int(today[:4]))
    add("")
    add(f"Events page (Won {counts['done'] + upcoming}, as of {today}): Done {counts['done']} · "
        f"Upcoming {upcoming} (of which \"Date not set\" {counts['undated']})")
    add(f"  Top line: \"{done_this_year} done this year · {upcoming} upcoming\"")
    for p in sorted(plan.create, key=lambda p: (p.row.year, p.row.number)):
        if timing[p.row.key] in ("upcoming", "undated"):
            label = "Date not set" if timing[p.row.key] == "undated" else "Upcoming"
            add(f"  {label:<12} {p.row.label:<5} {p.client_name} · {p.event_name or '—'}   "
                f"(sheet status {p.row.status!r}, event {p.event.text or '—'})")
    if applied is not None:
        add("")
        add(f"APPLIED: {applied['requests']} requests, {applied['clients']} clients, {applied['people']} new inactive accounts.")
    else:
        add("")
        add("Dry run: nothing was changed. Run again with --apply to import.")
    return "\n".join(lines)


def run(path: str, *, database_url: str, apply: bool = False, importer: str = "u-noha", sheet: str = SHEET,
        now: datetime | None = None, stale_days: int | None = None) -> str:
    now = now or utcnow()
    rows = [row for name in sheet.split(",") if name.strip() for row in read_rows(path, name.strip())]
    engine = make_engine(database_url)
    try:
        with make_sessionmaker(engine)() as db:
            kind = data_kind(db)
            if kind != "real":
                raise ImportRefused(f"Refusing: this database is not the real one (data_kind={kind!r}). "
                                    "Run python -m app.setup_real first; the demo database is never imported into.")
            today = cairo_today_iso(now)
            plan = build_plan(db, rows, date.fromisoformat(today), stale_days)
            if not apply:
                return report(plan, today=today)
            applied = apply_plan(db, plan, importer, now)
            db.commit()
            return report(plan, applied, today=today)
    finally:
        engine.dispose()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.import_tracker", description="Import the Proposal Tracker.")
    parser.add_argument("file")
    parser.add_argument("--apply", action="store_true", help="import (without it: dry run, nothing changes)")
    parser.add_argument("--sheet", default=SHEET, help='a sheet, or several separated by commas ("2025,2026")')
    parser.add_argument("--close-pending-older-than", dest="stale_days", type=int, default=None, metavar="DAYS",
                        help='close 2026 "Pending" briefs older than DAYS as cancelled (never answered)')
    parser.add_argument("--as", dest="importer", default="u-noha", help="who runs the import (stored, not shown)")
    args = parser.parse_args(argv)
    try:
        print(run(args.file, database_url=real_database_url(), apply=args.apply, importer=args.importer, sheet=args.sheet,
                  stale_days=args.stale_days))
    except ImportRefused as exc:
        print(str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())

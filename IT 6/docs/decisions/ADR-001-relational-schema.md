# ADR-001: Relational schema with derived pricing and app-owned payment state

## Status
Accepted

## Date
2026-11-19

## Context
PK's Resort replaces a paper schedule booklet. The data is naturally relational: a person books
many schedules, an accommodation hosts many schedules and has several valid prices, and every
schedule has dates plus a payment state. The presentation must also show clear joins,
constraints, triggers, CRUD and meaningful aggregates.

The earlier draft could not fully represent person-based tier limits, person-count naming, and
the required three-state payment flow with a partial downpayment example of ₱1,499 total,
₱1,000 downpayment, and ₱499 remaining.

## Decision
Use four normalized tables — customers, accommodations, rate_tiers, schedules — with
schedules as the fact table holding foreign keys to the other three. Database table names
remain unchanged for schema stability, while the UI presents customers as Persons.

rate_tiers owns tier_name, max_persons, rate_amount and rate_basis (PER_NIGHT or
FLAT). Exact tier names are Up to 2 persons, Up to 7 persons, and Flat 5-hour event.
schedules stores booking_kind, dates, person_count, downpayment_amount,
payment_status and paid_at.

payment_status is one of UNPAID, DOWNPAYMENT, PAID with a CHECK constraint.
DOWNPAYMENT means a partial amount has been paid with remaining balance due at check-in.
A validate_schedule_rules BEFORE INSERT/UPDATE trigger derives totals from the tier, enforces
room night/event same-day rules, caps person_count at max_persons, and rejects downpayment
values that are impossible for the chosen status. A set_updated_at() trigger maintains audit
timestamps.

Expose a v_schedule_details view for joined reads. It derives 
ights, total_amount,
downpayment_amount, remaining_balance, check_in_label, check_out_label and
time_window. All database access goes through parameterized queries in the Express backend;
.env holds credentials and is never committed. Row-level security is not enabled because there
is no direct client/PostgREST access and a single trusted backend role is used — this must be
revisited if tables are exposed directly.

## Alternatives Considered
- **One flat schedules table with repeated person/accommodation/price text:** simpler to show,
  but duplicates data and cannot enforce referential integrity — rejected.
- **Hardcoded prices in application code:** avoids a tier table, but makes rule changes error-prone
  and weakens data integrity — rejected.
- **Separate payments table deriving status from rows:** more realistic accounting, but adds
  complexity outside the brief — deferred.
- **Storing derived totals/balances as writable columns:** risks stale or inconsistent values;
  deriving them in v_schedule_details and enforcing rules in triggers is safer — rejected.

## Consequences
- Joins remain simple enough for the IT 6 demonstration, and the view keeps the API/UI consistent.
- ON DELETE RESTRICT on customer/accommodation/tier references protects history; rate_tiers
  cascades only from its parent accommodation.
- Changing a rate in rate_tiers automatically changes derived estimates without editing code.
- Correct weekday labels and time windows are derived centrally (Mon, 2026-11-02 -> Thu, 2026-11-05,
  Check-in: 1:00 PM / Check-out: 11:00 AM, 5-Hour Event Window).
- The live database must be dropped and reloaded after schema changes, and the server restarted.r

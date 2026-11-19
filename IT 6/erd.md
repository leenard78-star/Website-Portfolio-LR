# ERD — PK's Resort Scheduling & Payment System

## Mermaid ER diagram

The lines use ||--o{: every child booking or tier must have exactly one parent, while each
parent may have zero or many children.

`mermaid
erDiagram
    CUSTOMERS ||--o{ SCHEDULES : "books"
    ACCOMMODATIONS ||--o{ RATE_TIERS : "priced_by"
    ACCOMMODATIONS ||--o{ SCHEDULES : "hosts"
    RATE_TIERS ||--o{ SCHEDULES : "charges"

    CUSTOMERS {
        BIGINT customer_id PK "generated identity"
        TEXT full_name "2-100 chars"
        TEXT email "UK, lowercase"
        TEXT phone "UK, +63 mobile format"
        TEXT address "nullable"
        TIMESTAMPTZ created_at "default NOW"
        TIMESTAMPTZ updated_at "trigger-managed"
    }

    ACCOMMODATIONS {
        BIGINT accommodation_id PK "generated identity"
        TEXT name "UK, Room 1-6 or Exclusive Resort Event (5 Hours)"
        TEXT accommodation_type "CHECK ROOM or EVENT"
        INTEGER capacity "CHECK 1-7"
        TEXT description "event warning for EVENT rows"
        BOOLEAN is_active "default TRUE"
        TIMESTAMPTZ created_at "default NOW"
    }

    RATE_TIERS {
        BIGINT rate_tier_id PK "generated identity"
        BIGINT accommodation_id FK "UQ with tier_name, ON DELETE CASCADE"
        TEXT tier_name "UQ with accommodation_id"
        INTEGER max_persons "CHECK 1-7"
        NUMERIC rate_amount "CHECK > 0, PHP"
        TEXT rate_basis "CHECK PER_NIGHT or FLAT"
        BOOLEAN is_active "default TRUE"
        TIMESTAMPTZ created_at "default NOW"
    }

    SCHEDULES {
        BIGINT schedule_id PK "generated identity"
        BIGINT customer_id FK "ON DELETE RESTRICT"
        BIGINT accommodation_id FK "ON DELETE RESTRICT"
        BIGINT rate_tier_id FK "ON DELETE RESTRICT"
        TEXT booking_kind "CHECK ROOM_STAY or EVENT_5HR"
        DATE check_in_date "required"
        DATE check_out_date "required, rule-checked"
        INTEGER person_count "CHECK 1-7"
        NUMERIC downpayment_amount "CHECK >= 0, PHP"
        TEXT payment_status "UNPAID, DOWNPAYMENT, PAID"
        TIMESTAMPTZ paid_at "required when PAID"
        TEXT notes "nullable"
        TIMESTAMPTZ created_at "default NOW"
        TIMESTAMPTZ updated_at "trigger-managed"
    }
`

## Column dictionary

BIGINT IDs are generated identities and never reused. NUMERIC(10,2) stores Philippine
pesos exactly. DATE stores calendar days without a timezone. TIMESTAMPTZ stores audit
moments. Database tables remain customers, accommodations, rate_tiers, schedules; the UI
calls customers "Persons" (the persons table is presented as Persons in the UI).

### customers (Persons)

| Column | Type | Key / constraint | Meaning |
| --- | --- | --- | --- |
| customer_id | BIGINT | PK, identity | Stable person identifier |
| full_name | TEXT | NOT NULL, 2–100 chars | Person's complete name |
| email | TEXT | UNIQUE, lowercase | Contact email used by the API |
| phone | TEXT | NOT NULL, 7–20 chars | Example: +63 963 464 2360 |
| address | TEXT | nullable | Optional address |
| created_at | TIMESTAMPTZ | default NOW | Creation time |
| updated_at | TIMESTAMPTZ | trigger-managed | Last edit time |

### accommodations

| Column | Type | Key / constraint | Meaning |
| --- | --- | --- | --- |
| accommodation_id | BIGINT | PK, identity | Room or event identifier |
| 
ame | TEXT | UNIQUE | One of seven exact names (Room 1–6 or Exclusive Resort Event (5 Hours)) |
| accommodation_type | TEXT | CHECK ROOM/EVENT | Drives date and time-window rules |
| capacity | INTEGER | CHECK 1–7 | Physical person limit |
| description | TEXT | NOT NULL | Includes the exclusive-event rule for EVENT rows |
| is_active | BOOLEAN | default TRUE | Allows soft retirement |
| created_at | TIMESTAMPTZ | default NOW | Creation time |

### rate_tiers

| Column | Type | Key / constraint | Meaning |
| --- | --- | --- | --- |
| rate_tier_id | BIGINT | PK, identity | Stable price-rule identifier |
| accommodation_id | BIGINT | FK, UQ with tier_name | Parent accommodation |
| tier_name | TEXT | UQ with accommodation | Exactly Up to 2 persons, Up to 7 persons, or Flat 5-hour event |
| max_persons | INTEGER | CHECK 1–7 | Highest allowed person count for the tier |
| rate_amount | NUMERIC(10,2) | CHECK > 0 | ₱1,499, ₱3,499 or ₱9,000 |
| rate_basis | TEXT | CHECK PER_NIGHT/FLAT | How total is calculated |
| is_active | BOOLEAN | default TRUE | Allows old prices to be retired |
| created_at | TIMESTAMPTZ | default NOW | Creation time |

### schedules

| Column | Type | Key / constraint | Meaning |
| --- | --- | --- | --- |
| schedule_id | BIGINT | PK, identity | Stable booking identifier |
| customer_id | BIGINT | FK, RESTRICT | Person who booked |
| accommodation_id | BIGINT | FK, RESTRICT | Place booked |
| rate_tier_id | BIGINT | FK, RESTRICT | Price rule chosen |
| booking_kind | TEXT | CHECK ROOM_STAY/EVENT_5HR | Determines date and time rules |
| check_in_date | DATE | NOT NULL | First day |
| check_out_date | DATE | rule-checked | Room: after check-in. Event: same day |
| person_count | INTEGER | CHECK 1–7 | Must not exceed tier max_persons |
| downpayment_amount | NUMERIC(10,2) | CHECK >= 0 | Amount paid so far |
| payment_status | TEXT | 3-state CHECK | Exactly UNPAID, DOWNPAYMENT, PAID |
| paid_at | TIMESTAMPTZ | CHECK with status | Filled only for PAID |
| 
otes | TEXT | nullable | Clerk notes |
| created_at | TIMESTAMPTZ | default NOW | Creation time |
| updated_at | TIMESTAMPTZ | trigger-managed | Last edit time |

DOWNPAYMENT means a partial amount has been paid with remaining balance due at check-in.

## How the tables relate

One person (row in customers, shown as Persons in the UI) books many schedules. One accommodation hosts many schedules and is priced by many rate tiers. Each schedule chooses exactly one rate tier from the tiers belonging to its accommodation. The joined result is exposed as v_schedule_details, so the browser receives 
ights, total_amount, downpayment_amount, remaining_balance, check_in_label, check_out_label, and time_window.

## Why these keys and constraints

Identity keys avoid business meaning in primary keys. Foreign keys with ON DELETE RESTRICT protect booking history, while rate_tiers.accommodation_id uses CASCADE because a tier has no life without its accommodation. The payment CHECK and validate_schedule_rules trigger move resort rules into the database, so a buggy client cannot save an impossible payment state, exceed max_persons, or book an event across two days. Indexes on customer, accommodation, tier, check-in date and payment status keep the ledger and filters fast.

## Derived values in v_schedule_details

- 
ights — 0 for events, date difference for room stays
- total_amount — nights × rate, or flat ₱9,000
- downpayment_amount — amount recorded so far
- remaining_balance — total_amount - downpayment_amount
- check_in_label, check_out_label — e.g. Mon, 2026-11-02, Thu, 2026-11-05
- time_window — Check-in: 1:00 PM / Check-out: 11:00 AM or 5-Hour Event Window

Correct weekday example: Mon, 2026-11-02 -> Thu, 2026-11-05. Money example: ₱1,499 total, ₱1,000 downpayment, ₱499 remaining.

## How the animation will work

The presentation walks the diagram in the same order as a click in the app: highlight
customers (Persons), draw an arrow to schedules, then slide accommodations and rate_tiers
in. Pulse the rate_tier_id arrow, show 
ights = check_out - check_in (or 0 for events), and
fade in total_amount, downpayment_amount, and remaining_balance. Finally, fill the three
status boxes in sequence: UNPAID → DOWNPAYMENT → PAID, each revealing only the next join so
the audience can follow the derivation.

## Notes on safety and aggregation

Only the Express server connects to PostgreSQL. Every browser value travels in $1, $2, ...
placeholders, never string-concatenated SQL. Credentials stay in .env and are ignored by Git.
Aggregation happens in v_schedule_details and in grouped queries.sql reports, so the frontend
never recalculates totals from untrusted text. SUM(total_amount), SUM(downpayment_amount) and
SUM(remaining_balance) explain the summary cells, while COUNT(*) by payment_status explains
the ledger badges. No real person data, card details or payment gateway is involved.r

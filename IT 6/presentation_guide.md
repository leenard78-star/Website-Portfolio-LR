# Presentation guide — PK's Resort Scheduling & Payment System (IT 6)

Use this for a 5–10 minute live defence. Open three tabs before starting:

1. <http://localhost:3000> — the clerk desk.
2. PowerShell in the IT 6 folder — SQL checks.
3. VS Code with erd.md and queries.sql ready.

Opening line:

> "PK's Resort — Owned & Managed by the Bennun Family. This local PostgreSQL desk tracks Persons,
> accommodations, rate tiers, dates, downpayments, and balances — all derived from stored data."

## Slide outline (12 slides)

### Slide 1 — Title and ownership
- Title: **PK's Resort — Schedule & Payment Desk**
- Exact ownership line: **PK's Resort — Owned & Managed by the Bennun Family**
- One sentence: "A local Express + PostgreSQL app for reservations, rate tiers and balances."

### Slide 2 — Problem and scope
- Paper booklet caused unreadable dates, repeated person details and unclear balances.
- In scope: persons, seven accommodations, room/event tiers, dates, downpayment, three statuses.
- Out of scope: login, payment gateway, invoicing, cloud hosting.

### Slide 3 — The four tables
Database tables remain customers, accommodations, rate_tiers, schedules (the UI calls customers "Persons").

| Table | Rows after seed | Job |
| --- | --- | --- |
| customers | 16 | Person contact details (Persons in UI) |
| accommodations | 7 | Room 1–6 plus the exclusive event |
| rate_tiers | 13 | ₱1,499, ₱3,499, ₱9,000 rules |
| schedules | 20 | The booking fact table |

### Slide 4 — Relationships and participation
- customers ||--o{ schedules : books
- accommodations ||--o{ rate_tiers : priced_by
- accommodations ||--o{ schedules : hosts
- rate_tiers ||--o{ schedules : charges
- Every schedule must have one person, one accommodation and one chosen tier.

### Slide 5 — Normalization
- Person details appear once in customers, not on every booking.
- Room/event details appear once in accommodations.
- Prices appear once in rate_tiers (exact tier names: Up to 2 persons, Up to 7 persons, Flat 5-hour event).
- schedules keeps only foreign keys, dates, person count, money paid and status.

### Slide 6 — Constraints that protect the resort
- PRIMARY KEY on every *_id; unique person/accommodation/tier identifiers as defined.
- CHECK on type, status, person count, positive rates and non-negative downpayment.
- Payment statuses are exactly UNPAID, DOWNPAYMENT, PAID. DOWNPAYMENT means a partial amount has been paid with remaining balance due at check-in.
- validate_schedule_rules trigger enforces room nights vs event same-day booking and tier person limits (max_persons).
- ON DELETE RESTRICT protects history; rate_tiers cascades only from its parent accommodation.

### Slide 7 — Indexes and search
- Indexes on customer, accommodation, tier, check-in date and payment status keep filters fast.
- UI search: placeholder exactly Search all persons by name or phone...; ledger filter selector shows All persons; reset clears the search too.
- Search filters schedules by customer full name OR phone, and composes with status, date and All persons filters.

### Slide 8 — The view that powers everything
v_schedule_details joins all four tables and derives:
- 
ights
- total_amount
- downpayment_amount
- remaining_balance
- check_in_label, check_out_label
- time_window (Check-in: 1:00 PM / Check-out: 11:00 AM or 5-Hour Event Window)

Correct weekday example: Mon, 2026-11-02 -> Thu, 2026-11-05.

### Slide 9 — The exact money and event example
Peter Parker, Room 2, Mon, 2026-11-03 → Tue, 2026-11-04:

`text
nights            = 1
total amount      = 1 × ₱1,499 = ₱1,499
downpayment       = ₱1,000
remaining balance = ₱499
status            = DOWNPAYMENT
`

Event rule: Exclusive 5-hour private resort access — other persons that are not known / uninvited are strictly not allowed inside the resort during an exclusive event.

### Slide 10 — Sample aggregate query

`sql
SELECT payment_status,
       COUNT(*) AS bookings,
       SUM(total_amount) AS total_amount_php,
       SUM(downpayment_amount) AS downpayment_paid_php,
       SUM(remaining_balance) AS remaining_balance_php
FROM v_schedule_details
GROUP BY payment_status
ORDER BY payment_status;
`

Statuses in results are only UNPAID, DOWNPAYMENT, PAID.

### Slide 11 — End-to-end application flow
1. app.js calls /api/options to fill accommodations and tier names.
2. Clerk picks a person, accommodation/tier, dates, personCount, and downpayment.
3. server.js validates tier/date/person count/payment and writes with parameterized SQL.
4. PostgreSQL trigger re-checks rules and v_schedule_details derives nights, totals, balances, labels, and time window.
5. Ledger and summary strip refresh; search/filters (name or phone, status, date, All persons) compose.
6. **Settle Balance / Mark Paid** posts to /settle; API sets downpayment to full total and status PAID.

### Slide 12 — Security, testing and closing
- $1, $2, ... placeholders everywhere; credentials stay server-side in .env.
- 
ode --check on JS files; psql -f schema_and_seed.sql and optional psql -f queries.sql.
- Seed: 7 accommodations, 13 rate tiers, 16 persons, 20 schedules.
- Closing line: "The database is the source of truth; the webpage is a fast desk view for the Bennun Family's PK's Resort."

## Live demo script (8 minutes)

### 0:00–0:45 — Reset and show the seed
`powershell
 = "C:\Program Files\PostgreSQL\18\bin"
& "\psql.exe" -U postgres -d postgres -c "DROP DATABASE IF EXISTS pks_resort;"
& "\createdb.exe" -U postgres pks_resort
& "\psql.exe" -U postgres -d pks_resort -f schema_and_seed.sql
`
Say: "Fresh load gives 7 accommodations, 13 rate tiers, 16 persons, 20 schedules."

### 0:45–1:45 — Prove counts and correct weekdays
`powershell
& "\psql.exe" -U postgres -d pks_resort -c "SELECT (SELECT count(*) FROM accommodations) rooms, (SELECT count(*) FROM rate_tiers) tiers, (SELECT count(*) FROM customers) persons, (SELECT count(*) FROM schedules) bookings;"
& "\psql.exe" -U postgres -d pks_resort -c "SELECT full_name, check_in_label, check_out_label, total_amount, downpayment_amount, remaining_balance, payment_status FROM v_schedule_details WHERE full_name IN ('Joshua Garcia', 'Peter Parker');"
`
Point at Mon, 2026-11-02 -> Thu, 2026-11-05 and ₱1,499 / ₱1,000 / ₱499 / DOWNPAYMENT.

### 1:45–3:00 — Show the desk
- Point to ownership line PK's Resort — Owned & Managed by the Bennun Family and logo.
- Point to Check-in: 1:00 PM / Check-out: 11:00 AM and 5-Hour Event Window.
- Show summary strip and filters: search placeholder Search all persons by name or phone..., selector shows All persons.
- Filter status to DOWNPAYMENT and demonstrate search by name or phone composes with filters.

### 3:00–4:30 — Create a room booking
1. Click **Reset** (clears search too).
2. Choose a person and Room 4 — Up to 2 persons.
3. Set dates 2026-12-10 → 2026-12-12 and person count 2.
4. Enter downpayment 1000, keep DOWNPAYMENT.
5. Watch hint: 2 nights · ₱2,998 · ₱1,000 down · ₱1,998 remaining.
6. Submit and point to correct weekday labels and DOWNPAYMENT status.

### 4:30–5:30 — Settle it
Click **Settle Balance / Mark Paid**. Refresh and show downpayment becomes total, remaining ₱0, status PAID.

### 5:30–6:45 — Create an event booking
1. Choose a person and the exclusive event tier (Flat 5-hour event).
2. Set same-day dates; set person count; enter downpayment.
3. Show the exact event rule and 5-Hour Event Window.
4. Submit and point to 0 nights and flat ₱9,000 total behavior.

### 6:45–7:30 — Edit, search/reset, delete
- Edit a downpayment/status and save.
- Use search + status/date/All persons filters together, then Reset (clears search too).
- Delete a booking and confirm it disappears after refresh.

### 7:30–8:00 — Close with SQL
`powershell
& "\psql.exe" -U postgres -d pks_resort -c "SELECT payment_status, COUNT(*) schedules, SUM(remaining_balance) remaining_php FROM v_schedule_details GROUP BY payment_status ORDER BY payment_status;"
`
Say: "Same derived numbers the UI shows, with statuses only UNPAID, DOWNPAYMENT, PAID."

## Q&A

**Q: Why are the tables still named customers if the UI says Persons?**
A: The database schema remains stable (customers, accommodations, rate_tiers, schedules), while the UI terminology is Persons for clarity to the clerk.

**Q: What does DOWNPAYMENT mean?**
A: A partial amount has been paid with remaining balance due at check-in. It is not PAID and not UNPAID.

**Q: Where does the person search apply?**
A: It filters schedules by customer full name OR phone and composes with status, date, and All persons filters. Reset clears the search too.

**Q: What prevents overbooking by person count or bad payments?**
A: The API validates and validate_schedule_rules enforces tier max_persons, date rules, and downpayment/status consistency.

**Q: Why store dates as DATE?**
A: Real dates support comparisons/indexes/math; labels like Mon, 2026-11-02 and Thu, 2026-11-05 are derived accurately in SQL/JS.

**Q: What changed in naming?**
A: The old count fields became person_count/max_persons (and API JSON personCount/maxPersons), and rate tiers use person wording exactly as specified.

**Q: Is there any real person or payment data?**
A: No. The seed uses 16 sample persons and no payment gateway.r

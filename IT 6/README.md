# PK's Resort — Schedule & Payment Desk (IT 6)

A local PostgreSQL + Express app that replaces PK's Resort's paper schedule booklet.
It stores persons, accommodations, rate tiers, reservation dates, downpayments and payment
status, and gives the clerk a browser ledger with live balance calculations.

Ownership line used in the header and footer:

> PK's Resort — Owned & Managed by the Bennun Family

## What is in this folder

| File | Purpose |
| --- | --- |
| schema_and_seed.sql | Tables, tiers, constraints, triggers, view and 16 sample persons |
| queries.sql | Commented SELECT / INSERT / UPDATE / DELETE walkthrough |
| docs/CODE_EXPLANATION.md | Beginner-friendly step-by-step walkthrough of the main files |
| erd.md | Mermaid ERD, column dictionary and animation-ready workflow |
| presentation_guide.md | Slide outline, 5–10 minute demo script and Q&A |
| server.js / db.js | Express REST API and PostgreSQL connection pool |
| public/ | Single-page clerk interface (HTML, CSS, JavaScript) |
| SPEC.md, docs/decisions/ | Scope, assumptions and architecture decision record |

## Resort rules

- Rooms: Room 1 to Room 6.
- Room rates: ₱1,499/night up to 2 persons, or ₱3,499/night up to 7 persons.
- Exclusive event: Exclusive Resort Event (5 Hours), ₱9,000 flat rate.
- Event rule: Exclusive 5-hour private resort access — other persons that are not known / uninvited are strictly not allowed inside the resort during an exclusive event.
- Room times: Check-in: 1:00 PM / Check-out: 11:00 AM.
- Event time: 5-Hour Event Window.
- Phone numbers use +63 Philippine mobile format.
- Payment statuses are exactly UNPAID, DOWNPAYMENT, PAID. DOWNPAYMENT means a partial amount has been paid with remaining balance due at check-in.
- The clerk records the downpayment; total and remaining balance are calculated.

## Prerequisites

- PostgreSQL 14 or newer (PostgreSQL 18 is used in the setup commands below)
- Node.js 18 or newer and npm

## Setup

From PowerShell, inside this IT 6 folder:

`powershell
 = "C:\Program Files\PostgreSQL\18\bin"
& "\psql.exe" -U postgres -d postgres -c "DROP DATABASE IF EXISTS pks_resort;"
& "\createdb.exe" -U postgres pks_resort
& "\psql.exe" -U postgres -d pks_resort -f schema_and_seed.sql
`

Optional query walkthrough:

`powershell
& "\psql.exe" -U postgres -d pks_resort -f queries.sql
`

.env already exists with a working local DB_PASSWORD. If you move this project to another
machine, copy .env.example to .env and set your own password, then install and start:

`powershell
npm install
npm start
`

Open <http://localhost:3000>. To stop the server press Ctrl+C. Restart the server after
changing server.js, app.js or the database schema.

## Logo asset

The header <img>, favicon and apple-touch-icon all load from
/assets/pk-logo.jpg, served by Express from public/assets/pk-logo.jpg. It is framed at
64×64 with object-fit: cover; object-position: center 35%. If the image is missing, a
plain PK badge appears and the page still works. /brand/logo and /brand/favicon
remain as compatibility fallbacks.

## Seed verification

`powershell
& "\psql.exe" -U postgres -d pks_resort -c "SELECT (SELECT count(*) FROM accommodations) AS rooms, (SELECT count(*) FROM rate_tiers) AS tiers, (SELECT count(*) FROM customers) AS persons, (SELECT count(*) FROM schedules) AS bookings;"
`

Expected: rooms = 7, tiers = 13, persons = 16, bookings = 20.

The 16 exact persons are: Joshua Garcia, Peter Parker, Lebron James, Stephen Curry, Michael Jordan, Bruno Mars, Michael Jackson, Daniel Padilla, James Reid, Anne Curtis, Ivana Alawi, Arthur Pacheo, Arthur Fuentes, Bryan Fury, Paulo Baculinao, Arthur Nery.

Correct weekday example: Mon, 2026-11-02 -> Thu, 2026-11-05.

The exact ₱1,499 / ₱1,000 / ₱499 example is in the seed:

`powershell
& "\psql.exe" -U postgres -d pks_resort -c "SELECT full_name, check_in_label, check_out_label, total_amount, downpayment_amount, remaining_balance, payment_status FROM v_schedule_details WHERE full_name = 'Peter Parker';"
`

Expected: Mon, 2026-11-03, Tue, 2026-11-04, 1499.00, 1000.00, 499.00,
DOWNPAYMENT.

## Using the interface

1. **Add person** — enter a name, 
ame@example.com email, a +63 963 464 2360 style mobile, and optional address.
2. **New booking** — choose a person, then an accommodation/rate tier combination.
3. **Dates** — the hint below the date fields shows the real weekday, e.g. Mon, 2026-11-02 → Thu, 2026-11-05.
4. **Persons and downpayment** — the person limit follows the chosen tier; the balance hint updates live.
5. **Settle Balance / Mark Paid** — a single API call sets the downpayment to the full total and status to PAID.
6. **Edit** — change dates, person count, downpayment, status or notes in the dialog.
7. **Delete** — removes one booking after confirmation. Parent persons and accommodations are protected by foreign keys.
8. **Search and filters** — search bar placeholder is exactly Search all persons by name or phone...; the ledger filter selector shows All persons; reset clears the search too. Search filters schedules by customer full name OR phone, and composes with status, date and All persons filters.

## REST API contract

All errors use { "error": { "code": "VALIDATION_ERROR", "message": "..." } }.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /api/health | Confirm the API can reach PostgreSQL |
| GET | /api/options | Accommodations, rate tiers, statuses and resort info |
| GET | /api/customers?search=&page=1&pageSize=20 | Paginated persons |
| POST | /api/customers | Create a person (409 on duplicate email) |
| GET | /api/schedules?paymentStatus=&from=&to=&customerId=&search=&page=1&pageSize=10 | Paginated joined bookings |
| GET | /api/schedules/:id | One booking |
| POST | /api/schedules | Create a booking after tier/date/payment validation |
| PATCH | /api/schedules/:id | Partial update of dates, tier, person count, downpayment, status or notes |
| POST | /api/schedules/:id/settle | One-click full payment |
| DELETE | /api/schedules/:id | Delete a booking; returns 204 |

Request example:

`json
{
  "customerId": 1,
  "rateTierId": 1,
  "checkInDate": "2027-02-01",
  "checkOutDate": "2027-02-04",
  "personCount": 2,
  "downpaymentAmount": 1000,
  "paymentStatus": "DOWNPAYMENT",
  "notes": "Downpayment received"
}
`

Status codes: 201 created, 204 deleted, 422 validation/constraint error,
409 duplicate, 404 not found, 500 unexpected server error.

## Design notes

- Database tables remain customers, accommodations, rate_tiers, schedules. The UI calls customers "Persons".
- schedules is the fact table; customers, accommodations and rate_tiers are parents.
- rate_tiers keeps the ₱1,499, ₱3,499 and ₱9,000 rules in data, not hardcoded in the UI. Rate tier names are exactly Up to 2 persons, Up to 7 persons, Flat 5-hour event.
- validate_schedule_rules is a database trigger that rejects bad room/event dates, person counts above the tier limit, and impossible downpayment/status combinations.
- v_schedule_details centralises the four-table join and derives 
ights, total_amount, downpayment_amount, remaining_balance, check_in_label, check_out_label, time_window.
- Credentials stay in .env; the browser never sees them. Every value from the browser is sent through $1, $2, ... placeholders.
- The interface is a coastal desk ledger: deep blue header, ruled ivory surfaces, sans-serif labels, monospace figures and square status marks.
- All money uses Philippine pesos and Intl.NumberFormat('en-PH', { currency: 'PHP', maximumFractionDigits: 0 }).

## Verification checklist

`powershell
node --check server.js
node --check db.js
node --check public/app.js
npm start
`

Then in the browser: add a person, create a room booking, settle the balance, create an event booking, search by name or phone, filter by status/date/person, edit a downpayment, delete a booking, use reset (clearing search too), and reload to confirm persistence.r

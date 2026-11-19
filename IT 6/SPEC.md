# Spec: PK's Resort Scheduling & Payment System — V1

## Objective
Replace PK's Resort's manual schedule booklet with a small PostgreSQL-backed web app.
A resort clerk must be able to:
- add persons with Philippine mobile numbers,
- choose from six rooms and one exclusive 5-hour event,
- create a schedule that links a person, accommodation and rate tier to reservation dates,
- record a downpayment and one of three payment statuses,
- read a joined ledger with derived totals, balances and correct weekday labels,
- search/filter schedules by person name or phone (composed with status/date/person filters),
- update dates, person counts, downpayments or statuses,
- settle a balance in one click,
- delete a schedule,
all backed by local sample data.

## Ownership and resort rules
- Exact ownership line: PK's Resort — Owned & Managed by the Bennun Family
- Exact event rule: Exclusive 5-hour private resort access — other persons that are not known / uninvited are strictly not allowed inside the resort during an exclusive event.
- Resort times: Check-in: 1:00 PM / Check-out: 11:00 AM and 5-Hour Event Window
- Currency is Philippine pesos only: ₱1,499/night up to 2 persons, ₱3,499/night up to 7 persons, ₱9,000 flat event
- Payment statuses are exactly UNPAID, DOWNPAYMENT, PAID. DOWNPAYMENT means a partial amount has been paid with remaining balance due at check-in.

## Assumptions (correct if wrong)
1. Deployment is local (PostgreSQL installed on the machine), not a hosted/cloud service.
2. Authentication is out of scope: this is a single-clerk course demo.
3. Three payment states are tracked: UNPAID, DOWNPAYMENT, PAID; no payment gateway or invoices.
4. A schedule row = one reservation for one person in one accommodation using one rate tier.
5. Sample data uses example.com emails and realistic +63 mobile numbers.
6. The web app is the only database client, so credentials stay server-side in .env.
7. Database tables remain customers, accommodations, rate_tiers, schedules; the UI calls customers "Persons".

## Tech Stack
- PostgreSQL 14+ (pg client driver)
- Node.js 18+, Express 4, native fetch in the browser
- Plain HTML/CSS/JS (no front-end build step)

## Commands
`bash
createdb pks_resort
psql -d pks_resort -f schema_and_seed.sql
psql -d pks_resort -f queries.sql      # optional walkthrough
cp .env.example .env                   # only on a new machine; then edit DB_PASSWORD
npm install
npm start                              # http://localhost:3000
`

On the course machine, use the PostgreSQL 18 full paths shown in README.md instead of
assuming psql/createdb are on PATH. The live DB must be reset after changing
schema_and_seed.sql.

## Project Structure
`
schema_and_seed.sql       schema, tiers, constraints, triggers, view, sample seed data
queries.sql               commented CRUD + reporting query walkthrough
docs/CODE_EXPLANATION.md  beginner-friendly walkthrough of schema_and_seed.sql, db.js, server.js, public/index.html, public/styles.css, public/app.js
server.js                 Express REST API + static file host
db.js                     shared pg.Pool
public/index.html         single-page clerk interface
public/styles.css         responsive coastal desk-ledger styling
public/app.js             fetch calls, forms, filters, search, live balance, settle action
public/assets/pk-logo.jpg header/favicon logo asset
.env.example              non-secret configuration template
README.md                 setup, API contract, verification steps
erd.md                    Mermaid ERD + column breakdown + animation workflow
presentation_guide.md     slides, live demo script, Q&A
SPEC.md                   this scope document
docs/decisions/           architecture decision records
`

## Data and naming (final)
- Tables: customers, accommodations, rate_tiers, schedules
- UI terminology: customers are presented as Persons
- Field/API names: person_count / max_persons in schema; personCount / maxPersons in API/JSON
- Rate tier names are exactly Up to 2 persons, Up to 7 persons, Flat 5-hour event
- 16 exact persons: Joshua Garcia, Peter Parker, Lebron James, Stephen Curry, Michael Jordan, Bruno Mars, Michael Jackson, Daniel Padilla, James Reid, Anne Curtis, Ivana Alawi, Arthur Pacheo, Arthur Fuentes, Bryan Fury, Paulo Baculinao, Arthur Nery
- Seed: 7 accommodations (Room 1-6 + Exclusive Resort Event (5 Hours)), 13 rate tiers, 16 customers/persons, 20 schedules
- Correct weekday example: Mon, 2026-11-02 -> Thu, 2026-11-05
- Money example: ₱1,499 total, ₱1,000 downpayment, ₱499 remaining
- v_schedule_details derives 
ights, total_amount, downpayment_amount, remaining_balance, check_in_label, check_out_label, time_window

## UI behavior requirements
- Search bar placeholder exactly: Search all persons by name or phone...
- Ledger filter selector shows All persons
- Reset clears the search too
- Search filters schedules by customer full name OR phone, and composes with status, date and All persons filters

## Code Style
- SQL: snake_case identifiers, plural table names, *_id primary keys, created_at/updated_at timestamps, UPPER_SNAKE enum-like values.
- JS: CommonJS modules, async/await, 2-space indentation, parameterized SQL only ($1, $2).
- API: plural nouns, camelCase JSON, consistent error shape (e.g. { "error": { "code", "message" } }).
- Money: NUMERIC(10,2) in PostgreSQL, Philippine pesos formatting in the browser, never floats.

## Testing Strategy
- 
ode --check on every JS file.
- psql -f schema_and_seed.sql and optional psql -f queries.sql with ON_ERROR_STOP=1.
- Seed counts: 7 accommodations, 13 rate tiers, 16 persons, 20 schedules.
- 
pm start + browser smoke test of create/edit/delete/settle, search, filters, and reset behavior.
- Static checks for exact ownership/event lines, tier names, statuses, person wording in docs, and Philippine peso amounts.

## Boundaries
- **Always:** use parameterized queries; validate at the API boundary; keep sample data non-sensitive.
- **Ask first:** adding authentication, payments, or hosted infrastructure.
- **Never:** commit .env, real person data, or disable a constraint to make a demo work.

## Success Criteria
- Schema loads cleanly with PKs, FKs, CHECK constraints, indexes, triggers and a joined view.
- Seed contains exact persons, rate tiers, 2026 schedules and the ₱1,499 / ₱1,000 / ₱499 example.
- Web form can add a person and schedule, show correct weekday labels, search/filter correctly, settle, edit and delete.
- README.md, docs/CODE_EXPLANATION.md, erd.md, presentation_guide.md, SPEC.md, and docs/decisions/ADR-001-relational-schema.md are consistent with the final names and rules.

## Out of Scope (Deferred)
- Authentication/roles — not required for a local course demo.
- Payment gateway, invoices and real card data — the brief asks for downpayment/status tracking only.
- Date-range double-booking prevention beyond current constraints — can be added as an exclusion constraint later.

## Open Questions
- None blocking; assumptions above are visible for the presenter to adjust.r

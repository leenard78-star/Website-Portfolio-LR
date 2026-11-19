-- ============================================================================
-- PK's Resort - query walkthrough
-- Run after schema_and_seed.sql:  psql -U postgres -d pks_resort -f queries.sql
-- Every section explains WHAT it does and WHY it is written that way.
-- Write operations are wrapped in transactions: change COMMIT to ROLLBACK for a
-- dry run. Sample dates are in 2026 and weekday labels come from the view.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PART A - SELECT: read the booklet
-- ---------------------------------------------------------------------------

-- A1. The core report. The view hides the four-table join and already formats
--     the weekday labels, so the clerk sees "Mon, 2026-11-02", not just a date.
SELECT
    schedule_id,
    full_name,
    phone,
    accommodation_name,
    tier_name,
    check_in_label,
    check_out_label,
    time_window,
    payment_status
FROM v_schedule_details
ORDER BY check_in_date, schedule_id;

-- A2. Money report. total_amount is either nights x rate or the flat event rate.
--     remaining_balance is stored in the view as total - downpayment.
SELECT
    full_name,
    accommodation_name,
    nights,
    total_amount AS total_estimate_php,
    downpayment_amount AS downpayment_paid_php,
    remaining_balance AS remaining_balance_php,
    payment_status
FROM v_schedule_details
ORDER BY remaining_balance DESC;

-- A3. One grouped query gives the whole payment picture.
SELECT
    payment_status,
    COUNT(*) AS bookings,
    SUM(total_amount) AS total_estimate_php,
    SUM(downpayment_amount) AS downpayment_paid_php,
    SUM(remaining_balance) AS remaining_balance_php
FROM v_schedule_details
GROUP BY payment_status
ORDER BY payment_status;

-- A4. Follow-up list: persons who still owe money, oldest arrival first.
--     DOWNPAYMENT and UNPAID both have a remaining balance, so both are included.
SELECT
    schedule_id,
    full_name,
    phone,
    accommodation_name,
    check_in_label,
    remaining_balance AS remaining_balance_php,
    notes
FROM v_schedule_details
WHERE payment_status <> 'PAID'
ORDER BY check_in_date;

-- A5. Upcoming arrivals in the next 30 days. Comparing real DATE values is
--     safer than comparing formatted text such as "Mon, 2026-11-02".
SELECT full_name, accommodation_name, check_in_label, time_window, payment_status
FROM v_schedule_details
WHERE check_in_date >= CURRENT_DATE
  AND check_in_date < CURRENT_DATE + INTERVAL '30 days'
ORDER BY check_in_date;

-- A6. Personss on site today. Room stays use the half-open interval [in, out),
--     while the exclusive event is a single-day 5-hour booking.
SELECT full_name, accommodation_name, check_in_label, check_out_label, time_window
FROM v_schedule_details
WHERE (booking_kind = 'ROOM_STAY'
       AND check_in_date <= CURRENT_DATE
       AND check_out_date > CURRENT_DATE)
   OR (booking_kind = 'EVENT_5HR'
       AND check_in_date = CURRENT_DATE)
ORDER BY check_in_date;

-- A7. Overdue balances: arrival has passed and the booking is not fully paid.
SELECT full_name, phone, check_in_label, remaining_balance AS remaining_balance_php
FROM v_schedule_details
WHERE payment_status <> 'PAID'
  AND check_in_date < CURRENT_DATE
ORDER BY check_in_date;

-- A8. Overlap check for a NEW room stay. The '[)' range makes back-to-back
--     stays non-conflicting: checkout 11:00 AM, next check-in 1:00 PM.
SELECT s.schedule_id, c.full_name, s.check_in_label, s.check_out_label
FROM v_schedule_details s
JOIN customers c ON c.customer_id = s.customer_id
WHERE s.accommodation_id = 1
  AND s.booking_kind = 'ROOM_STAY'
  AND daterange(s.check_in_date, s.check_out_date, '[)')
      && daterange(DATE '2026-12-10', DATE '2026-12-13', '[)');

-- A9. Which tiers earn the most, and how much is still outstanding?
SELECT
    accommodation_name,
    tier_name,
    payment_status,
    COUNT(*) AS bookings,
    SUM(total_amount) AS total_estimate_php,
    SUM(downpayment_amount) AS downpayment_paid_php,
    SUM(remaining_balance) AS remaining_balance_php
FROM v_schedule_details
GROUP BY accommodation_name, tier_name, payment_status
ORDER BY accommodation_name, tier_name, payment_status;

-- A10. Pagination pattern used by GET /api/schedules (page 1, 8 rows).
SELECT schedule_id, full_name, accommodation_name, check_in_label, payment_status
FROM v_schedule_details
ORDER BY schedule_id
LIMIT 8 OFFSET 0;

-- A11. Person search used by the ledger bar. ILIKE makes it case-insensitive,
--      and the OR matches either the person name or the Philippine mobile.
SELECT schedule_id, full_name, phone, check_in_label, payment_status
FROM v_schedule_details
WHERE full_name ILIKE '%Peter%'
   OR phone ILIKE '%917%'
ORDER BY check_in_date, schedule_id;

-- ---------------------------------------------------------------------------
-- PART B - INSERT: add new information
-- ---------------------------------------------------------------------------

-- B1. Add a person. The API forces lowercase email and validates the +63 prefix,
--     matching the table constraints and the seeded Philippine numbers.
BEGIN;
INSERT INTO customers (full_name, email, phone, address)
VALUES ('Ishaan Verma', 'ishaan.verma@example.com', '+63 917 000 1111', '7 Banyan Road, Cebu City')
RETURNING customer_id, full_name, phone;
COMMIT;

-- B2. Add a room booking for the new person. The tier is looked up by name so
--     this example still works if identity IDs change after a database reset.
--     Three nights at ₱1,499 = ₱4,497; ₱500 down leaves ₱3,997 remaining.
BEGIN;
INSERT INTO schedules
    (customer_id, accommodation_id, rate_tier_id, booking_kind,
     check_in_date, check_out_date, person_count, downpayment_amount,
     payment_status, paid_at, notes)
SELECT c.customer_id, a.accommodation_id, rt.rate_tier_id, 'ROOM_STAY',
       DATE '2027-02-01', DATE '2027-02-04', 2, 500.00,
       'DOWNPAYMENT', NULL, 'New year booking'
FROM customers c
CROSS JOIN accommodations a
JOIN rate_tiers rt ON rt.accommodation_id = a.accommodation_id
WHERE c.email = 'ishaan.verma@example.com'
  AND a.name = 'Room 1'
  AND rt.tier_name = 'Up to 2 persons'
RETURNING schedule_id, check_in_date, check_out_date, payment_status;
COMMIT;

-- B3. Re-runnable insert. ON CONFLICT turns a duplicate email into a no-op.
BEGIN;
INSERT INTO customers (full_name, email, phone)
VALUES ('Ishaan Verma', 'ishaan.verma@example.com', '+63 917 000 1111')
ON CONFLICT (email) DO NOTHING;
COMMIT;

-- ---------------------------------------------------------------------------
-- PART C - UPDATE: correct the booklet
-- ---------------------------------------------------------------------------

-- C1. Mark schedule 3 fully paid. The downpayment must become the exact total,
--     and paid_at must be filled in the SAME statement for the CHECK and trigger.
BEGIN;
UPDATE schedules s
SET payment_status = 'PAID',
    downpayment_amount = v.total_amount,
    paid_at = COALESCE(s.paid_at, NOW())
FROM v_schedule_details v
WHERE s.schedule_id = 3 AND v.schedule_id = 3
RETURNING s.schedule_id, s.payment_status, s.downpayment_amount, s.paid_at;
COMMIT;

-- C2. Move that reservation. The trigger recalculates the total from the new
--     dates, so a PAID row with the wrong downpayment would be rejected.
BEGIN;
UPDATE schedules
SET check_in_date  = DATE '2026-12-11',
    check_out_date = DATE '2026-12-14'
WHERE schedule_id = 3
RETURNING schedule_id, check_in_date, check_out_date;
COMMIT;

-- C3. Reverse the payment. UNPAID requires 0 downpayment and no paid_at.
BEGIN;
UPDATE schedules
SET payment_status = 'UNPAID',
    downpayment_amount = 0,
    paid_at = NULL
WHERE schedule_id = 3
RETURNING schedule_id, payment_status, downpayment_amount, paid_at;
COMMIT;

-- C4. Correct a phone number; the trigger refreshes updated_at automatically.
BEGIN;
UPDATE customers
SET phone = '+63 917 000 2222'
WHERE email = 'joshua.garcia@example.com'
RETURNING customer_id, full_name, phone, updated_at;
COMMIT;

-- ---------------------------------------------------------------------------
-- PART D - DELETE: remove a bad entry
-- ---------------------------------------------------------------------------

-- D1. Delete a single schedule (a wrongly entered booking). Idempotent: running
--     it twice affects zero rows the second time.
BEGIN;
DELETE FROM schedules
WHERE schedule_id = 16
RETURNING schedule_id, check_in_date;
COMMIT;

-- D2. Remove unpaid entries for one person after a cutoff date. The RETURNING
--     clause gives the clerk an audit line before COMMIT.
BEGIN;
DELETE FROM schedules
WHERE customer_id = 12
  AND payment_status = 'UNPAID'
  AND check_in_date >= DATE '2026-12-01'
RETURNING schedule_id, customer_id, check_in_date;
COMMIT;

-- D3. A person with bookings CANNOT be deleted directly because the foreign key
--     uses ON DELETE RESTRICT. Remove the child rows first, then the parent.
BEGIN;
DELETE FROM schedules WHERE customer_id = 10;
DELETE FROM customers WHERE customer_id = 10 AND
    NOT EXISTS (SELECT 1 FROM schedules WHERE customer_id = 10)
RETURNING customer_id, full_name;
COMMIT;

-- D4. Verify the final state after the walkthrough.
SELECT payment_status, COUNT(*) AS schedules
FROM schedules
GROUP BY payment_status
ORDER BY payment_status;

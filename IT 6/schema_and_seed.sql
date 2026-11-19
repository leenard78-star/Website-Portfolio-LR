CREATE TABLE IF NOT EXISTS accommodations (
    accommodation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    accommodation_type TEXT NOT NULL CHECK (accommodation_type IN ('ROOM', 'EVENT')),
    capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 7),
    description TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rate_tiers (
    rate_tier_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    accommodation_id BIGINT NOT NULL
        REFERENCES accommodations (accommodation_id) ON DELETE CASCADE,
    tier_name TEXT NOT NULL,
    max_persons INTEGER NOT NULL CHECK (max_persons BETWEEN 1 AND 7),
    rate_amount NUMERIC(10,2) NOT NULL CHECK (rate_amount > 0),
    rate_basis TEXT NOT NULL CHECK (rate_basis IN ('PER_NIGHT', 'FLAT')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (accommodation_id, tier_name)
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 100),
    email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
    phone TEXT NOT NULL CHECK (length(trim(phone)) BETWEEN 7 AND 20),
    address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schedules (
    schedule_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id BIGINT NOT NULL
        REFERENCES customers (customer_id) ON DELETE RESTRICT,
    accommodation_id BIGINT NOT NULL
        REFERENCES accommodations (accommodation_id) ON DELETE RESTRICT,
    rate_tier_id BIGINT NOT NULL
        REFERENCES rate_tiers (rate_tier_id) ON DELETE RESTRICT,
    booking_kind TEXT NOT NULL CHECK (booking_kind IN ('ROOM_STAY', 'EVENT_5HR')),
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    person_count INTEGER NOT NULL CHECK (person_count BETWEEN 1 AND 7),
    downpayment_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (downpayment_amount >= 0),
    payment_status TEXT NOT NULL CHECK (payment_status IN ('UNPAID', 'DOWNPAYMENT', 'PAID')),
    paid_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_payment_consistency CHECK (
        (payment_status = 'UNPAID' AND downpayment_amount = 0 AND paid_at IS NULL) OR
        (payment_status = 'DOWNPAYMENT' AND downpayment_amount > 0 AND paid_at IS NULL) OR
        (payment_status = 'PAID' AND downpayment_amount > 0 AND paid_at IS NOT NULL)
    ),
    CONSTRAINT uq_schedule_slot UNIQUE (customer_id, accommodation_id, check_in_date)
);

CREATE INDEX IF NOT EXISTS idx_rate_tiers_accommodation ON rate_tiers (accommodation_id);
CREATE INDEX IF NOT EXISTS idx_schedules_customer ON schedules (customer_id);
CREATE INDEX IF NOT EXISTS idx_schedules_accommodation ON schedules (accommodation_id);
CREATE INDEX IF NOT EXISTS idx_schedules_rate_tier ON schedules (rate_tier_id);
CREATE INDEX IF NOT EXISTS idx_schedules_check_in ON schedules (check_in_date);
CREATE INDEX IF NOT EXISTS idx_schedules_payment ON schedules (payment_status);
CREATE INDEX IF NOT EXISTS idx_schedules_payment_dates ON schedules (payment_status, check_in_date);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_schedules_updated_at ON schedules;
CREATE TRIGGER trg_schedules_updated_at
    BEFORE UPDATE ON schedules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION validate_schedule_rules() RETURNS TRIGGER AS $$
DECLARE
    v_accommodation_type TEXT;
    v_rate_basis TEXT;
    v_rate_amount NUMERIC(10,2);
    v_max_persons INTEGER;
    v_total NUMERIC(10,2);
BEGIN
    SELECT a.accommodation_type, rt.rate_basis, rt.rate_amount, rt.max_persons
      INTO v_accommodation_type, v_rate_basis, v_rate_amount, v_max_persons
      FROM rate_tiers rt
      JOIN accommodations a ON a.accommodation_id = rt.accommodation_id
     WHERE rt.rate_tier_id = NEW.rate_tier_id
       AND rt.is_active = TRUE
       AND a.is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'rate_tier_id % is not active', NEW.rate_tier_id;
    END IF;

    IF NEW.booking_kind = 'ROOM_STAY' THEN
        IF v_accommodation_type <> 'ROOM' OR v_rate_basis <> 'PER_NIGHT' THEN
            RAISE EXCEPTION 'room stays require an active ROOM per-night rate tier';
        END IF;
        IF NEW.check_out_date <= NEW.check_in_date THEN
            RAISE EXCEPTION 'room check-out must be after check-in';
        END IF;
        v_total := (NEW.check_out_date - NEW.check_in_date) * v_rate_amount;
    ELSE
        IF v_accommodation_type <> 'EVENT' OR v_rate_basis <> 'FLAT' THEN
            RAISE EXCEPTION 'exclusive events require an active EVENT flat rate tier';
        END IF;
        IF NEW.check_out_date <> NEW.check_in_date THEN
            RAISE EXCEPTION 'exclusive events use the same check-in and check-out date';
        END IF;
        v_total := v_rate_amount;
    END IF;

    IF NEW.person_count > v_max_persons THEN
        RAISE EXCEPTION 'person_count cannot exceed tier limit %', v_max_persons;
    END IF;
    IF NEW.downpayment_amount > v_total THEN
        RAISE EXCEPTION 'downpayment_amount cannot exceed total amount %', v_total;
    END IF;
    IF NEW.payment_status = 'PAID' AND NEW.downpayment_amount <> v_total THEN
        RAISE EXCEPTION 'PAID requires downpayment_amount to equal total amount %', v_total;
    END IF;
    IF NEW.payment_status = 'DOWNPAYMENT' AND NEW.downpayment_amount >= v_total THEN
        RAISE EXCEPTION 'DOWNPAYMENT requires a downpayment below total amount %', v_total;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_schedules_rules ON schedules;
CREATE TRIGGER trg_schedules_rules
    BEFORE INSERT OR UPDATE ON schedules
    FOR EACH ROW EXECUTE FUNCTION validate_schedule_rules();

DROP VIEW IF EXISTS v_schedule_details;
CREATE VIEW v_schedule_details AS
SELECT
    s.schedule_id,
    c.customer_id,
    c.full_name,
    c.email,
    c.phone,
    a.accommodation_id,
    a.name AS accommodation_name,
    a.accommodation_type,
    a.description AS accommodation_description,
    s.booking_kind,
    rt.rate_tier_id,
    rt.tier_name,
    rt.max_persons,
    rt.rate_basis,
    rt.rate_amount AS tier_rate,
    CASE WHEN s.booking_kind = 'EVENT_5HR' THEN 0
         ELSE s.check_out_date - s.check_in_date END AS nights,
    s.check_in_date,
    s.check_out_date,
    to_char(s.check_in_date, 'Dy, YYYY-MM-DD') AS check_in_label,
    to_char(s.check_out_date, 'Dy, YYYY-MM-DD') AS check_out_label,
    CASE WHEN s.booking_kind = 'ROOM_STAY'
         THEN 'Check-in: 1:00 PM / Check-out: 11:00 AM'
         ELSE '5-Hour Event Window' END AS time_window,
    s.person_count,
    CASE WHEN rt.rate_basis = 'PER_NIGHT'
         THEN (s.check_out_date - s.check_in_date) * rt.rate_amount
         ELSE rt.rate_amount END AS total_amount,
    s.downpayment_amount,
    CASE WHEN rt.rate_basis = 'PER_NIGHT'
         THEN (s.check_out_date - s.check_in_date) * rt.rate_amount
         ELSE rt.rate_amount END - s.downpayment_amount AS remaining_balance,
    s.payment_status,
    s.paid_at,
    s.notes,
    s.created_at,
    s.updated_at
FROM schedules s
JOIN customers c ON c.customer_id = s.customer_id
JOIN accommodations a ON a.accommodation_id = s.accommodation_id
JOIN rate_tiers rt ON rt.rate_tier_id = s.rate_tier_id;

INSERT INTO accommodations (name, accommodation_type, capacity, description) VALUES
    ('Room 1', 'ROOM', 7, 'Room for up to 2 or 7 persons.'),
    ('Room 2', 'ROOM', 7, 'Room for up to 2 or 7 persons.'),
    ('Room 3', 'ROOM', 7, 'Room for up to 2 or 7 persons.'),
    ('Room 4', 'ROOM', 7, 'Room for up to 2 or 7 persons.'),
    ('Room 5', 'ROOM', 7, 'Room for up to 2 or 7 persons.'),
    ('Room 6', 'ROOM', 7, 'Room for up to 2 or 7 persons.'),
    ('Exclusive Resort Event (5 Hours)', 'EVENT', 7, 'Exclusive 5-hour private resort access — other persons that are not known / uninvited are strictly not allowed inside the resort during an exclusive event.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO rate_tiers (accommodation_id, tier_name, max_persons, rate_amount, rate_basis)
SELECT a.accommodation_id, t.tier_name, t.max_persons, t.rate_amount, t.rate_basis
FROM accommodations a
CROSS JOIN (VALUES
    ('Up to 2 persons', 2, 1499.00, 'PER_NIGHT'),
    ('Up to 7 persons', 7, 3499.00, 'PER_NIGHT')
) AS t(tier_name, max_persons, rate_amount, rate_basis)
WHERE a.accommodation_type = 'ROOM'
ON CONFLICT (accommodation_id, tier_name) DO NOTHING;

INSERT INTO rate_tiers (accommodation_id, tier_name, max_persons, rate_amount, rate_basis)
SELECT a.accommodation_id, 'Flat 5-hour event', 7, 9000.00, 'FLAT'
FROM accommodations a
WHERE a.accommodation_type = 'EVENT'
ON CONFLICT (accommodation_id, tier_name) DO NOTHING;

INSERT INTO customers (full_name, email, phone, address) VALUES
    ('Joshua Garcia', 'joshua.garcia@example.com', '+63 963 464 2360', '12 Banyan Road, Batangas City'),
    ('Peter Parker', 'peter.parker@example.com', '+63 917 123 4567', '8 Acacia Street, Quezon City'),
    ('Lebron James', 'lebron.james@example.com', '+63 918 555 0101', '31 Palm Avenue, Pasay City'),
    ('Stephen Curry', 'stephen.curry@example.com', '+63 939 222 3344', '5 Ocean Drive, Manila'),
    ('Michael Jordan', 'michael.jordan@example.com', '+63 926 777 8899', '17 Narra Lane, Tagaytay City'),
    ('Bruno Mars', 'bruno.mars@example.com', '+63 905 444 1122', '22 Sunset Way, Makati City'),
    ('Michael Jackson', 'michael.jackson@example.com', '+63 912 345 6789', '9 Cedar Court, Antipolo City'),
    ('Daniel Padilla', 'daniel.padilla@example.com', '+63 916 888 2200', '44 Garden Path, Quezon City'),
    ('James Reid', 'james.reid@example.com', '+63 928 600 1414', '3 Fern Avenue, Pasig City'),
    ('Anne Curtis', 'anne.curtis@example.com', '+63 909 300 5050', '26 Mango Road, Mandaluyong City'),
    ('Ivana Alawi', 'ivana.alawi@example.com', '+63 997 121 3131', '14 Seaside Drive, Cavite City'),
    ('Arthur Pacheo', 'arthur.pacheo@example.com', '+63 915 700 8080', '6 Laurel Street, Laguna'),
    ('Arthur Fuentes', 'arthur.fuentes@example.com', '+63 938 400 6060', '18 Mahogany Road, Bulacan'),
    ('Bryan Fury', 'bryan.fury@example.com', '+63 919 250 7070', '2 Driftwood Lane, Subic'),
    ('Paulo Baculinao', 'paulo.baculinao@example.com', '+63 906 111 9090', '29 Baywalk, Manila'),
    ('Arthur Nery', 'arthur.nery@example.com', '+63 921 650 4040', '11 Ipil Street, Cebu City')
ON CONFLICT (email) DO NOTHING;

INSERT INTO schedules
    (customer_id, accommodation_id, rate_tier_id, booking_kind,
     check_in_date, check_out_date, person_count, downpayment_amount,
     payment_status, paid_at, notes)
SELECT c.customer_id, a.accommodation_id, rt.rate_tier_id, v.booking_kind,
       v.check_in_date, v.check_out_date, v.person_count, v.downpayment_amount,
       v.payment_status, v.paid_at, v.notes
FROM (VALUES
    (1, 'joshua.garcia@example.com', 'Room 1', 'Up to 2 persons', 'ROOM_STAY', DATE '2026-11-02', DATE '2026-11-05', 2, 1000.00, 'DOWNPAYMENT', NULL::timestamptz, 'Monday to Thursday arrival'),
    (2, 'peter.parker@example.com', 'Room 2', 'Up to 2 persons', 'ROOM_STAY', DATE '2026-11-03', DATE '2026-11-04', 2, 1000.00, 'DOWNPAYMENT', NULL::timestamptz, 'One night, ₱499 remaining'),
    (3, 'lebron.james@example.com', 'Room 3', 'Up to 7 persons', 'ROOM_STAY', DATE '2026-11-05', DATE '2026-11-08', 5, 3000.00, 'DOWNPAYMENT', NULL::timestamptz, 'Group booking'),
    (4, 'stephen.curry@example.com', 'Room 4', 'Up to 2 persons', 'ROOM_STAY', DATE '2026-11-06', DATE '2026-11-09', 2, 4497.00, 'PAID', TIMESTAMPTZ '2026-10-30 10:15:00+00', NULL),
    (5, 'michael.jordan@example.com', 'Room 5', 'Up to 7 persons', 'ROOM_STAY', DATE '2026-11-09', DATE '2026-11-12', 6, 3500.00, 'DOWNPAYMENT', NULL::timestamptz, 'Extra bed requested'),
    (6, 'bruno.mars@example.com', 'Room 6', 'Up to 2 persons', 'ROOM_STAY', DATE '2026-11-10', DATE '2026-11-13', 2, 0.00, 'UNPAID', NULL::timestamptz, 'Payment due at check-in'),
    (7, 'michael.jackson@example.com', 'Exclusive Resort Event (5 Hours)', 'Flat 5-hour event', 'EVENT_5HR', DATE '2026-11-14', DATE '2026-11-14', 7, 4500.00, 'DOWNPAYMENT', NULL::timestamptz, 'No outside persons'),
    (8, 'daniel.padilla@example.com', 'Room 1', 'Up to 7 persons', 'ROOM_STAY', DATE '2026-11-15', DATE '2026-11-17', 4, 2500.00, 'DOWNPAYMENT', NULL::timestamptz, 'Family stay'),
    (9, 'james.reid@example.com', 'Room 2', 'Up to 2 persons', 'ROOM_STAY', DATE '2026-11-16', DATE '2026-11-18', 2, 2998.00, 'PAID', TIMESTAMPTZ '2026-11-01 09:40:00+00', NULL),
    (10, 'anne.curtis@example.com', 'Room 3', 'Up to 7 persons', 'ROOM_STAY', DATE '2026-11-18', DATE '2026-11-22', 7, 5000.00, 'DOWNPAYMENT', NULL::timestamptz, 'Anniversary group'),
    (11, 'ivana.alawi@example.com', 'Room 4', 'Up to 7 persons', 'ROOM_STAY', DATE '2026-11-19', DATE '2026-11-22', 3, 10497.00, 'PAID', TIMESTAMPTZ '2026-11-10 16:20:00+00', NULL),
    (12, 'arthur.pacheo@example.com', 'Room 5', 'Up to 2 persons', 'ROOM_STAY', DATE '2026-11-22', DATE '2026-11-25', 2, 0.00, 'UNPAID', NULL::timestamptz, 'Awaiting bank transfer'),
    (13, 'arthur.fuentes@example.com', 'Room 6', 'Up to 7 persons', 'ROOM_STAY', DATE '2026-11-23', DATE '2026-11-26', 5, 1000.00, 'DOWNPAYMENT', NULL::timestamptz, 'Downpayment recorded'),
    (14, 'bryan.fury@example.com', 'Exclusive Resort Event (5 Hours)', 'Flat 5-hour event', 'EVENT_5HR', DATE '2026-11-28', DATE '2026-11-28', 6, 9000.00, 'PAID', TIMESTAMPTZ '2026-11-12 14:05:00+00', 'Private event fully paid'),
    (15, 'paulo.baculinao@example.com', 'Room 1', 'Up to 2 persons', 'ROOM_STAY', DATE '2026-11-29', DATE '2026-12-02', 2, 1000.00, 'DOWNPAYMENT', NULL::timestamptz, NULL),
    (16, 'arthur.nery@example.com', 'Room 2', 'Up to 7 persons', 'ROOM_STAY', DATE '2026-12-01', DATE '2026-12-04', 7, 0.00, 'UNPAID', NULL::timestamptz, 'Corporate booking'),
    (17, 'joshua.garcia@example.com', 'Exclusive Resort Event (5 Hours)', 'Flat 5-hour event', 'EVENT_5HR', DATE '2026-12-05', DATE '2026-12-05', 7, 2000.00, 'DOWNPAYMENT', NULL::timestamptz, 'Birthday event'),
    (18, 'anne.curtis@example.com', 'Room 6', 'Up to 2 persons', 'ROOM_STAY', DATE '2026-12-10', DATE '2026-12-13', 2, 4497.00, 'PAID', TIMESTAMPTZ '2026-11-18 08:50:00+00', NULL),
    (19, 'lebron.james@example.com', 'Room 4', 'Up to 7 persons', 'ROOM_STAY', DATE '2026-12-15', DATE '2026-12-18', 7, 5000.00, 'DOWNPAYMENT', NULL::timestamptz, 'Team stay'),
    (20, 'ivana.alawi@example.com', 'Exclusive Resort Event (5 Hours)', 'Flat 5-hour event', 'EVENT_5HR', DATE '2026-12-20', DATE '2026-12-20', 5, 0.00, 'UNPAID', NULL::timestamptz, 'Payment reminder sent')
) AS v(ord, email, accommodation_name, tier_name, booking_kind, check_in_date, check_out_date, person_count, downpayment_amount, payment_status, paid_at, notes)
JOIN customers c ON c.email = v.email
JOIN accommodations a ON a.name = v.accommodation_name
JOIN rate_tiers rt ON rt.accommodation_id = a.accommodation_id AND rt.tier_name = v.tier_name
ORDER BY v.ord
ON CONFLICT (customer_id, accommodation_id, check_in_date) DO NOTHING;

SELECT
    (SELECT count(*) FROM accommodations) AS accommodations,
    (SELECT count(*) FROM rate_tiers) AS rate_tiers,
    (SELECT count(*) FROM customers) AS customers,
    (SELECT count(*) FROM schedules) AS schedules;

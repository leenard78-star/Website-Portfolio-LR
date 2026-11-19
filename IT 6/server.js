'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const pool = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PAYMENT_STATUSES = ['UNPAID', 'DOWNPAYMENT', 'PAID'];
const PHONE_PATTERN = /^(?:\+639\d{9}|63\+9\d{9})$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IMAGE_PATTERN = /\.(jpg|jpeg|png|webp)$/i;
const NUMERIC_JSON_FIELDS = new Set([
  'scheduleId', 'customerId', 'accommodationId', 'rateTierId',
  'capacity', 'maxPersons', 'nights', 'personCount',
  'rateAmount', 'totalAmount', 'downpaymentAmount', 'remainingBalance'
]);

function normalizeNumbers(row) {
  const result = { ...row };
  for (const key of NUMERIC_JSON_FIELDS) {
    if (result[key] !== null && result[key] !== undefined) {
      result[key] = Number(result[key]);
    }
  }
  return result;
}

const SCHEDULE_COLUMNS = `
  s.schedule_id AS "scheduleId",
  s.customer_id AS "customerId",
  s.full_name AS "fullName",
  s.email,
  s.phone,
  s.accommodation_id AS "accommodationId",
  s.accommodation_name AS "accommodationName",
  s.accommodation_type AS "accommodationType",
  s.accommodation_description AS "accommodationDescription",
  s.booking_kind AS "bookingKind",
  s.rate_tier_id AS "rateTierId",
  s.tier_name AS "tierName",
  s.max_persons AS "maxPersons",
  s.rate_basis AS "rateBasis",
  s.tier_rate AS "rateAmount",
  s.nights,
  to_char(s.check_in_date, 'YYYY-MM-DD') AS "checkInDate",
  to_char(s.check_out_date, 'YYYY-MM-DD') AS "checkOutDate",
  s.check_in_label AS "checkInLabel",
  s.check_out_label AS "checkOutLabel",
  s.time_window AS "timeWindow",
  s.person_count AS "personCount",
  s.total_amount AS "totalAmount",
  s.downpayment_amount AS "downpaymentAmount",
  s.remaining_balance AS "remainingBalance",
  s.payment_status AS "paymentStatus",
  s.paid_at AS "paidAt",
  s.notes,
  s.created_at AS "createdAt",
  s.updated_at AS "updatedAt"
`;

function resolveLogoFile() {
  const preferred = ['pk-logo.jpg', 'pk-logo.png', 'pk-logo.webp']
    .map((name) => path.join(__dirname, 'public', 'assets', name));
  const placed = preferred.find((file) => fs.existsSync(file));
  if (placed) return placed;

  const rootImages = fs.readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const rank = (name) => (/logo/i.test(name) ? 0 : /^pk/i.test(name) ? 1 : 2);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  return rootImages.length ? path.join(__dirname, rootImages[0]) : null;
}

function serveLogo(req, res) {
  const file = resolveLogoFile();
  if (!file) {
    return res.status(404).type('text/plain')
      .send('Logo not found. Copy your logo into IT 6 or public/assets/pk-logo.jpg.');
  }
  res.set('Cache-Control', 'no-cache');
  return res.sendFile(file);
}

app.use(express.json());
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/brand/logo', serveLogo);
app.get('/brand/favicon', serveLogo);

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function validationError(message, details) {
  return new ApiError(422, 'VALIDATION_ERROR', message, details);
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requiredString(value, field, maxLength) {
  if (typeof value !== 'string') {
    throw validationError(`${field} must be text`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw validationError(`${field} is required`);
  }
  if (trimmed.length > maxLength) {
    throw validationError(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw validationError(`${field} must be text`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw validationError(`${field} must be at most ${maxLength} characters`);
  }
  return trimmed || null;
}

function requireDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(`${field} must use YYYY-MM-DD`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw validationError(`${field} is not a real calendar date`);
  }
  return value;
}

function requireInteger(value, field, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw validationError(`${field} must be a whole number between ${min} and ${max}`);
  }
  return number;
}

function requireId(value, field) {
  return requireInteger(value, field, 1, Number.MAX_SAFE_INTEGER);
}

function requireMoney(value, field) {
  if (value === undefined || value === null || value === '') {
    throw validationError(`${field} is required`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000) {
    throw validationError(`${field} must be a peso amount between 0 and 1000000`);
  }
  const cents = Math.round(number * 100);
  if (Math.abs(cents / 100 - number) > 0.000001) {
    throw validationError(`${field} can have at most 2 decimal places`);
  }
  return cents / 100;
}

function requirePhone(value) {
  const phone = requiredString(value, 'phone', 20);
  const compact = phone.replace(/[\s-]/g, '');
  if (!PHONE_PATTERN.test(compact)) {
    throw validationError('phone must be a Philippine mobile like +63 963 464 2360');
  }
  return phone;
}

function requirePaymentStatus(value) {
  if (!PAYMENT_STATUSES.includes(value)) {
    throw validationError(`paymentStatus must be one of: ${PAYMENT_STATUSES.join(', ')}`);
  }
  return value;
}

function pageParams(query) {
  const parse = (value, fallback, max) => {
    const number = Number.parseInt(value, 10);
    return Number.isInteger(number) && number > 0 ? Math.min(number, max) : fallback;
  };
  return {
    page: parse(query.page, 1, 100000),
    pageSize: parse(query.pageSize, 10, 100)
  };
}

function paginate(rows, page, pageSize) {
  const totalItems = rows.length ? Number(rows[0].total_items) : 0;
  return {
    data: rows.map(({ total_items, ...row }) => normalizeNumbers(row)),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize)
    }
  };
}

function dayValue(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function nightsBetween(checkInDate, checkOutDate) {
  return Math.round((dayValue(checkOutDate) - dayValue(checkInDate)) / 86400000);
}

function bookingKindForTier(tier) {
  return tier.accommodationType === 'EVENT' ? 'EVENT_5HR' : 'ROOM_STAY';
}

function calculateTotal(tier, bookingKind, checkInDate, checkOutDate) {
  const rateAmount = Number(tier.rateAmount);
  if (bookingKind === 'EVENT_5HR') {
    if (checkOutDate !== checkInDate) {
      throw validationError('Exclusive events must use the same date for check-in and check-out');
    }
    return rateAmount;
  }
  if (checkOutDate <= checkInDate) {
    throw validationError('checkOutDate must be after checkInDate');
  }
  return nightsBetween(checkInDate, checkOutDate) * rateAmount;
}

function validateBooking(booking) {
  const { tier, personCount, downpaymentAmount, paymentStatus } = booking;
  if (personCount > tier.maxPersons) {
    throw validationError(`personCount cannot exceed tier limit ${tier.maxPersons}`);
  }
  const totalAmount = calculateTotal(
    tier,
    booking.bookingKind,
    booking.checkInDate,
    booking.checkOutDate
  );
  if (paymentStatus === 'UNPAID' && downpaymentAmount !== 0) {
    throw validationError('UNPAID bookings must have a downpayment of 0');
  }
  if (
    paymentStatus === 'DOWNPAYMENT' &&
    (downpaymentAmount <= 0 || downpaymentAmount >= totalAmount)
  ) {
    throw validationError('DOWNPAYMENT needs a downpayment greater than 0 and below the total');
  }
  if (paymentStatus === 'PAID' && downpaymentAmount !== totalAmount) {
    throw validationError(`PAID bookings need a downpayment equal to the total amount of ${totalAmount}`);
  }
  return totalAmount;
}

async function customerExists(customerId) {
  const { rows } = await pool.query(
    'SELECT customer_id FROM customers WHERE customer_id = $1',
    [customerId]
  );
  if (rows.length === 0) {
    throw validationError('customerId does not exist');
  }
}

async function loadRateTier(rateTierId) {
  const { rows } = await pool.query(
    `SELECT rt.rate_tier_id AS "rateTierId",
            rt.accommodation_id AS "accommodationId",
            a.name AS "accommodationName",
            a.accommodation_type AS "accommodationType",
            a.is_active AS "accommodationActive",
            rt.tier_name AS "tierName",
            rt.max_persons AS "maxPersons",
            rt.rate_amount AS "rateAmount",
            rt.rate_basis AS "rateBasis",
            rt.is_active AS "tierActive"
     FROM rate_tiers rt
     JOIN accommodations a ON a.accommodation_id = rt.accommodation_id
     WHERE rt.rate_tier_id = $1`,
    [rateTierId]
  );
  if (rows.length === 0) {
    throw validationError('rateTierId does not exist');
  }
  if (!rows[0].tierActive || !rows[0].accommodationActive) {
    throw validationError('That accommodation or rate tier is not active');
  }
  return rows[0];
}

async function getSchedule(scheduleId) {
  const { rows } = await pool.query(
    `SELECT ${SCHEDULE_COLUMNS} FROM v_schedule_details s WHERE s.schedule_id = $1`,
    [scheduleId]
  );
  return rows[0] ? normalizeNumbers(rows[0]) : null;
}

app.get('/api/health', asyncRoute(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected' });
}));

app.get('/api/options', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.accommodation_id AS "accommodationId",
            a.name,
            a.accommodation_type AS "accommodationType",
            a.capacity,
            a.description,
            rt.rate_tier_id AS "rateTierId",
            rt.tier_name AS "tierName",
            rt.max_persons AS "maxPersons",
            rt.rate_amount AS "rateAmount",
            rt.rate_basis AS "rateBasis"
     FROM accommodations a
     JOIN rate_tiers rt ON rt.accommodation_id = a.accommodation_id
     WHERE a.is_active = TRUE AND rt.is_active = TRUE
     ORDER BY CASE a.accommodation_type WHEN 'ROOM' THEN 0 ELSE 1 END,
              a.name, rt.max_persons`
  );
  const normalized = rows.map(normalizeNumbers);
  res.json({
    options: normalized,
    accommodations: normalized,
    paymentStatuses: PAYMENT_STATUSES,
    resort: {
      name: "PK's Resort",
      ownerLine: "PK's Resort — Owned & Managed by the Bennun Family",
      checkIn: '1:00 PM',
      checkOut: '11:00 AM',
      eventWindow: '5-Hour Event Window'
    }
  });
}));

app.get('/api/customers', asyncRoute(async (req, res) => {
  const { page, pageSize } = pageParams(req.query);
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const { rows } = await pool.query(
    `SELECT customer_id AS "customerId",
            full_name AS "fullName",
            email, phone, address,
            created_at AS "createdAt",
            COUNT(*) OVER() AS total_items
     FROM customers
     WHERE $1 = '' OR full_name ILIKE '%' || $1 || '%'
                   OR email ILIKE '%' || $1 || '%'
                   OR phone ILIKE '%' || $1 || '%'
     ORDER BY customer_id
     LIMIT $2 OFFSET $3`,
    [search, pageSize, (page - 1) * pageSize]
  );
  res.json(paginate(rows, page, pageSize));
}));

app.post('/api/customers', asyncRoute(async (req, res) => {
  const fullName = requiredString(req.body.fullName, 'fullName', 100);
  const email = requiredString(req.body.email, 'email', 180).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw validationError('email is not a valid address');
  }
  const phone = requirePhone(req.body.phone);
  const address = optionalString(req.body.address, 'address', 200);

  const { rows } = await pool.query(
    `INSERT INTO customers (full_name, email, phone, address)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING
     RETURNING customer_id AS "customerId", full_name AS "fullName", email, phone, address`,
    [fullName, email, phone, address]
  );
  if (rows.length === 0) {
    throw new ApiError(409, 'DUPLICATE_EMAIL', 'A customer with that email already exists');
  }
  res.status(201).json(rows[0]);
}));

app.get('/api/schedules', asyncRoute(async (req, res) => {
  const { page, pageSize } = pageParams(req.query);
  const paymentStatus = typeof req.query.paymentStatus === 'string' && req.query.paymentStatus !== ''
    ? requirePaymentStatus(req.query.paymentStatus)
    : null;
  const from = typeof req.query.from === 'string' && req.query.from !== ''
    ? requireDate(req.query.from, 'from')
    : null;
  const to = typeof req.query.to === 'string' && req.query.to !== ''
    ? requireDate(req.query.to, 'to')
    : null;
  const customerId = req.query.customerId
    ? requireId(req.query.customerId, 'customerId')
    : null;
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';

  const { rows } = await pool.query(
    `SELECT ${SCHEDULE_COLUMNS}, COUNT(*) OVER() AS total_items
     FROM v_schedule_details s
     WHERE ($1::text IS NULL OR s.payment_status = $1)
       AND ($2::date IS NULL OR s.check_in_date >= $2::date)
       AND ($3::date IS NULL OR s.check_in_date <= $3::date)
       AND ($4::bigint IS NULL OR s.customer_id = $4)
       AND ($5::text IS NULL OR s.full_name ILIKE '%' || $5 || '%'
                               OR s.phone ILIKE '%' || $5 || '%'
                               OR (regexp_replace($5, '\\D', '', 'g') <> ''
                                   AND regexp_replace(s.phone, '\\D', '', 'g')
                                       ILIKE '%' || regexp_replace($5, '\\D', '', 'g') || '%'))
     ORDER BY s.check_in_date, s.schedule_id
     LIMIT $6 OFFSET $7`,
    [paymentStatus, from, to, customerId, search || null, pageSize, (page - 1) * pageSize]
  );
  res.json(paginate(rows, page, pageSize));
}));

app.get('/api/schedules/:id', asyncRoute(async (req, res) => {
  const scheduleId = requireId(req.params.id, 'scheduleId');
  const schedule = await getSchedule(scheduleId);
  if (!schedule) {
    throw new ApiError(404, 'NOT_FOUND', `Schedule ${scheduleId} does not exist`);
  }
  res.json(schedule);
}));

app.post('/api/schedules', asyncRoute(async (req, res) => {
  const customerId = requireId(req.body.customerId, 'customerId');
  const rateTierId = requireId(req.body.rateTierId, 'rateTierId');
  const checkInDate = requireDate(req.body.checkInDate, 'checkInDate');
  const checkOutDate = requireDate(req.body.checkOutDate, 'checkOutDate');
  const personCount = requireInteger(req.body.personCount, 'personCount', 1, 7);
  const downpaymentAmount = requireMoney(req.body.downpaymentAmount, 'downpaymentAmount');
  const paymentStatus = requirePaymentStatus(req.body.paymentStatus);
  const notes = optionalString(req.body.notes, 'notes', 500);

  await customerExists(customerId);
  const tier = await loadRateTier(rateTierId);
  const bookingKind = bookingKindForTier(tier);
  validateBooking({
    tier,
    bookingKind,
    checkInDate,
    checkOutDate,
    personCount,
    downpaymentAmount,
    paymentStatus
  });

  const { rows } = await pool.query(
    `INSERT INTO schedules
        (customer_id, accommodation_id, rate_tier_id, booking_kind,
         check_in_date, check_out_date, person_count, downpayment_amount,
         payment_status, paid_at, notes)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9,
             CASE WHEN $9 = 'PAID' THEN NOW() ELSE NULL END, $10)
     ON CONFLICT (customer_id, accommodation_id, check_in_date) DO NOTHING
     RETURNING schedule_id`,
    [customerId, tier.accommodationId, rateTierId, bookingKind,
      checkInDate, checkOutDate, personCount, downpaymentAmount, paymentStatus, notes]
  );
  if (rows.length === 0) {
    throw new ApiError(409, 'DUPLICATE_SCHEDULE', 'That customer already has a booking starting on that date in this accommodation');
  }
  res.status(201).json(await getSchedule(rows[0].schedule_id));
}));

app.patch('/api/schedules/:id', asyncRoute(async (req, res) => {
  const scheduleId = requireId(req.params.id, 'scheduleId');
  const currentResult = await pool.query(
    `SELECT customer_id AS "customerId",
            accommodation_id AS "accommodationId",
            rate_tier_id AS "rateTierId",
            to_char(check_in_date, 'YYYY-MM-DD') AS "checkInDate",
            to_char(check_out_date, 'YYYY-MM-DD') AS "checkOutDate",
            person_count AS "personCount",
            downpayment_amount AS "downpaymentAmount",
            payment_status AS "paymentStatus"
     FROM schedules WHERE schedule_id = $1`,
    [scheduleId]
  );
  if (currentResult.rows.length === 0) {
    throw new ApiError(404, 'NOT_FOUND', `Schedule ${scheduleId} does not exist`);
  }
  const current = currentResult.rows[0];

  const next = {
    customerId: current.customerId,
    rateTierId: current.rateTierId,
    checkInDate: current.checkInDate,
    checkOutDate: current.checkOutDate,
    personCount: current.personCount,
    downpaymentAmount: Number(current.downpaymentAmount),
    paymentStatus: current.paymentStatus
  };
  if (req.body.customerId !== undefined) next.customerId = requireId(req.body.customerId, 'customerId');
  if (req.body.rateTierId !== undefined) next.rateTierId = requireId(req.body.rateTierId, 'rateTierId');
  if (req.body.checkInDate !== undefined) next.checkInDate = requireDate(req.body.checkInDate, 'checkInDate');
  if (req.body.checkOutDate !== undefined) next.checkOutDate = requireDate(req.body.checkOutDate, 'checkOutDate');
  if (req.body.personCount !== undefined) next.personCount = requireInteger(req.body.personCount, 'personCount', 1, 7);
  if (req.body.downpaymentAmount !== undefined) {
    next.downpaymentAmount = requireMoney(req.body.downpaymentAmount, 'downpaymentAmount');
  }
  if (req.body.paymentStatus !== undefined) next.paymentStatus = requirePaymentStatus(req.body.paymentStatus);

  const notesProvided = Object.prototype.hasOwnProperty.call(req.body, 'notes');
  const notes = notesProvided ? optionalString(req.body.notes, 'notes', 500) : null;

  await customerExists(next.customerId);
  const tier = await loadRateTier(next.rateTierId);
  const bookingKind = bookingKindForTier(tier);
  validateBooking({ ...next, tier, bookingKind });

  await pool.query(
    `UPDATE schedules SET
       customer_id = $2,
       accommodation_id = $3,
       rate_tier_id = $4,
       booking_kind = $5,
       check_in_date = $6::date,
       check_out_date = $7::date,
       person_count = $8,
       downpayment_amount = $9,
       payment_status = $10,
       paid_at = CASE WHEN $10 = 'PAID' THEN COALESCE(paid_at, NOW()) ELSE NULL END,
       notes = CASE WHEN $11::boolean THEN $12::text ELSE notes END
     WHERE schedule_id = $1`,
    [scheduleId, next.customerId, tier.accommodationId, next.rateTierId, bookingKind,
      next.checkInDate, next.checkOutDate, next.personCount, next.downpaymentAmount,
      next.paymentStatus, notesProvided, notes]
  );
  res.json(await getSchedule(scheduleId));
}));

app.post('/api/schedules/:id/settle', asyncRoute(async (req, res) => {
  const scheduleId = requireId(req.params.id, 'scheduleId');
  const { rows } = await pool.query(
    `UPDATE schedules s
        SET downpayment_amount = v.total_amount,
            payment_status = 'PAID',
            paid_at = COALESCE(s.paid_at, NOW())
       FROM v_schedule_details v
      WHERE s.schedule_id = $1 AND v.schedule_id = $1
      RETURNING s.schedule_id`,
    [scheduleId]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'NOT_FOUND', `Schedule ${scheduleId} does not exist`);
  }
  res.json(await getSchedule(scheduleId));
}));

app.delete('/api/schedules/:id', asyncRoute(async (req, res) => {
  const scheduleId = requireId(req.params.id, 'scheduleId');
  await pool.query('DELETE FROM schedules WHERE schedule_id = $1', [scheduleId]);
  res.status(204).end();
}));

app.use((error, req, res, next) => {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {})
      }
    });
  }
  if (error.code === '23505') {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'A record with that unique value already exists' }
    });
  }
  if (error.code === '23503') {
    return res.status(422).json({
      error: { code: 'VALIDATION_ERROR', message: 'A related customer, accommodation or rate tier does not exist' }
    });
  }
  if (['23514', '22007', '22P02'].includes(error.code)) {
    return res.status(422).json({
      error: { code: 'VALIDATION_ERROR', message: 'The value violates a database constraint' }
    });
  }
  if (error.code === 'P0001') {
    return res.status(422).json({
      error: { code: 'VALIDATION_ERROR', message: error.message.replace(/^.*?:\s*/, '') }
    });
  }
  if (['28P01', '28000'].includes(error.code)) {
    return res.status(500).json({
      error: {
        code: 'DB_AUTH_FAILED',
        message: 'PostgreSQL rejected the password. Set DB_PASSWORD in .env to your local password and restart the server.'
      }
    });
  }
  if (error.code === '3D000') {
    return res.status(500).json({
      error: {
        code: 'DB_MISSING',
        message: 'Database pks_resort does not exist. Create it with createdb, then run schema_and_seed.sql.'
      }
    });
  }
  if (['ECONNREFUSED', 'ENOTFOUND'].includes(error.code)) {
    return res.status(500).json({
      error: {
        code: 'DB_UNREACHABLE',
        message: `PostgreSQL is not accepting connections on ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 5432}.`
      }
    });
  }
  console.error(error);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' }
  });
});

app.listen(PORT, () => {
  console.log(`PK's Resort running at http://localhost:${PORT}`);
});

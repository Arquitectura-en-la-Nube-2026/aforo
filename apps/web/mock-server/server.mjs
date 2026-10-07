// DEV-ONLY stateful mock of the Aforo API Gateway plus every public service route.
// In-memory, Node built-ins only. Not part of the Docker image or any deployment.
// Contracts: contracts/conventions.md and contracts/openapi/*.yaml (the contracts win).
import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------
const env = process.env;
const num = (name, def) => {
  const n = Number(env[name]);
  return env[name] !== undefined && env[name] !== '' && Number.isFinite(n) ? n : def;
};
const PORT = num('PORT', 8080);
const FRONTEND_ORIGIN = env.FRONTEND_ORIGIN || 'http://localhost:4000';
const PUBLIC_ORIGIN = env.PUBLIC_ORIGIN || `http://localhost:${PORT}`;
const RESERVATION_SECONDS = num('MOCK_RESERVATION_SECONDS', 480);
const SCHEDULED_MINUTES = num('MOCK_SCHEDULED_MINUTES', 3);
const QUEUE_START = num('MOCK_QUEUE_START', 8);
const QUEUE_STEP_SECONDS = num('MOCK_QUEUE_STEP_SECONDS', 2);
const PASS_SECONDS = num('MOCK_PASS_SECONDS', 600);
const NO_SSE = env.MOCK_NO_SSE === '1';
const WEBHOOK_DELAY_MS = 2000;
const FAULT_MODES = ['none', 'error', 'timeout'];
let faultMode = FAULT_MODES.includes(env.MOCK_FAULT) ? env.MOCK_FAULT : 'none';

const JWT_SECRET = 'aforo-mock-dev-secret';
const JWT_ISSUER = 'aforo-mock-gateway';
const TOKEN_TTL_SECONDS = 8 * 3600;
const ALLOWED_ORIGINS = new Set([FRONTEND_ORIGIN, 'http://127.0.0.1:4000']);
const STARTED_AT = Date.now();

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const b64url = (x) => Buffer.from(x).toString('base64url');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// UUID v5-style id: sha1 over (DNS namespace + name), version and variant bits set.
const NAMESPACE = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
function uuidFromName(name) {
  const h = crypto.createHash('sha1').update(NAMESPACE).update(name).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// JSON with sorted keys, so two bodies that differ only in key order hash the same.
function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------------------------
// Problem details (application/problem+json)
// ---------------------------------------------------------------------------------------------
const TITLES = {
  UNAUTHENTICATED: 'Authentication required',
  SALE_NOT_OPEN: 'Sale is not open',
  SOLD_OUT: 'Not enough availability',
  LIMIT_EXCEEDED: 'Ticket limit exceeded',
  ACTIVE_RESERVATION_EXISTS: 'Active reservation exists',
  RESERVATION_EXPIRED: 'Reservation expired',
  IDEMPOTENCY_CONFLICT: 'Idempotency key reused with a different body',
  VALIDATION_ERROR: 'Validation failed',
  MALFORMED_REQUEST: 'Malformed request',
  NOT_FOUND: 'Resource not found',
  PAYMENT_UNAVAILABLE: 'Payment gateway unavailable',
  INTERNAL: 'Internal error',
};

class ApiError extends Error {
  constructor(status, code, detail, errors) {
    super(detail);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
  body(correlationId) {
    return {
      type: `https://aforo.dev/errors/${this.code.toLowerCase().replaceAll('_', '-')}`,
      title: TITLES[this.code] ?? this.code,
      status: this.status,
      code: this.code,
      detail: this.message,
      correlationId,
      ...(this.errors ? { errors: this.errors } : {}),
    };
  }
}
const notFound = (what) => new ApiError(404, 'NOT_FOUND', `${what} not found`);
const invalid = (errors) =>
  new ApiError(422, 'VALIDATION_ERROR', 'Request does not match the contract', errors);

// ---------------------------------------------------------------------------------------------
// Seed data and mutable state (all in memory)
// ---------------------------------------------------------------------------------------------
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const mkSector = (n, name, capacity, priceCents, available = capacity) => ({
  id: `a1a1a1a1-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name,
  capacity,
  priceCents,
  currency: 'COP',
  seedAvailable: available,
  available,
});
const rules = () => ({
  maxTicketsPerPerson: 4,
  reservationTtlSeconds: RESERVATION_SECONDS,
  openingWindowSeconds: 30,
});
const events = [
  {
    id: '8f1b2c3d-0000-4000-8000-000000000001',
    name: 'Festival Estéreo 2026',
    venue: 'Parque Simón Bolívar',
    startsAt: STARTED_AT + 30 * DAY,
    salesOpensAt: STARTED_AT - DAY,
    salesRules: rules(),
    sectors: [
      mkSector(1, 'General', 500, 18000000),
      mkSector(2, 'Platea', 120, 45000000),
      mkSector(3, 'VIP', 30, 120000000),
    ],
  },
  {
    id: '8f1b2c3d-0000-4000-8000-000000000002',
    name: 'Noche de Salsa en el Teatro Colón',
    venue: 'Teatro Colón',
    startsAt: STARTED_AT + 20 * DAY,
    salesOpensAt: STARTED_AT - DAY,
    salesRules: rules(),
    sectors: [mkSector(4, 'Balcón', 3, 9000000, 2), mkSector(5, 'Orquesta', 40, 15000000)],
  },
  {
    id: '8f1b2c3d-0000-4000-8000-000000000003',
    name: 'Jazz al Parque',
    venue: 'Parque El Virrey',
    startsAt: STARTED_AT + 45 * DAY,
    salesOpensAt: STARTED_AT + SCHEDULED_MINUTES * 60_000,
    salesRules: rules(),
    sectors: [mkSector(6, 'General', 200, 6000000)],
  },
].map((e) => ({ ...e, salesClosesAt: e.startsAt - 2 * HOUR, status: 'PUBLISHED' }));

const findEvent = (id) => events.find((e) => e.id === id);
const saleState = (e, now = Date.now()) =>
  now < e.salesOpensAt ? 'SCHEDULED' : now >= e.salesClosesAt ? 'CLOSED' : 'OPEN';

const toEvent = (e) => ({
  id: e.id,
  name: e.name,
  venue: e.venue,
  startsAt: iso(e.startsAt),
  status: e.status,
  salesOpensAt: iso(e.salesOpensAt),
  salesClosesAt: iso(e.salesClosesAt),
  saleState: saleState(e),
  salesRules: e.salesRules,
  sectors: e.sectors.map(({ id, name, capacity, priceCents, currency }) => ({
    id,
    name,
    capacity,
    priceCents,
    currency,
  })),
});

const orders = new Map(); // orderId -> order
const queues = new Map(); // `${eventId}|${userId}` -> queue entry
const payments = new Map(); // paymentId -> payment
const idempotency = new Map(); // `${userId}|${route}|${key}` -> { hash, status, body }
let orderSeq = 0;

function resetState() {
  for (const e of events) for (const s of e.sectors) s.available = s.seedAvailable;
  orders.clear();
  queues.clear();
  payments.clear();
  idempotency.clear();
}

// ---------------------------------------------------------------------------------------------
// Auth: HS256 JWT issued by login, verified on every protected route
// ---------------------------------------------------------------------------------------------
const sign = (data) => crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');

function issueToken(user, nowMs) {
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = {
    iss: JWT_ISSUER,
    sub: user.id,
    email: user.email,
    name: user.displayName,
    iat,
    exp: iat + TOKEN_TTL_SECONDS,
  };
  const payload = b64url(JSON.stringify(claims));
  return { token: `${header}.${payload}.${sign(`${header}.${payload}`)}`, exp: claims.exp };
}

function authenticate(req) {
  const fail = (why) => new ApiError(401, 'UNAUTHENTICATED', why);
  const m = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '');
  if (!m) throw fail('Missing Bearer token');
  const parts = m[1].split('.');
  if (parts.length !== 3) throw fail('Malformed token');
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    throw fail('Invalid token signature');
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw fail('Malformed token');
  }
  if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') throw fail('Bad claims');
  if (claims.exp * 1000 <= Date.now()) throw fail('Token expired');
  return { id: claims.sub, email: claims.email, name: claims.name };
}

// ---------------------------------------------------------------------------------------------
// Reservations: lazy expiry (also driven by a 1 s interval)
// ---------------------------------------------------------------------------------------------
const findSector = (eventId, sectorId) =>
  findEvent(eventId)?.sectors.find((s) => s.id === sectorId);

function expireDue(now = Date.now()) {
  for (const o of orders.values()) {
    if (o.status === 'PENDING_PAYMENT' && o.expiresAtMs <= now) {
      o.status = 'EXPIRED';
      findSector(o.eventId, o.sectorId).available += o.quantity;
    }
  }
}

const toOrderCreated = (o) => ({
  orderId: o.orderId,
  status: o.status,
  reservationId: o.reservationId,
  expiresAt: iso(o.expiresAtMs),
  unitPriceCents: o.unitPriceCents,
  totalCents: o.totalCents,
  currency: o.currency,
});
const toOrder = (o) => ({
  ...toOrderCreated(o),
  eventId: o.eventId,
  sectorId: o.sectorId,
  quantity: o.quantity,
  createdAt: iso(o.createdAtMs),
  paidAt: o.paidAtMs ? iso(o.paidAtMs) : null,
});

// ---------------------------------------------------------------------------------------------
// Queue simulation: position is computed lazily from elapsed time
// ---------------------------------------------------------------------------------------------
function queueStatus(eventId, entry, now = Date.now()) {
  if (!entry.admitted) {
    const steps = Math.floor((now - entry.joinedAt) / (QUEUE_STEP_SECONDS * 1000));
    const position = entry.startPos - steps;
    if (position > 0) {
      return {
        eventId,
        state: 'WAITING',
        position,
        aheadOf: position - 1,
        estimatedWaitSeconds: (position - 1) * QUEUE_STEP_SECONDS,
        passToken: null,
        passExpiresAt: null,
      };
    }
    entry.admitted = true;
    entry.passToken = `p_${crypto.randomBytes(18).toString('base64url')}`;
    entry.passExpiresAtMs = now + PASS_SECONDS * 1000;
  }
  return {
    eventId,
    state: 'ADMITTED',
    position: 0,
    aheadOf: 0,
    estimatedWaitSeconds: 0,
    passToken: entry.passToken,
    passExpiresAt: iso(entry.passExpiresAtMs),
  };
}

// ---------------------------------------------------------------------------------------------
// Request plumbing
// ---------------------------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) reject(new ApiError(400, 'MALFORMED_REQUEST', 'Body too large'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJson(ctx) {
  try {
    return JSON.parse(ctx.raw);
  } catch {
    throw new ApiError(400, 'MALFORMED_REQUEST', 'Request body is not valid JSON');
  }
}

function send(ctx, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  ctx.res.writeHead(status, {
    'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  ctx.res.end(payload);
}

function parsePaging(query) {
  const errors = [];
  const page = query.page === undefined ? 0 : Number(query.page);
  const size = query.size === undefined ? 20 : Number(query.size);
  if (!Number.isInteger(page) || page < 0) errors.push({ field: 'page', message: 'must be >= 0' });
  if (!Number.isInteger(size) || size < 1 || size > 100) {
    errors.push({ field: 'size', message: 'must be between 1 and 100' });
  }
  if (errors.length) throw invalid(errors);
  return { page, size };
}
const paginate = (all, { page, size }) => ({
  items: all.slice(page * size, page * size + size),
  page,
  size,
  total: all.length,
});

// Idempotent execution: same key + same body replays; same key + other body conflicts.
// Only 201 and 409 results are stored (a 503 fault must stay retryable with the same key).
function idempotent(ctx, body, produce) {
  const key = ctx.req.headers['idempotency-key'];
  if (!key) {
    throw invalid([{ field: 'Idempotency-Key', message: 'header is required' }]);
  }
  const id = `${ctx.user.id}|${ctx.req.method} ${ctx.url.pathname}|${key}`;
  const hash = sha256(stableStringify(body ?? null));
  const hit = idempotency.get(id);
  if (hit) {
    if (hit.hash !== hash) {
      throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used with another body');
    }
    const replayed = { 'Idempotent-Replayed': 'true' };
    return send(ctx, hit.status, hit.body, replayed);
  }
  try {
    const result = produce();
    idempotency.set(id, { hash, status: result.status, body: result.body });
    send(ctx, result.status, result.body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      idempotency.set(id, { hash, status: 409, body: err.body(ctx.cid) });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------
async function login(ctx) {
  const body = parseJson(ctx);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid([{ field: '', message: 'body must be a JSON object' }]);
  }
  const errors = [];
  const { email, displayName } = body;
  const emailOk = typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk || email.length > 254) {
    errors.push({ field: 'email', message: 'must be a valid email address' });
  }
  if (typeof displayName !== 'string' || displayName.length < 1 || displayName.length > 80) {
    errors.push({ field: 'displayName', message: 'must be between 1 and 80 characters' });
  }
  for (const k of Object.keys(body)) {
    if (k !== 'email' && k !== 'displayName') errors.push({ field: k, message: 'is not allowed' });
  }
  if (errors.length) throw invalid(errors);
  const user = { id: uuidFromName(email.toLowerCase()), email, displayName };
  const { token, exp } = issueToken(user, Date.now());
  send(ctx, 200, {
    accessToken: token,
    tokenType: 'Bearer',
    expiresAt: iso(exp * 1000),
    user,
  });
}

function listEvents(ctx) {
  const { status } = ctx.query;
  if (status !== undefined && !['DRAFT', 'PUBLISHED'].includes(status)) {
    throw invalid([{ field: 'status', message: 'must be DRAFT or PUBLISHED' }]);
  }
  const paging = parsePaging(ctx.query);
  const matching = events.filter((e) => status === undefined || e.status === status);
  const { items, ...meta } = paginate(matching, paging);
  send(ctx, 200, { items: items.map(toEvent), ...meta });
}

function getEvent(ctx) {
  const e = findEvent(ctx.params.id);
  if (!e) throw notFound('Event');
  send(ctx, 200, toEvent(e));
}

function getAvailability(ctx) {
  const e = findEvent(ctx.params.id);
  if (!e) throw notFound('Event');
  send(ctx, 200, {
    eventId: e.id,
    sectors: e.sectors.map((s) => ({
      sectorId: s.id,
      name: s.name,
      capacity: s.capacity,
      available: s.available,
      priceCents: s.priceCents,
      currency: s.currency,
    })),
  });
}

function queueEntryFor(ctx) {
  const e = findEvent(ctx.params.id);
  if (!e) throw notFound('Event');
  return { event: e, key: `${e.id}|${ctx.user.id}` };
}

/**
 * The real queue keeps the pass in Redis with a TTL, so once it lapses the buyer is gone from the
 * queue and joining again puts them at the back. Mirror that: drop an admitted entry whose pass
 * has expired.
 */
function liveQueueEntry(key) {
  const entry = queues.get(key);
  if (entry?.admitted && entry.passExpiresAtMs <= Date.now()) {
    queues.delete(key);
    return undefined;
  }
  return entry;
}

function joinQueue(ctx) {
  const { event, key } = queueEntryFor(ctx);
  let entry = liveQueueEntry(key);
  if (!entry) {
    if (saleState(event) !== 'OPEN') {
      throw new ApiError(409, 'SALE_NOT_OPEN', `Sale for "${event.name}" is not open`);
    }
    entry = { joinedAt: Date.now(), startPos: QUEUE_START, admitted: false };
    queues.set(key, entry);
  }
  send(ctx, 201, queueStatus(event.id, entry));
}

function getQueueStatus(ctx) {
  const { event, key } = queueEntryFor(ctx);
  const entry = liveQueueEntry(key);
  if (!entry) throw notFound('Queue entry');
  send(ctx, 200, queueStatus(event.id, entry));
}

function streamQueue(ctx) {
  if (NO_SSE) throw new ApiError(503, 'INTERNAL', 'SSE is disabled (MOCK_NO_SSE=1); poll /status');
  const { event, key } = queueEntryFor(ctx);
  const entry = queues.get(key);
  if (!entry) throw notFound('Queue entry');
  const { res, req } = ctx;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const write = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  let last = null;
  let ticker;
  let keepAlive;
  const stop = () => {
    clearInterval(ticker);
    clearInterval(keepAlive);
  };
  const tick = () => {
    const s = queueStatus(event.id, entry);
    const signature = `${s.state}:${s.position}`;
    if (signature === last) return;
    last = signature;
    if (s.state === 'ADMITTED') {
      write('admitted', s);
      stop();
      res.end();
    } else {
      write('position', s);
    }
  };
  ticker = setInterval(tick, 200);
  keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  req.on('close', stop);
  tick();
}

function createOrder(ctx) {
  const body = parseJson(ctx);
  const queuePass = ctx.req.headers['x-queue-pass'];
  if (queuePass) ctx.queuePass = queuePass; // logged, never verified (D-07)
  idempotent(ctx, body, () => {
    const errors = [];
    const obj = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    for (const f of ['eventId', 'sectorId']) {
      if (typeof obj[f] !== 'string' || !UUID_RE.test(obj[f])) {
        errors.push({ field: f, message: 'must be a UUID' });
      }
    }
    if (!Number.isInteger(obj.quantity) || obj.quantity < 1) {
      errors.push({ field: 'quantity', message: 'must be an integer >= 1' });
    }
    for (const k of Object.keys(obj)) {
      if (!['eventId', 'sectorId', 'quantity'].includes(k)) {
        errors.push({ field: k, message: 'is not allowed' });
      }
    }
    if (errors.length) throw invalid(errors);

    const event = findEvent(obj.eventId);
    const sector = findSector(obj.eventId, obj.sectorId);
    if (!event || !sector) throw notFound('Event or sector');
    const qty = obj.quantity;
    if (qty > sector.available) {
      throw new ApiError(
        409,
        'SOLD_OUT',
        `${sector.name} has ${sector.available} seats left and ${qty} were requested`,
      );
    }
    const mine = [...orders.values()].filter(
      (o) => o.userId === ctx.user.id && o.eventId === event.id,
    );
    if (mine.some((o) => o.status === 'PENDING_PAYMENT')) {
      throw new ApiError(409, 'ACTIVE_RESERVATION_EXISTS', 'You already hold a reservation');
    }
    const confirmed = mine.filter((o) => o.status === 'PAID').reduce((n, o) => n + o.quantity, 0);
    const max = event.salesRules.maxTicketsPerPerson;
    if (confirmed + qty > max) {
      throw new ApiError(
        409,
        'LIMIT_EXCEEDED',
        `Limit is ${max} per person; you hold ${confirmed} and asked for ${qty}`,
      );
    }
    sector.available -= qty;
    const now = Date.now();
    const order = {
      orderId: crypto.randomUUID(),
      seq: ++orderSeq,
      userId: ctx.user.id,
      reservationId: crypto.randomUUID(),
      eventId: event.id,
      sectorId: sector.id,
      quantity: qty,
      status: 'PENDING_PAYMENT',
      expiresAtMs: now + event.salesRules.reservationTtlSeconds * 1000,
      unitPriceCents: sector.priceCents,
      totalCents: sector.priceCents * qty,
      currency: sector.currency,
      createdAtMs: now,
      paidAtMs: null,
    };
    orders.set(order.orderId, order);
    return { status: 201, body: toOrderCreated(order) };
  });
}

function listOrders(ctx) {
  const paging = parsePaging(ctx.query);
  const mine = [...orders.values()].filter((o) => o.userId === ctx.user.id);
  mine.sort((a, b) => b.createdAtMs - a.createdAtMs || b.seq - a.seq);
  const { items, ...meta } = paginate(mine, paging);
  send(ctx, 200, { items: items.map(toOrder), ...meta });
}

const ownedOrder = (ctx) => {
  const o = orders.get(ctx.params.id);
  if (!o || o.userId !== ctx.user.id) throw notFound('Order');
  return o;
};
const getOrder = (ctx) => send(ctx, 200, toOrder(ownedOrder(ctx)));

function createPaymentIntent(ctx) {
  if (ctx.req.headers['x-queue-pass']) ctx.queuePass = ctx.req.headers['x-queue-pass'];
  idempotent(ctx, null, () => {
    const order = ownedOrder(ctx);
    if (order.status !== 'PENDING_PAYMENT') {
      throw new ApiError(409, 'RESERVATION_EXPIRED', `Order is ${order.status}, not payable`);
    }
    if (faultMode !== 'none') {
      throw new ApiError(503, 'PAYMENT_UNAVAILABLE', `Injected payment fault (${faultMode})`);
    }
    const paymentId = crypto.randomUUID();
    payments.set(paymentId, { paymentId, orderId: order.orderId, completed: false });
    return {
      status: 201,
      body: {
        paymentId,
        checkoutUrl: `${PUBLIC_ORIGIN}/mock-gateway/checkout/${paymentId}`,
        expiresAt: iso(order.expiresAtMs),
      },
    };
  });
}

// ---- Mock payment gateway (browser facing) ----
function checkoutPage(ctx) {
  const payment = payments.get(ctx.params.id);
  const order = payment && orders.get(payment.orderId);
  if (!order) throw notFound('Payment');
  const total = new Intl.NumberFormat('es-CO').format(order.totalCents / 100);
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Pasarela de pago (simulada)</title>
<style>
body{font-family:system-ui,sans-serif;max-width:26rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a}
.card{border:1px solid #ccc;border-radius:12px;padding:1.5rem}
button{font-size:1rem;padding:.7rem 1.2rem;margin:.5rem .5rem 0 0;border:0;border-radius:8px;
cursor:pointer}
#pay{background:#16794c;color:#fff}#decline{background:#b3261e;color:#fff}
button:disabled{opacity:.5;cursor:wait}
</style></head><body><div class="card">
<h1>Pasarela de pago</h1><p>Entorno de pruebas. No se realiza ningún cobro real.</p>
<p>Total a pagar: <strong>COP ${total}</strong></p>
<button id="pay">Pagar</button><button id="decline">Rechazar</button></div>
<script>
const paymentId = ${JSON.stringify(payment.paymentId)};
async function complete(outcome) {
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  const res = await fetch('/mock-gateway/checkout/' + paymentId + '/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome }),
  });
  const data = await res.json();
  location.href = data.redirectTo;
}
document.getElementById('pay').onclick = () => complete('APPROVED');
document.getElementById('decline').onclick = () => complete('DECLINED');
</script></body></html>`;
  ctx.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  ctx.res.end(html);
}

// Records the outcome and schedules the "webhook" that moves the order.
function completePayment(ctx, outcome) {
  if (outcome !== 'APPROVED' && outcome !== 'DECLINED') {
    throw invalid([{ field: 'outcome', message: 'must be APPROVED or DECLINED' }]);
  }
  const payment = payments.get(ctx.params.id);
  if (!payment) throw notFound('Payment');
  if (!payment.completed) {
    payment.completed = true;
    const timer = setTimeout(() => deliverWebhook(payment, outcome), WEBHOOK_DELAY_MS);
    timer.unref();
  }
  return `${FRONTEND_ORIGIN}/orders/${payment.orderId}`;
}

function deliverWebhook(payment, outcome) {
  expireDue();
  const order = orders.get(payment.orderId);
  if (!order || outcome !== 'APPROVED') return; // DECLINED: order stays PENDING_PAYMENT
  if (order.status === 'PENDING_PAYMENT') {
    order.status = 'PAID';
    order.paidAtMs = Date.now();
  } else if (order.status === 'EXPIRED') {
    order.status = 'REFUND_PENDING';
  }
}

async function checkoutCompletePost(ctx) {
  const body = parseJson(ctx);
  const redirectTo = completePayment(ctx, body?.outcome);
  send(ctx, 200, { redirectTo });
}
function checkoutCompleteGet(ctx) {
  const redirectTo = completePayment(ctx, ctx.query.outcome); // contract variant (R-03)
  ctx.res.writeHead(302, { Location: redirectTo });
  ctx.res.end();
}

// ---- Dev controls (not in any contract) ----
function mockState(ctx) {
  send(ctx, 200, {
    now: iso(Date.now()),
    startedAt: iso(STARTED_AT),
    faultMode,
    events: events.map((e) => ({
      ...toEvent(e),
      sectors: e.sectors.map((s) => ({ id: s.id, name: s.name, available: s.available })),
    })),
    orders: [...orders.values()].map((o) => ({ ...toOrder(o), userId: o.userId })),
    queues: [...queues.entries()].map(([k, v]) => ({ key: k, ...v })),
    payments: [...payments.values()],
    idempotencyKeys: idempotency.size,
  });
}
function mockFault(ctx) {
  const mode = ctx.query.mode;
  if (!FAULT_MODES.includes(mode)) {
    throw invalid([{ field: 'mode', message: `must be one of ${FAULT_MODES.join(', ')}` }]);
  }
  faultMode = mode;
  send(ctx, 200, { faultMode });
}
function mockReset(ctx) {
  resetState();
  send(ctx, 200, { status: 'reset' });
}

// ---------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------
const routes = [];
function route(method, pattern, handler, { isPublic = false } = {}) {
  const names = [];
  const src = pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)'));
  routes.push({ method, re: new RegExp(`^${src}/?$`), names, handler, isPublic });
}
const pub = { isPublic: true };
route('POST', '/api/v1/auth/login', login, pub);
route('GET', '/api/v1/events', listEvents, pub);
route('GET', '/api/v1/events/:id', getEvent, pub);
route('GET', '/api/v1/events/:id/availability', getAvailability, pub);
route('POST', '/api/v1/queue/:id/join', joinQueue);
route('GET', '/api/v1/queue/:id/status', getQueueStatus);
route('GET', '/api/v1/queue/:id/stream', streamQueue);
route('POST', '/api/v1/orders', createOrder);
route('GET', '/api/v1/orders', listOrders);
route('GET', '/api/v1/orders/:id', getOrder);
route('POST', '/api/v1/orders/:id/payment-intents', createPaymentIntent);
route('GET', '/mock-gateway/checkout/:id', checkoutPage, pub);
route('POST', '/mock-gateway/checkout/:id/complete', checkoutCompletePost, pub);
route('GET', '/mock-gateway/checkout/:id/complete', checkoutCompleteGet, pub);
const ok = (ctx) => send(ctx, 200, { status: 'ok' });
route('GET', '/health/live', ok, pub);
route('GET', '/health/ready', ok, pub);
route('POST', '/__mock/reset', mockReset, pub);
route('POST', '/__mock/fault', mockFault, pub);
route('GET', '/__mock/state', mockState, pub);

function applyCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, X-Queue-Pass, Idempotency-Key, X-Correlation-Id, Content-Type',
    );
    res.setHeader('Access-Control-Expose-Headers', 'Idempotent-Replayed, X-Correlation-Id');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const incoming = req.headers['x-correlation-id'];
  const cid =
    typeof incoming === 'string' && incoming.length <= 128 ? incoming : crypto.randomUUID();
  const url = new URL(req.url, 'http://mock.local');
  const ctx = { req, res, cid, url, query: Object.fromEntries(url.searchParams), user: null };
  res.setHeader('X-Correlation-Id', cid);
  applyCors(req, res);
  res.on('close', () => {
    console.log(
      JSON.stringify({
        severity: res.statusCode >= 500 ? 'ERROR' : 'INFO',
        correlationId: cid,
        userId: ctx.user?.id ?? null,
        route: `${req.method} ${url.pathname}`,
        status: res.statusCode,
        latencyMs: Date.now() - started,
        ...(ctx.queuePass ? { queuePass: ctx.queuePass } : {}),
      }),
    );
  });
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    expireDue();
    let params = {};
    const hit = routes.find((r) => {
      if (r.method !== req.method) return false;
      const m = r.re.exec(url.pathname);
      if (m) params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      return Boolean(m);
    });
    if (!hit) throw notFound(`Route ${req.method} ${url.pathname}`);
    ctx.params = params;
    if (!hit.isPublic) ctx.user = authenticate(req);
    ctx.raw = req.method === 'GET' ? '' : await readBody(req);
    await hit.handler(ctx);
  } catch (err) {
    const apiErr =
      err instanceof ApiError ? err : new ApiError(500, 'INTERNAL', 'Unexpected mock failure');
    if (!(err instanceof ApiError)) console.error(err);
    if (res.headersSent) return res.end();
    send(ctx, apiErr.status, apiErr.body(cid));
  }
});

setInterval(() => expireDue(), 1000).unref();

server.listen(PORT, () => {
  const line = '='.repeat(72);
  console.log(`${line}
Aforo DEV mock backend (in-memory, not for deployment)
Listening on http://localhost:${PORT}   public origin ${PUBLIC_ORIGIN}
Frontend origin (CORS): ${FRONTEND_ORIGIN} (+ http://127.0.0.1:4000)

Seed events:
${events.map((e) => `  ${e.id}  ${e.name} [${saleState(e)}]`).join('\n')}

Env knobs (current value):
  PORT=${PORT} PUBLIC_ORIGIN FRONTEND_ORIGIN
  MOCK_RESERVATION_SECONDS=${RESERVATION_SECONDS} MOCK_SCHEDULED_MINUTES=${SCHEDULED_MINUTES}
  MOCK_QUEUE_START=${QUEUE_START} MOCK_QUEUE_STEP_SECONDS=${QUEUE_STEP_SECONDS}
  MOCK_PASS_SECONDS=${PASS_SECONDS} MOCK_NO_SSE=${NO_SSE ? 1 : 0} MOCK_FAULT=${faultMode}

Dev controls: POST /__mock/reset | POST /__mock/fault?mode=none|error|timeout | GET /__mock/state
${line}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
  });
}

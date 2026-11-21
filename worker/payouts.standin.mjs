// A stand-in for everything the Worker talks to, for payouts.worker.test.mjs: the
// database, the payment processor and the mail service. Nothing here touches
// a real service, and every key and id is a made-up placeholder.
//
// It plays the processor as well as the database, so that a test can change
// what the processor "knows" (a refund, a dispute, a payment the app never
// heard about) and then ask the Worker what figure it would show.
//
// The processor here keeps its own ledger of what has reached each club's
// account, worked out separately from the objects it serves to the Worker.
// The tests compare the Worker's figure with that ledger.
import { createHmac } from "node:crypto";

export const ENV = {
  SUPABASE_URL: "https://database.invalid",
  SUPABASE_SERVICE_KEY: "placeholder-not-a-key",
  SUPABASE_ANON_KEY: "placeholder-not-a-key",
  STRIPE_SECRET_KEY: "placeholder-not-a-key",
  STRIPE_WEBHOOK_SECRET: "placeholder-webhook-secret",
  RESEND_API_KEY: "placeholder-not-a-key",
  PAY_IN_FULL_PMC_ID: "pmc_placeholder",
  // A placeholder, set low so that it never decides anything in these tests.
  MIN_FEE_BPS: "100",
  APP_URL: "https://app.invalid/app/"
};

// The columns `payments` has today, and the ones the migration adds.
const PAYMENT_COLUMNS_BEFORE = [
  "id", "created_at", "athlete_id", "stripe_payment_intent", "stripe_event_id", "amount_cents",
  "currency", "status", "payment_method", "installment_number", "notes"
];
const PAYMENT_COLUMNS_ADDED = [
  "stripe_charge_id", "stripe_transfer_id", "stripe_application_fee_id", "stripe_destination_account",
  "charge_cents", "application_fee_cents", "club_net_cents", "processor_recorded_at"
];

const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export function createWorld({ migrated = true } = {}) {
  const world = {
    // false plays a database the migration has not been applied to: `payments`
    // has only its old columns, and `payout_checks` and `save_payout_check`
    // do not exist.
    migrated,
    db: { clubs: [], teams: [], athletes: [], payments: [], payout_checks: [], events: [], user_profiles: [], suppressed_emails: [] },
    tokens: {},
    mail: [],
    // Every outgoing request the Worker made: "METHOD url".
    requests: [],
    seq: 0,
    // Set by a test to break things. Each is a function returning a Response
    // (or, for the processor, the string "timeout") to use instead of the
    // normal answer, or nothing to carry on as normal.
    faults: { db: null, processor: null },
    // Set by a test to make something happen in the middle of a check: an
    // async function called once, after the processor has put together its
    // list of transfers and before the Worker receives it. Whatever it does
    // (a refund, a second check) the Worker is still holding the older list.
    whileListing: null,
    processor: createProcessor()
  };

  const nextId = (prefix) => `${prefix}_${String(++world.seq).padStart(4, "0")}`;
  world.nextId = nextId;

  function paymentColumns() {
    return world.migrated ? [...PAYMENT_COLUMNS_BEFORE, ...PAYMENT_COLUMNS_ADDED] : PAYMENT_COLUMNS_BEFORE;
  }

  function matches(row, col, expr) {
    if (expr.startsWith("eq.")) return String(row[col]) === expr.slice(3);
    if (expr.startsWith("in.(") && expr.endsWith(")")) return expr.slice(4, -1).split(",").includes(String(row[col]));
    if (expr === "is.null") return row[col] == null;
    if (expr === "not.is.null") return row[col] != null;
    throw new Error(`stand-in database: the filter ${col}=${expr} is not supported`);
  }

  // migrations/2026-11-21-payout-tie-out.sql, save_payout_check: insert the
  // row, or replace the existing one unless that one is newer.
  function savePayoutCheck({ p, p_force }) {
    if (!world.migrated) {
      return reply(404, { code: "PGRST202", message: "Could not find the function public.save_payout_check(p, p_force) in the schema cache" });
    }
    const rows = world.db.payout_checks;
    const existing = rows.find((r) => r.club_id === p.club_id);
    if (!existing) {
      rows.push({ ...p });
      return reply(200, true);
    }
    if (!(p_force || Date.parse(existing.not_before) <= Date.parse(p.not_before))) return reply(200, false);
    Object.assign(existing, p);
    return reply(200, true);
  }

  function database(method, url, init) {
    const table = url.pathname.replace("/rest/v1/", "");
    const fault = world.faults.db && world.faults.db({ method, table, url, body: init.body });
    if (fault) return fault;
    if (table === "rpc/save_payout_check" && method === "POST") return savePayoutCheck(JSON.parse(init.body));
    if (!(table in world.db)) throw new Error(`stand-in database: no table ${table}`);
    if (table === "payout_checks" && !world.migrated) {
      return reply(404, { code: "PGRST205", message: "Could not find the table 'public.payout_checks' in the schema cache" });
    }
    const rows = world.db[table];
    const filters = [];
    let select = null, order = null, limit = null;
    for (const [key, value] of url.searchParams) {
      if (key === "select") select = value;
      else if (key === "order") order = value;
      else if (key === "limit") limit = Number(value);
      else if (key === "on_conflict") continue;
      else filters.push([key, value]);
    }
    const unknownColumn = (cols) => table === "payments" ? cols.find((c) => !paymentColumns().includes(c)) : null;
    const hit = (row) => filters.every(([col, expr]) => matches(row, col, expr));

    if (method === "GET") {
      const cols = select && select !== "*" ? select.split(",") : null;
      const missing = cols && unknownColumn(cols);
      if (missing) return reply(400, { code: "42703", message: `column payments.${missing} does not exist` });
      let out = rows.filter(hit);
      if (order) {
        const [col, dir] = order.split(".");
        out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === "desc" ? -1 : 1));
      }
      if (limit != null) out = out.slice(0, limit);
      return reply(200, out.map((row) => cols ? Object.fromEntries(cols.map((c) => [c, row[c] === undefined ? null : row[c]])) : { ...row }));
    }

    const body = init.body ? JSON.parse(init.body) : {};
    const prefer = (init.headers && init.headers.Prefer) || "";
    if (method === "POST") {
      const incoming = Array.isArray(body) ? body : [body];
      const missing = unknownColumn(incoming.flatMap((r) => Object.keys(r)));
      if (missing) return reply(400, { code: "PGRST204", message: `Could not find the '${missing}' column of 'payments' in the schema cache` });
      // The migration's rule: one payment, one "succeeded" row.
      if (table === "payments" && world.migrated && incoming.some((f) => f.status === "succeeded" && rows.some((r) => r.status === "succeeded" && r.stripe_payment_intent === f.stripe_payment_intent))) {
        return reply(409, { code: "23505", message: 'duplicate key value violates unique constraint "payments_one_succeeded_row_per_intent"' });
      }
      const written = [];
      for (const fields of incoming) {
        if (prefer.includes("resolution=merge-duplicates")) {
          const key = url.searchParams.get("on_conflict");
          const existing = rows.find((r) => String(r[key]) === String(fields[key]));
          if (existing) {
            Object.assign(existing, fields);
            written.push(existing);
            continue;
          }
        }
        const row = { id: nextId(table), created_at: new Date().toISOString(), ...fields };
        rows.push(row);
        written.push(row);
      }
      return prefer.includes("return=minimal") ? new Response(null, { status: 201 }) : reply(201, written.map((r) => ({ ...r })));
    }
    if (method === "PATCH") {
      const missing = unknownColumn(Object.keys(body));
      if (missing) return reply(400, { code: "PGRST204", message: `Could not find the '${missing}' column of 'payments' in the schema cache` });
      rows.filter(hit).forEach((row) => Object.assign(row, body));
      return new Response(null, { status: 204 });
    }
    throw new Error(`stand-in database: ${method} is not supported`);
  }

  function processorApi(method, url) {
    const fault = world.faults.processor && world.faults.processor({ method, url });
    if (fault === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
    if (fault) return fault;
    const path = url.pathname.replace("/v1", "");
    const expand = url.searchParams.getAll("expand[]");
    const p = world.processor;
    if (method === "GET" && path === "/transfers") {
      const destination = url.searchParams.get("destination");
      if (!destination) throw new Error("stand-in processor: transfers were listed without a destination");
      const limit = Math.min(100, Number(url.searchParams.get("limit") || 10));
      // Most recent first, as the processor documents.
      let list = p.payments.filter((pay) => pay.account === destination).sort((a, b) => b.n - a.n);
      const after = url.searchParams.get("starting_after");
      if (after) {
        const at = list.findIndex((pay) => pay.transferId === after);
        if (at === -1) return reply(400, { error: { type: "invalid_request_error", message: `No such transfer: ${after}` } });
        list = list.slice(at + 1);
      }
      const page = list.slice(0, limit);
      // The charge and its fee are only nested when the caller asks for them.
      const nest = expand.includes("data.source_transaction.application_fee");
      const charge = nest || expand.includes("data.source_transaction");
      // Built now: what the processor knew at this instant.
      const answer = {
        object: "list",
        url: "/v1/transfers",
        has_more: list.length > page.length,
        data: page.map((pay) => p.transferObject(pay, { charge, fee: nest }))
      };
      const meanwhile = world.whileListing;
      world.whileListing = null;
      return meanwhile ? Promise.resolve(meanwhile()).then(() => reply(200, answer)) : reply(200, answer);
    }
    const intent = path.match(/^\/payment_intents\/([^/]+)$/);
    if (method === "GET" && intent) {
      const pay = p.payments.find((x) => x.intentId === decodeURIComponent(intent[1]));
      if (!pay) return reply(404, { error: { type: "invalid_request_error", message: "No such payment_intent" } });
      const charge = expand.some((e) => e.startsWith("latest_charge"));
      return reply(200, {
        ...p.intentObject(pay),
        latest_charge: charge
          ? p.chargeObject(pay, { transfer: expand.includes("latest_charge.transfer"), fee: expand.includes("latest_charge.application_fee") })
          : pay.chargeId
      });
    }
    const account = path.match(/^\/accounts\/([^/]+)$/);
    if (method === "GET" && account) return reply(200, { id: account[1], charges_enabled: true, details_submitted: true });
    throw new Error(`stand-in processor: ${method} ${url.pathname} is not expected`);
  }

  world.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method || "GET").toUpperCase();
    world.requests.push(`${method} ${url.href}`);
    if (url.origin === ENV.SUPABASE_URL && url.pathname === "/auth/v1/user") {
      const token = String((init.headers && init.headers.Authorization) || "").replace("Bearer ", "");
      const userId = world.tokens[token];
      return userId ? reply(200, { id: userId }) : reply(401, { message: "invalid token" });
    }
    if (url.origin === ENV.SUPABASE_URL && url.pathname.startsWith("/rest/v1/")) return database(method, url, init);
    if (url.origin === "https://api.stripe.com" && url.pathname === "/v1/checkout/sessions" && method === "POST") {
      const form = new URLSearchParams(init.body);
      world.processor.openSession = {
        amountCents: Number(form.get("line_items[0][price_data][unit_amount]")),
        feeCents: Number(form.get("payment_intent_data[application_fee_amount]")),
        account: form.get("payment_intent_data[transfer_data][destination]"),
        athleteId: form.get("payment_intent_data[metadata][athlete_id]"),
        method: form.get("payment_method_types[0]") === "klarna" ? "klarna" : "card"
      };
      return reply(200, { client_secret: "placeholder_client_secret" });
    }
    if (url.origin === "https://api.stripe.com") return processorApi(method, url);
    if (url.href === "https://api.resend.com/emails" && method === "POST") {
      const mail = JSON.parse(init.body);
      world.mail.push(mail);
      return reply(200, { id: nextId("mail") });
    }
    throw new Error(`The Worker tried to reach ${url.href}, which this test does not expect`);
  };

  // ---- building a club ----------------------------------------------------

  world.addStaff = () => {
    world.tokens["token-staff"] = "user_staff";
    world.db.user_profiles.push({ id: "user_staff", role: "playfund_admin", club_id: null, team_id: null });
    return "token-staff";
  };

  // One club with a processor account (unless account: null), teams and
  // athletes. `teams` is a list of { dues_cents, athletes: number }.
  world.addClub = ({ code, fee_bps = 800, account, teams = [{ dues_cents: 100000, athletes: 2 }] } = {}) => {
    const n = world.db.clubs.length + 1;
    const club = {
      id: `club_${n}`,
      name: `Test Club ${n}`,
      code: code || `TESTCL${n}`,
      sport: "Soccer", city: "Testville", state: "NC", active: true, fees_per_athlete: null,
      fee_bps, fee_agreed_at: "2026-11-01T00:00:00Z",
      stripe_account_id: account === undefined ? `acct_placeholder${n}` : account
    };
    world.db.clubs.push(club);
    club.teams = teams.map((spec) => world.addTeam(club, spec));
    world.tokens[`token-${club.id}`] = `user_${club.id}`;
    world.db.user_profiles.push({ id: `user_${club.id}`, role: "club_admin", club_id: club.id, team_id: null });
    club.token = `token-${club.id}`;
    return club;
  };
  world.addTeam = (club, { dues_cents = 100000, athletes = 2 } = {}) => {
    const team = {
      id: `team_${world.db.teams.length + 1}`, club_id: club.id, name: `Team ${world.db.teams.length + 1}`,
      age_group: "12U", dues_cents, active: true, season_start: null, season_end: null, dues_due_date: "2027-01-15", fees: null
    };
    world.db.teams.push(team);
    team.athletes = [];
    for (let i = 0; i < athletes; i++) team.athletes.push(world.addAthlete(club, team));
    return team;
  };
  world.addAthlete = (club, team) => {
    const athlete = {
      id: `ath_${world.db.athletes.length + 1}`, name: `Test Athlete ${world.db.athletes.length + 1}`,
      club_id: club.id, team_id: team.id, payment_status: "unpaid", payment_method: null,
      approval_status: "approved", parent_email: "parent@example.invalid", enrolled_at: null
    };
    world.db.athletes.push(athlete);
    return athlete;
  };

  return world;
}

// The processor's side. `payments` is its own record of each payment; the
// objects served to the Worker are built from it on request.
function createProcessor() {
  const p = { payments: [], openSession: null, n: 0 };

  p.createPayment = ({ account, amountCents, feeCents, athleteId, method = "card", createdMs = Date.now() }) => {
    const n = ++p.n;
    const tag = String(n).padStart(4, "0");
    const pay = {
      n, account, amountCents, feeCents, athleteId, method,
      created: Math.floor(createdMs / 1000),
      intentId: `pi_test${tag}`, chargeId: `ch_test${tag}`, transferId: `tr_test${tag}`,
      feeId: feeCents > 0 ? `fee_test${tag}` : null, destinationPaymentId: `py_test${tag}`,
      refundedCents: 0, disputed: false, reversedCents: 0, feeRefundedCents: 0
    };
    p.payments.push(pay);
    return pay;
  };

  // What has reached a club's account, by the processor's own arithmetic:
  // everything transferred in, less anything taken back, less the fee kept.
  p.net = (pay) => pay.amountCents - pay.reversedCents - (pay.feeCents - pay.feeRefundedCents);
  p.ledger = (account) => p.payments.filter((pay) => pay.account === account).reduce((sum, pay) => sum + p.net(pay), 0);
  p.charged = (account) => p.payments.filter((pay) => pay.account === account).reduce((sum, pay) => sum + pay.amountCents, 0);
  // True while nothing has been refunded, disputed or reversed.
  p.clean = (pay) => pay.refundedCents === 0 && !pay.disputed && pay.reversedCents === 0 && pay.feeRefundedCents === 0;

  p.refund = (pay, cents, { reverseTransfer = false, refundFee = false } = {}) => {
    pay.refundedCents += cents;
    if (reverseTransfer) pay.reversedCents += cents;
    if (refundFee) pay.feeRefundedCents += Math.round(pay.feeCents * cents / pay.amountCents);
  };

  p.feeObject = (pay) => ({
    id: pay.feeId, object: "application_fee", account: pay.account, amount: pay.feeCents,
    amount_refunded: pay.feeRefundedCents, refunded: pay.feeCents > 0 && pay.feeRefundedCents === pay.feeCents,
    charge: pay.destinationPaymentId, originating_transaction: pay.chargeId, currency: "usd"
  });
  p.chargeObject = (pay, { transfer = false, fee = false } = {}) => ({
    id: pay.chargeId, object: "charge", amount: pay.amountCents, amount_captured: pay.amountCents,
    amount_refunded: pay.refundedCents, refunded: pay.refundedCents === pay.amountCents,
    disputed: pay.disputed, paid: true, captured: true, status: "succeeded", currency: "usd",
    payment_intent: pay.intentId,
    application_fee: pay.feeId ? (fee ? p.feeObject(pay) : pay.feeId) : null,
    application_fee_amount: pay.feeCents,
    transfer: transfer ? p.transferObject(pay) : pay.transferId,
    transfer_data: { amount: null, destination: pay.account },
    metadata: { athlete_id: pay.athleteId }
  });
  p.transferObject = (pay, { charge = false, fee = false } = {}) => ({
    id: pay.transferId, object: "transfer", amount: pay.amountCents, amount_reversed: pay.reversedCents,
    reversed: pay.reversedCents === pay.amountCents, currency: "usd", created: pay.created,
    destination: pay.account, destination_payment: pay.destinationPaymentId,
    source_transaction: charge ? p.chargeObject(pay, { fee }) : pay.chargeId
  });
  p.intentObject = (pay) => ({
    id: pay.intentId, object: "payment_intent", amount: pay.amountCents, amount_received: pay.amountCents,
    application_fee_amount: pay.feeCents, currency: "usd", status: "succeeded", created: pay.created,
    payment_method_types: [pay.method], metadata: { athlete_id: pay.athleteId },
    transfer_data: { destination: pay.account }, latest_charge: pay.chargeId, receipt_email: null
  });
  return p;
}

// ---- driving the Worker ---------------------------------------------------

// A webhook the way the processor sends one: the body signed with the
// endpoint's secret (see verifyStripeSignature in index.js). The secret is a
// placeholder. With no `ctx`, the Worker runs the payout check before it
// answers, so the test sees the finished state.
export async function sendWebhook(worker, world, type, object, { secret = ENV.STRIPE_WEBHOOK_SECRET, eventId, env = ENV } = {}) {
  const body = JSON.stringify({ id: eventId || world.nextId("evt"), object: "event", type, data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return worker.fetch(
    new Request("https://worker.invalid/webhook/stripe", {
      method: "POST",
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      body
    }),
    env
  );
}

export async function call(worker, method, path, { token, body, env = ENV, origin } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  if (origin) headers.Origin = origin;
  const res = await worker.fetch(
    new Request(`https://worker.invalid${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }),
    env
  );
  return { status: res.status, body: await res.json() };
}

// One family paying for one athlete, end to end through the Worker: the
// Worker's own checkout handler decides the amount and the fee, the stand-in
// processor takes the payment on those terms, and the Worker is told with a
// signed webhook. Returns the processor's record of the payment.
export async function payFor(worker, world, athlete, paymentType = "full", { deliver = true } = {}) {
  const started = await call(worker, "POST", `/athlete/${athlete.id}/checkout`, { body: { payment_type: paymentType } });
  if (started.status !== 200) throw new Error(`checkout did not start: ${started.status} ${JSON.stringify(started.body)}`);
  const session = world.processor.openSession;
  world.processor.openSession = null;
  const pay = world.processor.createPayment(session);
  if (deliver) {
    const res = await sendWebhook(worker, world, "payment_intent.succeeded", world.processor.intentObject(pay));
    pay.webhookStatus = res.status;
  }
  return pay;
}

// The timed run, the way the runtime starts it.
export async function runTimer(worker, cron, env = ENV) {
  const waiting = [];
  await worker.scheduled({ cron }, env, { waitUntil: (promise) => waiting.push(promise) });
  return Promise.all(waiting);
}

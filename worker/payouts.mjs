// When a payout figure may be shown, and how it is checked.
//
// The rule this file exists to enforce:
//
//   A figure about money a club has received is shown only when (a) every
//   payment behind it has its amount and fee recorded from the payment
//   processor's own data for that payment, and (b) those records have been
//   compared with the processor's records for the club's account and found
//   equal, with nothing refunded, disputed or reversed, and no payment on the
//   processor's side that the app does not have. In every other case there is
//   no figure. "No figure" is the default, and a figure has to earn its place.
//
// Nothing here works a fee out. fees.mjs decides what to ask the processor to
// take when a checkout is created. This file only ever reads back what the
// processor says it took and moved, and adds those numbers up.
//
// Everything in this file is a function of its arguments: no network and no
// environment, so payouts.test.mjs can try every way of producing a wrong
// number. The reading and writing lives in index.js, and
// payouts.worker.test.mjs runs that against a stand-in processor.
//
// How the processor describes one payment (a "destination charge"), from its
// documentation, read 2026-11-21:
//
//   Charge           on PlayFund's account. `amount`, `amount_captured`,
//                    `amount_refunded`, `refunded` (true only for a full
//                    refund), `disputed`, `status`, `payment_intent`,
//                    `transfer`, `application_fee`.
//   Transfer         the whole charge amount moved to the club's account.
//                    `amount`, `amount_reversed`, `reversed` (true only for a
//                    full reversal), `destination`, `source_transaction`.
//   Application fee  the part moved back to PlayFund. `amount`,
//                    `amount_refunded`, `refunded`.
//
//   What the club's account keeps is Transfer.amount less ApplicationFee.amount.
//
//   https://docs.stripe.com/connect/destination-charges
//   https://docs.stripe.com/api/charges/object
//   https://docs.stripe.com/api/transfers/object
//   https://docs.stripe.com/api/application_fees/object

// How long a passed check is trusted. The check runs after every payment and
// on a timer, every ten minutes (PAYOUT_CHECK_CRON in index.js). If the timer
// stops, figures disappear after this long instead of going quietly out of
// date. It is longer than the timer's interval on purpose: one run gets round
// only so many clubs, and a figure should not vanish because a run was missed.
export const PAYOUT_CHECK_MAX_AGE_MS = 2 * 60 * 60 * 1000;

// A payment that only one side has is given this long to appear on the other
// before staff are told. The figure is hidden for the whole of that time.
export const SETTLING_GRACE_MS = 15 * 60 * 1000;

// When the processor reports a refund, dispute or reversal, the club's figure
// is hidden and no check that started within this long afterwards may bring
// it back. A check that was already running read the processor before the
// event, and one that starts a moment later might be answered before the
// processor's own records have caught up.
export const ADVERSE_EVENT_HOLD_MS = 2 * 60 * 1000;

// How far apart the Worker's clock and the database's clock may be.
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export const FUNDED_STATUSES = ["paid_full", "bnpl_active", "bnpl_complete"];

// The columns added to `payments` by migrations/2026-11-21-payout-tie-out.sql.
// They are always read in a query of their own, so that a database without
// them fails that one query and nothing else.
export const PAYMENT_RECORD_COLUMNS = [
  "stripe_charge_id",
  "stripe_transfer_id",
  "stripe_application_fee_id",
  "stripe_destination_account",
  "charge_cents",
  "application_fee_cents",
  "club_net_cents",
  "processor_recorded_at"
];
export const PAYMENT_SELECT =
  "id,athlete_id,created_at,amount_cents,stripe_payment_intent," + PAYMENT_RECORD_COLUMNS.join(",");

// Why a check failed. Every one of these hides the figure. The ones in
// QUIET_REASONS are expected to clear by themselves, so staff are not emailed.
export const REASONS = {
  refund: "The payment processor shows a refund on a payment to this club.",
  dispute: "The payment processor shows a dispute on a payment to this club.",
  transfer_reversed: "The payment processor shows money taken back out of this club's account (a transfer reversal).",
  fee_refunded: "The payment processor shows that PlayFund's fee on a payment to this club was refunded.",
  unrecorded_processor_payment: "The payment processor shows money moved to this club's account that PlayFund has no payment record for.",
  payment_not_at_processor: "PlayFund has a payment recorded for this club that the payment processor does not show.",
  record_mismatch: "A payment's recorded amounts do not match the payment processor's.",
  duplicate_payment_rows: "The same payment is recorded more than once for this club.",
  paid_without_payment: "An athlete is marked as paid but has no payment recorded.",
  payment_without_paid_status: "A payment is recorded for an athlete who is not marked as paid.",
  processor_unexpected: "The payment processor returned a payment in a shape PlayFund does not recognise.",
  processor_unreadable: "The payment processor could not be read for this club's account.",
  processor_down: "The payment processor could not be reached.",
  too_many_payments: "This club has more payments than one check can read.",
  db_unreadable: "PlayFund's own payment records could not be read.",
  store_unavailable: "Payout checks cannot be saved or read. The database migration for payout checks may not have been applied.",
  settling: "A payment has not appeared on both sides yet.",
  backfill_pending: "Older payments are still being filled in from the payment processor's records."
};
export const QUIET_REASONS = ["settling", "backfill_pending"];
// Problems that are not about one club. Staff get one email for all clubs.
export const GLOBAL_REASONS = ["store_unavailable", "db_unreadable", "processor_down"];

// When several things are wrong at once, the one reported. Kept in a fixed
// order so that the reason does not flip between checks and re-send the alert.
const REASON_ORDER = [
  "refund",
  "dispute",
  "transfer_reversed",
  "fee_refunded",
  "unrecorded_processor_payment",
  "payment_not_at_processor",
  "record_mismatch",
  "duplicate_payment_rows",
  "paid_without_payment",
  "payment_without_paid_status",
  "processor_unexpected",
  "settling"
];

const isCents = (n) => Number.isSafeInteger(n) && n >= 0;
const isId = (s) => typeof s === "string" && s.length > 0;
// The processor sends a linked object either as its id or, when asked to
// expand it, as the object itself.
export const idOf = (v) => (typeof v === "string" ? v : v && typeof v === "object" && typeof v.id === "string" ? v.id : null);

// Reads one payment out of the processor's own objects: a Charge, the Transfer
// that moved it to the club's account, and the Application fee taken back.
// `fee` is null only for a payment with no fee at all.
//
// Returns { ok: true, record } when the payment is whole: succeeded, in US
// dollars, moved in full to `accountId`, with nothing refunded, disputed or
// reversed. Anything else returns { ok: false, reason, detail }, and a payment
// like that never contributes to a figure.
export function readProcessorPayment({ charge, transfer, fee }, accountId) {
  const pi = charge && typeof charge === "object" ? idOf(charge.payment_intent) : null;
  const bad = (reason, detail) => ({ ok: false, reason, detail, payment_intent: pi });
  const odd = (detail) => bad("processor_unexpected", detail);

  if (!charge || typeof charge !== "object" || charge.object !== "charge" || !isId(charge.id)) {
    return odd(`transfer ${idOf(transfer) || "?"} has no charge behind it`);
  }
  if (!isId(pi)) return odd(`charge ${charge.id} has no payment intent`);
  if (!transfer || typeof transfer !== "object" || !isId(transfer.id)) return odd(`charge ${charge.id} has no transfer`);

  if (typeof charge.refunded !== "boolean" || !isCents(charge.amount_refunded) || typeof charge.disputed !== "boolean") {
    return odd(`charge ${charge.id} is missing its refund or dispute fields`);
  }
  if (typeof transfer.reversed !== "boolean" || !isCents(transfer.amount_reversed)) {
    return odd(`transfer ${transfer.id} is missing its reversal fields`);
  }
  if (fee == null) {
    // No fee object is only believable when no fee was asked for.
    if (charge.application_fee != null || (charge.application_fee_amount != null && charge.application_fee_amount !== 0)) {
      return odd(`charge ${charge.id} has a fee that was not returned`);
    }
  } else if (
    typeof fee !== "object" || !isId(fee.id) || !isCents(fee.amount) || typeof fee.refunded !== "boolean" ||
    !(fee.amount_refunded == null || isCents(fee.amount_refunded))
  ) {
    return odd(`charge ${charge.id} has a fee in an unknown shape`);
  }

  if (charge.refunded || charge.amount_refunded > 0) return bad("refund", `${pi}: ${charge.amount_refunded} cents refunded`);
  if (charge.disputed) return bad("dispute", `${pi} is disputed`);
  if (transfer.reversed || transfer.amount_reversed > 0) {
    return bad("transfer_reversed", `${pi}: ${transfer.amount_reversed} cents reversed on ${transfer.id}`);
  }
  if (fee && (fee.refunded || (fee.amount_refunded || 0) > 0)) {
    return bad("fee_refunded", `${pi}: ${fee.amount_refunded} cents of the fee refunded`);
  }

  if (charge.status !== "succeeded" || charge.paid !== true || charge.captured !== true) {
    return odd(`charge ${charge.id} is not a captured, succeeded charge`);
  }
  if (!isCents(charge.amount) || charge.amount === 0 || charge.amount_captured !== charge.amount) {
    return odd(`charge ${charge.id} was not captured in full`);
  }
  if (charge.currency !== "usd" || transfer.currency !== "usd" || (fee && fee.currency !== "usd")) {
    return odd(`${pi} is not in US dollars`);
  }
  if (transfer.amount !== charge.amount) return odd(`${pi}: transfer ${transfer.id} is not the whole charge`);
  if (!isId(accountId) || idOf(transfer.destination) !== accountId) {
    return odd(`${pi}: transfer ${transfer.id} did not go to this club's account`);
  }
  if (idOf(transfer.source_transaction) !== charge.id) return odd(`${pi}: transfer ${transfer.id} is not from charge ${charge.id}`);
  const feeCents = fee ? fee.amount : 0;
  if (feeCents > charge.amount) return odd(`${pi}: the fee is more than the payment`);

  return {
    ok: true,
    payment_intent: pi,
    record: {
      stripe_payment_intent: pi,
      stripe_charge_id: charge.id,
      stripe_transfer_id: transfer.id,
      stripe_application_fee_id: fee ? fee.id : null,
      stripe_destination_account: accountId,
      charge_cents: charge.amount,
      application_fee_cents: feeCents,
      club_net_cents: transfer.amount - feeCents
    }
  };
}

// Whether a row of `payments` carries a complete processor record for a
// payment to `accountId`, with numbers that agree with each other. Checked
// every time a figure is about to be shown, as well as when it is verified.
export function isCompletePaymentRow(row, accountId) {
  if (!row || typeof row !== "object") return false;
  if (!isId(row.stripe_payment_intent) || !isId(row.stripe_charge_id) || !isId(row.stripe_transfer_id)) return false;
  if (!isId(accountId) || row.stripe_destination_account !== accountId) return false;
  if (!isCents(row.charge_cents) || !isCents(row.application_fee_cents) || !isCents(row.club_net_cents)) return false;
  if (row.club_net_cents !== row.charge_cents - row.application_fee_cents) return false;
  if (row.amount_cents !== row.charge_cents) return false;
  if (row.stripe_application_fee_id == null ? row.application_fee_cents !== 0 : !isId(row.stripe_application_fee_id)) return false;
  if (row.processor_recorded_at == null) return false;
  return true;
}

// Problems that can be seen in the app's own records without asking the
// processor. Shared by the check and by the decision to show a figure.
//
// `nowMs` is given by the check only. With it, a payment that is minutes old
// and whose athlete is not yet marked paid is "settling", not a problem to
// report: the webhook that recorded it may still be finishing or retrying.
function ownRecordProblems(athletes, payments, nowMs) {
  const problems = [];
  const byIntent = new Map();
  const paidAthletes = new Map();
  for (const p of payments) {
    const created = Date.parse(p.created_at);
    const id = String(p.athlete_id);
    paidAthletes.set(id, Math.max(paidAthletes.get(id) || 0, Number.isFinite(created) ? created : 0));
    if (!isId(p.stripe_payment_intent)) {
      problems.push({ reason: "record_mismatch", detail: `payment row ${p.id} has no payment intent` });
      continue;
    }
    if (byIntent.has(p.stripe_payment_intent)) {
      problems.push({ reason: "duplicate_payment_rows", detail: `${p.stripe_payment_intent} is recorded more than once` });
    }
    byIntent.set(p.stripe_payment_intent, p);
  }
  const athleteById = new Map(athletes.map((a) => [String(a.id), a]));
  for (const a of athletes) {
    if (FUNDED_STATUSES.includes(a.payment_status) && !paidAthletes.has(String(a.id))) {
      problems.push({ reason: "paid_without_payment", detail: `athlete ${a.id} is ${a.payment_status} with no payment row` });
    }
  }
  for (const [id, newest] of paidAthletes) {
    const a = athleteById.get(id);
    if (!a || !FUNDED_STATUSES.includes(a.payment_status)) {
      const young = a && nowMs !== undefined && nowMs - newest < SETTLING_GRACE_MS;
      problems.push(young
        ? { reason: "settling", detail: `athlete ${id} has a new payment and is not marked paid yet` }
        : { reason: "payment_without_paid_status", detail: `athlete ${id} has a payment but is not marked paid` });
    }
  }
  return { problems, byIntent };
}

function worst(problems) {
  let best = null;
  for (const p of problems) {
    const rank = REASON_ORDER.indexOf(p.reason);
    const r = rank === -1 ? REASON_ORDER.length : rank;
    if (!best || r < best.rank) best = { rank: r, problem: p };
  }
  const same = problems.filter((p) => p.reason === best.problem.reason);
  const detail = same.slice(0, 5).map((p) => p.detail).join("; ") + (same.length > 5 ? `; and ${same.length - 5} more` : "");
  return { reason: best.problem.reason, detail };
}

// The tie-out for one club: the app's succeeded payment rows against every
// transfer the processor lists for the club's account, in both directions.
//
//   accountId   the club's account at the processor
//   athletes    every athlete of the club: { id, payment_status }
//   payments    every succeeded payment row for those athletes (PAYMENT_SELECT)
//   transfers   every Transfer the processor lists for accountId, each with
//               `source_transaction` expanded to its Charge and that charge's
//               `application_fee` expanded
//   now         a Date
//
// Returns { status: "verified", rows, backfill, summary } or
// { status: "failed", reason, detail, backfill }.
//
// `backfill` lists payment rows that have no processor record yet (payments
// made before the columns existed, or whose record could not be written when
// they were made) with the fields to fill in from the processor's objects. A
// recorded value is never overwritten: a stored value that differs from the
// processor's is a failure, not something to correct. A "verified" result
// only stands once every backfill has been written.
export function tieOut({ accountId, athletes, payments, transfers, now }) {
  const nowMs = now.getTime();
  const { problems, byIntent } = ownRecordProblems(athletes, payments, nowMs);

  const atProcessor = new Map();
  for (const transfer of transfers) {
    const charge = transfer && typeof transfer === "object" ? transfer.source_transaction : null;
    const read = readProcessorPayment(
      { charge, transfer, fee: charge && typeof charge === "object" ? charge.application_fee : null },
      accountId
    );
    if (read.payment_intent && atProcessor.has(read.payment_intent)) {
      problems.push({ reason: "processor_unexpected", detail: `${read.payment_intent} has more than one transfer` });
      continue;
    }
    if (read.payment_intent) atProcessor.set(read.payment_intent, { read, transfer });
    if (!read.ok) problems.push({ reason: read.reason, detail: read.detail });
  }

  const young = (ms) => Number.isFinite(ms) && nowMs - ms < SETTLING_GRACE_MS;
  for (const [pi, { transfer }] of atProcessor) {
    if (byIntent.has(pi)) continue;
    const created = typeof transfer.created === "number" ? transfer.created * 1000 : NaN;
    problems.push(young(created)
      ? { reason: "settling", detail: `${pi} is at the processor and not yet recorded here` }
      : { reason: "unrecorded_processor_payment", detail: `${pi} (transfer ${transfer.id})` });
  }
  // A transfer the processor could not tie to a payment intent at all.
  for (const transfer of transfers) {
    const charge = transfer && typeof transfer === "object" ? transfer.source_transaction : null;
    const pi = charge && typeof charge === "object" ? idOf(charge.payment_intent) : null;
    if (!pi) problems.push({ reason: "unrecorded_processor_payment", detail: `transfer ${idOf(transfer) || "?"} is not from a recorded payment` });
  }

  const backfill = [];
  const rows = [];
  for (const [pi, row] of byIntent) {
    const match = atProcessor.get(pi);
    if (!match) {
      problems.push(young(Date.parse(row.created_at))
        ? { reason: "settling", detail: `${pi} is recorded here and not yet at the processor` }
        : { reason: "payment_not_at_processor", detail: pi });
      continue;
    }
    if (!match.read.ok) continue;
    const record = match.read.record;
    if (row.amount_cents !== record.charge_cents) {
      problems.push({ reason: "record_mismatch", detail: `${pi}: recorded ${row.amount_cents} cents, processor ${record.charge_cents}` });
      continue;
    }
    const missing = {};
    let differs = null;
    for (const field of Object.keys(record)) {
      if (field === "stripe_payment_intent") continue;
      if (row[field] == null) {
        if (record[field] != null) missing[field] = record[field];
      } else if (row[field] !== record[field]) {
        differs = `${pi}: ${field} recorded as ${row[field]}, processor ${record[field]}`;
      }
    }
    if (differs) {
      problems.push({ reason: "record_mismatch", detail: differs });
      continue;
    }
    if (row.processor_recorded_at == null) missing.processor_recorded_at = now.toISOString();
    if (Object.keys(missing).length) backfill.push({ id: row.id, stripe_payment_intent: pi, fields: missing });
    rows.push({ ...row, ...missing });
  }

  if (problems.length) return { status: "failed", ...worst(problems), backfill };

  // Belt and braces: after any backfill every row must be a complete record.
  const incomplete = rows.find((r) => !isCompletePaymentRow(r, accountId));
  if (incomplete) {
    return { status: "failed", reason: "record_mismatch", detail: `${incomplete.stripe_payment_intent}: the record is incomplete`, backfill };
  }
  return { status: "verified", rows, backfill, summary: summarize(rows) };
}

function summarize(rows) {
  return rows.reduce((acc, r) => ({
    payment_count: acc.payment_count + 1,
    charge_cents: acc.charge_cents + r.charge_cents,
    application_fee_cents: acc.application_fee_cents + r.application_fee_cents,
    club_net_cents: acc.club_net_cents + r.club_net_cents
  }), { payment_count: 0, charge_cents: 0, application_fee_cents: 0, club_net_cents: 0 });
}

// A short, fixed description of exactly which payment records a check looked
// at, and which team each one counted towards. Stored with a passed check and
// worked out again from the database every time a figure is about to be
// shown. If a payment has been added, removed or altered since the check, or
// an athlete has changed team, the two differ and no figure is shown.
export async function payoutFingerprint(accountId, rows, athletes) {
  const teamOf = new Map(athletes.map((a) => [String(a.id), a.team_id == null ? "" : String(a.team_id)]));
  const lines = rows.map((r) => [
    r.stripe_payment_intent, r.id, r.athlete_id, teamOf.get(String(r.athlete_id)) || "",
    r.stripe_charge_id, r.stripe_transfer_id,
    r.stripe_application_fee_id == null ? "" : r.stripe_application_fee_id,
    r.amount_cents, r.charge_cents, r.application_fee_cents, r.club_net_cents
  ].join("|")).sort();
  const text = [String(accountId), ...lines].join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const NO_FIGURE = Object.freeze({ verified: false });

// Decides whether a figure may be shown for one club, from what is in the
// database right now. Asks the processor nothing.
//
//   club       { id, stripe_account_id }
//   athletes   every athlete of the club: { id, team_id, payment_status }
//   payments   every succeeded payment row for those athletes (PAYMENT_SELECT)
//   check      the club's row in payout_checks; null if it is known to have
//              none; undefined if that could not be read
//   now        a Date
//
// Returns { verified: false } unless every condition holds. When it does:
// { verified: true, club_net_cents, charge_cents, payment_count, checked_at,
//   teams: Map(team_id -> { club_net_cents, charge_cents, payment_count }) }.
export async function verifiedPayout({ club, athletes, payments, check, now }) {
  try {
    if (!club || !Array.isArray(athletes) || !Array.isArray(payments)) return NO_FIGURE;
    const accountId = club.stripe_account_id;
    const { problems } = ownRecordProblems(athletes, payments);
    if (problems.length) return NO_FIGURE;

    if (!accountId) {
      // A club with no account at the processor cannot have been sent money
      // through PlayFund. Zero is shown only if the app's own records agree,
      // and only if the club is known never to have been checked: a saved
      // check means it had an account at some point.
      if (payments.length || check !== null) return NO_FIGURE;
      return { verified: true, club_net_cents: 0, charge_cents: 0, payment_count: 0, checked_at: null, teams: new Map() };
    }

    if (!check || check.status !== "verified") return NO_FIGURE;
    if (check.stripe_account_id !== accountId) return NO_FIGURE;
    const checkedMs = Date.parse(check.checked_at);
    const nowMs = now.getTime();
    if (!Number.isFinite(checkedMs)) return NO_FIGURE;
    if (nowMs - checkedMs > PAYOUT_CHECK_MAX_AGE_MS || checkedMs - nowMs > CLOCK_SKEW_MS) return NO_FIGURE;

    for (const p of payments) {
      if (!isCompletePaymentRow(p, accountId)) return NO_FIGURE;
      // A payment newer than the check has not been checked.
      const createdMs = Date.parse(p.created_at);
      if (!Number.isFinite(createdMs) || createdMs > checkedMs) return NO_FIGURE;
    }

    const total = summarize(payments);
    if (
      check.payment_count !== total.payment_count ||
      check.charge_cents !== total.charge_cents ||
      check.application_fee_cents !== total.application_fee_cents ||
      check.club_net_cents !== total.club_net_cents
    ) return NO_FIGURE;
    if (!isId(check.fingerprint) || check.fingerprint !== await payoutFingerprint(accountId, payments, athletes)) return NO_FIGURE;

    const teamOf = new Map(athletes.map((a) => [String(a.id), a.team_id == null ? null : String(a.team_id)]));
    const teams = new Map();
    for (const p of payments) {
      const teamId = teamOf.get(String(p.athlete_id));
      if (teamId == null) continue;
      const t = teams.get(teamId) || { club_net_cents: 0, charge_cents: 0, payment_count: 0 };
      t.club_net_cents += p.club_net_cents;
      t.charge_cents += p.charge_cents;
      t.payment_count += 1;
      teams.set(teamId, t);
    }
    return {
      verified: true,
      club_net_cents: total.club_net_cents,
      charge_cents: total.charge_cents,
      payment_count: total.payment_count,
      checked_at: check.checked_at,
      teams
    };
  } catch {
    return NO_FIGURE;
  }
}

// What the app is sent for a club: the figure, or the plain fact that there is
// none. Never a reason, and never a number alongside verified: false.
export function payoutForClub(result) {
  if (!result || result.verified !== true) return { verified: false };
  return {
    verified: true,
    club_net_cents: result.club_net_cents,
    charge_cents: result.charge_cents,
    payment_count: result.payment_count,
    checked_at: result.checked_at
  };
}

// The same for one team of that club. A team with no payments in a verified
// club is a verified zero.
export function payoutForTeam(result, teamId) {
  if (!result || result.verified !== true) return { verified: false };
  const t = result.teams.get(String(teamId)) || { club_net_cents: 0, charge_cents: 0, payment_count: 0 };
  return { verified: true, club_net_cents: t.club_net_cents, charge_cents: t.charge_cents, payment_count: t.payment_count };
}

// The total across clubs, shown only when every single club has a figure.
export function payoutForAll(results) {
  const unverified = results.filter((r) => !r || r.verified !== true).length;
  if (unverified) return { verified: false, unverified_clubs: unverified };
  return {
    verified: true,
    club_net_cents: results.reduce((s, r) => s + r.club_net_cents, 0),
    charge_cents: results.reduce((s, r) => s + r.charge_cents, 0),
    payment_count: results.reduce((s, r) => s + r.payment_count, 0)
  };
}

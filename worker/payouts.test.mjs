// Tests for the rule in payouts.mjs, one piece at a time. No network and no
// stand-in: every function here is given its inputs directly.
//
//   A figure about money a club has received is shown only when every payment
//   behind it is recorded from the payment processor's own data and has been
//   checked against the processor and found equal. Otherwise there is no
//   figure.
//
// payouts.worker.test.mjs runs the same rule through the Worker's handlers.
//
//   node --test                          from the repo root, runs every *.test.mjs
//   node --test worker/payouts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADVERSE_EVENT_HOLD_MS,
  PAYOUT_CHECK_MAX_AGE_MS,
  SETTLING_GRACE_MS,
  isCompletePaymentRow,
  payoutFingerprint,
  payoutForAll,
  payoutForClub,
  payoutForTeam,
  readProcessorPayment,
  tieOut,
  verifiedPayout
} from "./payouts.mjs";

const T0 = Date.parse("2026-12-01T15:00:00Z");
const HOUR = 60 * 60 * 1000;

function processorObjects(overrides = {}) {
  const fee = { id: "fee_x", object: "application_fee", amount: 2930, amount_refunded: 0, refunded: false, currency: "usd" };
  const charge = {
    id: "ch_x", object: "charge", amount: 100000, amount_captured: 100000, amount_refunded: 0, refunded: false, disputed: false,
    paid: true, captured: true, status: "succeeded", currency: "usd", payment_intent: "pi_x", application_fee: "fee_x", application_fee_amount: 2930
  };
  const transfer = { id: "tr_x", object: "transfer", amount: 100000, amount_reversed: 0, reversed: false, currency: "usd", destination: "acct_x", source_transaction: "ch_x", created: T0 / 1000 };
  return {
    charge: { ...charge, ...overrides.charge },
    transfer: overrides.transfer === null ? null : { ...transfer, ...overrides.transfer },
    fee: overrides.fee === null ? null : { ...fee, ...overrides.fee }
  };
}

test("reading one payment from the processor: a whole payment gives the processor's own numbers", () => {
  const read = readProcessorPayment(processorObjects(), "acct_x");
  assert.deepEqual(read, {
    ok: true,
    payment_intent: "pi_x",
    record: {
      stripe_payment_intent: "pi_x", stripe_charge_id: "ch_x", stripe_transfer_id: "tr_x", stripe_application_fee_id: "fee_x",
      stripe_destination_account: "acct_x", charge_cents: 100000, application_fee_cents: 2930, club_net_cents: 97070
    }
  });
  // The fee recorded is the fee object's amount, not the amount asked for.
  const capped = readProcessorPayment(processorObjects({ fee: { amount: 2000 } }), "acct_x");
  assert.equal(capped.record.application_fee_cents, 2000);
  assert.equal(capped.record.club_net_cents, 98000);
  // A payment with no fee at all.
  const free = readProcessorPayment(processorObjects({ charge: { application_fee: null, application_fee_amount: null }, fee: null }), "acct_x");
  assert.equal(free.record.club_net_cents, 100000);
  assert.equal(free.record.stripe_application_fee_id, null);
});

test("reading one payment from the processor: anything refunded, disputed, reversed or odd is refused", () => {
  const cases = [
    ["refund", { charge: { refunded: true, amount_refunded: 100000 } }],
    ["refund", { charge: { amount_refunded: 1 } }],
    ["dispute", { charge: { disputed: true } }],
    ["transfer_reversed", { transfer: { reversed: true, amount_reversed: 100000 } }],
    ["transfer_reversed", { transfer: { amount_reversed: 1 } }],
    ["fee_refunded", { fee: { refunded: true, amount_refunded: 2930 } }],
    ["fee_refunded", { fee: { amount_refunded: 1 } }],
    ["processor_unexpected", { charge: { status: "pending" } }],
    ["processor_unexpected", { charge: { status: "failed", paid: false } }],
    ["processor_unexpected", { charge: { captured: false } }],
    ["processor_unexpected", { charge: { amount_captured: 90000 } }],
    ["processor_unexpected", { charge: { currency: "cad" } }],
    ["processor_unexpected", { charge: { payment_intent: null } }],
    ["processor_unexpected", { charge: { object: "payment" } }],
    ["processor_unexpected", { charge: { amount: 0, amount_captured: 0 } }],
    ["processor_unexpected", { charge: { amount: 1000.5, amount_captured: 1000.5 } }],
    ["processor_unexpected", { charge: { refunded: undefined } }],
    ["processor_unexpected", { charge: { amount_refunded: null } }],
    ["processor_unexpected", { charge: { disputed: "false" } }],
    ["processor_unexpected", { transfer: null }],
    ["processor_unexpected", { transfer: { amount: 99000 } }],
    ["processor_unexpected", { transfer: { destination: "acct_other" } }],
    ["processor_unexpected", { transfer: { source_transaction: "ch_other" } }],
    ["processor_unexpected", { transfer: { reversed: undefined } }],
    ["processor_unexpected", { transfer: { currency: "eur" } }],
    ["processor_unexpected", { fee: null }],
    ["processor_unexpected", { fee: { amount: "2930" } }],
    ["processor_unexpected", { fee: { amount: -1 } }],
    ["processor_unexpected", { fee: { amount: 200000 } }],
    ["processor_unexpected", { fee: { refunded: null } }],
    ["processor_unexpected", { fee: { currency: "gbp" } }]
  ];
  for (const [reason, overrides] of cases) {
    const read = readProcessorPayment(processorObjects(overrides), "acct_x");
    assert.equal(read.ok, false, JSON.stringify(overrides));
    assert.equal(read.reason, reason, JSON.stringify(overrides));
    assert.equal("record" in read, false);
  }
  for (const nothing of [null, undefined, "ch_x", 7]) {
    assert.equal(readProcessorPayment({ charge: nothing, transfer: processorObjects().transfer, fee: null }, "acct_x").ok, false);
  }
  assert.equal(readProcessorPayment(processorObjects(), null).ok, false);
  assert.equal(readProcessorPayment(processorObjects(), "").ok, false);
});

function unit() {
  const accountId = "acct_x";
  const now = new Date(T0);
  const athletes = [
    { id: "a1", team_id: "t1", payment_status: "paid_full" },
    { id: "a2", team_id: "t2", payment_status: "bnpl_complete" },
    { id: "a3", team_id: "t2", payment_status: "unpaid" }
  ];
  const row = (n, athlete, charge, fee) => ({
    id: `row${n}`, athlete_id: athlete, created_at: new Date(T0 - HOUR).toISOString(), amount_cents: charge,
    stripe_payment_intent: `pi_${n}`, stripe_charge_id: `ch_${n}`, stripe_transfer_id: `tr_${n}`, stripe_application_fee_id: `fee_${n}`,
    stripe_destination_account: accountId, charge_cents: charge, application_fee_cents: fee, club_net_cents: charge - fee,
    processor_recorded_at: new Date(T0 - HOUR).toISOString()
  });
  const payments = [row(1, "a1", 100000, 2930), row(2, "a2", 45000, 3600)];
  const transfer = (r) => ({
    id: r.stripe_transfer_id, object: "transfer", amount: r.charge_cents, amount_reversed: 0, reversed: false, currency: "usd",
    destination: accountId, created: (T0 - HOUR) / 1000,
    source_transaction: {
      id: r.stripe_charge_id, object: "charge", amount: r.charge_cents, amount_captured: r.charge_cents, amount_refunded: 0, refunded: false,
      disputed: false, paid: true, captured: true, status: "succeeded", currency: "usd", payment_intent: r.stripe_payment_intent,
      application_fee_amount: r.application_fee_cents,
      application_fee: { id: r.stripe_application_fee_id, object: "application_fee", amount: r.application_fee_cents, amount_refunded: 0, refunded: false, currency: "usd" }
    }
  });
  return { accountId, now, athletes, payments, transfers: payments.map(transfer), transfer, row };
}

async function passedCheck(u, overrides = {}) {
  const result = tieOut(u);
  assert.equal(result.status, "verified");
  return {
    club_id: "c1", status: "verified", checked_at: u.now.toISOString(), stripe_account_id: u.accountId,
    ...result.summary, fingerprint: await payoutFingerprint(u.accountId, result.rows, u.athletes), ...overrides
  };
}

test("the tie-out passes only when both sides agree in both directions", () => {
  const u = unit();
  const ok = tieOut(u);
  assert.equal(ok.status, "verified");
  assert.deepEqual(ok.summary, { payment_count: 2, charge_cents: 145000, application_fee_cents: 6530, club_net_cents: 138470 });
  assert.deepEqual(ok.backfill, []);

  const old = new Date(T0 - 2 * SETTLING_GRACE_MS);
  const cases = {
    unrecorded_processor_payment: () => { const x = unit(); x.transfers.push({ ...x.transfer(x.row(3, "a3", 5000, 100)), created: old / 1000 }); return x; },
    payment_not_at_processor: () => { const x = unit(); x.transfers.pop(); x.payments[1].created_at = old.toISOString(); return x; },
    settling: () => { const x = unit(); x.transfers.pop(); x.payments[1].created_at = x.now.toISOString(); return x; },
    record_mismatch: () => { const x = unit(); x.payments[0].application_fee_cents = 2929; x.payments[0].club_net_cents = 97071; return x; },
    duplicate_payment_rows: () => { const x = unit(); x.payments.push({ ...x.payments[0], id: "row1b" }); return x; },
    paid_without_payment: () => { const x = unit(); x.athletes[2].payment_status = "bnpl_active"; return x; },
    payment_without_paid_status: () => { const x = unit(); x.athletes[0].payment_status = "unpaid"; return x; },
    // The same, minutes after the payment: the webhook may still be finishing.
    settling_status: () => { const x = unit(); x.athletes[0].payment_status = "unpaid"; x.payments[0].created_at = x.now.toISOString(); return x; },
    refund: () => { const x = unit(); x.transfers[0].source_transaction.amount_refunded = 1; return x; },
    dispute: () => { const x = unit(); x.transfers[0].source_transaction.disputed = true; return x; },
    transfer_reversed: () => { const x = unit(); x.transfers[0].amount_reversed = 1; return x; },
    fee_refunded: () => { const x = unit(); x.transfers[0].source_transaction.application_fee.amount_refunded = 1; return x; },
    processor_unexpected: () => { const x = unit(); x.transfers[0].source_transaction.application_fee = "fee_1"; return x; }
  };
  for (const [reason, build] of Object.entries(cases)) {
    const result = tieOut(build());
    assert.equal(result.status, "failed", reason);
    assert.equal(result.reason, reason.replace(/_status$/, "") === "settling" ? "settling" : reason, reason);
    assert.equal("summary" in result, false, reason);
    assert.equal("rows" in result, false, reason);
  }

  // Other ways a stored row can disagree with the processor.
  for (const change of [
    (r) => { r.amount_cents = 99999; },
    (r) => { r.stripe_charge_id = "ch_other"; },
    (r) => { r.stripe_transfer_id = "tr_other"; },
    (r) => { r.stripe_application_fee_id = "fee_other"; },
    (r) => { r.stripe_destination_account = "acct_other"; },
    (r) => { r.charge_cents = 100001; },
    (r) => { r.club_net_cents = 97071; },
    (r) => { r.stripe_payment_intent = null; }
  ]) {
    const x = unit();
    x.payments[0].created_at = old.toISOString();
    x.transfers[0].created = old / 1000;
    change(x.payments[0]);
    assert.equal(tieOut(x).status, "failed", change.toString());
  }

  // A transfer that did not come from a payment at all.
  const loose = unit();
  loose.transfers.push({ id: "tr_loose", object: "transfer", amount: 5000, amount_reversed: 0, reversed: false, currency: "usd", destination: loose.accountId, source_transaction: null, created: old / 1000 });
  assert.equal(tieOut(loose).reason, "unrecorded_processor_payment");

  // A refund outranks everything else found at the same time, so the reason is stable.
  const both = unit();
  both.transfers[0].source_transaction.amount_refunded = 1;
  both.athletes[2].payment_status = "paid_full";
  assert.equal(tieOut(both).reason, "refund");
});

test("the tie-out fills in a missing record from the processor and never overwrites a recorded value", () => {
  const u = unit();
  for (const col of ["stripe_charge_id", "stripe_transfer_id", "stripe_application_fee_id", "stripe_destination_account", "charge_cents", "application_fee_cents", "club_net_cents", "processor_recorded_at"]) {
    delete u.payments[1][col];
  }
  const result = tieOut(u);
  assert.equal(result.status, "verified");
  assert.deepEqual(result.backfill, [{
    id: "row2", stripe_payment_intent: "pi_2",
    fields: {
      stripe_charge_id: "ch_2", stripe_transfer_id: "tr_2", stripe_application_fee_id: "fee_2", stripe_destination_account: "acct_x",
      charge_cents: 45000, application_fee_cents: 3600, club_net_cents: 41400, processor_recorded_at: u.now.toISOString()
    }
  }]);
  assert.equal(result.summary.club_net_cents, 138470);

  // One field present and wrong: a failure, with nothing proposed for that row.
  const wrong = unit();
  delete wrong.payments[1].club_net_cents;
  wrong.payments[1].application_fee_cents = 1;
  const failed = tieOut(wrong);
  assert.equal(failed.reason, "record_mismatch");
  assert.deepEqual(failed.backfill, []);
});

test("deciding to show a figure: every condition has to hold", async () => {
  const u = unit();
  const club = { id: "c1", stripe_account_id: u.accountId };
  const check = await passedCheck(u);
  const base = { club, athletes: u.athletes, payments: u.payments, check, now: u.now };

  const shown = await verifiedPayout(base);
  assert.equal(shown.verified, true);
  assert.equal(shown.club_net_cents, 138470);
  assert.equal(shown.charge_cents, 145000);
  assert.deepEqual(payoutForClub(shown), { verified: true, club_net_cents: 138470, charge_cents: 145000, payment_count: 2, checked_at: check.checked_at });
  assert.deepEqual(payoutForTeam(shown, "t1"), { verified: true, club_net_cents: 97070, charge_cents: 100000, payment_count: 1 });
  assert.deepEqual(payoutForTeam(shown, "t2"), { verified: true, club_net_cents: 41400, charge_cents: 45000, payment_count: 1 });
  assert.deepEqual(payoutForTeam(shown, "t9"), { verified: true, club_net_cents: 0, charge_cents: 0, payment_count: 0 });

  const later = (ms) => new Date(T0 + ms);
  const without = (list, i) => list.filter((_, j) => j !== i);
  const edit = (i, fields) => u.payments.map((p, j) => (j === i ? { ...p, ...fields } : p));
  const absent = {
    "no saved check": { check: null },
    "a failed check": { check: { ...check, status: "failed" } },
    "a check with an unknown status": { check: { ...check, status: "ok" } },
    "a check against another account": { check: { ...check, stripe_account_id: "acct_other" } },
    "a check with no date": { check: { ...check, checked_at: null } },
    "a check with a date that is not one": { check: { ...check, checked_at: "soon" } },
    "a check that is too old": { now: later(PAYOUT_CHECK_MAX_AGE_MS + 1) },
    "a check from the future": { now: later(-HOUR) },
    "a check with no fingerprint": { check: { ...check, fingerprint: null } },
    "a check with another fingerprint": { check: { ...check, fingerprint: "0".repeat(64) } },
    "a check with a different count": { check: { ...check, payment_count: 3 } },
    "a check with a different net": { check: { ...check, club_net_cents: check.club_net_cents + 1 } },
    "a check with a different charge total": { check: { ...check, charge_cents: check.charge_cents + 1 } },
    "a check with a different fee total": { check: { ...check, application_fee_cents: check.application_fee_cents + 1 } },
    "a payment newer than the check": { payments: edit(0, { created_at: later(1).toISOString() }) },
    "a payment with no date": { payments: edit(0, { created_at: null }) },
    "a payment removed": { payments: without(u.payments, 1), athletes: u.athletes.map((a) => (a.id === "a2" ? { ...a, payment_status: "unpaid" } : a)) },
    "a payment missing its fee": { payments: edit(0, { application_fee_cents: null }) },
    "a payment missing its net": { payments: edit(0, { club_net_cents: null }) },
    "a payment whose numbers do not add up": { payments: edit(0, { club_net_cents: 97071 }) },
    "a payment whose amount is not its charge": { payments: edit(0, { amount_cents: 100001 }) },
    "a payment with a fractional fee": { payments: edit(0, { application_fee_cents: 2930.5, club_net_cents: 97069.5 }) },
    "a payment with a negative fee": { payments: edit(0, { application_fee_cents: -1, club_net_cents: 100001 }) },
    "a payment with its numbers as text": { payments: edit(0, { charge_cents: "100000" }) },
    "a payment recorded against another account": { payments: edit(0, { stripe_destination_account: "acct_other" }) },
    "a payment with no charge id": { payments: edit(0, { stripe_charge_id: null }) },
    "a payment with no transfer id": { payments: edit(0, { stripe_transfer_id: "" }) },
    "a payment never marked as recorded": { payments: edit(0, { processor_recorded_at: null }) },
    "a payment moved to another athlete": { payments: edit(0, { athlete_id: "a3" }), athletes: u.athletes.map((a) => ({ ...a, payment_status: a.id === "a1" ? "unpaid" : "paid_full" })) },
    "the same payment twice": { payments: [...u.payments, { ...u.payments[0], id: "row1b" }] },
    "an athlete marked paid with no payment": { athletes: u.athletes.map((a) => (a.id === "a3" ? { ...a, payment_status: "paid_full" } : a)) },
    "a payment for an athlete not marked paid": { athletes: u.athletes.map((a) => (a.id === "a1" ? { ...a, payment_status: "unpaid" } : a)) },
    "a payment for an athlete who is gone": { athletes: without(u.athletes, 0) },
    "payments that are not a list": { payments: null },
    "athletes that are not a list": { athletes: undefined },
    "no club": { club: null }
  };
  for (const [name, change] of Object.entries(absent)) {
    const result = await verifiedPayout({ ...base, ...change });
    assert.deepEqual(result, { verified: false }, name);
    assert.deepEqual(payoutForClub(result), { verified: false }, name);
    assert.deepEqual(payoutForTeam(result, "t1"), { verified: false }, name);
  }

  // Dates in the form the database returns them, with microseconds and an offset.
  const pg = (ms) => new Date(ms).toISOString().replace("Z", "123+00:00");
  const asStored = u.payments.map((p) => ({ ...p, created_at: pg(T0 - HOUR) }));
  assert.equal((await verifiedPayout({ ...base, payments: asStored, check: { ...check, checked_at: pg(T0) } })).verified, true);
  assert.deepEqual(await verifiedPayout({ ...base, payments: asStored, check: { ...check, checked_at: pg(T0 - 2 * HOUR) } }), { verified: false });

  // An athlete changes team after the check: the split between teams is no
  // longer the one that was checked.
  const moved = u.athletes.map((a) => (a.id === "a1" ? { ...a, team_id: "t2" } : a));
  assert.deepEqual(await verifiedPayout({ ...base, athletes: moved }), { verified: false });

  // A club with no processor account: zero if and only if its records are
  // empty and it is known never to have been checked.
  const none = { id: "c2", stripe_account_id: null };
  assert.equal((await verifiedPayout({ club: none, athletes: [u.athletes[2]], payments: [], check: null, now: u.now })).club_net_cents, 0);
  assert.deepEqual(await verifiedPayout({ club: none, athletes: u.athletes, payments: u.payments, check, now: u.now }), { verified: false });
  assert.deepEqual(await verifiedPayout({ club: none, athletes: u.athletes, payments: [], check: null, now: u.now }), { verified: false });
  // It had an account once (a check was saved), or the saved checks could not be read.
  assert.deepEqual(await verifiedPayout({ club: none, athletes: [u.athletes[2]], payments: [], check, now: u.now }), { verified: false });
  assert.deepEqual(await verifiedPayout({ club: none, athletes: [u.athletes[2]], payments: [], check: undefined, now: u.now }), { verified: false });
  assert.ok(ADVERSE_EVENT_HOLD_MS >= 60 * 1000, "the hold after a refund report must outlast a running check");
});

test("what the app is sent never carries a number alongside 'not verified'", () => {
  for (const nothing of [null, undefined, {}, { verified: false, club_net_cents: 5 }, { verified: "true", club_net_cents: 5 }, { club_net_cents: 5 }]) {
    assert.deepEqual(payoutForClub(nothing), { verified: false });
    assert.deepEqual(payoutForTeam(nothing, "t1"), { verified: false });
  }
  const one = { verified: true, club_net_cents: 100, charge_cents: 110, payment_count: 1, teams: new Map() };
  assert.deepEqual(payoutForAll([one, one]), { verified: true, club_net_cents: 200, charge_cents: 220, payment_count: 2 });
  assert.deepEqual(payoutForAll([one, { verified: false }, null]), { verified: false, unverified_clubs: 2 });
  assert.deepEqual(payoutForAll([]), { verified: true, club_net_cents: 0, charge_cents: 0, payment_count: 0 });
});

test("a complete payment row is one whose numbers agree with each other", () => {
  const u = unit();
  assert.equal(isCompletePaymentRow(u.payments[0], u.accountId), true);
  assert.equal(isCompletePaymentRow({ ...u.payments[0], stripe_application_fee_id: null, application_fee_cents: 0, club_net_cents: 100000 }, u.accountId), true);
  assert.equal(isCompletePaymentRow({ ...u.payments[0], stripe_application_fee_id: null }, u.accountId), false, "a fee with no fee object behind it");
  assert.equal(isCompletePaymentRow(u.payments[0], "acct_other"), false);
  assert.equal(isCompletePaymentRow(u.payments[0], null), false);
  assert.equal(isCompletePaymentRow(null, u.accountId), false);
});

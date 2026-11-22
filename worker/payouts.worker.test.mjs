// Tests that run the Worker's own handlers against a stand-in database and a
// stand-in payment processor, and try to make the app show a wrong number.
//
// The rule under test (see payouts.mjs):
//
//   A figure about money a club has received is shown only when every payment
//   behind it is recorded from the payment processor's own data and has been
//   checked against the processor and found equal. Otherwise there is no
//   figure.
//
// Each attempt below has to end with no figure at all, or with a figure equal
// to the stand-in processor's own ledger to the cent.
//
// Nothing here touches a real service. payouts.standin.mjs plays the database,
// the processor and the mail service. All keys and ids are made-up
// placeholders.
//
//   node --test                                 from the repo root, runs every *.test.mjs
//   node --test worker/payouts.worker.test.mjs
//
// To run the same tests against a bundled build of the Worker, set
// WORKER_UNDER_TEST to the bundled file's path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { call, createWorld, payFor, runTimer, sendWebhook } from "./payouts.standin.mjs";
import { ADVERSE_EVENT_HOLD_MS, PAYOUT_CHECK_MAX_AGE_MS, SETTLING_GRACE_MS, payoutFingerprint } from "./payouts.mjs";

// One world per test. The stand-in is installed for the whole file and never
// removed, and it fails the test if the Worker asks for anything unexpected.
let world = null;
globalThis.fetch = (input, init) => {
  if (!world) throw new Error("The Worker made a request outside a test");
  return world.fetch(input, init);
};
// The Worker logs every failed check. Keep that out of the test output.
const logged = [];
console.error = (...args) => logged.push(args.map(String).join(" "));
console.log = (...args) => logged.push(args.map(String).join(" "));

const workerUrl = process.env.WORKER_UNDER_TEST
  ? pathToFileURL(process.env.WORKER_UNDER_TEST).href
  : new URL("./index.js", import.meta.url).href;
const { default: worker } = await import(workerUrl);

const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const PAYOUT_CHECK_CRON = source.match(/PAYOUT_CHECK_CRON = "([^"]+)"/)[1];

const T0 = Date.parse("2026-12-01T15:00:00Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// How often the timer fires, read from its schedule.
const RUN_EVERY = Number(PAYOUT_CHECK_CRON.match(/^\*\/(\d+) \* \* \* \*$/)[1]) * MINUTE;
const NO_FIGURE = { verified: false };

// A fresh world with the clock under the test's control.
function begin(t, options) {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  world = createWorld(options);
  logged.length = 0;
  const staff = world.addStaff();
  return { world, staff, wait: (ms) => t.mock.timers.tick(ms) };
}

const timer = () => runTimer(worker, PAYOUT_CHECK_CRON);
// What a signed-in member of PlayFund staff is sent for one club.
async function clubView(club, token = "token-staff") {
  const res = await call(worker, "GET", `/club/${club.code}`, { token });
  assert.equal(res.status, 200);
  return res.body.club;
}
async function adminView() {
  const res = await call(worker, "GET", "/admin/clubs", { token: "token-staff" });
  assert.equal(res.status, 200);
  return res.body;
}
const alerts = () => world.mail.filter((m) => /^ACTION NEEDED: payout/.test(m.subject));
const paymentRow = (pay) => world.db.payments.find((r) => r.stripe_payment_intent === pay.intentId && r.status === "succeeded");
const checkRow = (club) => world.db.payout_checks.find((r) => r.club_id === club.id);

// The figure the app would show for a club must equal the processor's ledger
// for that club's account, and the same for what families were charged.
function assertTies(payout, account) {
  assert.equal(payout.verified, true, "expected a figure");
  assert.equal(payout.club_net_cents, world.processor.ledger(account));
  assert.equal(payout.charge_cents, world.processor.charged(account));
}
// Nothing is shown, and no number rides along with "not verified".
function assertNoFigure(payout) {
  assert.deepEqual(payout, NO_FIGURE);
}

// ---------------------------------------------------------------------------
// A payment is recorded from the processor's data, checked, and then shown.
// ---------------------------------------------------------------------------

test("pay in full: recorded from the processor, checked, and the figure ties to the cent", async (t) => {
  begin(t);
  const club = world.addClub();
  const [athlete] = club.teams[0].athletes;
  const pay = await payFor(worker, world, athlete, "full");
  assert.equal(pay.webhookStatus, 200);

  // $1,000 of dues: the processor took 2.9% + 30c and the club's account kept the rest.
  assert.equal(pay.feeCents, 2930);
  assert.equal(world.processor.ledger(club.stripe_account_id), 97070);

  const row = paymentRow(pay);
  assert.equal(row.amount_cents, 100000);
  assert.equal(row.payment_method, "card");
  // The record is the processor's, object for object.
  assert.equal(row.stripe_charge_id, pay.chargeId);
  assert.equal(row.stripe_transfer_id, pay.transferId);
  assert.equal(row.stripe_application_fee_id, pay.feeId);
  assert.equal(row.stripe_destination_account, club.stripe_account_id);
  assert.equal(row.charge_cents, 100000);
  assert.equal(row.application_fee_cents, 2930);
  assert.equal(row.club_net_cents, 97070);
  assert.equal(world.db.athletes.find((a) => a.id === athlete.id).payment_status, "paid_full");

  assert.equal(checkRow(club).status, "verified");
  const view = await clubView(club);
  assertTies(view.payout, club.stripe_account_id);
  assert.equal(view.payout.club_net_cents, 97070);
  // The team's figure is the same payment, and the club admin sees what staff see.
  assert.deepEqual(view.teams[0].payout, { verified: true, club_net_cents: 97070, charge_cents: 100000, payment_count: 1 });
  assert.deepEqual((await clubView(club, club.token)).payout, view.payout);
  assert.equal(alerts().length, 0);
});

test("installments: recorded and shown the same way, at the fee the processor took", async (t) => {
  begin(t);
  const club = world.addClub({ fee_bps: 650 });
  const [athlete] = club.teams[0].athletes;
  const pay = await payFor(worker, world, athlete, "bnpl");
  assert.equal(pay.method, "klarna");
  assert.equal(pay.feeCents, 6500);
  assert.equal(paymentRow(pay).payment_method, "klarna");
  assert.equal(paymentRow(pay).application_fee_cents, 6500);
  assert.equal(paymentRow(pay).club_net_cents, 93500);
  // The installment partner pays the whole amount up front, so the plan is complete.
  assert.equal(world.db.athletes.find((a) => a.id === athlete.id).payment_status, "bnpl_complete");
  const view = await clubView(club);
  assertTies(view.payout, club.stripe_account_id);
  assert.equal(view.payout.club_net_cents, 93500);
});

test("the webhook sets paid_full for a card and bnpl_* for an installment payment", async (t) => {
  begin(t);
  const club = world.addClub({ teams: [{ dues_cents: 100000, athletes: 3 }] });
  const [card, klarna, part] = club.teams[0].athletes;
  const status = (a) => world.db.athletes.find((x) => x.id === a.id).payment_status;

  await payFor(worker, world, card, "full");
  assert.equal(status(card), "paid_full");

  await payFor(worker, world, klarna, "bnpl");
  assert.equal(status(klarna), "bnpl_complete");

  // An installment payment for less than the dues leaves the plan active.
  const short = world.processor.createPayment({ account: club.stripe_account_id, amountCents: 40000, feeCents: 3200, athleteId: part.id, method: "klarna" });
  const res = await sendWebhook(worker, world, "payment_intent.succeeded", world.processor.intentObject(short));
  assert.equal(res.status, 200);
  assert.equal(status(part), "bnpl_active");
  assert.equal(world.db.athletes.find((x) => x.id === part.id).payment_method, "klarna");
});

test("the webhook needs a valid signature", async (t) => {
  begin(t);
  const club = world.addClub();
  const [athlete] = club.teams[0].athletes;
  const pay = world.processor.createPayment({ account: club.stripe_account_id, amountCents: 100000, feeCents: 2930, athleteId: athlete.id });
  const forged = await sendWebhook(worker, world, "payment_intent.succeeded", world.processor.intentObject(pay), { secret: "not-the-secret" });
  assert.equal(forged.status, 401);
  assert.equal(world.db.payments.length, 0);
  assert.equal(world.db.athletes.find((a) => a.id === athlete.id).payment_status, "unpaid");
  // A forged refund event must not be able to hide a figure or mail staff either.
  const forgedRefund = await sendWebhook(worker, world, "charge.refunded", world.processor.chargeObject(pay), { secret: "not-the-secret" });
  assert.equal(forgedRefund.status, 401);
  assert.equal(world.db.payout_checks.length, 0);
  assert.equal(world.mail.length, 0);
});

// ---------------------------------------------------------------------------
// Things that used to move the figure, and no longer can.
// ---------------------------------------------------------------------------

test("the club's rate changes after payments: the figure does not move", async (t) => {
  begin(t);
  const club = world.addClub({ fee_bps: 800 });
  const [a, b] = club.teams[0].athletes;
  await payFor(worker, world, a, "bnpl");
  await payFor(worker, world, b, "full");
  const before = (await clubView(club)).payout;
  assert.equal(before.club_net_cents, 92000 + 97070);

  const patched = await call(worker, "PATCH", `/admin/clubs/${club.id}`, { token: "token-staff", body: { fee_bps: 1200 } });
  assert.equal(patched.status, 200);
  assert.equal(world.db.clubs[0].fee_bps, 1200);

  // The old code would now report $880 for the installment family.
  const after = await clubView(club);
  assert.deepEqual(after.payout, before);
  assertTies(after.payout, club.stripe_account_id);
  assertTies((await adminView()).clubs[0].payout, club.stripe_account_id);
  await timer();
  assert.deepEqual((await clubView(club)).payout.club_net_cents, before.club_net_cents);
});

test("a team's dues change after payments: the figure does not move", async (t) => {
  begin(t);
  const club = world.addClub();
  const [a, b] = club.teams[0].athletes;
  await payFor(worker, world, a, "full");
  await payFor(worker, world, b, "bnpl");
  const before = (await clubView(club)).payout;

  world.db.teams[0].dues_cents = 150000;

  const after = await clubView(club);
  assert.deepEqual(after.payout, before);
  assertTies(after.payout, club.stripe_account_id);
  assert.deepEqual(after.teams[0].payout.club_net_cents, 97070 + 92000);
});

test("a payment made under an older fee rule is shown at the fee actually taken", async (t) => {
  begin(t);
  const club = world.addClub();
  const [athlete] = club.teams[0].athletes;
  // A pay-in-full payment from before the rule changed: the processor took 8%,
  // and the row was written before the processor record columns existed.
  const old = world.processor.createPayment({ account: club.stripe_account_id, amountCents: 100000, feeCents: 8000, athleteId: athlete.id, createdMs: T0 - 60 * 24 * HOUR });
  world.db.payments.push({
    id: "payments_old", created_at: new Date(T0 - 60 * 24 * HOUR).toISOString(), athlete_id: athlete.id,
    stripe_payment_intent: old.intentId, stripe_event_id: "evt_old", amount_cents: 100000, status: "succeeded", payment_method: "card"
  });
  world.db.athletes[0].payment_status = "paid_full";

  // Not checked yet: nothing is shown, and certainly not today's rule applied to it.
  assertNoFigure((await clubView(club)).payout);

  await timer();
  // The check fills the record in from the processor's objects, never from a rate.
  assert.equal(world.db.payments[0].application_fee_cents, 8000);
  assert.equal(world.db.payments[0].club_net_cents, 92000);
  const view = await clubView(club);
  assertTies(view.payout, club.stripe_account_id);
  assert.equal(view.payout.club_net_cents, 92000);
});

// ---------------------------------------------------------------------------
// Ways to make the figure wrong. Each must end with no figure.
// ---------------------------------------------------------------------------

// A club with two paid athletes and a figure on screen.
async function paidClub(t, options) {
  const ctx = begin(t, options);
  const club = world.addClub({ teams: [{ dues_cents: 100000, athletes: 3 }] });
  const [a, b] = club.teams[0].athletes;
  const first = await payFor(worker, world, a, "full");
  const second = await payFor(worker, world, b, "bnpl");
  assertTies((await clubView(club)).payout, club.stripe_account_id);
  assert.equal(world.mail.filter((m) => /^ACTION NEEDED/.test(m.subject)).length, 0);
  return { ...ctx, club, first, second };
}

// After anything that should hide the figure: nothing on any screen's data.
async function assertHiddenEverywhere(club) {
  const view = await clubView(club);
  assertNoFigure(view.payout);
  for (const team of view.teams) assertNoFigure(team.payout);
  const admin = await adminView();
  const row = admin.clubs.find((c) => c.id === club.id);
  assertNoFigure(row.payout);
  for (const team of row.teams) assertNoFigure(team.payout);
  assert.equal(admin.totals.payout.verified, false);
  assert.equal("club_net_cents" in admin.totals.payout, false);
  assert.equal("charge_cents" in admin.totals.payout, false);
}

test("a stored fee that differs from the processor's: no figure", async (t) => {
  const { club, first } = await paidClub(t);
  // Someone, or some bug, makes the stored fee smaller and the payout bigger.
  const row = paymentRow(first);
  row.application_fee_cents = 1000;
  row.club_net_cents = 99000;
  // Hidden at once: the stored rows are no longer the ones that were checked.
  await assertHiddenEverywhere(club);
  // And the next check says why, and tells staff.
  await timer();
  assert.equal(checkRow(club).status, "failed");
  assert.equal(checkRow(club).reason, "record_mismatch");
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 1);
  // The check never "corrects" a recorded value to make itself pass.
  assert.equal(row.application_fee_cents, 1000);
});

test("a stored amount that differs from the processor's: no figure", async (t) => {
  const { club, first } = await paidClub(t);
  const row = paymentRow(first);
  row.amount_cents = 120000;
  row.charge_cents = 120000;
  row.club_net_cents = 117070;
  await assertHiddenEverywhere(club);
  await timer();
  assert.equal(checkRow(club).reason, "record_mismatch");
  await assertHiddenEverywhere(club);
});

for (const [name, cents, options] of [
  ["a full refund", 100000, {}],
  ["a full refund that takes the money back from the club", 100000, { reverseTransfer: true, refundFee: true }],
  ["a partial refund", 2500, {}],
  ["a partial refund that takes part of the money back", 2500, { reverseTransfer: true }]
]) {
  test(`the processor shows ${name}: no figure`, async (t) => {
    const { club, first } = await paidClub(t);
    world.processor.refund(first, cents, options);
    await timer();
    assert.equal(checkRow(club).status, "failed");
    assert.equal(checkRow(club).reason, "refund");
    await assertHiddenEverywhere(club);
    assert.equal(alerts().length, 1);
    assert.match(alerts()[0].subject, new RegExp(`payout figure hidden for ${club.name}`));
    // It stays hidden for as long as the processor still shows the refund.
    await timer();
    await assertHiddenEverywhere(club);
    assert.equal(alerts().length, 1, "staff are told once, not on every check");
  });
}

test("the processor shows a dispute: no figure", async (t) => {
  const { club, second } = await paidClub(t);
  second.disputed = true;
  await timer();
  assert.equal(checkRow(club).reason, "dispute");
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 1);
});

test("the processor shows a reversal: no figure", async (t) => {
  const { club, second } = await paidClub(t);
  second.reversedCents = 5000;
  await timer();
  assert.equal(checkRow(club).reason, "transfer_reversed");
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 1);
});

test("the processor shows PlayFund's fee refunded: no figure", async (t) => {
  const { club, second } = await paidClub(t);
  second.feeRefundedCents = 8000;
  await timer();
  assert.equal(checkRow(club).reason, "fee_refunded");
  await assertHiddenEverywhere(club);
});

test("a refund, dispute or reversal event hides the figure at once, without waiting for a check", async (t) => {
  for (const [type, reason, change, object] of [
    ["charge.refunded", "refund", (p) => world.processor.refund(p, 100000), (p) => world.processor.chargeObject(p)],
    ["charge.dispute.created", "dispute", (p) => { p.disputed = true; }, (p) => ({ id: "dp_test0001", object: "dispute", charge: p.chargeId, payment_intent: p.intentId, amount: p.amountCents })],
    ["transfer.reversed", "transfer_reversed", (p) => { p.reversedCents = 100000; }, (p) => world.processor.transferObject(p)],
    ["application_fee.refunded", "fee_refunded", (p) => { p.feeRefundedCents = p.feeCents; }, (p) => world.processor.feeObject(p)]
  ]) {
    const { club, first } = await paidClub(t);
    change(first);
    const res = await sendWebhook(worker, world, type, object(first));
    assert.equal(res.status, 200, type);
    assert.equal(checkRow(club).status, "failed", type);
    assert.equal(checkRow(club).reason, reason, type);
    await assertHiddenEverywhere(club);
    assert.equal(alerts().length, 1, type);
    // The athlete's status is not touched: what a refund means is not decided.
    assert.equal(world.db.athletes[0].payment_status, "paid_full", type);
    // The same reason from the next check does not mail staff a second time.
    await timer();
    assert.equal(checkRow(club).reason, reason, type);
    assert.equal(alerts().length, 1, type);
    await assertHiddenEverywhere(club);
    t.mock.timers.reset();
  }
});

test("the processor has a payment the app never recorded: no figure", async (t) => {
  const { club, wait } = await paidClub(t);
  // A third family pays, and the webhook for it never arrives.
  await payFor(worker, world, club.teams[0].athletes[2], "full", { deliver: false });
  assert.equal(world.db.payments.length, 2);

  // The first check after it: hidden, but not yet reported, in case the
  // webhook is only late.
  await timer();
  assert.equal(checkRow(club).reason, "settling");
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 0);

  wait(SETTLING_GRACE_MS + MINUTE);
  await timer();
  assert.equal(checkRow(club).reason, "unrecorded_processor_payment");
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 1);
});

test("a club's very first payment is missed: no figure, never a wrong $0", async (t) => {
  const { wait } = begin(t);
  const club = world.addClub();
  await timer();
  // Checked, nothing received: a true zero.
  assert.deepEqual((await clubView(club)).payout, { verified: true, club_net_cents: 0, charge_cents: 0, payment_count: 0, checked_at: checkRow(club).checked_at });

  await payFor(worker, world, club.teams[0].athletes[0], "full", { deliver: false });
  wait(SETTLING_GRACE_MS + MINUTE);
  await timer();
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 1);
});

test("the app has a payment the processor does not: no figure", async (t) => {
  const { club, wait } = await paidClub(t);
  const athlete = club.teams[0].athletes[2];
  world.db.payments.push({
    id: "payments_phantom", created_at: new Date().toISOString(), athlete_id: athlete.id,
    stripe_payment_intent: "pi_test9999", stripe_event_id: "evt_phantom", amount_cents: 100000, status: "succeeded", payment_method: "card",
    stripe_charge_id: "ch_test9999", stripe_transfer_id: "tr_test9999", stripe_application_fee_id: "fee_test9999",
    stripe_destination_account: club.stripe_account_id, charge_cents: 100000, application_fee_cents: 2930, club_net_cents: 97070,
    processor_recorded_at: new Date().toISOString()
  });
  world.db.athletes.find((a) => a.id === athlete.id).payment_status = "paid_full";
  await assertHiddenEverywhere(club);

  wait(SETTLING_GRACE_MS + MINUTE);
  await timer();
  assert.equal(checkRow(club).reason, "payment_not_at_processor");
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 1);
});

test("a payment row is deleted: no figure", async (t) => {
  const { club, first, wait } = await paidClub(t);
  world.db.payments.splice(world.db.payments.indexOf(paymentRow(first)), 1);
  await assertHiddenEverywhere(club);
  wait(SETTLING_GRACE_MS + MINUTE);
  await timer();
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 1);
});

test("the processor call fails: no figure", async (t) => {
  const { club } = await paidClub(t);
  world.faults.processor = () => new Response(JSON.stringify({ error: { message: "placeholder outage" } }), { status: 500 });
  await timer();
  assert.equal(checkRow(club).status, "failed");
  assert.equal(checkRow(club).reason, "processor_down");
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 1);

  // When the processor can be read again the figure comes back, and it ties.
  world.faults.processor = null;
  await timer();
  assertTies((await clubView(club)).payout, club.stripe_account_id);
});

test("the processor call times out: no figure", async (t) => {
  const { club } = await paidClub(t);
  world.faults.processor = () => "timeout";
  await timer();
  assert.equal(checkRow(club).reason, "processor_down");
  await assertHiddenEverywhere(club);
});

test("the processor refuses the club's account: no figure, and staff are told which club", async (t) => {
  const { club } = await paidClub(t);
  world.faults.processor = () => new Response(JSON.stringify({ error: { message: "placeholder: no such destination" } }), { status: 400 });
  await timer();
  assert.equal(checkRow(club).reason, "processor_unreadable");
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0].subject, new RegExp(club.name));
});

test("the processor answers in a shape that is not a list: no figure", async (t) => {
  const { club } = await paidClub(t);
  for (const body of [{}, { object: "list", data: "nope", has_more: false }, { object: "list", data: [] }, null, []]) {
    world.faults.processor = () => new Response(JSON.stringify(body), { status: 200 });
    await timer();
    assert.equal(checkRow(club).reason, "processor_unreadable", JSON.stringify(body));
    await assertHiddenEverywhere(club);
  }
});

test("a new payment whose check could not run: no figure, not the old one", async (t) => {
  const { club } = await paidClub(t);
  // The processor cannot be read while the third family pays, so the payment
  // is recorded but neither its record nor the check can be completed.
  await call(worker, "POST", `/athlete/${club.teams[0].athletes[2].id}/checkout`, { body: { payment_type: "full" } });
  const pay = world.processor.createPayment(world.processor.openSession);
  world.faults.processor = () => new Response("{}", { status: 503 });
  const res = await sendWebhook(worker, world, "payment_intent.succeeded", world.processor.intentObject(pay));
  assert.equal(res.status, 200);
  assert.equal(world.db.payments.length, 3);
  assert.equal(paymentRow(pay).application_fee_cents, undefined);
  await assertHiddenEverywhere(club);
});

test("the check is older than the newest payment: no figure", async (t) => {
  const { club, wait } = await paidClub(t);
  const verified = { ...checkRow(club) };
  wait(10 * MINUTE);
  // A third payment arrives and is fully recorded, but the saved check is put
  // back to the one from before it, made to look as if it covered three.
  const pay = await payFor(worker, world, club.teams[0].athletes[2], "full");
  const rows = world.db.payments.filter((r) => r.status === "succeeded");
  Object.assign(checkRow(club), {
    status: "verified", reason: null, checked_at: verified.checked_at,
    payment_count: 3,
    charge_cents: rows.reduce((s, r) => s + r.charge_cents, 0),
    application_fee_cents: rows.reduce((s, r) => s + r.application_fee_cents, 0),
    club_net_cents: rows.reduce((s, r) => s + r.club_net_cents, 0),
    fingerprint: await payoutFingerprint(club.stripe_account_id, rows, world.db.athletes)
  });
  assert.ok(Date.parse(paymentRow(pay).created_at) > Date.parse(verified.checked_at));
  await assertHiddenEverywhere(club);
});

test("the last check is too old: no figure", async (t) => {
  const { club, wait } = await paidClub(t);
  wait(PAYOUT_CHECK_MAX_AGE_MS - MINUTE);
  assertTies((await clubView(club)).payout, club.stripe_account_id);
  wait(2 * MINUTE);
  // Nothing has changed, but nothing has confirmed that either.
  await assertHiddenEverywhere(club);
  await timer();
  assertTies((await clubView(club)).payout, club.stripe_account_id);
});

test("a check dated in the future is not trusted", async (t) => {
  const { club } = await paidClub(t);
  checkRow(club).checked_at = new Date(T0 + 24 * HOUR).toISOString();
  await assertHiddenEverywhere(club);
});

test("a payment row is missing its fee: no figure until the processor's own value is on it", async (t) => {
  const { club, first } = await paidClub(t);
  paymentRow(first).application_fee_cents = null;
  await assertHiddenEverywhere(club);
  // The check fills the gap from the processor, and only then is a figure shown.
  await timer();
  assert.equal(paymentRow(first).application_fee_cents, first.feeCents);
  assertTies((await clubView(club)).payout, club.stripe_account_id);
});

test("a payment row is missing its whole processor record: no figure until it is filled in", async (t) => {
  const { club, second } = await paidClub(t);
  const row = paymentRow(second);
  for (const col of ["stripe_charge_id", "stripe_transfer_id", "stripe_application_fee_id", "stripe_destination_account", "charge_cents", "application_fee_cents", "club_net_cents", "processor_recorded_at"]) row[col] = null;
  await assertHiddenEverywhere(club);
  await timer();
  assert.equal(row.club_net_cents, world.processor.net(second));
  assertTies((await clubView(club)).payout, club.stripe_account_id);
});

test("a processor record that cannot be written leaves no figure", async (t) => {
  const { club, second } = await paidClub(t);
  paymentRow(second).application_fee_cents = null;
  world.faults.db = ({ method, table }) => method === "PATCH" && table === "payments" ? new Response('{"message":"placeholder failure"}', { status: 500 }) : null;
  await timer();
  assert.equal(checkRow(club).status, "failed");
  assert.equal(checkRow(club).reason, "store_unavailable");
  await assertHiddenEverywhere(club);
});

test("an athlete is marked paid with no payment row: no figure", async (t) => {
  const { club } = await paidClub(t);
  world.db.athletes.find((a) => a.id === club.teams[0].athletes[2].id).payment_status = "paid_full";
  await assertHiddenEverywhere(club);
  await timer();
  assert.equal(checkRow(club).reason, "paid_without_payment");
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 1);
});

test("a payment exists for an athlete who is not marked paid: no figure", async (t) => {
  const { club, wait } = await paidClub(t);
  world.db.athletes[0].payment_status = "unpaid";
  await assertHiddenEverywhere(club);
  // Minutes after the payment this can be a webhook still retrying, so it is
  // hidden without an email.
  await timer();
  assert.equal(checkRow(club).reason, "settling");
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 0);
  // Still so later: now it is reported.
  wait(SETTLING_GRACE_MS + MINUTE);
  await timer();
  assert.equal(checkRow(club).reason, "payment_without_paid_status");
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 1);
});

test("the same payment recorded twice: no figure", async (t) => {
  const { club, first } = await paidClub(t);
  world.db.payments.push({ ...paymentRow(first), id: "payments_copy", stripe_event_id: "evt_copy" });
  await assertHiddenEverywhere(club);
  await timer();
  assert.equal(checkRow(club).reason, "duplicate_payment_rows");
  await assertHiddenEverywhere(club);
});

test("the club's processor account changes: no figure", async (t) => {
  const { club } = await paidClub(t);
  world.db.clubs[0].stripe_account_id = "acct_placeholderother";
  await assertHiddenEverywhere(club);
  await timer();
  await assertHiddenEverywhere(club);
});

test("a payment that went to a different account is never counted", async (t) => {
  const { club } = await paidClub(t);
  const athlete = club.teams[0].athletes[2];
  const stray = world.processor.createPayment({ account: "acct_placeholderother", amountCents: 100000, feeCents: 2930, athleteId: athlete.id });
  const res = await sendWebhook(worker, world, "payment_intent.succeeded", world.processor.intentObject(stray));
  assert.equal(res.status, 200);
  // Recorded as a payment, but with no processor record against this club.
  assert.equal(paymentRow(stray).club_net_cents, undefined);
  await assertHiddenEverywhere(club);
});

test("a saved check that claims a different total from the stored payments: no figure", async (t) => {
  const { club } = await paidClub(t);
  checkRow(club).club_net_cents += 1;
  await assertHiddenEverywhere(club);
});

test("a saved check marked failed is never shown, whatever totals it carries", async (t) => {
  const { club } = await paidClub(t);
  checkRow(club).status = "failed";
  await assertHiddenEverywhere(club);
});

test("the database cannot be read: no figure, and the rest of the page still loads", async (t) => {
  const { club } = await paidClub(t);
  for (const broken of ["payout_checks", "payments", "athletes"]) {
    world.faults.db = ({ method, table, url }) =>
      // For athletes, only the reads made for the payout figure: the club
      // page's by club, and the admin list's of every athlete.
      method === "GET" && table === broken && (table !== "athletes" || url.search.includes("club_id=") || url.search.includes("select=id,club_id"))
        ? new Response('{"message":"placeholder failure"}', { status: 500 })
        : null;
    const res = await call(worker, "GET", `/club/${club.code}`, { token: "token-staff" });
    assert.equal(res.status, 200, broken);
    assertNoFigure(res.body.club.payout);
    assert.equal(res.body.club.teams.length, 1, broken);
    assert.equal(res.body.stats.funded_athletes, 2, broken);
    const admin = await call(worker, "GET", "/admin/clubs", { token: "token-staff" });
    assert.equal(admin.status, 200, broken);
    assertNoFigure(admin.body.clubs[0].payout);
  }
});

// ---------------------------------------------------------------------------
// A database reply that is cut short or refused must never pass for a whole one.
// ---------------------------------------------------------------------------

test("the database returns only a few rows at a time: every read still gets all of them", async (t) => {
  begin(t);
  // The real API stops at a row limit and says nothing. Here it stops at 3.
  world.limits.maxRows = 3;
  const one = world.addClub({ teams: [{ dues_cents: 50000, athletes: 3 }] });
  const two = world.addClub({ teams: [{ dues_cents: 50000, athletes: 4 }, { dues_cents: 30000, athletes: 3 }] });
  for (const athlete of [...two.teams[0].athletes, ...two.teams[1].athletes]) await payFor(worker, world, athlete, "full");
  await payFor(worker, world, one.teams[0].athletes[0], "bnpl");
  await timer();

  // Nobody is told a payment is missing when it is only on the next page.
  assert.equal(alerts().length, 0);
  for (const club of [one, two]) {
    assert.equal(checkRow(club).status, "verified", club.code);
    assertTies((await clubView(club)).payout, club.stripe_account_id);
  }
  assert.equal((await clubView(two)).payout.payment_count, 7);
  const admin = await adminView();
  assertTies(admin.clubs.find((c) => c.id === two.id).payout, two.stripe_account_id);
  assert.equal(admin.totals.payout.club_net_cents, world.processor.payments.reduce((s, p) => s + world.processor.net(p), 0));
  // Each team's share is still right when its rows arrive across several pages.
  const teams = (await clubView(two)).teams;
  assert.equal(teams.reduce((s, team) => s + team.payout.club_net_cents, 0), world.processor.ledger(two.stripe_account_id));
});

test("a database reply with no row count is not trusted: no figure, and no false report of missing money", async (t) => {
  const { club } = await paidClub(t);
  // Replies to the payout reads are cut to one row and carry no count, so
  // there is no way to tell they are short.
  const real = world.fetch;
  world.fetch = async (input, init = {}) => {
    const res = await real(input, init);
    const url = new URL(typeof input === "string" ? input : input.url);
    if ((init.method || "GET") === "GET" && url.pathname === "/rest/v1/payments" && res.ok) {
      const rows = await res.clone().json();
      if (Array.isArray(rows) && rows.length > 1) return new Response(JSON.stringify(rows.slice(0, 1)), { status: 200 });
    }
    return res;
  };
  await assertHiddenEverywhere(club);
  await timer();
  // The check does not go ahead on a list it cannot prove is whole. It would
  // otherwise have told staff the processor has a payment PlayFund never recorded.
  assert.equal(checkRow(club).status, "failed");
  assert.equal(checkRow(club).reason, "db_unreadable");
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0].subject, /records cannot be read/);
  assert.doesNotMatch(alerts()[0].html, /has no payment record for/);
  await assertHiddenEverywhere(club);
});

test("a database reply that counts more rows than it ever delivers: no figure", async (t) => {
  const { club } = await paidClub(t);
  const real = world.fetch;
  world.fetch = async (input, init = {}) => {
    const res = await real(input, init);
    const url = new URL(typeof input === "string" ? input : input.url);
    if ((init.method || "GET") === "GET" && url.pathname === "/rest/v1/payments" && res.ok && String((init.headers || {}).Prefer).includes("count=exact")) {
      const rows = await res.clone().json();
      // Says there are three more rows than there are, on every page.
      return new Response(JSON.stringify(rows), { status: 206, headers: { "Content-Range": `0-${rows.length - 1}/${rows.length + 3}` } });
    }
    return res;
  };
  await assertHiddenEverywhere(club);
  await timer();
  assert.equal(checkRow(club).status, "failed");
  await assertHiddenEverywhere(club);
});

test("a big club: athlete ids go in bounded batches, never in one long URL", async (t) => {
  begin(t);
  const club = world.addClub({ teams: [{ dues_cents: 20000, athletes: 320 }] });
  const paying = club.teams[0].athletes.filter((_, i) => i % 40 === 0);
  for (const athlete of paying) await payFor(worker, world, athlete, "full");
  world.requests.length = 0;
  await timer();
  assert.ok(world.requests.length <= 50, `a run made ${world.requests.length} requests`);
  // 320 ids in one list would be about 12,000 characters. The stand-in
  // refuses anything over 8,000, as the real API would.
  const longest = Math.max(...world.requests.map((r) => r.length));
  assert.ok(longest < 5000, `a request URL was ${longest} characters long`);
  assert.equal(world.requests.filter((r) => r.includes("/rest/v1/payments?athlete_id=in.")).length, 4);
  assert.equal(checkRow(club).status, "verified");
  const view = await clubView(club);
  assertTies(view.payout, club.stripe_account_id);
  assert.equal(view.payout.payment_count, paying.length);
  assertTies((await adminView()).clubs[0].payout, club.stripe_account_id);
});

test("a URL the database refuses as too long: no figure", async (t) => {
  const { club } = await paidClub(t);
  // Short enough that even one batch of ids is refused.
  world.limits.maxUrl = 200;
  const res = await call(worker, "GET", `/club/${club.code}`, { token: "token-staff" });
  assert.equal(res.status, 200);
  assertNoFigure(res.body.club.payout);
  // A check that cannot read the club's records does not leave the earlier pass standing.
  await timer();
  assert.equal(checkRow(club).status, "failed");
  world.limits.maxUrl = 8000;
  assertNoFigure((await clubView(club)).payout);
  await timer();
  assertTies((await clubView(club)).payout, club.stripe_account_id);
});

test("clubs too large to share a run are taken a few at a time, and none is skipped for ever", async (t) => {
  const { wait } = begin(t);
  const clubs = [];
  for (let i = 0; i < 12; i++) clubs.push(world.addClub({ teams: [{ dues_cents: 20000, athletes: 150 }] }));
  let runs = 0;
  while (world.db.payout_checks.length < clubs.length) {
    world.requests.length = 0;
    await timer();
    assert.ok(world.requests.length <= 50, `a run made ${world.requests.length} requests`);
    runs++;
    wait(RUN_EVERY);
    assert.ok(runs < 6, "the timer is not getting round the clubs");
  }
  assert.ok(runs > 1, "twelve clubs of 150 athletes should not fit in one run");
  assert.ok(runs * RUN_EVERY * 2 <= PAYOUT_CHECK_MAX_AGE_MS);
  assert.equal(world.db.payout_checks.every((r) => r.status === "verified"), true);
  assert.equal(alerts().length, 0);
});

test("one club too large for a run by itself is shown no figure, and staff are told which", async (t) => {
  begin(t);
  const small = world.addClub({ teams: [{ dues_cents: 20000, athletes: 2 }] });
  const huge = world.addClub({ teams: [{ dues_cents: 20000, athletes: 4000 }] });
  await timer();
  await timer();
  assert.ok(world.requests.length > 0);
  assert.equal(checkRow(small).status, "verified");
  assert.equal(checkRow(huge).status, "failed");
  assert.equal(checkRow(huge).reason, "too_many_payments");
  assertNoFigure((await clubView(huge)).payout);
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0].subject, new RegExp(huge.name));
});

// ---------------------------------------------------------------------------
// The migration has not been applied yet.
// ---------------------------------------------------------------------------

test("the new columns do not exist: payments are still recorded exactly as before, and no figure is shown", async (t) => {
  begin(t, { migrated: false });
  const club = world.addClub({ teams: [{ dues_cents: 100000, athletes: 2 }] });
  const [a, b] = club.teams[0].athletes;

  const card = await payFor(worker, world, a, "full");
  assert.equal(card.webhookStatus, 200);
  const klarna = await payFor(worker, world, b, "bnpl");
  assert.equal(klarna.webhookStatus, 200);

  // The payment rows are there, with the same columns the Worker wrote before.
  assert.equal(world.db.payments.length, 2);
  assert.deepEqual(Object.keys(world.db.payments[0]).sort(), [
    "amount_cents", "athlete_id", "created_at", "id", "notes", "payment_method", "status", "stripe_event_id", "stripe_payment_intent"
  ]);
  assert.equal(world.db.payments[0].amount_cents, 100000);
  assert.equal(world.db.payments[0].status, "succeeded");
  // The athletes are marked paid, and the families got their receipts.
  assert.equal(world.db.athletes[0].payment_status, "paid_full");
  assert.equal(world.db.athletes[1].payment_status, "bnpl_complete");
  assert.equal(world.mail.filter((m) => /^Receipt:/.test(m.subject)).length, 2);

  // The dashboard still loads, with the roster, and with no figure.
  const view = await clubView(club);
  assert.equal(view.teams[0].athletes.length, 2);
  assertNoFigure(view.payout);
  assertNoFigure(view.teams[0].payout);
  const admin = await adminView();
  assert.equal(admin.clubs.length, 1);
  assert.equal(admin.clubs[0].funded_count, 2);
  assertNoFigure(admin.clubs[0].payout);
  assert.equal(admin.totals.payout.verified, false);

  // Staff are told once that checks cannot run, not once per payment or per run.
  await timer();
  await timer();
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0].subject, /payout checks cannot be saved/);
  assert.match(alerts()[0].html, /migrations\/2026-11-21-payout-tie-out\.sql/);

  // Once the migration is applied, the next check fills the records in from
  // the processor and the figure appears, tied to the cent.
  world.migrated = true;
  await timer();
  assert.equal(world.db.payments[0].application_fee_cents, card.feeCents);
  assertTies((await clubView(club)).payout, club.stripe_account_id);
});

// ---------------------------------------------------------------------------
// Things happening at the same time.
// ---------------------------------------------------------------------------

// Each of these changes the processor and tells the Worker with an event.
const ADVERSE = [
  ["charge.refunded", "refund", (p) => world.processor.refund(p, 100000, { reverseTransfer: true }), (p) => world.processor.chargeObject(p)],
  ["charge.dispute.created", "dispute", (p) => { p.disputed = true; }, (p) => ({ id: "dp_test0001", object: "dispute", charge: p.chargeId, payment_intent: p.intentId, amount: p.amountCents })],
  ["transfer.reversed", "transfer_reversed", (p) => { p.reversedCents = 100000; }, (p) => world.processor.transferObject(p)],
  ["application_fee.refunded", "fee_refunded", (p) => { p.feeRefundedCents = p.feeCents; }, (p) => world.processor.feeObject(p)]
];

test("a refund reported while a check is running: the check cannot put the old figure back", async (t) => {
  for (const [type, reason, change, object] of ADVERSE) {
    for (const start of ["timer", "staff", "payment"]) {
      const { club, first } = await paidClub(t);
      const where = `${type} during a check started by ${start}`;
      // The check has the processor's list in hand, from before the change.
      // Then the change happens and its event is handled, all before the
      // check finishes.
      world.whileListing = async () => {
        change(first);
        const res = await sendWebhook(worker, world, type, object(first));
        assert.equal(res.status, 200, where);
        assert.equal(checkRow(club).reason, reason, where);
      };
      if (start === "timer") await timer();
      else if (start === "staff") {
        // Staff are told their check was overtaken, not that it passed.
        const res = await call(worker, "POST", `/admin/clubs/${club.id}/payout-check`, { token: "token-staff" });
        assert.equal(res.body.payout_check.status, "superseded", where);
        assertNoFigure(res.body.payout);
      } else await payFor(worker, world, club.teams[0].athletes[2], "full");
      assert.equal(world.whileListing, null, `${where}: the event was never delivered`);

      // The finished check did not replace the event's result.
      assert.equal(checkRow(club).status, "failed", where);
      assert.equal(checkRow(club).reason, reason, where);
      await assertHiddenEverywhere(club);
      assert.equal(alerts().length, 1, where);
      // And it did not record a "passing again", which would re-send the alert later.
      assert.equal(world.db.events.filter((e) => e.event_name === "payout_check_ok").length, 0, where);
      t.mock.timers.reset();
    }
  }
});

test("after a refund is reported, a check cannot bring the figure back even if the processor still shows the old state", async (t) => {
  const { club, first, wait } = await paidClub(t);
  // The event arrives, but the processor's list has not caught up with it yet.
  const res = await sendWebhook(worker, world, "charge.refunded", world.processor.chargeObject(first));
  assert.equal(res.status, 200);
  await assertHiddenEverywhere(club);

  // Checks that start inside the hold are dropped, whoever starts them.
  await timer();
  assert.equal(checkRow(club).reason, "refund");
  await call(worker, "POST", `/admin/clubs/${club.id}/payout-check`, { token: "token-staff" });
  assert.equal(checkRow(club).reason, "refund");
  await assertHiddenEverywhere(club);

  // By the time the hold has passed the processor shows the refund itself.
  world.processor.refund(first, 100000);
  wait(ADVERSE_EVENT_HOLD_MS + MINUTE);
  await timer();
  assert.equal(checkRow(club).status, "failed");
  assert.equal(checkRow(club).reason, "refund");
  await assertHiddenEverywhere(club);
  assert.equal(alerts().length, 1);
});

test("an older check that finishes after a newer one does not replace it", async (t) => {
  const { club, first, wait } = await paidClub(t);
  // An older check is holding the processor's list. While it waits, a refund
  // happens with no event, time passes, and a newer check sees the refund.
  world.whileListing = async () => {
    world.processor.refund(first, 100000);
    wait(MINUTE);
    await timer();
    assert.equal(checkRow(club).reason, "refund");
  };
  await timer();
  assert.equal(world.whileListing, null);
  assert.equal(checkRow(club).status, "failed");
  assert.equal(checkRow(club).reason, "refund");
  await assertHiddenEverywhere(club);
});

test("a new payment recorded while a check is running: no figure until a check has seen it", async (t) => {
  const { club } = await paidClub(t);
  const before = world.processor.ledger(club.stripe_account_id);
  // The timed check lists transfers, and in that gap a third family pays and
  // the webhook for it is fully handled, with its own check.
  world.whileListing = async () => {
    await payFor(worker, world, club.teams[0].athletes[2], "full");
  };
  await timer();
  const view = await clubView(club);
  // Either nothing is shown, or the figure includes the new payment. Never the old total.
  if (view.payout.verified) assertTies(view.payout, club.stripe_account_id);
  else assertNoFigure(view.payout);
  assert.notEqual(view.payout.club_net_cents, before);
  await timer();
  assertTies((await clubView(club)).payout, club.stripe_account_id);
});

test("two deliveries of one payment at the same moment: one row, and the second is sent again", async (t) => {
  begin(t);
  const club = world.addClub();
  const [athlete] = club.teams[0].athletes;
  const pay = await payFor(worker, world, athlete, "full");
  assert.equal(world.db.payments.length, 1);
  // The second delivery looks for an existing row a moment too early and
  // finds none, as it would if both arrived together.
  let lied = false;
  world.faults.db = ({ method, table, url }) => {
    if (!lied && method === "GET" && table === "payments" && url.search.includes("stripe_payment_intent=eq.")) {
      lied = true;
      return new Response("[]", { status: 200 });
    }
    return null;
  };
  const second = await sendWebhook(worker, world, "payment_intent.succeeded", world.processor.intentObject(pay), { eventId: "evt_the_other_delivery" });
  // The database's one-row rule refuses the insert, and the processor is asked to try again.
  assert.equal(second.status, 500);
  assert.equal(world.db.payments.length, 1);
  const again = await sendWebhook(worker, world, "payment_intent.succeeded", world.processor.intentObject(pay), { eventId: "evt_the_other_delivery" });
  assert.equal(again.status, 200);
  assert.equal(world.db.payments.length, 1);
  assert.equal(world.mail.filter((m) => /^Receipt:/.test(m.subject)).length, 1);
  assertTies((await clubView(club)).payout, club.stripe_account_id);
});

test("an athlete changes team: no figure until the split between teams has been checked again", async (t) => {
  begin(t);
  const club = world.addClub({ teams: [{ dues_cents: 100000, athletes: 1 }, { dues_cents: 100000, athletes: 1 }] });
  const [one, two] = club.teams;
  const pay = await payFor(worker, world, one.athletes[0], "full");
  assert.equal((await clubView(club)).teams.find((x) => x.id === one.id).payout.club_net_cents, world.processor.net(pay));

  world.db.athletes.find((a) => a.id === one.athletes[0].id).team_id = two.id;
  // Neither team's figure quietly moves.
  await assertHiddenEverywhere(club);

  await timer();
  const view = await clubView(club);
  assertTies(view.payout, club.stripe_account_id);
  // A team's figure is the payments of the athletes on that team.
  assert.equal(view.teams.find((x) => x.id === two.id).payout.club_net_cents, world.processor.net(pay));
  assert.equal(view.teams.find((x) => x.id === one.id).payout.club_net_cents, 0);
});

test("a club that loses its processor account after being checked is not shown a zero", async (t) => {
  const { club } = await paidClub(t);
  // The account id is cleared and the payment rows go with their athletes.
  world.db.clubs[0].stripe_account_id = null;
  world.db.payments.length = 0;
  for (const a of world.db.athletes) a.payment_status = "unpaid";
  await assertHiddenEverywhere(club);
  await timer();
  await assertHiddenEverywhere(club);
});

test("when the processor cannot be reached, staff get one email, not one per club", async (t) => {
  const { wait } = begin(t);
  for (let i = 0; i < 8; i++) world.addClub({ teams: [{ dues_cents: 100000, athletes: 1 }] });
  await timer();
  assert.equal((await adminView()).totals.payout.verified, true);

  world.faults.processor = () => new Response("{}", { status: 503 });
  wait(RUN_EVERY);
  await timer();
  assert.equal(world.db.payout_checks.filter((r) => r.reason === "processor_down").length, 8);
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0].subject, /the payment processor cannot be reached/);
  assert.equal((await adminView()).totals.payout.verified, false);

  // Back again: figures return. A second outage later is reported again.
  world.faults.processor = null;
  wait(RUN_EVERY);
  await timer();
  assert.equal((await adminView()).totals.payout.verified, true);
  world.faults.processor = () => "timeout";
  wait(RUN_EVERY);
  await timer();
  assert.equal(alerts().length, 2);
});

// ---------------------------------------------------------------------------
// Never lose a payment record.
// ---------------------------------------------------------------------------

test("the payment insert fails: the processor is asked to send it again, and the retry records everything once", async (t) => {
  begin(t);
  const club = world.addClub();
  const [athlete] = club.teams[0].athletes;
  await call(worker, "POST", `/athlete/${athlete.id}/checkout`, { body: { payment_type: "full" } });
  const pay = world.processor.createPayment(world.processor.openSession);
  const event = world.processor.intentObject(pay);

  world.faults.db = ({ method, table }) => method === "POST" && table === "payments" ? new Response('{"message":"placeholder failure"}', { status: 500 }) : null;
  const failed = await sendWebhook(worker, world, "payment_intent.succeeded", event, { eventId: "evt_same" });
  assert.equal(failed.status, 500);
  assert.equal(world.db.payments.length, 0);
  // Nothing was half done: no status, no receipt.
  assert.equal(world.db.athletes[0].payment_status, "unpaid");
  assert.equal(world.mail.length, 0);

  world.faults.db = null;
  const retried = await sendWebhook(worker, world, "payment_intent.succeeded", event, { eventId: "evt_same" });
  assert.equal(retried.status, 200);
  assert.equal(world.db.payments.length, 1);
  assert.equal(world.db.athletes[0].payment_status, "paid_full");
  assert.equal(world.mail.filter((m) => /^Receipt:/.test(m.subject)).length, 1);
  assertTies((await clubView(club)).payout, club.stripe_account_id);
});

test("the status update fails: the payment is kept, and the retry finishes the job with one receipt", async (t) => {
  begin(t);
  const club = world.addClub();
  const [athlete] = club.teams[0].athletes;
  await call(worker, "POST", `/athlete/${athlete.id}/checkout`, { body: { payment_type: "full" } });
  const pay = world.processor.createPayment(world.processor.openSession);
  const event = world.processor.intentObject(pay);

  world.faults.db = ({ method, table }) => method === "PATCH" && table === "athletes" ? new Response('{"message":"placeholder failure"}', { status: 500 }) : null;
  const failed = await sendWebhook(worker, world, "payment_intent.succeeded", event, { eventId: "evt_same" });
  assert.equal(failed.status, 500);
  assert.equal(world.db.payments.length, 1, "the payment row is kept");
  assert.equal(world.db.athletes[0].payment_status, "unpaid");
  assert.equal(world.mail.filter((m) => /^Receipt:/.test(m.subject)).length, 0);
  // A payment with no paid status behind it is not shown as a figure.
  await assertHiddenEverywhere(club);

  world.faults.db = null;
  const retried = await sendWebhook(worker, world, "payment_intent.succeeded", event, { eventId: "evt_same" });
  assert.equal(retried.status, 200);
  assert.equal(world.db.payments.length, 1);
  assert.equal(world.db.athletes[0].payment_status, "paid_full");
  assert.equal(world.mail.filter((m) => /^Receipt:/.test(m.subject)).length, 1);
  assertTies((await clubView(club)).payout, club.stripe_account_id);
});

test("the same event delivered twice: one payment row, one receipt, the same figure", async (t) => {
  const { club, first } = await paidClub(t);
  const before = (await clubView(club)).payout.club_net_cents;
  const again = await sendWebhook(worker, world, "payment_intent.succeeded", world.processor.intentObject(first), {
    eventId: paymentRow(first).stripe_event_id
  });
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { received: true, duplicate: true });
  assert.equal(world.db.payments.length, 2);
  assert.equal(world.mail.filter((m) => /^Receipt:/.test(m.subject)).length, 2);
  assert.equal((await clubView(club)).payout.club_net_cents, before);
});

test("one payment described by two separate events is still one payment row", async (t) => {
  const { club, first } = await paidClub(t);
  const again = await sendWebhook(worker, world, "payment_intent.succeeded", world.processor.intentObject(first), { eventId: "evt_a_second_event_for_it" });
  assert.equal(again.status, 200);
  assert.equal(world.db.payments.filter((r) => r.stripe_payment_intent === first.intentId).length, 1);
  assert.equal(world.mail.filter((m) => /^Receipt:/.test(m.subject)).length, 2);
  assertTies((await clubView(club)).payout, club.stripe_account_id);
});

test("an old event sent again does not change a status that is already set", async (t) => {
  const { club, first } = await paidClub(t);
  // Dues go up after the family paid in full.
  world.db.teams[0].dues_cents = 150000;
  await sendWebhook(worker, world, "payment_intent.succeeded", world.processor.intentObject(first), { eventId: paymentRow(first).stripe_event_id });
  assert.equal(world.db.athletes[0].payment_status, "paid_full");
  assertTies((await clubView(club)).payout, club.stripe_account_id);
});

test("a failed payment is recorded, and a failed write of it asks for a retry", async (t) => {
  begin(t);
  const club = world.addClub();
  const [athlete] = club.teams[0].athletes;
  const event = { id: "pi_testfailed", object: "payment_intent", amount: 100000, payment_method_types: ["card"], metadata: { athlete_id: athlete.id }, last_payment_error: { message: "placeholder decline" } };
  world.faults.db = ({ method, table }) => method === "POST" && table === "payments" ? new Response("{}", { status: 500 }) : null;
  assert.equal((await sendWebhook(worker, world, "payment_intent.payment_failed", event)).status, 500);
  world.faults.db = null;
  assert.equal((await sendWebhook(worker, world, "payment_intent.payment_failed", event)).status, 200);
  assert.equal(world.db.payments.length, 1);
  assert.equal(world.db.payments[0].status, "failed");
  // A failed payment is not money received.
  await timer();
  assert.equal((await clubView(club)).payout.club_net_cents, 0);
});

// ---------------------------------------------------------------------------
// Telling staff.
// ---------------------------------------------------------------------------

test("staff are told once per problem, and again if the same problem comes back later", async (t) => {
  const { club, wait } = await paidClub(t);
  const nextRun = async () => { wait(RUN_EVERY); await timer(); };
  world.faults.processor = () => new Response("{}", { status: 500 });
  await nextRun();
  await nextRun();
  await nextRun();
  assert.equal(alerts().length, 1);
  assert.deepEqual(alerts()[0].to, ["admin@playfundai.com"]);

  world.faults.processor = null;
  await nextRun();
  assertTies((await clubView(club)).payout, club.stripe_account_id);

  world.faults.processor = () => new Response("{}", { status: 500 });
  await nextRun();
  assert.equal(alerts().length, 2);
  await nextRun();
  assert.equal(alerts().length, 2);
});

test("a pass after a quiet reason writes no 'passing again' row", async (t) => {
  const { club } = await paidClub(t);
  const okRows = () => world.db.events.filter((e) => e.event_name === "payout_check_ok");
  // A third family pays and the webhook is late: hidden, quietly.
  const pay = await payFor(worker, world, club.teams[0].athletes[2], "full", { deliver: false });
  await timer();
  assert.equal(checkRow(club).reason, "settling");
  // The webhook arrives and the club passes again.
  await sendWebhook(worker, world, "payment_intent.succeeded", world.processor.intentObject(pay));
  assert.equal(checkRow(club).status, "verified");
  assertTies((await clubView(club)).payout, club.stripe_account_id);
  // Staff were never told anything, so there is nothing to mark as cleared.
  assert.equal(alerts().length, 0);
  assert.equal(okRows().length, 0);

  // Filling in a missing record from the processor does not write one either.
  world.db.payments.forEach((row) => { row.application_fee_cents = null; });
  await timer();
  assert.equal(checkRow(club).status, "verified");
  assert.equal(okRows().length, 0);
});

test("a pass after a quiet reason still clears an email that went out before it", async (t) => {
  const { club, wait } = await paidClub(t);
  const okRows = () => world.db.events.filter((e) => e.event_name === "payout_check_ok");
  const refuse = () => new Response(JSON.stringify({ error: { message: "placeholder: no such destination" } }), { status: 400 });
  // A real problem: staff are told.
  world.faults.processor = refuse;
  wait(RUN_EVERY);
  await timer();
  assert.equal(checkRow(club).reason, "processor_unreadable");
  assert.equal(alerts().length, 1);
  // It clears, but the next check lands on a quiet reason before any pass.
  world.faults.processor = null;
  const pay = await payFor(worker, world, club.teams[0].athletes[2], "full", { deliver: false });
  wait(RUN_EVERY);
  await timer();
  assert.equal(checkRow(club).reason, "settling");
  assert.equal(okRows().length, 0);
  // Then it passes. The earlier email is marked as cleared, once.
  wait(RUN_EVERY);
  await sendWebhook(worker, world, "payment_intent.succeeded", world.processor.intentObject(pay));
  assert.equal(checkRow(club).status, "verified");
  assert.equal(okRows().length, 1);
  // So the same problem coming back is reported again.
  world.faults.processor = refuse;
  wait(RUN_EVERY);
  await timer();
  assert.equal(alerts().length, 2);
});

test("the alert says what was found, and is never sent to the club", async (t) => {
  const { club, first } = await paidClub(t);
  world.processor.refund(first, 100000);
  await timer();
  const [mail] = alerts();
  assert.deepEqual(mail.to, ["admin@playfundai.com"]);
  assert.match(mail.html, /shows a refund/);
  assert.match(mail.html, new RegExp(club.code));
  assert.match(mail.html, new RegExp(first.intentId));
  assert.doesNotMatch(mail.subject + mail.html, /—/, "no em dashes in anything staff read");
});

test("a page cannot write the events that record whether staff were told", async (t) => {
  const { club, first } = await paidClub(t);
  // Someone posts the "already alerted" marker through the public events endpoint.
  const posted = await call(worker, "POST", "/events", {
    origin: "https://www.playfundai.com",
    body: { event_name: "payout_check_alert", club_id: club.id, properties: { reason: "refund" } }
  });
  assert.equal(posted.status, 200);
  assert.equal(world.db.events.filter((e) => e.event_name.startsWith("payout_check")).length, 0);
  world.processor.refund(first, 100000);
  await timer();
  assert.equal(alerts().length, 1);
});

// ---------------------------------------------------------------------------
// Who is sent what.
// ---------------------------------------------------------------------------

test("a caller who is not signed in is sent no payout data at all", async (t) => {
  const { club } = await paidClub(t);
  const res = await call(worker, "GET", `/club/${club.code}`);
  assert.equal(res.status, 200);
  assert.equal("payout" in res.body.club, false);
  assert.equal("stats" in res.body, false);
  assert.equal("fee_bps" in res.body.club, false);
  for (const team of res.body.club.teams) assert.equal("payout" in team, false);
});

test("a club is never sent the reason a check failed", async (t) => {
  const { club, first } = await paidClub(t);
  world.processor.refund(first, 100000);
  await timer();
  const res = await call(worker, "GET", `/club/${club.code}`, { token: club.token });
  assert.doesNotMatch(JSON.stringify(res.body), /refund|payout_check|reason/);
  // Staff are.
  const admin = await adminView();
  assert.equal(admin.clubs[0].payout_check.status, "failed");
  assert.equal(admin.clubs[0].payout_check.reason, "refund");
  assert.match(admin.clubs[0].payout_check.message, /shows a refund/);
});

test("running a check on request is for PlayFund staff only", async (t) => {
  const { club, first } = await paidClub(t);
  world.processor.refund(first, 100000);
  for (const token of [undefined, club.token, "not-a-token"]) {
    const res = await call(worker, "POST", `/admin/clubs/${club.id}/payout-check`, { token });
    assert.ok([401, 403].includes(res.status), String(token));
  }
  // Refused callers start nothing: the refund is still unknown to the app.
  assert.equal(checkRow(club).status, "verified");
  const res = await call(worker, "POST", `/admin/clubs/${club.id}/payout-check`, { token: "token-staff" });
  assert.equal(res.status, 200);
  assert.equal(res.body.payout_check.status, "failed");
  assert.equal(res.body.payout_check.reason, "refund");
  assertNoFigure(res.body.payout);
  await assertHiddenEverywhere(club);
});

// ---------------------------------------------------------------------------
// Zero, teams, and totals.
// ---------------------------------------------------------------------------

test("a club with no processor account and no payments is shown a true zero", async (t) => {
  begin(t);
  const club = world.addClub({ account: null });
  assert.deepEqual((await clubView(club)).payout, { verified: true, club_net_cents: 0, charge_cents: 0, payment_count: 0, checked_at: null });
  // But not if its own records say someone has paid.
  world.db.athletes[0].payment_status = "paid_full";
  assertNoFigure((await clubView(club)).payout);
});

test("a club with an account is shown nothing until it has been checked", async (t) => {
  begin(t);
  const club = world.addClub();
  assertNoFigure((await clubView(club)).payout);
  await timer();
  assert.equal((await clubView(club)).payout.club_net_cents, 0);
  assert.equal((await clubView(club)).payout.verified, true);
});

test("a club that has just connected its account gets its first check from the status call, once", async (t) => {
  begin(t);
  const club = world.addClub();
  assertNoFigure((await clubView(club)).payout);
  await call(worker, "GET", `/club/${club.id}/stripe-status`);
  assert.equal(checkRow(club).status, "verified");
  assert.equal((await clubView(club)).payout.verified, true);
  // Later calls do not go back to the processor's transfer list.
  world.requests.length = 0;
  await call(worker, "GET", `/club/${club.id}/stripe-status`);
  assert.equal(world.requests.filter((r) => r.includes("/v1/transfers")).length, 0);
});

test("each team's figure is its own payments, and the teams add up to the club", async (t) => {
  begin(t);
  const club = world.addClub({ teams: [{ dues_cents: 100000, athletes: 2 }, { dues_cents: 45000, athletes: 2 }, { dues_cents: 30000, athletes: 1 }] });
  const [t1, t2] = club.teams;
  const p1 = await payFor(worker, world, t1.athletes[0], "full");
  const p2 = await payFor(worker, world, t1.athletes[1], "bnpl");
  const p3 = await payFor(worker, world, t2.athletes[0], "full");
  const view = await clubView(club);
  assertTies(view.payout, club.stripe_account_id);
  const byId = Object.fromEntries(view.teams.map((team) => [team.id, team.payout]));
  assert.equal(byId[t1.id].club_net_cents, world.processor.net(p1) + world.processor.net(p2));
  assert.equal(byId[t2.id].club_net_cents, world.processor.net(p3));
  // A team nobody has paid on, in a checked club, is a true zero.
  assert.deepEqual(byId[club.teams[2].id], { verified: true, club_net_cents: 0, charge_cents: 0, payment_count: 0 });
  assert.equal(view.teams.reduce((s, team) => s + team.payout.club_net_cents, 0), view.payout.club_net_cents);

  // A team created now comes back with its own figure, so the app can open it.
  const made = await call(worker, "POST", "/team", { token: club.token, body: { club_id: club.id, name: "New Team", dues_cents: 50000, dues_due_date: "2027-02-01" } });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.team.payout, { verified: true, club_net_cents: 0, charge_cents: 0, payment_count: 0 });
});

test("the total across clubs exists only when every club's figure does", async (t) => {
  begin(t);
  const one = world.addClub();
  const two = world.addClub({ fee_bps: 650 });
  const none = world.addClub({ account: null });
  const a = await payFor(worker, world, one.teams[0].athletes[0], "full");
  await payFor(worker, world, two.teams[0].athletes[0], "bnpl");
  await payFor(worker, world, two.teams[0].athletes[1], "full");

  let admin = await adminView();
  const everything = world.processor.payments.reduce((s, p) => s + world.processor.net(p), 0);
  assert.deepEqual(admin.totals.payout, {
    verified: true,
    club_net_cents: everything,
    charge_cents: 300000,
    payment_count: 3
  });
  assert.equal(admin.clubs.find((c) => c.id === none.id).payout.club_net_cents, 0);
  for (const club of [one, two]) assertTies(admin.clubs.find((c) => c.id === club.id).payout, club.stripe_account_id);

  // One club's figure goes: so does the total. No partial sum is offered.
  world.processor.refund(a, 100000);
  await timer();
  admin = await adminView();
  assert.deepEqual(admin.totals.payout, { verified: false, unverified_clubs: 1 });
  assertNoFigure(admin.clubs.find((c) => c.id === one.id).payout);
  assertTies(admin.clubs.find((c) => c.id === two.id).payout, two.stripe_account_id);
});

test("no response carries the old estimated fields", async (t) => {
  const { club } = await paidClub(t);
  const text = JSON.stringify([await clubView(club), await adminView()]);
  assert.doesNotMatch(text, /fronted_cents|collected_cents/);
});

// ---------------------------------------------------------------------------
// The timed run and the limits it has to stay inside.
// ---------------------------------------------------------------------------

test("every schedule in wrangler.toml is one the Worker knows, and the other way round", () => {
  const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
  const crons = JSON.parse(toml.match(/^crons\s*=\s*(\[.*\])/m)[1]);
  const known = {
    PAYOUT_CHECK_CRON,
    WEEKLY_METRICS_CRON: source.match(/WEEKLY_METRICS_CRON = "([^"]+)"/)[1],
    DAILY_REMINDERS_CRON: source.match(/DAILY_REMINDERS_CRON = "([^"]+)"/)[1]
  };
  // The runtime hands back the expression exactly as written in the file, so
  // the two lists have to match character for character.
  assert.deepEqual([...crons].sort(), Object.values(known).sort());
  assert.equal(new Set(crons).size, 3);
});

test("each schedule runs its own job, and a schedule the Worker does not know runs nothing", async (t) => {
  begin(t);
  world.addClub();
  const made = () => world.requests.join("\n");
  const reminders = /\/rest\/v1\/clubs\?reminders_enabled=eq\.true/;
  const digest = /\/rest\/v1\/rpc\/weekly_metrics/;
  const checks = /\/v1\/transfers\?/;

  // The daily reminder sweep, and only that.
  world.requests.length = 0;
  await runTimer(worker, "0 13 * * *");
  assert.match(made(), reminders);
  assert.doesNotMatch(made(), digest);
  assert.doesNotMatch(made(), checks);
  assert.equal(world.db.payout_checks.length, 0, "the reminder schedule does not run payout checks");

  // The Monday digest, and only that.
  world.requests.length = 0;
  await runTimer(worker, "0 14 * * 1");
  assert.match(made(), digest);
  assert.doesNotMatch(made(), reminders);
  assert.doesNotMatch(made(), checks);
  assert.equal(world.mail.filter((m) => /^PlayFund weekly metrics/.test(m.subject)).length, 1);

  // The payout check, and only that.
  world.requests.length = 0;
  await timer();
  assert.match(made(), checks);
  assert.doesNotMatch(made(), reminders);
  assert.doesNotMatch(made(), digest);
  assert.equal(world.db.payout_checks.length, 1);

  // None of the three known schedules produces the "unknown schedule" email.
  const unknownMail = () => world.mail.filter((m) => /a timer fired that the Worker does not recognise/.test(m.subject));
  assert.equal(unknownMail().length, 0);
  assert.equal(world.db.events.filter((e) => e.event_name === "unknown_schedule_alert").length, 0);

  // Anything else: none of the three jobs is run, and it is said out loud,
  // in the log and once in an email to staff. It used to fall through to the
  // reminder emails.
  const unknown = ["*/5 * * * *", "0 12 * * *", "0 13 * * * ", " 0 13 * * *", "0 13 * * 1", "", undefined, null];
  for (const [i, cron] of unknown.entries()) {
    for (const firing of ["first", "second", "third"]) {
      world.requests.length = 0;
      logged.length = 0;
      await runTimer(worker, cron);
      const where = `"${cron}", ${firing} firing`;
      assert.doesNotMatch(made(), reminders, where);
      assert.doesNotMatch(made(), digest, where);
      assert.doesNotMatch(made(), checks, where);
      assert.match(logged.join("\n"), /matches no schedule/, where);
      // One email for this expression, however many times it fires.
      assert.equal(unknownMail().length, i + 1, where);
    }
    const mail = unknownMail()[i];
    assert.deepEqual(mail.to, ["admin@playfundai.com"]);
    // It names the expression that fired, and says that nothing was run.
    assert.ok(mail.html.includes(`<strong>${String(cron)}</strong>`), `"${cron}" is not named in the email`);
    assert.match(mail.html, /Nothing was run\./);
    assert.doesNotMatch(mail.subject + mail.html, /\u2014/, "no em dashes in anything staff read");
  }
  assert.equal(world.db.payout_checks.length, 1, "an unknown schedule ran payout checks");
  assert.equal(world.mail.filter((m) => /^PlayFund weekly metrics/.test(m.subject)).length, 1, "an unknown schedule sent the digest");

  // The known schedules still send no such email after all that.
  await runTimer(worker, "0 13 * * *");
  await runTimer(worker, "0 14 * * 1");
  await timer();
  assert.equal(unknownMail().length, unknown.length);
});

test("telling staff about an unknown schedule never throws, never repeats blindly, and cannot be silenced from a page", async (t) => {
  begin(t);
  const unknownMail = () => world.mail.filter((m) => /a timer fired that the Worker does not recognise/.test(m.subject));
  const rows = () => world.db.events.filter((e) => e.event_name === "unknown_schedule_alert");

  // The events table cannot be read: not knowing whether the email already
  // went, it is not sent, and the run still ends quietly.
  world.faults.db = ({ method, table }) => method === "GET" && table === "events" ? new Response('{"message":"placeholder failure"}', { status: 500 }) : null;
  await runTimer(worker, "*/7 * * * *");
  assert.equal(unknownMail().length, 0);
  world.faults.db = null;

  // The mail service refuses it: nothing is recorded, so the next firing tries again.
  const real = world.fetch;
  world.fetch = async (input, init = {}) => String(typeof input === "string" ? input : input.url) === "https://api.resend.com/emails"
    ? new Response('{"message":"placeholder refusal"}', { status: 422 })
    : real(input, init);
  await runTimer(worker, "*/7 * * * *");
  assert.equal(rows().length, 0);
  world.fetch = real;
  await runTimer(worker, "*/7 * * * *");
  assert.equal(unknownMail().length, 1);
  assert.equal(rows().length, 1);
  assert.deepEqual(rows()[0].properties, { cron: "*/7 * * * *" });

  // Everything it touches throws: the run still does not.
  world.fetch = async () => { throw new Error("placeholder network failure"); };
  await runTimer(worker, "*/9 * * * *");
  world.fetch = real;
  assert.equal(unknownMail().length, 1);

  // A page cannot write the "already told" row to keep staff from hearing about a schedule.
  const posted = await call(worker, "POST", "/events", {
    origin: "https://www.playfundai.com",
    body: { event_name: "unknown_schedule_alert", properties: { cron: "*/9 * * * *" } }
  });
  assert.equal(posted.status, 200);
  assert.equal(rows().length, 1);
  await runTimer(worker, "*/9 * * * *");
  assert.equal(unknownMail().length, 2);
});

test("one timed run stays under the request limit and gets round every club in time", async (t) => {
  const { wait } = begin(t);
  const clubs = [];
  for (let i = 0; i < 30; i++) clubs.push(world.addClub({ teams: [{ dues_cents: 100000, athletes: 1 }] }));
  // Enough runs to reach every club, well inside the time a check is trusted for.
  let runs = 0;
  while (world.db.payout_checks.length < clubs.length) {
    world.requests.length = 0;
    await timer();
    assert.ok(world.requests.length <= 50, `a run made ${world.requests.length} requests`);
    runs++;
    wait(RUN_EVERY);
    assert.ok(runs < 10, "the timer is not getting round the clubs");
  }
  // With room to spare: a missed run or two must not make figures vanish.
  assert.ok(runs * RUN_EVERY * 2 <= PAYOUT_CHECK_MAX_AGE_MS, `${runs} runs is too slow for a ${PAYOUT_CHECK_MAX_AGE_MS / HOUR} hour limit`);
  // Kept up: after several more hours of runs, every club still has a figure.
  for (let i = 0; i < 12; i++) {
    world.requests.length = 0;
    await timer();
    assert.ok(world.requests.length <= 50);
    wait(RUN_EVERY);
  }
  const admin = await adminView();
  assert.equal(admin.totals.payout.verified, true);
});

test("a run with failing clubs still stays under the request limit", async (t) => {
  begin(t);
  for (let i = 0; i < 30; i++) world.addClub({ teams: [{ dues_cents: 100000, athletes: 1 }] });
  world.faults.processor = () => new Response("{}", { status: 500 });
  world.requests.length = 0;
  await timer();
  assert.ok(world.requests.length <= 50, `a run made ${world.requests.length} requests`);
});

test("a payment webhook stays under the request limit", async (t) => {
  begin(t);
  const club = world.addClub({ teams: [{ dues_cents: 100000, athletes: 40 }] });
  for (const athlete of club.teams[0].athletes.slice(0, 5)) {
    await call(worker, "POST", `/athlete/${athlete.id}/checkout`, { body: { payment_type: "full" } });
    const pay = world.processor.createPayment(world.processor.openSession);
    world.requests.length = 0;
    await sendWebhook(worker, world, "payment_intent.succeeded", world.processor.intentObject(pay));
    assert.ok(world.requests.length <= 50, `the webhook made ${world.requests.length} requests`);
  }
  assertTies((await clubView(club)).payout, club.stripe_account_id);
});

test("a club with more payments than one page is read to the end", async (t) => {
  begin(t);
  const club = world.addClub({ teams: [{ dues_cents: 20000, athletes: 150 }] });
  // Paid some time ago, recorded the old way, so the check has to read every
  // page and fill each record in.
  for (const athlete of club.teams[0].athletes) {
    const pay = world.processor.createPayment({ account: club.stripe_account_id, amountCents: 20000, feeCents: 610, athleteId: athlete.id, createdMs: T0 - 24 * HOUR });
    world.db.payments.push({
      id: world.nextId("payments"), created_at: new Date(T0 - 24 * HOUR).toISOString(), athlete_id: athlete.id,
      stripe_payment_intent: pay.intentId, stripe_event_id: world.nextId("evt"), amount_cents: 20000, status: "succeeded", payment_method: "card"
    });
    world.db.athletes.find((a) => a.id === athlete.id).payment_status = "paid_full";
  }
  // Filling in 150 records takes more than one run, and no figure shows meanwhile.
  let runs = 0;
  do {
    world.requests.length = 0;
    await timer();
    assert.ok(world.requests.length <= 50, `a run made ${world.requests.length} requests`);
    runs++;
    if (checkRow(club).status !== "verified") {
      assert.equal(checkRow(club).reason, "backfill_pending");
      assertNoFigure((await clubView(club)).payout);
    }
  } while (checkRow(club).status !== "verified" && runs < 20);
  assert.ok(runs > 1 && runs < 20);
  assert.equal(alerts().length, 0, "filling in old records is not a problem to report");
  const view = await clubView(club);
  assertTies(view.payout, club.stripe_account_id);
  assert.equal(view.payout.payment_count, 150);
  assert.equal(view.payout.club_net_cents, 150 * (20000 - 610));
});

test("a club with too many payments to read in one check is shown no figure", async (t) => {
  begin(t);
  const club = world.addClub({ teams: [{ dues_cents: 20000, athletes: 1 }] });
  for (let i = 0; i < 301; i++) {
    world.processor.createPayment({ account: club.stripe_account_id, amountCents: 20000, feeCents: 610, athleteId: club.teams[0].athletes[0].id, createdMs: T0 - 24 * HOUR });
  }
  await timer();
  assert.equal(checkRow(club).reason, "too_many_payments");
  assertNoFigure((await clubView(club)).payout);
});

// ---------------------------------------------------------------------------
// The property itself.
// ---------------------------------------------------------------------------

// A small seeded generator, so a failing run can be repeated exactly.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

test("whenever a figure is returned, it equals the processor's total for that scope to the cent", async (t) => {
  let shown = 0, shownNonZero = 0, hidden = 0;

  for (let seed = 1; seed <= 120; seed++) {
    t.mock.timers.reset();
    const { wait } = begin(t);
    const rand = seeded(seed);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const chance = (p) => rand() < p;

    const clubs = [];
    const clubCount = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < clubCount; i++) {
      clubs.push(world.addClub({
        fee_bps: pick([650, 800, 1000]),
        teams: Array.from({ length: 1 + Math.floor(rand() * 2) }, () => ({ dues_cents: pick([25000, 33333, 100000, 149999]), athletes: 1 + Math.floor(rand() * 3) }))
      }));
    }
    // The processor can change without the app being told. Until the next
    // check runs, the app cannot know, and that club is left out of the
    // comparison. Everything else is compared straight away.
    const unseen = new Set();
    const liveAthletes = (club) => world.db.athletes.filter((a) => a.club_id === club.id);
    const paymentsOf = (club) => world.processor.payments.filter((p) => p.account === club.stripe_account_id);

    async function compare(label) {
      const admin = await adminView();
      for (const club of clubs) {
        if (unseen.has(club.id)) continue;
        const account = world.db.clubs.find((c) => c.id === club.id).stripe_account_id;
        const view = await clubView(club);
        const adminRow = admin.clubs.find((c) => c.id === club.id);
        assert.deepEqual(adminRow.payout, view.payout, `${label}: the two screens disagree`);
        const where = `seed ${seed}, ${label}, ${club.code}`;
        if (view.payout.verified) {
          shown++;
          if (view.payout.club_net_cents > 0) shownNonZero++;
          assert.equal(view.payout.club_net_cents, world.processor.ledger(account), where);
          assert.equal(view.payout.charge_cents, world.processor.charged(account), where);
          assert.ok(paymentsOf(club).every(world.processor.clean), `${where}: a figure is shown over a refund, dispute or reversal`);
        } else {
          hidden++;
          assert.deepEqual(view.payout, NO_FIGURE, where);
        }
        for (const team of view.teams) {
          if (!view.payout.verified) {
            assert.deepEqual(team.payout, NO_FIGURE, where);
            continue;
          }
          const onTeam = new Set(world.db.athletes.filter((a) => a.team_id === team.id).map((a) => a.id));
          const teamTotal = paymentsOf(club).filter((p) => onTeam.has(p.athleteId)).reduce((s, p) => s + world.processor.net(p), 0);
          assert.equal(team.payout.club_net_cents, teamTotal, `${where}, ${team.id}`);
        }
      }
      if (admin.totals.payout.verified && unseen.size === 0) {
        const everything = world.processor.payments.reduce((s, p) => s + world.processor.net(p), 0);
        assert.equal(admin.totals.payout.club_net_cents, everything, `seed ${seed}, ${label}: total across clubs`);
      }
    }

    const steps = 8 + Math.floor(rand() * 14);
    for (let step = 0; step < steps; step++) {
      const club = pick(clubs);
      const dbClub = world.db.clubs.find((c) => c.id === club.id);
      const paid = paymentsOf(club);
      const rows = world.db.payments.filter((r) => r.status === "succeeded" && liveAthletes(club).some((a) => a.id === r.athlete_id));
      const unpaid = liveAthletes(club).filter((a) => a.payment_status === "unpaid");
      const move = pick([
        "pay", "pay", "pay", "pay", "missed", "rate", "dues", "refund", "dispute", "reversal", "fee_refund",
        "delete_row", "edit_fee", "edit_amount", "phantom", "mark_paid", "blank_fee", "wait", "long_wait",
        "timer", "timer", "move_athlete", "outage", "restore", "new_account", "mid_check", "mid_check"
      ]);
      let label = `step ${step} ${move}`;

      if (move === "pay" && unpaid.length && dbClub.stripe_account_id === club.stripe_account_id) {
        await payFor(worker, world, pick(unpaid), pick(["full", "bnpl"]));
      } else if (move === "missed" && unpaid.length && dbClub.stripe_account_id === club.stripe_account_id) {
        await payFor(worker, world, pick(unpaid), pick(["full", "bnpl"]), { deliver: false });
        unseen.add(club.id);
      } else if (move === "rate") {
        dbClub.fee_bps = pick([700, 900, 1500, 2000]);
      } else if (move === "dues") {
        pick(world.db.teams.filter((team) => team.club_id === club.id)).dues_cents = pick([10000, 50000, 200000]);
      } else if (["refund", "dispute", "reversal", "fee_refund"].includes(move) && paid.length) {
        const pay = pick(paid);
        const told = chance(0.5);
        let type, object;
        if (move === "refund") {
          world.processor.refund(pay, chance(0.5) ? pay.amountCents - pay.refundedCents : 1, { reverseTransfer: chance(0.5), refundFee: chance(0.3) });
          type = "charge.refunded"; object = world.processor.chargeObject(pay);
        } else if (move === "dispute") {
          pay.disputed = true;
          type = "charge.dispute.created"; object = { id: "dp_test", object: "dispute", charge: pay.chargeId, payment_intent: pay.intentId };
        } else if (move === "reversal") {
          pay.reversedCents = Math.min(pay.amountCents, pay.reversedCents + pick([1, 5000, pay.amountCents]));
          type = "transfer.reversed"; object = world.processor.transferObject(pay);
        } else {
          pay.feeRefundedCents = pay.feeCents;
          type = "application_fee.refunded"; object = world.processor.feeObject(pay);
        }
        label += told ? " (app told)" : " (app not told)";
        // A payment with no row here cannot be found from a dispute alone.
        if (told && (move !== "dispute" || rows.some((r) => r.stripe_payment_intent === pay.intentId))) {
          await sendWebhook(worker, world, type, object);
        } else {
          unseen.add(club.id);
        }
      } else if (move === "delete_row" && rows.length) {
        world.db.payments.splice(world.db.payments.indexOf(pick(rows)), 1);
      } else if (move === "edit_fee" && rows.length) {
        const row = pick(rows);
        if (row.application_fee_cents != null) { row.application_fee_cents -= 1; row.club_net_cents += 1; }
      } else if (move === "edit_amount" && rows.length) {
        const row = pick(rows);
        row.amount_cents += 5000;
        if (row.charge_cents != null) { row.charge_cents += 5000; row.club_net_cents += 5000; }
      } else if (move === "phantom" && unpaid.length) {
        const athlete = pick(unpaid);
        world.db.payments.push({
          id: world.nextId("payments"), created_at: new Date().toISOString(), athlete_id: athlete.id,
          stripe_payment_intent: world.nextId("pi_phantom"), stripe_event_id: world.nextId("evt"), amount_cents: 77700, status: "succeeded", payment_method: "card",
          stripe_charge_id: world.nextId("ch_phantom"), stripe_transfer_id: world.nextId("tr_phantom"), stripe_application_fee_id: world.nextId("fee_phantom"),
          stripe_destination_account: dbClub.stripe_account_id, charge_cents: 77700, application_fee_cents: 700, club_net_cents: 77000,
          processor_recorded_at: new Date().toISOString()
        });
        athlete.payment_status = "paid_full";
      } else if (move === "mark_paid" && unpaid.length) {
        pick(unpaid).payment_status = pick(["paid_full", "bnpl_active"]);
      } else if (move === "blank_fee" && rows.length) {
        pick(rows).application_fee_cents = null;
      } else if (move === "wait") {
        wait(Math.floor(rand() * 30) * MINUTE);
      } else if (move === "long_wait") {
        wait(PAYOUT_CHECK_MAX_AGE_MS + MINUTE);
      } else if (move === "timer") {
        await timer();
        // Every club gets its turn within three runs here, so run until all have.
        await timer();
        await timer();
        if (!world.faults.processor) unseen.clear();
      } else if (move === "mid_check" && paid.length) {
        // A refund that takes money back, reported while a check is running.
        const pay = pick(paid);
        let happened = false;
        world.whileListing = async () => {
          happened = true;
          world.processor.refund(pay, 1, { reverseTransfer: true });
          await sendWebhook(worker, world, "charge.refunded", world.processor.chargeObject(pay));
        };
        await timer();
        world.whileListing = null;
        label += happened ? " (reported mid-check)" : " (no check ran)";
      } else if (move === "move_athlete") {
        const teams = world.db.teams.filter((team) => team.club_id === club.id);
        pick(liveAthletes(club)).team_id = pick(teams).id;
      } else if (move === "outage") {
        world.faults.processor = () => (chance(0.5) ? "timeout" : new Response("{}", { status: 500 }));
      } else if (move === "restore") {
        world.faults.processor = null;
      } else if (move === "new_account") {
        // Its own new account: two clubs never share one here.
        dbClub.stripe_account_id = `acct_placeholdermoved${seed}n${clubs.indexOf(club)}s${step}`;
      }
      await compare(label);
    }
  }
  // The comparison above is not allowed to pass by never showing anything.
  assert.ok(shown > 300, `only ${shown} figures were shown`);
  assert.ok(shownNonZero > 100, `only ${shownNonZero} non-zero figures were shown`);
  assert.ok(hidden > 300, `only ${hidden} hidden figures were seen`);
});

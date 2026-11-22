// Checks that the Worker actually uses worker/fees.mjs where money is divided:
// the checkout it creates. What a club is then shown as received is a
// different matter, read back from the processor: see payouts.worker.test.mjs.
//
// Nothing here touches a real service. Every outgoing request the Worker makes
// is answered by the stand-in below, which is installed for the whole file and
// never removed, and which fails the test if the Worker asks for anything that
// was not expected. All keys and ids are made-up placeholders.
//
//   node --test            from the repo root, runs every *.test.mjs
//
// Needs Node 22.12 or newer, which can load index.js as a module directly.
//
// To run the same tests against a bundled build of the Worker, set
// WORKER_UNDER_TEST to the bundled file's path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const ENV = {
  SUPABASE_URL: "https://database.invalid",
  SUPABASE_SERVICE_KEY: "placeholder-not-a-key",
  SUPABASE_ANON_KEY: "placeholder-not-a-key",
  STRIPE_SECRET_KEY: "placeholder-not-a-key",
  PAY_IN_FULL_PMC_ID: "pmc_placeholder",
  MIN_FEE_BPS: "600",
  APP_URL: "https://app.invalid/app/"
};
const DB = `${ENV.SUPABASE_URL}/rest/v1`;
const PROCESSOR_CHECKOUT = "https://api.stripe.com/v1/checkout/sessions";

let routes = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  for (const [prefix, respond] of routes) {
    if (url.startsWith(prefix)) {
      const { status = 200, data } = respond({ url, method: init.method || "GET", body: init.body });
      return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    }
  }
  throw new Error(`The Worker tried to reach ${url}, which this test does not expect`);
};

const { default: worker } = await import(
  process.env.WORKER_UNDER_TEST ? pathToFileURL(process.env.WORKER_UNDER_TEST).href : "./index.js"
);

// One family starting checkout for one athlete. Returns the Worker's reply and
// every checkout the Worker asked the processor to create.
async function startCheckout({ paymentType, club = {}, team = {}, env = {} }) {
  const created = [];
  routes = [
    [`${DB}/athletes?`, () => ({ data: [{ id: "ath_1", name: "Test Athlete", team_id: "team_1", club_id: "club_1", approval_status: "approved" }] })],
    [`${DB}/teams?`, () => ({ data: [{ id: "team_1", name: "12U", dues_cents: 100000, ...team }] })],
    [`${DB}/clubs?`, () => ({ data: [{ id: "club_1", name: "Test Club", code: "TESTCLB", stripe_account_id: "acct_placeholder", fee_bps: 800, fee_agreed_at: "2026-11-01T00:00:00Z", ...club }] })],
    [PROCESSOR_CHECKOUT, ({ body }) => {
      created.push(new URLSearchParams(body));
      return { data: { client_secret: "placeholder_client_secret" } };
    }]
  ];
  const res = await worker.fetch(
    new Request("https://worker.invalid/athlete/ath_1/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment_type: paymentType })
    }),
    { ...ENV, ...env }
  );
  return { status: res.status, body: await res.json(), created };
}

const FEE = "payment_intent_data[application_fee_amount]";
const AMOUNT = "line_items[0][price_data][unit_amount]";
const DESTINATION = "payment_intent_data[transfer_data][destination]";

test("pay in full: the club is charged 2.9% + 30c, not its own rate", async () => {
  const { status, body, created } = await startCheckout({ paymentType: "full" });
  assert.equal(status, 200);
  assert.equal(body.client_secret, "placeholder_client_secret");
  assert.equal(created.length, 1);
  assert.equal(created[0].get(AMOUNT), "100000");
  assert.equal(created[0].get(FEE), "2930");
  assert.equal(created[0].get(DESTINATION), "acct_placeholder");
  // Still a card-only session: the pay-in-full configuration, and no method list.
  assert.equal(created[0].get("payment_method_configuration"), "pmc_placeholder");
  assert.equal(created[0].get("payment_method_types[0]"), null);
});

test("pay in full: the fee is the same whatever the club's rate is", async () => {
  for (const fee_bps of [650, 800, 1200, null]) {
    const { status, created } = await startCheckout({ paymentType: "full", club: { fee_bps } });
    assert.equal(status, 200, `fee_bps ${fee_bps}`);
    assert.equal(created[0].get(FEE), "2930", `fee_bps ${fee_bps}`);
  }
});

test("pay in full: the fee follows the dues amount", async () => {
  for (const [dues_cents, fee] of [[25000, "755"], [95000, "2785"], [200000, "5830"]]) {
    const { created } = await startCheckout({ paymentType: "full", team: { dues_cents } });
    assert.equal(created[0].get(AMOUNT), String(dues_cents));
    assert.equal(created[0].get(FEE), fee, `dues ${dues_cents}`);
  }
});

test("installments: the club is charged its own rate, as before", async () => {
  const standard = await startCheckout({ paymentType: "bnpl" });
  assert.equal(standard.status, 200);
  assert.equal(standard.created[0].get(AMOUNT), "100000");
  assert.equal(standard.created[0].get(FEE), "8000");
  assert.equal(standard.created[0].get(DESTINATION), "acct_placeholder");
  // Still an installment-only session.
  assert.equal(standard.created[0].get("payment_method_types[0]"), "klarna");
  assert.equal(standard.created[0].get("payment_method_configuration"), null);

  const discounted = await startCheckout({ paymentType: "bnpl", club: { fee_bps: 650 } });
  assert.equal(discounted.created[0].get(FEE), "6500");
});

test("a club under the minimum rate: installments blocked, pay in full allowed", async (t) => {
  t.mock.method(console, "error", () => {});
  const installments = await startCheckout({ paymentType: "bnpl", club: { fee_bps: 500 } });
  assert.equal(installments.status, 409);
  assert.equal(installments.created.length, 0);
  assert.match(installments.body.error, /Nothing has been charged/);
  // The app sends a parent to its "another way forward" screen, which offers
  // pay in full, only when it sees this reason. Without it the parent is left
  // on an error message.
  assert.equal(installments.body.reason, "bnpl_unavailable");

  const full = await startCheckout({ paymentType: "full", club: { fee_bps: 500 } });
  assert.equal(full.status, 200);
  assert.equal(full.created[0].get(FEE), "2930");
});

test("with no minimum configured, installments are not blocked (unchanged)", async () => {
  const { status, created } = await startCheckout({ paymentType: "bnpl", club: { fee_bps: 500 }, env: { MIN_FEE_BPS: undefined } });
  assert.equal(status, 200);
  assert.equal(created[0].get(FEE), "5000");
});

test("a club with no agreed rate cannot take either kind of payment (unchanged)", async () => {
  for (const paymentType of ["full", "bnpl"]) {
    const { status, created } = await startCheckout({ paymentType, club: { fee_agreed_at: null } });
    assert.equal(status, 409, paymentType);
    assert.equal(created.length, 0, paymentType);
  }
});

test("a payment type other than full or bnpl creates nothing (unchanged)", async () => {
  for (const paymentType of ["card", "klarna", "", undefined]) {
    const { status, created } = await startCheckout({ paymentType });
    assert.equal(status, 400, String(paymentType));
    assert.equal(created.length, 0, String(paymentType));
  }
});

test("a rate that cannot be charged stops installments before the processor is called", async (t) => {
  t.mock.method(console, "error", () => {});
  const { status, body, created } = await startCheckout({ paymentType: "bnpl", club: { fee_bps: 20000 } });
  assert.equal(status, 500);
  assert.equal(created.length, 0);
  assert.match(body.error, /Nothing has been charged/);
});

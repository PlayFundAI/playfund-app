// Checks what POST /athlete/:id/checkout asks the payment processor for: one
// payment method per session, the fee for that method, and the same
// destination charge as before.
//
// Nothing here touches a real service. Every outgoing request the Worker makes
// is answered by the stand-in below. A request the stand-in does not expect is
// refused and recorded, and each checkout below fails if any were recorded.
// All keys, ids and addresses are made-up placeholders.
//
//   node --test            from the repo root, runs every *.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const ENV = {
  SUPABASE_URL: "https://database.invalid",
  SUPABASE_SERVICE_KEY: "placeholder-not-a-key",
  STRIPE_SECRET_KEY: "placeholder-not-a-key",
  PAY_IN_FULL_PMC_ID: "pmc_placeholder",
  MIN_FEE_BPS: "605",
  APP_URL: "https://app.invalid/app/"
};
const DB = `${ENV.SUPABASE_URL}/rest/v1`;
const SESSIONS = "https://api.stripe.com/v1/checkout/sessions";

let routes = [];
let unexpected = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  for (const [prefix, respond] of routes) {
    if (url.startsWith(prefix)) {
      const { status = 200, data } = respond({ url, method: init.method || "GET", body: init.body });
      return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    }
  }
  unexpected.push(url);
  throw new Error(`The Worker tried to reach ${url}, which this test does not expect`);
};

const { default: worker } = await import("./index.js");

// One checkout request. Returns the Worker's reply and the form fields it
// sent to the processor, or null if it never got that far.
async function checkout(requestBody, { duesCents = 65000, club = {}, stripeReply } = {}) {
  let sent = null;
  unexpected = [];
  routes = [
    [`${DB}/athletes`, () => ({ data: [{ id: "ath_1", name: "Test Athlete", team_id: "team_1", club_id: "club_1", approval_status: "approved" }] })],
    [`${DB}/teams`, () => ({ data: [{ id: "team_1", name: "12U", dues_cents: duesCents }] })],
    [`${DB}/clubs`, () => ({ data: [{ id: "club_1", name: "Test Club", code: "TEST123", stripe_account_id: "acct_placeholder", fee_bps: 800, fee_agreed_at: "2026-01-01T00:00:00Z", ...club }] })],
    [SESSIONS, ({ body }) => {
      sent = Object.fromEntries(new URLSearchParams(body));
      return stripeReply || { data: { client_secret: "cs_placeholder_secret" } };
    }]
  ];
  const res = await worker.fetch(
    new Request("https://worker.invalid/athlete/ath_1/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    }),
    ENV
  );
  assert.deepEqual(unexpected, [], "the Worker made a request this test does not expect");
  return { status: res.status, body: await res.json(), sent };
}

// The destination charge is the same for every choice: the club's account is
// the destination, the parent is charged the dues and nothing more, and
// nothing is charged on the club's behalf.
function assertDestinationChargeUnchanged(sent, duesCents = 65000) {
  assert.equal(sent["payment_intent_data[transfer_data][destination]"], "acct_placeholder");
  assert.equal(sent["line_items[0][price_data][unit_amount]"], String(duesCents));
  assert.equal(sent["line_items[0][quantity]"], "1");
  assert.equal(Object.keys(sent).filter((k) => k.startsWith("line_items[")).some((k) => k.startsWith("line_items[1]")), false);
  assert.equal(Object.keys(sent).some((k) => k.includes("on_behalf_of")), false);
  assert.equal(sent.mode, "payment");
  assert.equal(sent.ui_mode, "embedded_page");
}

test("card: card configuration with bank shut out, and the card fee", async () => {
  const { status, body, sent } = await checkout({ payment_choice: "card" });

  assert.equal(status, 200);
  assert.equal(body.client_secret, "cs_placeholder_secret");
  assert.equal(sent.payment_method_configuration, "pmc_placeholder");
  assert.equal(sent["excluded_payment_method_types[0]"], "us_bank_account");
  assert.equal(Object.keys(sent).some((k) => k.startsWith("payment_method_types")), false);
  assert.equal(sent["payment_intent_data[application_fee_amount]"], "2565");
  assert.equal(sent["payment_intent_data[metadata][payment_choice]"], "card");
  assert.equal(sent["payment_intent_data[metadata][application_fee_cents]"], "2565");
  assertDestinationChargeUnchanged(sent);
});

test("bank: bank account only, and the bank fee", async () => {
  const { status, sent } = await checkout({ payment_choice: "bank" });

  assert.equal(status, 200);
  assert.equal(sent["payment_method_types[0]"], "us_bank_account");
  assert.equal(sent["payment_method_types[1]"], undefined);
  assert.equal(sent.payment_method_configuration, undefined);
  assert.equal(sent["payment_intent_data[application_fee_amount]"], "1150");
  assert.equal(sent["payment_intent_data[metadata][payment_choice]"], "bank");
  assertDestinationChargeUnchanged(sent);
});

test("klarna: Klarna only, at the club's own agreed rate", async () => {
  const { status, sent } = await checkout({ payment_choice: "klarna" });

  assert.equal(status, 200);
  assert.equal(sent["payment_method_types[0]"], "klarna");
  assert.equal(sent["payment_method_types[1]"], undefined);
  assert.equal(sent.payment_method_configuration, undefined);
  // 8% of $650, the rate on this club's record.
  assert.equal(sent["payment_intent_data[application_fee_amount]"], "5200");
  assertDestinationChargeUnchanged(sent);
});

test("klarna: a club at 10% is charged 10%", async () => {
  const { sent } = await checkout({ payment_choice: "klarna" }, { club: { fee_bps: 1000 } });
  assert.equal(sent["payment_intent_data[application_fee_amount]"], "6500");
});

test("the club's rate does not move the card or bank fee", async () => {
  const card = await checkout({ payment_choice: "card" }, { club: { fee_bps: 1000 } });
  const bank = await checkout({ payment_choice: "bank" }, { club: { fee_bps: 1000 } });
  assert.equal(card.sent["payment_intent_data[application_fee_amount]"], "2565");
  assert.equal(bank.sent["payment_intent_data[application_fee_amount]"], "1150");
});

test("klarna above the maximum is refused before the processor is asked", async () => {
  const { status, body, sent } = await checkout({ payment_choice: "klarna" }, { duesCents: 200001 });

  assert.equal(status, 409);
  assert.equal(body.reason, "bnpl_unavailable");
  assert.equal(sent, null);
});

test("klarna at exactly the maximum is allowed", async () => {
  const { status, sent } = await checkout({ payment_choice: "klarna" }, { duesCents: 200000 });
  assert.equal(status, 200);
  assert.equal(sent["payment_intent_data[application_fee_amount]"], "16000");
});

test("card and bank still work above the Klarna maximum", async () => {
  const card = await checkout({ payment_choice: "card" }, { duesCents: 250000 });
  const bank = await checkout({ payment_choice: "bank" }, { duesCents: 250000 });
  assert.equal(card.status, 200);
  assert.equal(card.sent["payment_intent_data[application_fee_amount]"], "9780");
  assert.equal(bank.status, 200);
  assert.equal(bank.sent["payment_intent_data[application_fee_amount]"], "3000");
});

test("the rate floor blocks Klarna for a club below it, and only Klarna", async () => {
  const club = { fee_bps: 500 };
  const klarna = await checkout({ payment_choice: "klarna" }, { club });
  const card = await checkout({ payment_choice: "card" }, { club });
  const bank = await checkout({ payment_choice: "bank" }, { club });

  assert.equal(klarna.status, 409);
  assert.equal(klarna.sent, null);
  assert.equal(card.status, 200);
  assert.equal(bank.status, 200);
});

test("no choice moves money until the club's rate has been agreed", async () => {
  for (const payment_choice of ["bank", "card", "klarna"]) {
    const { status, sent } = await checkout({ payment_choice }, { club: { fee_agreed_at: null } });
    assert.equal(status, 409, payment_choice);
    assert.equal(sent, null, payment_choice);
  }
});

test("the older names still work: full is card, bnpl is Klarna", async () => {
  const full = await checkout({ payment_type: "full" });
  const bnpl = await checkout({ payment_type: "bnpl" });
  assert.equal(full.sent.payment_method_configuration, "pmc_placeholder");
  assert.equal(full.sent["payment_intent_data[application_fee_amount]"], "2565");
  assert.equal(bnpl.sent["payment_method_types[0]"], "klarna");
});

test("an unknown choice is refused", async () => {
  const { status, sent } = await checkout({ payment_choice: "cash" });
  assert.equal(status, 400);
  assert.equal(sent, null);
});

test("a bank session the processor will not create says so, without its error text", async () => {
  const { status, body } = await checkout({ payment_choice: "bank" }, {
    stripeReply: { status: 400, data: { error: { type: "invalid_request_error", message: "placeholder processor detail" } } }
  });
  assert.equal(status, 409);
  assert.equal(body.reason, "bank_unavailable");
  assert.equal(JSON.stringify(body).includes("placeholder processor detail"), false);
});

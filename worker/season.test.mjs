// Checks the routes around a team's season: creating a team with its
// registration payment deadline, what a parent's page is told about paying by
// bank, and the expected payout date passed through from the processor.
//
// Nothing here touches a real service. Every outgoing request the Worker makes
// is answered by the stand-in below. A request the stand-in does not expect is
// refused and recorded, and each test fails if any were recorded.
// All keys, ids and addresses are made-up placeholders.
//
//   node --test            from the repo root, runs every *.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { todayInUS } from "./timing.js";

const ENV = {
  SUPABASE_URL: "https://database.invalid",
  SUPABASE_SERVICE_KEY: "placeholder-not-a-key",
  SUPABASE_ANON_KEY: "placeholder-not-a-key",
  STRIPE_SECRET_KEY: "placeholder-not-a-key"
};
const DB = `${ENV.SUPABASE_URL}/rest/v1`;
const AUTH_USER = `${ENV.SUPABASE_URL}/auth/v1/user`;
const INTENTS = "https://api.stripe.com/v1/payment_intents/";

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

const asClubAdmin = [
  [AUTH_USER, () => ({ data: { id: "user_1" } })],
  [`${DB}/user_profiles`, () => ({ data: [{ role: "club_admin", club_id: "club_1" }] })]
];

function daysFromToday(days) {
  const d = new Date(todayInUS() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// --- POST /team -------------------------------------------------------------

// One request to create a team. Returns the Worker's reply and the row it
// tried to store, or null if it refused before storing anything.
async function createTeam(fields) {
  let stored = null;
  unexpected = [];
  routes = [
    ...asClubAdmin,
    [`${DB}/teams`, ({ method, body }) => {
      assert.equal(method, "POST");
      stored = JSON.parse(body);
      return { status: 201, data: [{ id: "team_new", ...stored }] };
    }]
  ];
  const res = await worker.fetch(
    new Request("https://worker.invalid/team", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer placeholder" },
      body: JSON.stringify({ club_id: "club_1", name: "12U Travel", dues_cents: 65000, ...fields })
    }),
    ENV
  );
  assert.deepEqual(unexpected, [], "the Worker made a request this test does not expect");
  return { status: res.status, body: await res.json(), stored };
}

test("a team with no deadline is stored with the default, 7 days before the season", async () => {
  const { status, body, stored } = await createTeam({ season_start: "2027-03-07" });
  assert.equal(status, 201);
  assert.equal(stored.season_start, "2027-03-07");
  assert.equal(stored.dues_due_date, "2027-02-28");
  assert.equal(body.team.dues_due_date, "2027-02-28");
});

test("a deadline later than the default is refused and nothing is stored", async () => {
  const { status, body, stored } = await createTeam({ season_start: "2027-03-07", dues_due_date: "2027-03-01" });
  assert.equal(status, 400);
  assert.match(body.error, /no later than 2027-02-28/);
  assert.equal(stored, null);
});

test("a deadline earlier than the default is stored as chosen", async () => {
  const { status, stored } = await createTeam({ season_start: "2027-03-07", dues_due_date: "2027-02-01" });
  assert.equal(status, 201);
  assert.equal(stored.dues_due_date, "2027-02-01");
});

test("a team with no season start is refused and nothing is stored", async () => {
  const { status, body, stored } = await createTeam({ dues_due_date: "2027-02-01" });
  assert.equal(status, 400);
  assert.match(body.error, /season start date is required/);
  assert.equal(stored, null);
});

// --- GET /club/:code, as a parent sees it -----------------------------------

async function clubAsParent(team) {
  unexpected = [];
  routes = [
    [`${DB}/clubs`, () => ({ data: [{ id: "club_1", name: "Test Club", code: "TEST123", fee_bps: 800, fee_agreed_at: "2026-01-01T00:00:00Z" }] })],
    [`${DB}/teams`, () => ({ data: [{ id: "team_1", name: "12U", dues_cents: 65000, ...team }] })]
  ];
  const res = await worker.fetch(new Request("https://worker.invalid/club/TEST123"), ENV);
  assert.deepEqual(unexpected, [], "the Worker made a request this test does not expect");
  assert.equal(res.status, 200);
  return (await res.json()).club;
}

test("inside the bank cutoff window, the parent's page is told to show the bank note", async () => {
  // Three days out can never hold seven business days.
  const club = await clubAsParent({ season_start: daysFromToday(3), dues_due_date: daysFromToday(-4) });
  assert.equal(club.teams[0].bank_takes_longer, true);
  assert.equal(club.teams[0].payment_deadline, daysFromToday(-4));
});

test("well before the season, the bank note is off", async () => {
  // Thirty days out always holds at least twenty business days.
  const club = await clubAsParent({ season_start: daysFromToday(30), dues_due_date: daysFromToday(23) });
  assert.equal(club.teams[0].bank_takes_longer, false);
  assert.equal(club.teams[0].payment_deadline, daysFromToday(23));
  assert.equal(club.teams[0].latest_payment_deadline, daysFromToday(23));
});

test("the page is given the default so the add-team form can fill it in", async () => {
  const club = await clubAsParent({ season_start: daysFromToday(30), dues_due_date: daysFromToday(23) });
  assert.equal(club.default_deadline_days_before_season, 7);
  assert.equal(club.fee_bps, undefined, "the club's rate still does not reach a parent");
});

// --- the expected payout date -----------------------------------------------

const PAYMENT_ROWS = [
  { id: "pay_1", created_at: "2027-03-01T15:00:00Z", amount_cents: 65000, status: "succeeded", payment_method: "card", installment_number: null, athlete_id: "ath_1", stripe_payment_intent: "pi_one" },
  { id: "pay_2", created_at: "2027-02-27T15:00:00Z", amount_cents: 65000, status: "succeeded", payment_method: "card", installment_number: null, athlete_id: "ath_2", stripe_payment_intent: "pi_two" },
  { id: "pay_3", created_at: "2027-02-26T15:00:00Z", amount_cents: 65000, status: "failed", payment_method: "card", installment_number: null, athlete_id: "ath_3", stripe_payment_intent: "pi_three" }
];

async function clubPayments(query, intents) {
  const asked = [];
  unexpected = [];
  routes = [
    ...asClubAdmin,
    [`${DB}/teams`, () => ({ data: [{ id: "team_1", name: "12U" }] })],
    [`${DB}/athletes`, () => ({ data: [
      { id: "ath_1", name: "Athlete One", team_id: "team_1" },
      { id: "ath_2", name: "Athlete Two", team_id: "team_1" },
      { id: "ath_3", name: "Athlete Three", team_id: "team_1" }
    ] })],
    [`${DB}/payments`, () => ({ data: PAYMENT_ROWS })],
    [INTENTS, ({ url }) => {
      asked.push(url);
      const id = url.slice(INTENTS.length).split("?")[0];
      return intents[id] || { status: 404, data: { error: { message: "No such payment_intent" } } };
    }]
  ];
  const res = await worker.fetch(
    new Request(`https://worker.invalid/admin/clubs/club_1/payments${query}`, {
      headers: { "Authorization": "Bearer placeholder" }
    }),
    ENV
  );
  assert.deepEqual(unexpected, [], "the Worker made a request this test does not expect");
  assert.equal(res.status, 200);
  return { payments: (await res.json()).payments, asked };
}

// What the processor sends back for one payment, cut down to the part read.
function intentWithFunds(availableOn, status) {
  return { data: { latest_charge: { transfer: { destination_payment: { balance_transaction: { available_on: availableOn, status } } } } } };
}

test("each payment carries the date the processor gives, unchanged", async () => {
  const { payments, asked } = await clubPayments("?payout_dates=1", {
    // 2027-03-08 and 2027-03-03, at midnight UTC, as the processor sends them.
    pi_one: intentWithFunds(Date.UTC(2027, 2, 8) / 1000, "pending"),
    pi_two: intentWithFunds(Date.UTC(2027, 2, 3) / 1000, "available")
  });
  const byId = Object.fromEntries(payments.map((p) => [p.id, p]));
  assert.equal(byId.pay_1.expected_payout_date, "2027-03-08");
  assert.equal(byId.pay_1.payout_funds_status, "pending");
  assert.equal(byId.pay_2.expected_payout_date, "2027-03-03");
  assert.equal(byId.pay_2.payout_funds_status, "available");
  assert.equal(byId.pay_1.team_id, "team_1");

  // Only payments that succeeded are looked up, and each asks for the club's
  // side of the charge.
  assert.equal(asked.length, 2);
  assert.ok(asked.every((u) => u.includes("expand[]=latest_charge.transfer.destination_payment.balance_transaction")));
  assert.equal(byId.pay_3.expected_payout_date, undefined);
});

test("a payment the processor gives no date for shows none, and none is made up", async () => {
  const { payments } = await clubPayments("?payout_dates=1", {
    pi_one: { data: { latest_charge: { transfer: null } } }
    // pi_two is answered with an error.
  });
  for (const p of payments) {
    assert.equal(p.expected_payout_date, undefined);
    assert.equal(p.payout_funds_status, undefined);
  }
});

test("without the flag the processor is not asked at all", async () => {
  const { payments, asked } = await clubPayments("", {});
  assert.equal(asked.length, 0);
  assert.equal(payments.length, 3);
  assert.equal(payments[0].expected_payout_date, undefined);
});

test("the processor's payment id is not sent to the page", async () => {
  const { payments } = await clubPayments("", {});
  assert.ok(payments.every((p) => !("stripe_payment_intent" in p)));
});

// Checks what POST /club/register sends back, and what it puts in the welcome
// email.
//
// The account setup link belongs to the owner of the admin mailbox. It goes
// out in the welcome email and is not part of the reply.
//
// Nothing here touches a real service. Every outgoing request the Worker makes
// is answered by the stand-in below, which is installed for the whole file and
// never removed. A request the stand-in does not expect is refused and
// recorded, and each registration below fails if any were recorded. All keys,
// tokens and addresses are made-up placeholders.
//
//   node --test            from the repo root, runs every *.test.mjs
//
// Needs Node 22.12 or newer, which can load index.js as a module directly.
import { test } from "node:test";
import assert from "node:assert/strict";

const ENV = {
  SUPABASE_URL: "https://database.invalid",
  SUPABASE_SERVICE_KEY: "placeholder-not-a-key",
  RESEND_API_KEY: "placeholder-not-a-key",
  APP_URL: "https://app.invalid/app/"
};
const DB = `${ENV.SUPABASE_URL}/rest/v1`;
const SETUP_LINK = `${ENV.SUPABASE_URL}/auth/v1/admin/generate_link`;
const MAIL = "https://api.resend.com/emails";

const TOKEN = "placeholder-setup-token-0123456789";
const OTP = "placeholder-one-time-code";
const ACTION_LINK = "https://database.invalid/auth/v1/verify?token=placeholder-action-token";
const PIN = "placeholder-pin-value";
const ADMIN_EMAIL = "treasurer@club.invalid";

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

const FORM = {
  name: "Test Club",
  sport: "Basketball",
  city: "Testville",
  state: "TX",
  admin_email: ADMIN_EMAIL,
  admin_name: "Test Treasurer",
  athlete_count: 20,
  fees: [{ label: "Dues", amount: 500 }],
  teams: [{ name: "12U", age_group: "12U", dues: 500 }]
};

// One club registration. `setupLink` is what the account service answers when
// asked for a setup link. Returns the Worker's reply and every email it sent.
async function register({ setupLink, form = {} }) {
  const emails = [];
  unexpected = [];
  routes = [
    [`${DB}/clubs`, ({ method, body }) => {
      if (method === "GET") return { data: [] };
      // The stored row has columns the form never sent.
      return { status: 201, data: [{ ...JSON.parse(body), id: "club_1", pin_hash: PIN, fee_bps: 800, stripe_account_id: "acct_placeholder" }] };
    }],
    [`${DB}/teams`, ({ body }) => ({ status: 201, data: [{ id: "team_1", ...JSON.parse(body) }] })],
    [SETUP_LINK, () => setupLink],
    [`${DB}/user_profiles`, () => ({ status: 201, data: [{}] })],
    [`${DB}/suppressed_emails`, () => ({ data: [] })],
    [`${DB}/events`, () => ({ status: 201, data: [{}] })],
    [MAIL, ({ body }) => {
      emails.push(JSON.parse(body));
      return { data: { id: "email_placeholder" } };
    }]
  ];
  const res = await worker.fetch(
    new Request("https://worker.invalid/club/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...FORM, ...form })
    }),
    ENV
  );
  const text = await res.text();
  assert.deepEqual(unexpected, [], "the Worker made a request this test does not expect");
  return { status: res.status, text, body: JSON.parse(text), emails };
}

const LINK_MADE = {
  data: { id: "user_1", hashed_token: TOKEN, verification_type: "magiclink", email_otp: OTP, action_link: ACTION_LINK }
};
const LINK_FAILED = { status: 500, data: { error_code: "unexpected_failure", msg: "placeholder failure detail" } };

test("the reply is the club's id, name, code and teams, and a message", async () => {
  const { status, text, body } = await register({ setupLink: LINK_MADE });

  assert.equal(status, 201);
  assert.deepEqual(Object.keys(body).sort(), ["club", "message"]);
  assert.deepEqual(Object.keys(body.club).sort(), ["code", "id", "name", "teams"]);
  assert.equal(body.club.id, "club_1");
  assert.equal(body.club.name, "Test Club");
  assert.equal(body.club.teams.length, 1);
  assert.match(body.message, /Check your email/);

  for (const kept of [TOKEN, OTP, ACTION_LINK, "club_verify", "verify_type", PIN, "acct_placeholder", ADMIN_EMAIL]) {
    assert.ok(!text.includes(kept), `the reply must not contain "${kept}"`);
  }
});

test("the setup link reaches the admin's mailbox, and only that mailbox", async () => {
  const { emails } = await register({ setupLink: LINK_MADE });

  const welcome = emails.find((m) => m.to.includes(ADMIN_EMAIL));
  assert.ok(welcome, "a welcome email goes to the admin email");
  assert.deepEqual(welcome.to, [ADMIN_EMAIL]);
  assert.ok(
    welcome.html.includes(`href="${ENV.APP_URL}?club_verify=${TOKEN}&verify_type=magiclink"`),
    "the welcome email carries the setup link"
  );
  for (const m of emails) {
    if (m !== welcome) assert.ok(!JSON.stringify(m).includes(TOKEN), "no other email carries the token");
  }
});

test("a failed setup link is reported to the team, not in the reply", async () => {
  const { status, text, emails } = await register({ setupLink: LINK_FAILED });

  assert.equal(status, 201);
  for (const detail of ["invite_error", "generate_link", "unexpected_failure", "placeholder failure detail"]) {
    assert.ok(!text.includes(detail), `the reply must not contain "${detail}"`);
  }
  const alert = emails.find((m) => m.to.includes("admin@playfundai.com"));
  assert.ok(alert, "an internal alert is sent");
  assert.match(alert.subject, /^ACTION NEEDED/);
  assert.ok(alert.html.includes("generate_link 500"), "the internal alert names the failure");
});

test("what a registrant types is text in the welcome email, never markup", async () => {
  const typed = `<img src='https://elsewhere.invalid/?`;
  const { emails } = await register({
    setupLink: LINK_MADE,
    form: { name: `Club ${typed}`, sport: typed, city: typed, state: "", admin_name: `${typed} Treasurer` }
  });

  const welcome = emails.find((m) => m.to.includes(ADMIN_EMAIL));
  assert.ok(welcome, "a welcome email goes to the admin email");
  assert.ok(!welcome.html.includes("<img"), "typed text must not open a tag");
  assert.ok(!welcome.html.includes("src='https://elsewhere.invalid"), "typed text must not open an attribute");
  assert.ok(welcome.html.includes("&lt;img src=&#39;https://elsewhere.invalid/?"), "typed text is shown as text");
  assert.ok(
    welcome.html.includes(`href="${ENV.APP_URL}?club_verify=${TOKEN}&verify_type=magiclink"`),
    "the setup link is still intact"
  );
});

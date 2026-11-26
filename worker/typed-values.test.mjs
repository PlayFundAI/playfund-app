// Checks that what a person types stays text.
//
// Two layers, tested separately:
//
//   1. Every email the Worker sends, and the one page it serves, shows typed
//      values as text. These tests hand the Worker rows that hold markup, the
//      way a row stored before the second layer existed might, and read what
//      it sends.
//   2. The routes that store typed names refuse an angle bracket or a control
//      character, and leave every real name alone.
//
// Nothing here touches a real service. Every outgoing request the Worker makes
// is answered by the stand-in below, which is installed for the whole file and
// never removed. A request the stand-in does not expect is refused and
// recorded, and each call below fails if any were recorded. All keys, tokens
// and addresses are made-up placeholders.
//
//   node --test                              from the repo root, runs every *.test.mjs
//   node --test worker/typed-values.test.mjs
//
// Needs Node 22.12 or newer, which can load index.js as a module directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const ENV = {
  SUPABASE_URL: "https://database.invalid",
  SUPABASE_SERVICE_KEY: "placeholder-not-a-key",
  SUPABASE_ANON_KEY: "placeholder-not-a-key",
  RESEND_API_KEY: "placeholder-not-a-key",
  STRIPE_SECRET_KEY: "placeholder-not-a-key",
  STRIPE_WEBHOOK_SECRET: "placeholder-signing-secret",
  UNSUBSCRIBE_SECRET: "placeholder-unsubscribe-secret",
  APP_URL: "https://app.invalid/app/",
  WORKER_URL: "https://worker.invalid"
};
const DB = `${ENV.SUPABASE_URL}/rest/v1`;
const WHO_AM_I = `${ENV.SUPABASE_URL}/auth/v1/user`;
const SETUP_LINK = `${ENV.SUPABASE_URL}/auth/v1/admin/generate_link`;
const PROCESSOR = "https://api.stripe.com/v1";
const MAIL = "https://api.resend.com/emails";

// A value that holds markup, an attribute, an entity and both kinds of quote.
// Shown as text it reads exactly like this. Read as markup it would add a tag.
const MARKED = `Ann <b title="t">B</b> & 'C'`;
const AS_TEXT = `Ann &lt;b title=&quot;t&quot;&gt;B&lt;/b&gt; &amp; &#39;C&#39;`;
const mark = (label) => `${label} ${MARKED}`;
const asText = (label) => `${label} ${AS_TEXT}`;

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

// One call to the Worker. `tables` maps a table name to the rows the database
// stand-in answers a read with. Every write is recorded and echoed back. The
// caller is signed in as `role` when one is given.
async function call(path, { method = "POST", body, headers = {}, tables = {}, role, setupLink, raw } = {}) {
  const emails = [];
  const writes = [];
  unexpected = [];
  routes = [
    [WHO_AM_I, () => ({ data: { id: "user_1" } })],
    [SETUP_LINK, () => setupLink || { data: { id: "user_2", hashed_token: "placeholder-token", verification_type: "magiclink" } }],
    [`${PROCESSOR}/accounts/`, () => ({ data: { charges_enabled: true } })],
    [MAIL, ({ body: sent }) => {
      emails.push(JSON.parse(sent));
      return { data: { id: "email_placeholder" } };
    }],
    [`${DB}/`, ({ url, method: verb, body: sent }) => {
      const table = url.slice(DB.length + 1).split("?")[0];
      if (verb === "GET") {
        if (table === "user_profiles") return { data: role ? [{ role, club_id: "club_1", team_id: "team_1" }] : [] };
        return { data: tables[table] || [] };
      }
      const row = sent ? JSON.parse(sent) : null;
      writes.push({ table, verb, row });
      return { status: verb === "POST" ? 201 : 200, data: [{ id: `${table}_new`, ...row }] };
    }]
  ];
  const res = await worker.fetch(
    new Request(`https://worker.invalid${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(role ? { Authorization: "Bearer placeholder-session" } : {}), ...headers },
      body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body)
    }),
    ENV
  );
  const text = await res.text();
  assert.deepEqual(unexpected, [], "the Worker made a request this test does not expect");
  return { status: res.status, text, emails, writes, stored: (table) => writes.filter((w) => w.table === table && w.verb === "POST").map((w) => w.row) };
}

// Rows as they might already sit in the database.
const STORED = {
  clubs: [{
    id: "club_1", code: "TESTCLB", name: mark("Club"), city: mark("City"), state: "TX",
    admin_email: "treasurer@club.invalid", fee_agreed_at: "2026-01-01T00:00:00Z", stripe_account_id: "acct_placeholder"
  }],
  teams: [{ id: "team_1", club_id: "club_1", name: mark("Team"), dues_cents: 50000 }],
  athletes: [{
    id: "ath_1", club_id: "club_1", team_id: "team_1", name: mark("Athlete"),
    parent_email: `parent@family.invalid`, payment_status: "unpaid"
  }]
};

// What every email body must satisfy, whatever else it says.
function assertTextOnly(html, what) {
  assert.ok(!html.includes("<b title"), `${what}: a stored value must not open a tag`);
  assert.ok(!html.includes(`title="t"`), `${what}: a stored value must not add an attribute`);
  assert.ok(!html.includes(MARKED), `${what}: a stored value must not appear unescaped`);
}
// The sender line is "Name <address>". Nothing typed may add a second address.
function assertOneSender(from) {
  assert.equal(from.split("<").length, 2, `one address in the sender line: ${from}`);
  assert.equal(from.split(">").length, 2, `one address in the sender line: ${from}`);
  assert.ok(from.endsWith("<admin@playfundai.com>"), `the sender is PlayFund's own address: ${from}`);
  assert.ok(!from.includes('"'), `no quotation mark in the sender line: ${from}`);
}

test("a parent's registration: the two emails show stored names as text", async () => {
  const { status, emails } = await call("/athlete", {
    body: { club_code: "TESTCLB", team_id: "team_1", athlete_name: "Zoë O'Brien-Smith", parent_email: "parent@family.invalid" },
    tables: { ...STORED, clubs: [{ ...STORED.clubs[0], fee_agreed_at: null }] }
  });
  assert.equal(status, 201);
  assert.equal(emails.length, 2, "one email to the club and one to the parent");
  for (const m of emails) {
    assertTextOnly(m.html, m.subject);
    assert.ok(m.html.includes(asText("Club")), "the club's name is shown as text");
    assert.ok(m.html.includes(asText("Team")), "the team's name is shown as text");
    assert.ok(m.html.includes("Zoë O&#39;Brien-Smith"), "the athlete's name is shown as typed");
    assertOneSender(m.from);
  }
});

test("a reminder shows stored names as text, and its links are intact", async () => {
  const { status, emails } = await call("/remind", { body: { team_id: "team_1" }, tables: STORED, role: "playfund_admin" });
  assert.equal(status, 200);
  assert.equal(emails.length, 1);
  const [m] = emails;
  assertTextOnly(m.html, "reminder");
  for (const label of ["Club", "Team", "Athlete"]) assert.ok(m.html.includes(asText(label)), `${label} name is shown as text`);
  assert.ok(m.html.includes(`href="${ENV.APP_URL}?code=TESTCLB&athlete=ath_1&method=full"`), "the pay link is unchanged");
  assert.ok(m.html.includes(`href="${ENV.WORKER_URL}/unsubscribe?email=parent%40family.invalid&sig=`), "the unsubscribe link is unchanged");
  assertOneSender(m.from);
});

test("an approval shows stored names as text", async () => {
  const { status, emails } = await call("/athlete/ath_1/approve", { tables: STORED, role: "club_admin" });
  assert.equal(status, 200);
  assert.equal(emails.length, 1);
  assertTextOnly(emails[0].html, "approval");
  for (const label of ["Club", "Team", "Athlete"]) assert.ok(emails[0].html.includes(asText(label)), `${label} name is shown as text`);
  assert.ok(emails[0].html.includes(`href="${ENV.APP_URL}?code=TESTCLB&athlete=ath_1&method=bnpl"`), "the pay link is unchanged");
  assertOneSender(emails[0].from);
});

test("a note to the club about paying directly shows stored values as text", async () => {
  const tables = { ...STORED, athletes: [{ ...STORED.athletes[0], parent_email: mark("parent@family.invalid") }] };
  const { status, emails } = await call("/athlete/ath_1/notify-club", { tables });
  assert.equal(status, 200);
  assert.equal(emails.length, 1);
  assertTextOnly(emails[0].html, "note to the club");
  for (const label of ["Club", "Team", "Athlete", "parent@family.invalid"]) {
    assert.ok(emails[0].html.includes(asText(label)), `${label} is shown as text`);
  }
});

// A payment processor event, signed the way the Worker checks it.
function signedEvent(event) {
  const raw = JSON.stringify(event);
  const t = "1700000000";
  const v1 = createHmac("sha256", ENV.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`).digest("hex");
  return { raw, headers: { "stripe-signature": `t=${t},v1=${v1}` } };
}

test("a receipt shows stored names as text", async () => {
  const { raw, headers } = signedEvent({
    id: "evt_placeholder",
    type: "payment_intent.succeeded",
    data: { object: {
      id: mark("pi_placeholder"), amount_received: 50000, created: 1700000000,
      payment_method_types: ["card"], metadata: { athlete_id: "ath_1" }
    } }
  });
  const { status, emails } = await call("/webhook/stripe", { raw, headers, tables: { ...STORED, payments: [] } });
  assert.equal(status, 200);
  assert.equal(emails.length, 1);
  assertTextOnly(emails[0].html, "receipt");
  for (const label of ["Club", "Athlete", "pi_placeholder"]) assert.ok(emails[0].html.includes(asText(label)), `${label} is shown as text`);
  assertOneSender(emails[0].from);
});

test("the staff alert about a club with no rate shows stored values as text", async () => {
  const { raw, headers } = signedEvent({
    id: "evt_placeholder_2",
    type: "account.updated",
    data: { object: { id: "acct_placeholder", charges_enabled: true } }
  });
  const tables = { clubs: [{ ...STORED.clubs[0], fee_agreed_at: null, code: mark("CODE") }] };
  const { status, emails } = await call("/webhook/stripe", { raw, headers, tables });
  assert.equal(status, 200);
  assert.equal(emails.length, 1);
  assertTextOnly(emails[0].html, "rate alert");
  for (const label of ["Club", "City", "CODE"]) assert.ok(emails[0].html.includes(asText(label)), `${label} is shown as text`);
});

test("the staff alert about a new club shows what was typed as text", async () => {
  // Angle brackets are refused at the door (see below), so this is what can
  // still be typed: an ampersand and both kinds of quotation mark.
  const typed = `Bell & "Sons" 'A'`;
  const typedAsText = `Bell &amp; &quot;Sons&quot; &#39;A&#39;`;
  const { status, emails } = await call("/club/register", {
    body: { name: typed, sport: typed, city: typed, state: "", admin_name: typed, admin_email: "treasurer@club.invalid", athlete_count: 20 },
    // The account service's own words end up in the alert when a link fails.
    setupLink: { status: 500, data: { error_code: "unexpected_failure", msg: MARKED } }
  });
  assert.equal(status, 201);
  const alert = emails.find((m) => m.to.includes("admin@playfundai.com"));
  assert.ok(alert, "an internal alert is sent");
  assertTextOnly(alert.html, "new club alert");
  assert.ok(!alert.html.includes(typed), "typed values do not appear unescaped");
  assert.ok(alert.html.includes(`>${typedAsText}</h2>`), "the club name is shown as text");
  assert.ok(alert.html.includes(`<td>${typedAsText} (treasurer@club.invalid)</td>`), "the contact is shown as text");
  assert.ok(alert.html.includes(`<td>${typedAsText}</td>`), "sport and city are shown as text");
  assert.ok(alert.html.includes(AS_TEXT), "the failure detail is shown as text");
});

test("the unsubscribe page shows the address as text", async () => {
  const email = mark("parent@family.invalid");
  const sig = createHmac("sha256", ENV.UNSUBSCRIBE_SECRET).update(email.toLowerCase().trim()).digest("hex");
  const { status, text } = await call(`/unsubscribe?email=${encodeURIComponent(email)}&sig=${sig}`, { method: "GET" });
  assert.equal(status, 200);
  assert.match(text, /You're unsubscribed/);
  assertTextOnly(text, "unsubscribe page");
  assert.ok(text.includes(asText("parent@family.invalid")), "the address is shown as text");
});

test("the sender name drops what an address line reads as structure", async () => {
  const tables = { ...STORED, clubs: [{ ...STORED.clubs[0], name: `Northside <other@elsewhere.invalid> "FC"\r\nBcc: x` }] };
  const { emails } = await call("/remind", { body: { team_id: "team_1" }, tables, role: "playfund_admin" });
  assert.equal(emails.length, 1);
  assertOneSender(emails[0].from);
  assert.equal(emails[0].from, "Northside other@elsewhere.invalid FC Bcc: x via PlayFund <admin@playfundai.com>");
});

// ---------------------------------------------------------------------------
// The second layer: what the routes accept and refuse.
// ---------------------------------------------------------------------------

const REAL_NAMES = [
  "Zoë O'Brien-Smith", "José Ángel de la Cruz", "Seán Ó Súilleabháin", "D’Angelo Russell Jr.",
  "Anne-Marie St. Pierre", "李小龙", "Мария Иванова", "محمد علي", "Nguyễn Thị Minh Khai", "Åsa Björk",
  "Ng", "Mary-Kate & Ashley", `Robert "Bobby" Tables`
];
const REFUSED_TEXT = [
  ["a tag", "Sam <b>Jones</b>"],
  ["one angle bracket", "Sam < Jones"],
  ["a closing angle bracket", "Sam > Jones"],
  ["a line break", "Sam\nJones"],
  ["a null character", "Sam\u0000Jones"],
  ["an escape character", "Sam\u001bJones"],
  ["only spaces", "   "],
  ["too many characters", "S".repeat(300)],
  ["a number", 42],
  ["a list", ["Sam"]],
  ["an object", { name: "Sam" }]
];
const ATHLETE = { club_code: "TESTCLB", team_id: "team_1", athlete_name: "Sam Jones", parent_email: "parent@family.invalid" };
const UNPAID_CLUB = { ...STORED, clubs: [{ ...STORED.clubs[0], fee_agreed_at: null }] };

test("POST /athlete keeps real names exactly as typed", async () => {
  for (const name of REAL_NAMES) {
    const { status, stored } = await call("/athlete", { body: { ...ATHLETE, athlete_name: `  ${name} ` }, tables: UNPAID_CLUB });
    assert.equal(status, 201, name);
    assert.equal(stored("athletes").length, 1, name);
    assert.equal(stored("athletes")[0].name, name, "stored as typed, trimmed");
  }
});

test("POST /athlete refuses a name that is not a name, and stores and sends nothing", async () => {
  for (const [what, name] of REFUSED_TEXT) {
    const { status, text, writes, emails } = await call("/athlete", { body: { ...ATHLETE, athlete_name: name }, tables: UNPAID_CLUB });
    assert.equal(status, 400, what);
    assert.match(JSON.parse(text).error, /name/i, what);
    assert.deepEqual(writes, [], `${what}: nothing is stored`);
    assert.deepEqual(emails, [], `${what}: nothing is sent`);
  }
});

test("POST /athlete applies the same rule to the parent's email and phone", async () => {
  for (const field of ["parent_email", "parent_phone"]) {
    for (const value of [`"Pat" <parent@family.invalid>`, "parent@family.invalid\r\nBcc: x@elsewhere.invalid", "x".repeat(300)]) {
      const { status, writes, emails } = await call("/athlete", { body: { ...ATHLETE, [field]: value }, tables: UNPAID_CLUB });
      assert.equal(status, 400, `${field}: ${value.slice(0, 30)}`);
      assert.deepEqual(writes, []);
      assert.deepEqual(emails, []);
    }
  }
  const { status, stored } = await call("/athlete", {
    body: { ...ATHLETE, parent_email: "  Pat.O'Neil+kids@Family.Invalid ", parent_phone: " +1 (555) 010-0199 " },
    tables: UNPAID_CLUB
  });
  assert.equal(status, 201);
  assert.equal(stored("athletes")[0].parent_email, "pat.o'neil+kids@family.invalid");
  assert.equal(stored("athletes")[0].parent_phone, "+1 (555) 010-0199");
});

const TEAM = { club_id: "club_1", name: "12U Girls", dues_cents: 50000, dues_due_date: "2027-01-15" };

test("POST /team keeps real names and refuses the rest", async () => {
  for (const name of ["12U Girls – Año 2", "Under-10s (Red)", "Boys' A & B", "U12"]) {
    const { status, stored } = await call("/team", {
      body: { ...TEAM, name, age_group: "12U", fees: [{ label: "Coach's fee & kit", amount: 100 }] },
      role: "club_admin"
    });
    assert.equal(status, 201, name);
    assert.equal(stored("teams")[0].name, name);
    assert.equal(stored("teams")[0].age_group, "12U");
    assert.deepEqual(stored("teams")[0].fees, [{ label: "Coach's fee & kit", amount: 100 }]);
  }
  for (const [what, name] of REFUSED_TEXT) {
    const { status, writes } = await call("/team", { body: { ...TEAM, name }, role: "club_admin" });
    assert.equal(status, 400, what);
    assert.deepEqual(writes, [], `${what}: nothing is stored`);
  }
  for (const extra of [{ age_group: "12U <b>" }, { fees: [{ label: "Kit <b>", amount: 100 }] }]) {
    const { status, writes } = await call("/team", { body: { ...TEAM, ...extra }, role: "club_admin" });
    assert.equal(status, 400, JSON.stringify(extra));
    assert.deepEqual(writes, []);
  }
});

const CLUB = {
  name: "Test Club", sport: "Basketball", city: "Testville", state: "TX",
  admin_email: "treasurer@club.invalid", admin_name: "Test Treasurer", athlete_count: 20,
  teams: [{ name: "12U", age_group: "12U", dues: 500 }]
};

test("POST /club/register keeps real names exactly as typed", async () => {
  const typed = { name: "  São Paulo FC Juniors – O'Fallon  ", city: " Coeur d'Alene ", admin_name: " Zoë O'Brien-Smith " };
  const { status, stored } = await call("/club/register", { body: { ...CLUB, ...typed } });
  assert.equal(status, 201);
  const [club] = stored("clubs");
  assert.equal(club.name, "São Paulo FC Juniors – O'Fallon");
  assert.equal(club.city, "Coeur d'Alene");
  assert.equal(club.state, "TX");
  assert.equal(club.sport, "Basketball");
  assert.equal(club.admin_name, "Zoë O'Brien-Smith");
  assert.equal(club.admin_email, "treasurer@club.invalid");
  assert.equal(stored("teams")[0].name, "12U");
});

test("POST /club/register refuses markup in any typed field, and stores and sends nothing", async () => {
  const bad = "Sam <b>Jones</b>";
  for (const change of [
    { name: bad }, { sport: bad }, { city: bad }, { state: bad }, { admin_name: bad },
    { admin_email: `treasurer@club.invalid <b>` }, { teams: [{ name: bad }] }, { teams: [{ name: "12U", age_group: bad }] }
  ]) {
    const { status, writes, emails } = await call("/club/register", { body: { ...CLUB, ...change } });
    assert.equal(status, 400, JSON.stringify(change));
    assert.deepEqual(writes, [], `${JSON.stringify(change)}: nothing is stored`);
    assert.deepEqual(emails, [], `${JSON.stringify(change)}: nothing is sent`);
  }
});

test("POST /invite refuses markup in the name or the address", async () => {
  const INVITE = { email: "coach@club.invalid", display_name: "Coach Kim", role: "team_admin", club_id: "club_1", team_id: "team_1" };
  for (const change of [{ display_name: "Coach <b>Kim</b>" }, { email: "coach@club.invalid <b>" }]) {
    const { status, writes } = await call("/invite", { body: { ...INVITE, ...change }, role: "club_admin" });
    assert.equal(status, 400, JSON.stringify(change));
    assert.deepEqual(writes, []);
  }
});

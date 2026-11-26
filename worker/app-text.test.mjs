// Checks that the app page, public/app/index.html, shows what people type as
// text.
//
// The page builds most of its screens by joining strings and writing them
// with innerHTML. The rule it follows is at escapeHtml in the page: anything a
// person typed, and anything that came back from the Worker or from the
// device's saved state, is escaped before it is joined in.
//
// These tests run the page's own script, unchanged, against a stand-in for
// the browser. Nothing is loaded in a real browser and nothing leaves this
// computer: the stand-in's fetch answers from the rows below and refuses
// anything else. Every value in those rows that the test does not set itself
// comes back as a string that would add a tag if it were read as markup. Each
// screen is then drawn and every innerHTML write is read back:
//
//   - the only tags and attributes in it are the page's own;
//   - the typed value is there, character for character, as text;
//   - no value is written into an onclick. Buttons get the value handed to
//     their handler instead, exactly as stored.
//
// The last test makes sure no write was skipped: every innerHTML write in the
// page is either drawn by these tests or is one fixed string. A new write
// fails here until a test draws it.
//
//   node --test                           from the repo root, runs every *.test.mjs
//   node --test worker/app-text.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const PAGE_NAME = "public/app/index.html";
const page = readFileSync(new URL(`../${PAGE_NAME}`, import.meta.url), "utf8");
const pageLines = page.split("\n");

// The app's script is the longest inline <script> block in the page.
const script = (() => {
  let best = null;
  for (let i = 0; i < pageLines.length; i++) {
    if (pageLines[i].trim() !== "<script>") continue;
    let end = i + 1;
    while (end < pageLines.length && pageLines[end].trim() !== "</script>") end++;
    if (!best || end - i > best.end - best.start) best = { start: i, end };
  }
  assert.ok(best && best.end - best.start > 1000, "the app's script was not found in the page");
  // lineOffset makes line numbers in the script the page's own line numbers.
  return {
    firstLine: best.start + 2,
    lastLine: best.end,
    compiled: new vm.Script(pageLines.slice(best.start + 1, best.end).join("\n"), { filename: PAGE_NAME, lineOffset: best.start + 1 })
  };
})();

// ---------------------------------------------------------------------------
// Typed values
// ---------------------------------------------------------------------------

// What a field holds when the test has not said otherwise. Read as markup it
// would open a <u> tag with a pf attribute, and the quotation marks would end
// an attribute it was written into.
const typed = (field) => `ZQX${field}"'&<u pf=1>`;
// The same for a field the page reads as a date. It holds no digit, because
// the date parser will make a date out of almost anything that has one.
const typedDate = (field) => `ZQX${field}"'&<u pf>`;

// A row whose every unset field is a typed value.
function row(fields = {}) {
  return new Proxy(fields, {
    get(target, key) {
      if (typeof key === "symbol" || key in target) return target[key];
      if (key === "then" || key === "toJSON" || key === "length") return undefined;
      return typed(key);
    }
  });
}

// ---------------------------------------------------------------------------
// Reading markup back
// ---------------------------------------------------------------------------

// Splits a string of markup into tags and text the way a browser would begin
// to: a "<" followed by a letter or a slash starts a tag, and the tag runs to
// the next ">" outside a quoted attribute value.
function readMarkup(html) {
  const tags = [];
  const texts = [];
  let text = "";
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) { text += html.slice(i); break; }
    text += html.slice(i, lt);
    if (!/[a-zA-Z/!?]/.test(html[lt + 1] || "")) { text += "<"; i = lt + 1; continue; }
    if (text) { texts.push(text); text = ""; }
    let j = lt + 1;
    const closing = html[j] === "/";
    if (closing) j++;
    let name = "";
    while (j < html.length && !/[\s/>]/.test(html[j])) name += html[j++];
    const attrs = [];
    for (;;) {
      while (j < html.length && /[\s/]/.test(html[j])) j++;
      if (j >= html.length || html[j] === ">") { j++; break; }
      let attr = html[j++];
      while (j < html.length && !/[\s/>=]/.test(html[j])) attr += html[j++];
      while (j < html.length && /\s/.test(html[j])) j++;
      let value = null;
      if (html[j] === "=") {
        j++;
        while (j < html.length && /\s/.test(html[j])) j++;
        const quote = html[j];
        if (quote === '"' || quote === "'") {
          const end = html.indexOf(quote, j + 1);
          value = html.slice(j + 1, end === -1 ? html.length : end);
          j = end === -1 ? html.length : end + 1;
        } else {
          value = "";
          while (j < html.length && !/[\s>]/.test(html[j])) value += html[j++];
        }
      }
      attrs.push([attr.toLowerCase(), value]);
    }
    tags.push({ name: name.toLowerCase(), closing, attrs });
    i = j;
  }
  if (text) texts.push(text);
  return { tags, texts };
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

// The page's own markup. A tag or attribute outside these lists means a value
// was read as markup, or that the page gained new markup and this list needs
// the new name.
const OWN_TAGS = new Set(["div", "span", "p", "b", "small", "button", "input", "option", "svg", "path", "circle", "line", "polyline", "rect"]);
const OWN_ATTRS = new Set([
  "class", "style", "title", "type", "placeholder", "value", "inputmode", "aria-label", "onclick", "oninput",
  "viewbox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "d", "cx", "cy", "r", "rx", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "points"
]);
const looksTyped = (s) => /zqx|pf=1|u pf/i.test(s);

// Fails unless `html` is the page's own markup around text. Returns the text
// and attribute values in it, decoded, for the "as typed" checks.
function ownMarkupOnly(html, where) {
  const { tags, texts } = readMarkup(html);
  const shown = texts.map(decode);
  for (const tag of tags) {
    assert.ok(OWN_TAGS.has(tag.name), `${where}: <${tag.name}> is not the page's own markup. A value was read as markup.\n${html}`);
    for (const [attr, value] of tag.attrs) {
      assert.ok(OWN_ATTRS.has(attr), `${where}: the attribute "${attr}" on <${tag.name}> is not the page's own. A value was read as markup.\n${html}`);
      if (attr.startsWith("on")) {
        assert.ok(!looksTyped(value || ""), `${where}: a value was written into ${attr}.\n${html}`);
      } else if (value !== null) {
        shown.push(decode(value));
      }
    }
  }
  return shown;
}

test("the check itself tells text from markup", () => {
  const name = typed("name");
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  assert.deepEqual(ownMarkupOnly(`<div class="roster-name">${esc(name)}</div>`, "escaped"), ["roster-name", name].reverse());
  assert.deepEqual(ownMarkupOnly(`<input type="text" value="${esc(name)}">`, "escaped attribute"), ["text", name]);
  assert.throws(() => ownMarkupOnly(`<div class="roster-name">${name}</div>`, "raw text"), /read as markup/);
  assert.throws(() => ownMarkupOnly(`<input type="text" value="${name}">`, "raw attribute"), /read as markup/);
  assert.throws(() => ownMarkupOnly(`<div class="athlete-avatar"><p</div>`, "raw initials"), /read as markup/);
  assert.throws(() => ownMarkupOnly(`<button onclick="go('${esc(name)}')">x</button>`, "value in a handler"), /written into onclick/);
  assert.throws(() => ownMarkupOnly(`<div>${name.slice(-8).toUpperCase()}</div>`, "raw tail"), /read as markup/);
});

// ---------------------------------------------------------------------------
// A stand-in for the browser
// ---------------------------------------------------------------------------

const allWrites = [];   // every innerHTML write made by any test: { line, html }

function openPage({ answers = [] } = {}) {
  const writes = [];
  const refused = [];
  const elements = new Map();

  // Does markup this element was given hold what `selector` asks for? Enough
  // of querySelector for the page: class and tag selectors on a row it just
  // wrote. An element the page did not write is assumed to hold anything.
  const holds = (html, selector) => !html || selector.split(/\s+/).pop().split(/(?=[.#])/).every((part) =>
    part.startsWith(".") ? new RegExp(`class="[^"]*\\b${part.slice(1)}\\b`).test(html) : part.startsWith("#") ? true : html.includes(`<${part}`));

  function element(id = "") {
    let html = "";
    let found = {};
    const node = {
      id, value: "", disabled: false, textContent: "", offsetHeight: 0, parentNode: null, children: [],
      listeners: {}, dataset: {},
      style: new Proxy({ setProperty() {}, removeProperty() {} }, { get: (t, k) => (k in t ? t[k] : ""), set: (t, k, v) => { t[k] = v; return true; } }),
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      get innerHTML() { return html; },
      set innerHTML(value) {
        html = String(value);
        found = {};
        const frame = (new Error().stack || "").split("\n").find((l) => l.includes(`${PAGE_NAME}:`)) || "";
        const line = Number((frame.match(/:(\d+):\d+\)?$/) || [])[1]);
        const write = { line, html };
        writes.push(write);
        allWrites.push(write);
      },
      get firstChild() { return node.children[0] || null; },
      querySelector(selector) {
        if (!holds(html, selector)) return null;
        return found[selector] || (found[selector] = element());
      },
      querySelectorAll: () => [],
      appendChild(child) { node.children.push(child); child.parentNode = node; return child; },
      removeChild(child) { node.children = node.children.filter((c) => c !== child); return child; },
      addEventListener(type, fn) { (node.listeners[type] = node.listeners[type] || []).push(fn); },
      setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
      focus() {}, click() {},
      // What the page asked for with querySelector on this element.
      found: (selector) => found[selector] || null
    };
    return node;
  }
  const byId = (id) => elements.get(id) || (elements.set(id, element(id)), elements.get(id));

  const storage = () => {
    const kept = new Map();
    return { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => { kept.set(k, String(v)); }, removeItem: (k) => { kept.delete(k); } };
  };

  const sandbox = {
    document: {
      getElementById: byId,
      createElement: () => element(),
      querySelector: () => element("screen-home"),
      querySelectorAll: () => [],
      addEventListener() {},
      body: element("body")
    },
    sessionStorage: storage(),
    localStorage: storage(),
    location: { search: "", hash: "", pathname: "/app/" },
    history: { replaceState() {} },
    scrollTo() {},
    addEventListener() {},
    setTimeout: () => 0,
    clearTimeout() {},
    console: { log() {}, warn() {}, error() {} },
    URLSearchParams,
    // Answers from the rows the test gave, and from nowhere else.
    fetch: async (input, init = {}) => {
      const url = String(input);
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (path === "/events") return { ok: true, status: 200, json: async () => ({}) };
      for (const [pattern, answer] of answers) {
        if (pattern.test(path)) {
          const { status = 200, data } = typeof answer === "function" ? answer({ path, init }) : answer;
          return { ok: status >= 200 && status < 300, status, json: async () => data };
        }
      }
      refused.push(url);
      throw new Error(`The page tried to reach ${url}, which this test does not expect`);
    }
  };
  sandbox.window = sandbox;
  const app = vm.createContext(sandbox);
  script.compiled.runInContext(app);

  return {
    app, byId, writes, refused,
    // Lets work the page started and did not wait for run to its end.
    settle: async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); },
    // Every write so far must be the page's own markup. Returns what it shows.
    shown() {
      assert.deepEqual(refused, [], "the page made a request this test does not expect");
      return writes.flatMap((w) => ownMarkupOnly(w.html, `${PAGE_NAME}:${w.line}`));
    }
  };
}

const showsAsTyped = (shown, value, what) =>
  assert.ok(shown.some((s) => s.includes(value)), `${what} is shown exactly as typed: ${value}`);

// Presses the button the page wired in a row and returns what the handler was
// called with.
function press(rowElement, selector, calls) {
  const button = rowElement.found(selector);
  assert.ok(button && button.listeners.click && button.listeners.click.length === 1, `the ${selector} button has one click handler`);
  calls.length = 0;
  button.listeners.click[0]();
  return calls[0];
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const athlete = (fields = {}) => row({ approval_status: "approved", payment_status: "unpaid", payment_method: null, ...fields });
const pendingAthlete = () => athlete({ id: typed("pending_id"), name: typed("pending_name"), parent_email: typed("pending_email"), approval_status: "pending" });
const unpaidAthlete = () => athlete({ id: typed("unpaid_id"), name: typed("unpaid_name"), parent_email: typed("unpaid_email") });
const paidAthlete = () => athlete({ id: typed("paid_id"), name: typed("paid_name"), parent_email: typed("paid_email"), payment_status: "paid_full", payment_method: "card" });
const mixedRoster = () => [pendingAthlete(), unpaidAthlete(), paidAthlete()];
const team = (fields = {}) => row({ id: "team_1", dues_cents: 50000, athletes: mixedRoster(), ...fields });
const club = (fields = {}) => row({ id: "club_1", code: "TESTCLB", fee_bps: 800, fee_agreed_at: "2026-01-01T00:00:00Z", teams: [team()], ...fields });

const CLUB_SESSION = JSON.stringify({ access_token: "placeholder-session", user: { role: "club_admin" } });

// ---------------------------------------------------------------------------
// Club screens
// ---------------------------------------------------------------------------

test("club overview: team cards and the approval list", async () => {
  const p = openPage({ answers: [[/^\/club\/club_1\/stripe-status$/, { data: { charges_enabled: true, connected: true } }]] });
  p.app.state.club = club({ teams: [team({ name: typed("team_name") })] });
  p.app.openClubOverview();
  await p.settle();
  const shown = p.shown();
  showsAsTyped(shown, typed("team_name"), "the team name");
  showsAsTyped(shown, typed("pending_name"), "the athlete awaiting approval");

  const empty = openPage({ answers: [[/stripe-status$/, { data: { charges_enabled: true } }]] });
  empty.app.state.club = club({ teams: [], fee_agreed_at: null });
  empty.app.openClubOverview();
  await empty.settle();
  empty.shown();

  const noAthletes = openPage({ answers: [[/stripe-status$/, { data: { charges_enabled: true } }]] });
  noAthletes.app.state.club = club({ teams: [team({ athletes: [] })] });
  noAthletes.app.openClubOverview();
  await noAthletes.settle();
  noAthletes.shown();
});

test("club roster: every row, and the buttons hand over the stored id and name", () => {
  const p = openPage();
  const calls = [];
  p.app.approvePendingAthlete = (...args) => calls.push(["approve", ...args]);
  p.app.deleteRosterAthlete = (...args) => calls.push(["remove", ...args]);
  p.app.state.club = club();
  p.app.state.team = p.app.state.club.teams[0];
  p.app.openRoster();
  const shown = p.shown();
  for (const field of ["pending_name", "pending_email", "unpaid_name", "paid_name"]) showsAsTyped(shown, typed(field), field);

  const rows = p.byId("rosterList").children.filter((c) => c.innerHTML);
  assert.equal(rows.length, 3, "three roster rows");
  const pending = rows.find((r) => r.innerHTML.includes("roster-action-btn approve"));
  assert.deepEqual(press(pending, ".roster-action-btn.approve", calls), ["approve", typed("pending_id")]);
  assert.deepEqual(press(pending, ".roster-action-btn.danger", calls), ["remove", typed("pending_id"), typed("pending_name")]);
  for (const r of rows.filter((x) => x !== pending)) {
    assert.equal(r.found(".roster-action-btn.approve"), null, "an approved athlete has no approve button");
    const [, id, name] = press(r, ".roster-action-btn.danger", calls);
    assert.ok([typed("unpaid_id"), typed("paid_id")].includes(id) && [typed("unpaid_name"), typed("paid_name")].includes(name));
  }
});

test("club roster: the note under the totals, in each of its four states", () => {
  for (const athletes of [[], [paidAthlete()], [unpaidAthlete()], [paidAthlete(), unpaidAthlete()]]) {
    const p = openPage();
    p.app.state.club = club({ teams: [team({ athletes })] });
    p.app.state.team = p.app.state.club.teams[0];
    p.app.openRoster();
    p.shown();
  }
});

test("sending payment links: the result line", async () => {
  const p = openPage({
    answers: [[/^\/club\/club_1\/send-payment-links$/, { data: { sent: typed("sent"), skipped: { length: typed("skipped") } } }]]
  });
  p.app.sessionStorage.setItem("pf_club_session", CLUB_SESSION);
  p.app.ask = async () => true;
  p.app.state.club = club();
  await p.app.sendPaymentLinks();
  const shown = p.shown();
  showsAsTyped(shown, typed("sent"), "the count the Worker sent back");
  showsAsTyped(shown, typed("skipped"), "the skipped count the Worker sent back");
});

test("adding a team: fee rows keep what was typed", () => {
  const p = openPage();
  p.app.state.club = club();
  p.app.showAddTeamScreen();
  p.app.addTeamFees = [{ label: typed("fee_label"), amount: 250 }, { label: "", amount: 0 }];
  p.app.renderAddTeamFees();
  showsAsTyped(p.shown(), typed("fee_label"), "the fee name in its input");
  p.app.showInviteAdminScreen();
  p.shown();
});

test("team admin roster: every row, and the buttons hand over the stored id and name", async () => {
  const live = club();
  const p = openPage({ answers: [[/^\/club\/TESTCLB$/, { data: { club: live } }]] });
  const calls = [];
  p.app.approveAthleteTeamAdmin = (...args) => calls.push(["approve", ...args]);
  p.app.deleteAthleteTeamAdmin = (...args) => calls.push(["remove", ...args]);
  await p.app.openTeamAdminView({ access_token: "placeholder-session", user: row({ team: row({ id: "team_1" }), club: row({ code: "TESTCLB" }) }) });
  const shown = p.shown();
  for (const field of ["pending_name", "pending_email", "unpaid_name", "paid_name"]) showsAsTyped(shown, typed(field), field);

  const rows = p.byId("teamAdminRosterList").children.filter((c) => c.innerHTML);
  assert.equal(rows.length, 3, "three roster rows");
  const pending = rows.find((r) => r.innerHTML.includes("roster-action-btn approve"));
  assert.deepEqual(press(pending, ".roster-action-btn.approve", calls), ["approve", typed("pending_id")]);
  assert.deepEqual(press(pending, ".roster-action-btn.danger", calls), ["remove", typed("pending_id"), typed("pending_name")]);

  const empty = openPage({ answers: [[/^\/club\/TESTCLB$/, { data: { club: club({ teams: [team({ athletes: [] })] }) } }]] });
  await empty.app.openTeamAdminView({ access_token: "placeholder-session", user: row({ team: row({ id: "team_1" }), club: row({ code: "TESTCLB" }) }) });
  empty.shown();
});

// ---------------------------------------------------------------------------
// Parent screens
// ---------------------------------------------------------------------------

// A parent's device with saved athletes at one club.
function parentPage(athletes, teamFields = {}) {
  const p = openPage();
  const theClub = club({ name: typed("club_name"), teams: [team({ name: typed("team_name"), dues: 500, ...teamFields })] });
  p.app.clubCache.TESTCLB = theClub;
  p.app.state.athletes = athletes.map((fields) => row({ clubId: "club_1", teamId: "team_1", paymentStatus: null, history: null, ...fields }));
  return p;
}

test("parent home, settings and the combined plan", () => {
  const p = parentPage([
    { id: typed("local_id_1"), name: typed("first_child") },
    { id: typed("local_id_2"), name: "<u pf=1> <u pf=1>" }
  ]);
  const calls = [];
  p.app.payCombinedAthlete = (...args) => calls.push(args);
  p.app.renderAthleteList();
  p.app.goToParentSettings();
  p.app.openCombinedPlan();
  const shown = p.shown();
  for (const value of [typed("first_child"), "<u pf=1> <u pf=1>", typed("club_name"), typed("team_name"), "<p"]) {
    showsAsTyped(shown, value, "a name or its initials");
  }
  const rows = p.byId("combinedAthleteList").children;
  assert.equal(rows.length, 2, "two athletes on the combined plan");
  assert.deepEqual(press(rows[0], "button", calls), [typed("local_id_1")]);
  assert.deepEqual(press(rows[1], "button", calls), [typed("local_id_2")]);
});

test("athlete detail: the club's fee list, itemised or not", () => {
  const itemised = parentPage([{ id: "a1" }], { fees: [row({ label: typed("fee_label"), amount: 250 })] });
  itemised.app.openAthleteDetail("a1");
  showsAsTyped(itemised.shown(), typed("fee_label"), "the fee name");

  const bare = parentPage([{ id: "a1" }], { fees: [] });
  bare.app.openAthleteDetail("a1");
  bare.shown();
});

test("payment confirmation, schedule and history", () => {
  const payment = row({ created_at: "2026-01-02T00:00:00Z" });
  for (const method of ["full", "bnpl"]) {
    const p = parentPage([{ id: "a1" }]);
    p.app.state.activeAthleteId = "a1";
    p.app.recordAthletePayment(method, null, payment);
    p.app.openPaymentMgmt();
    p.app.openPaymentHistory();
    const shown = p.shown();
    // The reference shown is the last eight characters of the id, in capitals.
    showsAsTyped(shown, typed("stripe_payment_intent").slice(-8).toUpperCase(), "the payment reference");
    showsAsTyped(shown, typed("amount"), "the amount the Worker sent back");
  }

  // History kept on the device from an earlier visit.
  const saved = parentPage([{ id: "a1", paymentStatus: "full", history: [
    row({ status: "paid", label: typed("paid_label"), date: typedDate("paid_date"), amount: typed("paid_amount"), txnId: typed("ref") }),
    row({ status: "upcoming", label: typed("upcoming_label"), date: typedDate("upcoming_date"), amount: typed("upcoming_amount") })
  ] }]);
  saved.app.state.activeAthleteId = "a1";
  saved.app.recordAthletePayment("full", null);
  saved.app.recordAthletePayment("bnpl", null);
  saved.app.openPaymentMgmt();
  saved.app.openPaymentHistory();
  const shown = saved.shown();
  for (const field of ["paid_label", "paid_amount", "ref", "upcoming_label", "upcoming_amount"]) showsAsTyped(shown, typed(field), field);
  for (const field of ["paid_date", "upcoming_date"]) showsAsTyped(shown, typedDate(field), field);

  const none = parentPage([{ id: "a1" }]);
  none.app.state.activeAthleteId = "a1";
  none.app.openPaymentHistory();
  none.shown();
});

test("saving a parent account: the address in the confirmation line", async () => {
  const p = openPage({ answers: [[/^\/auth\/signup$/, { data: {} }]] });
  const email = `${typed("email")}@family.invalid`;
  p.byId("parentSaveName").value = "Pat Parent";
  p.byId("parentSaveEmail").value = email;
  p.byId("parentSavePassword").value = "placeholder-password";
  await p.app.submitParentSaveAccount();
  showsAsTyped(p.shown(), email, "the address just typed");
});

// ---------------------------------------------------------------------------
// Staff screens
// ---------------------------------------------------------------------------

const staffClub = (fields = {}) => club({
  name: typed("club_name"), city: typed("city"), code: typed("code"), team_count: typed("team_count"),
  athlete_count: 12, fronted_cents: 100000, collected_cents: 50000,
  needs_action: true, needs_fee: true, needs_stripe: true, pending_approvals: 2,
  teams: [team({ name: typed("team_name") })], ...fields
});

test("staff: the club list, the work queue and the filter", async () => {
  const p = openPage({ answers: [[/^\/admin\/clubs$/, { data: { clubs: [staffClub(), staffClub({ needs_action: false, fronted_cents: 0 })], totals: row({}) } }]] });
  p.app.adminSession = "placeholder-session";
  await p.app.loadAdminClubs();
  const shown = p.shown();
  for (const field of ["club_name", "city", "code", "team_count"]) showsAsTyped(shown, typed(field), field);

  p.byId("adminClubFilter").value = typed("filter");
  p.app.renderAdminClubList();
  showsAsTyped(p.shown(), typed("filter").toLowerCase(), "the filter text");

  const failed = openPage({ answers: [[/^\/admin\/clubs$/, { status: 500, data: { error: typed("error") } }]] });
  failed.app.adminSession = "placeholder-session";
  await failed.app.loadAdminClubs();
  showsAsTyped(failed.shown(), typed("error"), "the Worker's error text");

  const none = openPage({ answers: [[/^\/admin\/clubs$/, { data: { clubs: [], totals: {} } }]] });
  none.app.adminSession = "placeholder-session";
  await none.app.loadAdminClubs();
  none.shown();
});

test("staff: one club, its teams and its payments", async () => {
  const payments = [
    row({ created_at: "2026-01-02T00:00:00Z", status: "succeeded" }),
    row({ created_at: typedDate("created_at") })
  ];
  const p = openPage({ answers: [[/^\/admin\/clubs\/club_1\/payments$/, { data: { payments } }]] });
  p.app.adminSession = "placeholder-session";
  p.app.openAdminClubDetail(staffClub());
  await p.settle();
  const shown = p.shown();
  for (const field of ["team_name", "athlete_name", "amount", "payment_method", "status"]) showsAsTyped(shown, typed(field), field);
  showsAsTyped(shown, typedDate("created_at"), "a date the page could not read");

  const failed = openPage({ answers: [[/payments$/, { status: 500, data: { error: typed("error") } }]] });
  failed.app.adminSession = "placeholder-session";
  failed.app.openAdminClubDetail(staffClub());
  await failed.settle();
  showsAsTyped(failed.shown(), typed("error"), "the Worker's error text");

  const none = openPage({ answers: [[/payments$/, { data: { payments: [] } }]] });
  none.app.adminSession = "placeholder-session";
  none.app.openAdminClubDetail(staffClub());
  await none.settle();
  none.shown();
});

test("staff roster: every row, and the buttons hand over the stored id and name", async () => {
  const live = staffClub({ code: "TESTCLB", teams: [team()] });
  const p = openPage({ answers: [[/^\/club\/TESTCLB$/, { data: { club: live, stats: { collected_cents: 25000 } } }]] });
  const calls = [];
  p.app.approveAthleteAdmin = (...args) => calls.push(["approve", ...args]);
  p.app.deleteAthleteAdmin = (...args) => calls.push(["remove", ...args]);
  p.app.adminSession = "placeholder-session";
  await p.app.openAdminTeamRoster(live, live.teams[0]);
  const shown = p.shown();
  for (const field of ["pending_name", "pending_email", "unpaid_name", "unpaid_email", "paid_name", "paid_email"]) showsAsTyped(shown, typed(field), field);

  const rows = p.byId("adminRosterList").children.filter((c) => c.innerHTML);
  assert.equal(rows.length, 3, "three roster rows");
  const pending = rows.find((r) => r.innerHTML.includes("roster-action-btn approve"));
  assert.deepEqual(press(pending, ".roster-action-btn.approve", calls), ["approve", typed("pending_id")]);
  assert.deepEqual(press(pending, ".roster-action-btn.danger", calls), ["remove", typed("pending_id"), typed("pending_name")]);

  const empty = openPage({ answers: [[/^\/club\/TESTCLB$/, { data: { club: staffClub({ code: "TESTCLB", teams: [team({ athletes: [] })] }) } }]] });
  empty.app.adminSession = "placeholder-session";
  await empty.app.openAdminTeamRoster(live, live.teams[0]);
  empty.shown();
});

test("a toast shows its message as text", () => {
  const p = openPage();
  p.app.toast(typed("message"), "bad");
  p.shown();
  const toastElement = p.byId("toastStack").children[0];
  assert.equal(toastElement.found(".toast-text").textContent, typed("message"));
});

// ---------------------------------------------------------------------------
// Nothing skipped
// ---------------------------------------------------------------------------

test("every innerHTML write in the page is drawn above, or is one fixed string", () => {
  const drawn = new Set(allWrites.map((w) => w.line));
  const sites = [];
  for (let n = script.firstLine; n <= script.lastLine; n++) {
    if (/\.innerHTML\s*\+?=(?!=)/.test(pageLines[n - 1])) sites.push(n);
  }
  assert.ok(sites.length > 40, "the page's innerHTML writes were not found");
  for (const line of drawn) {
    assert.ok(sites.includes(line), `a write was recorded at ${PAGE_NAME}:${line}, which is not an innerHTML line`);
  }
  // One quoted string and nothing joined to it.
  const fixed = /\.innerHTML\s*=\s*'(?:[^'\\]|\\.)*'\s*;/;
  const missed = sites.filter((n) => !drawn.has(n) && !fixed.test(pageLines[n - 1]));
  assert.deepEqual(
    missed.map((n) => `${PAGE_NAME}:${n}  ${pageLines[n - 1].trim().slice(0, 90)}`), [],
    "these innerHTML writes join values into markup and no test above draws them. Draw each one with typed values, as the tests above do."
  );
});

test("the page writes markup in no other way", () => {
  const source = pageLines.slice(script.firstLine - 1, script.lastLine).join("\n");
  for (const other of ["insertAdjacentHTML", "outerHTML", "document.write", "srcdoc", "eval(", "new Function", "DOMParser", "createContextualFragment"]) {
    assert.ok(!source.includes(other), `the app's script uses ${other}, which this file does not check`);
  }
  // A handler written into markup may carry a row's own index and nothing else.
  for (const [, handler] of source.matchAll(/\bon[a-z]+=\\?"([^"]*)"/g)) {
    for (const [, joined] of handler.matchAll(/'\s*\+\s*([^+]*?)\s*\+\s*'/g)) {
      assert.equal(joined, "i", `a value is joined into a handler written as markup: ${handler.slice(0, 80)}`);
    }
  }
});

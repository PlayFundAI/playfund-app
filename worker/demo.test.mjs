// Tests for the payout figures in demo mode (public/app/demo.js).
//
// In demo mode the app's requests are answered on the page from made-up data.
// The page itself is the real one, so it keeps its rule: it shows a figure
// for money a club has received only when the reply says the figure is
// confirmed, in whole cents, and the page has put a time on it. These tests
// run the demo's stand-in for the Worker and hand its replies to the page's
// own code, lifted out of public/app/index.html, to check that:
//
//   - every reply that can carry a payout carries one the page accepts;
//   - the demo's money adds up to the cent and follows the fee rule in
//     worker/fees.mjs;
//   - with &payout=none there is no figure anywhere;
//   - a demo left open keeps its figure.
//
// Nothing here opens a browser or touches a network. demo.js is run against
// a stand-in for the few browser objects it uses.
//
//   node --test                       from the repo root, runs every *.test.mjs
//   node --test worker/demo.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PAY_IN_FULL_FEE_BPS, PAY_IN_FULL_FEE_FIXED_CENTS, applicationFeeCents } from "./fees.mjs";

const demoSource = readFileSync(new URL("../public/app/demo.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../public/app/index.html", import.meta.url), "utf8");
const WORKER = demoSource.match(/var WORKER = '([^']+)'/)[1];

// The page's own payout code.
const blockStart = page.indexOf("  var PAYOUT_UNAVAILABLE_TEXT = ");
const blockEnd = page.indexOf("  function openRoster(){", blockStart);
const fetchStart = page.indexOf("  async function fetchClub(code, token) {");
const fetchEnd = page.indexOf("  function formatDate(iso) {", fetchStart);
assert.ok(blockStart > 0 && blockEnd > blockStart && fetchStart > 0 && fetchEnd > fetchStart, "the page's payout code was not found where expected");
const helpersEnd = page.indexOf("  // Every received-money slot on every screen is filled through showPayout,", blockStart);
const pageHelpers = new Function(
  `${page.slice(page.indexOf("  var PAYOUT_ASK_AFTER_MS = ", blockStart), helpersEnd)}; return { payoutCents, fmtCents, stampPayouts, PAYOUT_SHOWN_FOR_MS };`
)();

const NOW = Date.parse("2026-12-01T15:00:00Z");

// demo.js, started the way the loader in index.html starts it, with a
// stand-in for the browser. Its replies normally arrive after a short pause;
// here they arrive at once.
function startDemo(query = "") {
  const search = "?demo=1" + (query ? "&" + query : "");
  const stored = {};
  const storage = {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => { stored[k] = String(v); },
    removeItem: (k) => { delete stored[k]; }
  };
  const window = {
    PF_DEMO_BOOT: { ready: false, failed: false },
    location: { search, href: "https://app.invalid/app/" + search, origin: "https://app.invalid", pathname: "/app/" },
    // What the loader leaves in place of fetch: it refuses everything.
    fetch: (input) => Promise.reject(new Error(`Demo mode refused a request to ${String(input)}`)),
    history: { pushState() {}, replaceState() {} },
    addEventListener() {},
    state: {}
  };
  const document = { baseURI: window.location.href, title: "" };
  const atOnce = (fn) => { Promise.resolve().then(fn); return 0; };
  new Function("window", "document", "console", "setTimeout", "localStorage", "sessionStorage", demoSource)(
    window, document, { log() {}, warn() {}, error() {} }, atOnce, storage, storage
  );
  assert.equal(window.PF_DEMO_BOOT.ready, true, "demo.js did not finish starting");
  const ask = async (method, path, { signedIn = true, body } = {}) => {
    const res = await window.fetch(WORKER + path, {
      method,
      headers: signedIn ? { Authorization: "Bearer demo.access.token" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json() };
  };
  return { window, demo: window.PF_DEMO, ask };
}

// Every payout object anywhere in a reply.
function payoutsIn(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) { node.forEach((n) => payoutsIn(n, found)); return found; }
  for (const key of Object.keys(node)) {
    if (key === "payout" && node[key] && typeof node[key] === "object") found.push(node[key]);
    else payoutsIn(node[key], found);
  }
  return found;
}

// What a family's payment leaves with the club, by the product's own rule.
function clubShare(duesCents, paymentStatus, feeBps) {
  const paymentType = paymentStatus === "paid_full" ? "full" : "bnpl";
  return duesCents - applicationFeeCents({ duesCents, paymentType, feeBps });
}
const FUNDED = ["paid_full", "bnpl_active", "bnpl_complete"];

test("the demo's two fee numbers are the ones in worker/fees.mjs", () => {
  const bps = demoSource.match(/\bPAY_IN_FULL_FEE_BPS\s*=\s*(\d+)/);
  const fixed = demoSource.match(/\bPAY_IN_FULL_FEE_FIXED_CENTS\s*=\s*(\d+)/);
  assert.ok(bps && fixed, "the two fee numbers were not found in public/app/demo.js");
  assert.equal(Number(bps[1]), PAY_IN_FULL_FEE_BPS);
  assert.equal(Number(fixed[1]), PAY_IN_FULL_FEE_FIXED_CENTS);
  // And the demo divides a payment exactly as the Worker would ask the
  // processor to, for both ways of paying, across dues and rates.
  for (const [query, feeBps] of [["", 800], ["fee=650", 650], ["fee=2000", 2000], ["fee=100", 100]]) {
    const { demo } = startDemo(query);
    for (const duesCents of [50, 99, 2500, 12345, 33333, 100000, 149999, 500000]) {
      for (const paymentType of ["full", "bnpl"]) {
        const fee = applicationFeeCents({ duesCents, paymentType, feeBps });
        assert.deepEqual(
          demo.splitPayment(duesCents, paymentType),
          { charge_cents: duesCents, application_fee_cents: fee, club_net_cents: duesCents - fee },
          `${paymentType} ${duesCents} at ${feeBps}`
        );
      }
    }
  }
});

test("every demo reply that can carry a payout carries one the page accepts", async () => {
  const { demo, ask } = startDemo();
  const replies = {
    club: (await ask("GET", `/club/${demo.club.code}`)).body,
    admin: (await ask("GET", "/admin/clubs")).body,
    team: (await ask("POST", "/team", { body: { name: "New Team", dues_cents: 50000, dues_due_date: "2027-02-01" } })).body,
    checkNow: (await ask("POST", `/admin/clubs/${demo.club.id}/payout-check`)).body
  };
  // Where the page looks for a figure on each reply.
  assert.ok(replies.club.club.payout);
  assert.ok(replies.club.club.teams.length >= 3 && replies.club.club.teams.every((t) => t.payout));
  assert.ok(replies.admin.clubs[0].payout && replies.admin.totals.payout);
  assert.ok(replies.admin.clubs[0].teams.every((t) => t.payout));
  assert.ok(replies.team.team.payout);
  assert.ok(replies.checkNow.payout);
  // What staff are shown about the check.
  assert.equal(replies.admin.clubs[0].payout_check.status, "verified");
  assert.equal(replies.checkNow.payout_check.status, "verified");

  for (const [name, reply] of Object.entries(replies)) {
    const found = payoutsIn(reply);
    assert.ok(found.length > 0, name);
    for (const payout of found) {
      // Confirmed, in whole cents.
      assert.equal(payout.verified, true, name);
      for (const field of ["club_net_cents", "charge_cents", "payment_count"]) {
        assert.ok(Number.isSafeInteger(payout[field]) && payout[field] >= 0, `${name}: ${field} is ${payout[field]}`);
      }
      // The page shows nothing it has not put a time on.
      assert.equal(pageHelpers.payoutCents(payout, "club_net_cents", NOW), null, `${name}: accepted with no time on it`);
    }
    // Marked the way the page marks a reply, each one is accepted, and it
    // stops being accepted when the page has held it too long.
    pageHelpers.stampPayouts(reply, NOW);
    for (const payout of found) {
      assert.equal(pageHelpers.payoutCents(payout, "club_net_cents", NOW), payout.club_net_cents, name);
      assert.equal(pageHelpers.payoutCents(payout, "charge_cents", NOW + 30 * 1000), payout.charge_cents, name);
      assert.equal(pageHelpers.payoutCents(payout, "club_net_cents", NOW + pageHelpers.PAYOUT_SHOWN_FOR_MS + 1), null, name);
    }
  }
  // The old estimated fields are gone from every reply.
  assert.doesNotMatch(JSON.stringify(replies), /fronted_cents|collected_cents/);
  // A caller who is not signed in is sent no payout data, as in the real app.
  const open = (await ask("GET", `/club/${demo.club.code}`, { signedIn: false })).body;
  assert.equal(payoutsIn(open).length, 0);
  assert.equal("fee_bps" in open.club, false);
});

test("the demo's money adds up to the cent, for the club, each team and the staff screens", async () => {
  for (const query of ["", "dues=1200&athletes=64&fee=650", "dues=333&athletes=7&fee=1000", "dues=1&athletes=3", "dues=50000&athletes=500&fee=2000", "pending=1"]) {
    const { demo, ask } = startDemo(query);
    const feeBps = demo.cfg.feeBps;
    const { club } = (await ask("GET", `/club/${demo.club.code}`)).body;
    const admin = (await ask("GET", "/admin/clubs")).body;

    let clubNet = 0, clubCharged = 0, clubCount = 0;
    for (const team of club.teams) {
      const paid = team.athletes.filter((a) => FUNDED.includes(a.payment_status));
      const net = paid.reduce((sum, a) => sum + clubShare(team.dues_cents, a.payment_status, feeBps), 0);
      const charged = paid.length * team.dues_cents;
      // Each team's figure is the sum for its own athletes.
      assert.deepEqual(team.payout, { verified: true, club_net_cents: net, charge_cents: charged, payment_count: paid.length }, `${query}: ${team.name}`);
      clubNet += net; clubCharged += charged; clubCount += paid.length;
    }
    assert.ok(clubCount > 0, query);
    // The headline is the sum of the club shares, and the teams add up to it.
    assert.equal(club.payout.club_net_cents, clubNet, query);
    assert.equal(club.payout.charge_cents, clubCharged, query);
    assert.equal(club.payout.payment_count, clubCount, query);
    assert.equal(demo.payout(), clubNet / 100, query);

    // The staff screens are sent the same figures, and the total is that club's.
    const row = admin.clubs[0];
    assert.equal(row.payout.club_net_cents, clubNet, query);
    assert.equal(row.payout.charge_cents, clubCharged, query);
    assert.deepEqual(row.teams.map((t) => t.payout), club.teams.map((t) => t.payout), query);
    assert.deepEqual(admin.totals.payout, { verified: true, club_net_cents: clubNet, charge_cents: clubCharged, payment_count: clubCount }, query);
    assert.equal(row.funded_count, clubCount, query);
    assert.equal(admin.totals.funded, clubCount, query);
    assert.equal(row.athlete_count, club.teams.reduce((n, t) => n + t.athletes.length, 0), query);
    assert.deepEqual(row.teams.map((t) => t.athlete_count), club.teams.map((t) => t.athletes.length), query);

    // The payments list on the staff page is what each family was charged.
    const { payments } = (await ask("GET", `/admin/clubs/${demo.club.id}/payments`)).body;
    assert.equal(payments.length, clubCount, query);
    assert.equal(payments.reduce((sum, p) => sum + p.amount_cents, 0), clubCharged, query);
    assert.ok(payments.every((p) => p.status === "succeeded" && p.athlete_name && p.team_name && p.amount === p.amount_cents / 100), query);
  }
});

test("paying for one more athlete moves the headline by exactly that family's club share", async () => {
  for (const query of ["", "dues=1234&fee=650&athletes=30"]) {
    const { demo, ask } = startDemo(query);
    const headline = async () => (await ask("GET", `/club/${demo.club.code}`)).body.club;
    const dues = demo.cfg.dues * 100;
    let before = await headline();

    for (const [type, status] of [["full", "paid_full"], ["bnpl", "bnpl_active"]]) {
      const athlete = demo.athletes.find((a) => a.payment_status === "unpaid" && a.approval_status === "approved");
      const started = await ask("POST", `/athlete/${athlete.id}/checkout`, { signedIn: false, body: { payment_type: type } });
      assert.equal(started.status, 200);
      // What the stand-in payment sheet does when its button is pressed.
      demo.markPaid(athlete, type);

      const after = await headline();
      const share = clubShare(dues, status, demo.cfg.feeBps);
      assert.equal(after.payout.club_net_cents - before.payout.club_net_cents, share, `${query} ${type}`);
      assert.equal(after.payout.charge_cents - before.payout.charge_cents, dues, `${query} ${type}`);
      assert.equal(after.payout.payment_count - before.payout.payment_count, 1, `${query} ${type}`);
      // Only that athlete's team moved, and by the same amount.
      for (const team of after.teams) {
        const was = before.teams.find((t) => t.id === team.id).payout.club_net_cents;
        assert.equal(team.payout.club_net_cents - was, team.id === athlete.team_id ? share : 0, `${query} ${type} ${team.name}`);
      }
      // The family's own view shows what it paid, and not how it was divided.
      const own = (await ask("GET", `/athlete/${athlete.id}`, { signedIn: false })).body;
      assert.equal(own.payments[0].amount_cents, dues);
      assert.equal(own.athlete.payment_status, status);
      for (const field of ["charge_cents", "application_fee_cents", "club_net_cents"]) {
        assert.equal(field in own.payments[0], false, `the family's reply carries ${field}`);
      }
      before = after;
    }
  }
});

test("a team added in the demo has its own dues, and a payment on it is divided at those dues", async () => {
  const { demo, ask } = startDemo("dues=1000&fee=800");
  const made = (await ask("POST", "/team", { body: { name: "8U Minis", age_group: "8U", dues_cents: 45000, dues_due_date: "2027-02-01" } })).body.team;
  assert.deepEqual(made.payout, { verified: true, club_net_cents: 0, charge_cents: 0, payment_count: 0 });
  const added = (await ask("POST", "/athlete", { body: { athlete_name: "New Player", team_id: made.id, parent_email: "family@example.com" } })).body.athlete;
  const before = (await ask("GET", `/club/${demo.club.code}`)).body.club;
  demo.markPaid(demo.athletes.find((a) => a.id === added.id), "full");
  const after = (await ask("GET", `/club/${demo.club.code}`)).body.club;
  const share = clubShare(45000, "paid_full", 800);
  assert.equal(after.payout.club_net_cents - before.payout.club_net_cents, share);
  assert.deepEqual(after.teams.find((t) => t.id === made.id).payout, { verified: true, club_net_cents: share, charge_cents: 45000, payment_count: 1 });
});

test("with payout=none there is no figure anywhere in the demo", async () => {
  const { demo, ask } = startDemo("payout=none");
  assert.equal(demo.cfg.payoutNone, true);
  const replies = [
    (await ask("GET", `/club/${demo.club.code}`)).body,
    (await ask("GET", "/admin/clubs")).body,
    (await ask("POST", "/team", { body: { name: "New Team", dues_cents: 50000, dues_due_date: "2027-02-01" } })).body,
    (await ask("POST", `/admin/clubs/${demo.club.id}/payout-check`)).body
  ];
  // Paying in the demo does not bring one back either.
  demo.markPaid(demo.athletes.find((a) => a.payment_status === "unpaid"), "full");
  replies.push((await ask("GET", `/club/${demo.club.code}`)).body);

  let seen = 0;
  for (const reply of replies) {
    pageHelpers.stampPayouts(reply, NOW);
    for (const payout of payoutsIn(reply)) {
      seen++;
      // Nothing rides along with "not confirmed" but, for the total, a count of clubs.
      assert.equal(payout.verified, false);
      assert.deepEqual(Object.keys(payout).filter((k) => k !== "verified" && k !== "received_ms" && k !== "unverified_clubs"), []);
      for (const field of ["club_net_cents", "charge_cents"]) {
        assert.equal(pageHelpers.payoutCents(payout, field, NOW), null);
      }
    }
  }
  assert.ok(seen >= 12, `only ${seen} payout objects were looked at`);
  assert.deepEqual(replies[1].totals.payout, { verified: false, unverified_clubs: 1, received_ms: NOW });
  // Staff see that the check did not pass, in words marked as the demo's.
  assert.equal(replies[1].clubs[0].payout_check.status, "failed");
  assert.match(replies[1].clubs[0].payout_check.message, /^Demo:/);
  assert.equal(replies[3].payout_check.status, "failed");
  assert.equal(demo.payout(), null);
  // The rest of the demo is untouched: the roster and the counts are still there.
  assert.ok(replies[0].club.teams.every((t) => t.athletes.length > 0));
  assert.ok(replies[0].stats.funded_athletes > 0);
  // Only the exact word switches it on.
  for (const other of ["payout=0", "payout=NONE", "payout=nonesuch", "payout="]) {
    assert.equal(startDemo(other).demo.cfg.payoutNone, false, other);
  }
});

// The page's own payout block and its own fetchClub, run against the demo's
// replies in a stand-in for the browser, with a clock the test moves.
function pageOnDemo(query) {
  const { window: demoWindow, demo, ask } = startDemo(query);
  const clock = { now: NOW };
  const drawn = {};
  const elements = {};
  const document = {
    hidden: false,
    getElementById(id) {
      if (!elements[id]) {
        let text = "";
        drawn[id] = [];
        elements[id] = { offsetParent: {}, classList: { toggle() {}, remove() {} } };
        Object.defineProperty(elements[id], "textContent", { get: () => text, set: (value) => { text = value; drawn[id].push(value); } });
      }
      return elements[id];
    },
    addEventListener() {}
  };
  const timers = [];
  const state = { club: null, team: null, adminCurrentTeam: null };
  const api = new Function(
    "document", "state", "Date", "setInterval", "getClubSessionToken", "console", "fetch", "WORKER_URL",
    "adminSession", "adminAllClubs", "adminDetailClubId", "clubCache", "formatDate",
    `${page.slice(blockStart, blockEnd)}\n${page.slice(fetchStart, fetchEnd)}; return { fetchClub, showPayout, refreshPayouts, payoutSlots, PAYOUT_UNAVAILABLE_TEXT, PAYOUT_UNAVAILABLE_SHORT, PAYOUT_ASK_EVERY_MS };`
  )(
    document, state, { now: () => clock.now }, (fn) => timers.push(fn), async () => "demo.access.token", { error() {} },
    (input, init) => demoWindow.fetch(input, init), WORKER, "demo.admin.token", [], demo.club.id, {}, () => ""
  );
  return { ...api, demo, ask, clock, drawn, state, tick: async () => { clock.now += api.PAYOUT_ASK_EVERY_MS; await timers[0](); }, text: (id) => elements[id].textContent };
}

test("a demo left open keeps its figure, and shows a payment made meanwhile", async () => {
  const p = pageOnDemo("");
  // Opened as the demo opens the club's dashboard: through the page's own request.
  p.state.club = await p.fetchClub(p.demo.club.code, "demo.access.token");
  p.state.team = p.state.club.teams[1];
  p.showPayout("overviewPayoutAmt", p.state.club.payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_TEXT);
  p.showPayout("statCollected", p.state.team.payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_TEXT);
  const first = p.text("overviewPayoutAmt");
  assert.match(first, /^\$[\d,]+\.\d\d$/);
  assert.equal(first, "$" + (p.demo.payout()).toLocaleString("en-US", { minimumFractionDigits: 2 }));

  // Ten minutes with the dashboard open: the figure is never replaced by the line of text.
  for (let i = 0; i < 40; i++) await p.tick();
  assert.equal(p.text("overviewPayoutAmt"), first);
  for (const id of ["overviewPayoutAmt", "statCollected"]) {
    assert.equal(p.drawn[id].includes(p.PAYOUT_UNAVAILABLE_TEXT), false, `${id} vanished from a demo left open`);
  }

  // A family pays in the demo. Within a minute the open dashboard shows the
  // new figure, to the cent, with no reload.
  const athlete = p.demo.athletes.find((a) => a.payment_status === "unpaid" && a.team_id === p.state.team.id);
  const before = p.demo.payout();
  p.demo.markPaid(athlete, "bnpl");
  for (let i = 0; i < 4; i++) await p.tick();
  const share = clubShare(p.demo.cfg.dues * 100, "bnpl_active", p.demo.cfg.feeBps) / 100;
  assert.equal(p.demo.payout(), before + share);
  assert.equal(p.text("overviewPayoutAmt"), "$" + (before + share).toLocaleString("en-US", { minimumFractionDigits: 2 }));
  assert.notEqual(p.text("statCollected"), p.PAYOUT_UNAVAILABLE_TEXT);
});

test("with payout=none an open demo shows the line of text and keeps showing it", async () => {
  const p = pageOnDemo("payout=none");
  p.state.club = await p.fetchClub(p.demo.club.code, "demo.access.token");
  p.state.team = p.state.club.teams[0];
  p.showPayout("overviewPayoutAmt", p.state.club.payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_TEXT);
  p.showPayout("bucketFundedAmt", p.state.club.payout, "club_net_cents", "");
  p.showPayout("statCollected", p.state.team.payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_TEXT);
  for (let i = 0; i < 12; i++) await p.tick();
  assert.equal(p.text("overviewPayoutAmt"), p.PAYOUT_UNAVAILABLE_TEXT);
  assert.equal(p.text("statCollected"), p.PAYOUT_UNAVAILABLE_TEXT);
  assert.equal(p.text("bucketFundedAmt"), "");
  for (const id of Object.keys(p.drawn)) {
    assert.equal(p.drawn[id].some((text) => /\$/.test(text)), false, `${id} showed a figure with payout=none`);
  }
});

test("staff screens left open in the demo keep their figures too", async () => {
  const p = pageOnDemo("");
  const admin = (await p.ask("GET", "/admin/clubs")).body;
  const slots = {
    adminTotalFronted: [() => admin.totals.payout, "club_net_cents"],
    adminTotalCollected: [() => admin.totals.payout, "charge_cents"],
    adminDetailFronted: [() => admin.clubs[0].payout, "club_net_cents"],
    ["adminClubCardPayout-" + admin.clubs[0].id]: [() => admin.clubs[0].payout, "club_net_cents"],
    ["adminTeamCardPayout-" + admin.clubs[0].teams[0].id]: [() => admin.clubs[0].teams[0].payout, "club_net_cents"]
  };
  // No time on them yet: the page shows none of them.
  for (const [id, [get, field]] of Object.entries(slots)) {
    p.showPayout(id, get(), field, p.PAYOUT_UNAVAILABLE_SHORT);
    assert.equal(p.text(id), p.PAYOUT_UNAVAILABLE_SHORT);
  }
  // The page asks for itself, and from then on they are there and stay there.
  await p.tick();
  for (const id of Object.keys(slots)) { assert.match(p.text(id), /^\$[\d,]+\.\d\d$/, id); p.drawn[id].length = 0; }
  for (let i = 0; i < 40; i++) await p.tick();
  for (const id of Object.keys(slots)) {
    assert.equal(p.drawn[id].includes(p.PAYOUT_UNAVAILABLE_SHORT), false, `${id} vanished from a demo left open`);
  }
  assert.equal(p.text("adminTotalFronted"), "$" + p.demo.payout().toLocaleString("en-US", { minimumFractionDigits: 2 }));
});

test("the demo never puts a club straight into the app's state", () => {
  // The page shows no figure it cannot date, and only its own request puts a
  // time on one. So the demo hands the app its club through that request.
  const direct = [...demoSource.matchAll(/window\.state\.club\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(direct, ["loaded"], "window.state.club is set from something other than the app's own request");
  assert.match(demoSource, /window\.fetchClub\(club\.code, session\(\)\.access_token\)\.then\(function \(loaded\) \{\s*window\.state\.club = loaded;/);
  // Nor a team: a team has to be the copy the app is holding, which carries its figure.
  assert.doesNotMatch(demoSource, /window\.state\.team\s*=\s*teams\[/);
  // And no trace of the old estimate.
  assert.doesNotMatch(demoSource, /fronted_cents|collected_cents|frontedCents|collectedCents/);
  // The only fee arithmetic in the file is the one function that divides a payment.
  assert.equal(demoSource.match(/cfg\.feeBps\s*\/\s*10000/g).length, 1);
  assert.equal(demoSource.match(/PAY_IN_FULL_FEE_BPS\s*\/\s*10000/g).length, 1);
});

// The demo's own start-up, run with the page's real fetchClub and stand-ins
// for the screens it opens. This is the path a person takes when they open
// the demo address, and the part of demo.js that used to put the club
// straight into the app's state.
async function openDemo(query) {
  const search = "?demo=1" + (query ? "&" + query : "");
  const stored = {};
  const storage = {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => { stored[k] = String(v); },
    removeItem: (k) => { delete stored[k]; }
  };
  const opened = [];
  const listeners = {};
  const element = () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, querySelector: () => null, textContent: "", innerHTML: "" });
  const document = {
    baseURI: "https://app.invalid/app/" + search, title: "", head: element(), body: element(), documentElement: element(),
    createElement: element, getElementById: () => null, querySelector: () => null, addEventListener() {}
  };
  const window = {
    PF_DEMO_BOOT: { ready: false, failed: false },
    location: { search, href: document.baseURI, origin: "https://app.invalid", pathname: "/app/" },
    fetch: (input) => Promise.reject(new Error(`Demo mode refused a request to ${String(input)}`)),
    history: { pushState() {}, replaceState() {} },
    addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
    state: { club: null, team: null },
    adminAllClubs: [],
    openClubOverview: () => opened.push("club-overview"),
    openRoster: () => opened.push("roster"),
    showAddAthleteScreen: () => opened.push("add-athlete-admin"),
    showScreen: (name) => opened.push(name),
    startStripeOnboarding: () => opened.push("club-stripe-onboarding"),
    ask: () => opened.push("ask"),
    openAdminClubDetail: (club) => opened.push(["admin-club-detail", club]),
    openAdminTeamRoster: (club, team) => opened.push(["admin-team-roster", club, team])
  };
  const atOnce = (fn) => { Promise.resolve().then(fn); return 0; };
  new Function("window", "document", "console", "setTimeout", "localStorage", "sessionStorage", "requestAnimationFrame", demoSource)(
    window, document, { log() {}, warn() {}, error() {} }, atOnce, storage, storage, atOnce
  );
  // The page's own fetchClub, talking to the demo's fetch.
  window.fetchClub = new Function(
    "Date", "fetch", "WORKER_URL", "clubCache", "formatDate", "console", "stampPayouts",
    `${page.slice(fetchStart, fetchEnd)}; return fetchClub;`
  )(Date, (input, init) => window.fetch(input, init), WORKER, {}, () => "", { error() {} }, pageHelpers.stampPayouts);
  // The page's way into the staff screens: a saved token, then its own request for the list.
  window.enterAdminMode = () => {
    opened.push("admin-clubs");
    window.adminSession = storage.getItem("pf_admin_token");
    const askedAt = Date.now();
    window.fetch(WORKER + "/admin/clubs", { headers: { Authorization: "Bearer " + window.adminSession } })
      .then((res) => res.json())
      .then((data) => { window.adminAllClubs = pageHelpers.stampPayouts(data, askedAt).clubs; });
  };
  for (const start of listeners.load || []) start({});
  for (let i = 0; i < 60; i++) await new Promise((resolve) => setImmediate(resolve));
  return { window, demo: window.PF_DEMO, opened, storage };
}

test("the demo opens each club screen through the page's own request, with a dated figure", async () => {
  for (const query of ["screen=club-overview", "screen=roster", "screen=add-athlete-admin", "screen=add-team", "role=club"]) {
    const { window, demo, opened, storage } = await openDemo(query);
    const club = window.state.club;
    assert.ok(club, `${query}: the app was given no club`);
    // The figure arrived through the page's request, so it has a time on it
    // and the page will show it.
    assert.equal(typeof club.payout.received_ms, "number", query);
    assert.equal(pageHelpers.payoutCents(club.payout, "club_net_cents", Date.now()), Math.round(demo.payout() * 100), query);
    assert.ok(club.teams.every((t) => typeof t.payout.received_ms === "number"), query);
    // Signed in as the club, which is what lets the page ask again by itself.
    assert.ok(JSON.parse(storage.getItem("pf_club_session")).access_token, query);
    const expected = query === "role=club" ? "club-overview" : query.slice("screen=".length);
    assert.ok(opened.includes(expected), `${query}: opened ${JSON.stringify(opened)}`);
    if (/roster|add-athlete-admin/.test(query)) {
      // The team is the copy the app is holding, which carries its own figure.
      assert.ok(club.teams.includes(window.state.team), query);
      assert.equal(window.state.team.id, demo.teams[1].id, query);
      assert.equal(typeof window.state.team.payout.received_ms, "number", query);
    }
  }
});

test("the guided steps hand the app its club and team the same way", async () => {
  const { window, demo, opened } = await openDemo("screen=club-overview");
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve)); };
  const roster = demo.steps.find((step) => step.screen === "roster" && step.go);
  const back = demo.steps.filter((step) => step.screen === "club-overview" && step.go).pop();

  roster.go();
  await settle();
  assert.ok(opened.includes("roster"));
  assert.ok(window.state.club.teams.includes(window.state.team));
  assert.equal(typeof window.state.team.payout.received_ms, "number");

  // A family pays, and the presenter goes back to the dashboard: the app is
  // given a fresh club, asked for again, with the new figure in it.
  const before = window.state.club;
  demo.markPaid(demo.athletes.find((a) => a.payment_status === "unpaid"), "full");
  back.go();
  await settle();
  assert.notEqual(window.state.club, before);
  assert.equal(pageHelpers.payoutCents(window.state.club.payout, "club_net_cents", Date.now()), Math.round(demo.payout() * 100));
  assert.ok(window.state.club.payout.club_net_cents > before.payout.club_net_cents);
});

test("the demo opens the staff screens the app's own way, with figures on the club and its teams", async () => {
  for (const [query, last] of [["screen=admin-clubs", "admin-clubs"], ["screen=admin-club-detail", "admin-club-detail"], ["screen=admin-team-roster", "admin-team-roster"]]) {
    const { window, demo, opened, storage } = await openDemo(query);
    assert.equal(opened[0], "admin-clubs", query);
    assert.equal(storage.getItem("pf_admin_token"), "demo.admin.token", query);
    assert.equal(window.adminAllClubs.length, 1, query);
    const listed = window.adminAllClubs[0];
    assert.equal(pageHelpers.payoutCents(listed.payout, "club_net_cents", Date.now()), Math.round(demo.payout() * 100), query);
    if (last === "admin-clubs") { assert.equal(opened.length, 1, query); continue; }
    const step = opened[opened.length - 1];
    assert.equal(step[0], last, query);
    assert.equal(step[1], listed, query);
    if (last === "admin-team-roster") {
      assert.equal(step[2].id, demo.teams[1].id, query);
      assert.equal(typeof step[2].payout.received_ms, "number", query);
    }
  }
  // With payout=none the staff screens open the same way, with nothing to show.
  const none = await openDemo("screen=admin-club-detail&payout=none");
  assert.deepEqual({ ...none.window.adminAllClubs[0].payout, received_ms: 0 }, { verified: false, received_ms: 0 });
  assert.equal(none.window.adminAllClubs[0].payout_check.status, "failed");
});

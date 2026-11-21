// Tests that read the app page, public/app/index.html.
//
// The page is a static file and cannot import the Worker's modules. What it
// must never do again is work out a payout itself: it shows the figure the
// Worker sends, which the Worker sends only after matching it against the
// payment processor's records, or it shows no figure. These tests lift the
// page's own helpers out of the HTML and run them, and read the page for any
// sign of the old arithmetic.
//
//   node --test                           from the repo root, runs every *.test.mjs
//   node --test worker/app-page.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../public/app/index.html", import.meta.url), "utf8");

// Every element that shows money a club has received.
const RECEIVED_MONEY_ELEMENTS = [
  "overviewPayoutAmt", "bucketFundedAmt", "statCollected",
  "adminTotalFronted", "adminTotalCollected",
  "adminDetailFronted", "adminDetailCollected",
  "adminRosterFronted", "adminRosterCollected"
];

function pageHelpers() {
  const start = page.indexOf("  var PAYOUT_SHOWN_FOR_MS = ");
  const end = page.indexOf("  // Every received-money slot on every screen is filled through showPayout,", start);
  assert.ok(start > 0 && end > start, "the payout helpers were not found where expected in public/app/index.html");
  return new Function(`${page.slice(start, end)}; return { payoutCents, fmtCents, stampPayouts, PAYOUT_SHOWN_FOR_MS };`)();
}

const NOW = Date.parse("2026-12-01T15:00:00Z");
// A figure the way the page holds it: as sent by the Worker, marked with the
// time it arrived.
const sent = (fields, receivedMs = NOW) => ({ ...fields, received_ms: receivedMs });

test("the app page shows the Worker's figure or nothing", () => {
  const { payoutCents, fmtCents } = pageHelpers();
  assert.equal(payoutCents(sent({ verified: true, club_net_cents: 97070 }), "club_net_cents", NOW), 97070);
  assert.equal(payoutCents(sent({ verified: true, club_net_cents: 0 }), "club_net_cents", NOW), 0);
  for (const nothing of [
    undefined, null, {}, { verified: false }, { verified: false, club_net_cents: 97070 }, { club_net_cents: 97070 },
    { verified: "true", club_net_cents: 97070 }, { verified: 1, club_net_cents: 97070 },
    { verified: true }, { verified: true, club_net_cents: null }, { verified: true, club_net_cents: "97070" },
    { verified: true, club_net_cents: NaN }, { verified: true, club_net_cents: Infinity },
    { verified: true, club_net_cents: -1 }, { verified: true, club_net_cents: 970.7 }
  ]) {
    assert.equal(payoutCents(nothing && sent(nothing), "club_net_cents", NOW), null, JSON.stringify(nothing));
  }
  // To the cent, never rounded to the dollar.
  assert.equal(fmtCents(97070), "$970.70");
  assert.equal(fmtCents(0), "$0.00");
  assert.equal(fmtCents(5), "$0.05");
  assert.equal(fmtCents(100), "$1.00");
  assert.equal(fmtCents(4600000), "$46,000.00");
  assert.equal(fmtCents(123456789), "$1,234,567.89");
  for (let cents = 0; cents < 30000; cents += 7) {
    const text = fmtCents(cents);
    assert.equal(Math.round(Number(text.replace(/[$,]/g, "")) * 100), cents, text);
    assert.match(text, /^\$[\d,]+\.\d\d$/);
  }
});

test("the app page stops showing a figure it has held for too long", () => {
  const { payoutCents, stampPayouts, PAYOUT_SHOWN_FOR_MS } = pageHelpers();
  const figure = { verified: true, club_net_cents: 97070 };
  assert.ok(PAYOUT_SHOWN_FOR_MS > 0 && PAYOUT_SHOWN_FOR_MS <= 15 * 60 * 1000, "a page should not hold a figure for longer than a quarter of an hour");
  assert.equal(payoutCents(sent(figure, NOW), "club_net_cents", NOW + PAYOUT_SHOWN_FOR_MS), 97070);
  assert.equal(payoutCents(sent(figure, NOW), "club_net_cents", NOW + PAYOUT_SHOWN_FOR_MS + 1), null);
  assert.equal(payoutCents(sent(figure, NOW), "club_net_cents", NOW + 24 * 60 * 60 * 1000), null);
  // A device clock that has gone backwards is not trusted either.
  assert.equal(payoutCents(sent(figure, NOW), "club_net_cents", NOW - 1), null);
  // A figure that was never marked with an arrival time is not shown.
  assert.equal(payoutCents(figure, "club_net_cents", NOW), null);
  assert.equal(payoutCents({ ...figure, received_ms: "now" }, "club_net_cents", NOW), null);

  // Marking a reply finds every figure in it, however it is nested.
  const reply = stampPayouts({
    club: { payout: { verified: true, club_net_cents: 5 }, teams: [{ id: "t1", payout: { verified: true, club_net_cents: 5 }, athletes: [{ id: "a1" }] }] },
    clubs: [{ payout: { verified: false }, teams: [{ payout: { verified: true, club_net_cents: 0 } }] }],
    totals: { payout: { verified: true, club_net_cents: 5 } },
    team: { payout: { verified: true, club_net_cents: 0 } }
  }, NOW);
  for (const marked of [reply.club.payout, reply.club.teams[0].payout, reply.clubs[0].payout, reply.clubs[0].teams[0].payout, reply.totals.payout, reply.team.payout]) {
    assert.equal(marked.received_ms, NOW);
  }
  assert.equal(stampPayouts(null, NOW), null);

  // Every reply that can carry a figure is marked as it arrives: a club, a
  // new team, the admin list, and a team opened from the admin list.
  assert.equal(page.match(/stampPayouts\(await res\.json\(\), Date\.now\(\)\)/g).length, 4);
  // And the page checks again by itself, without waiting to be reloaded.
  assert.match(page, /setInterval\(refreshPayouts, 60 \* 1000\);/);
  assert.match(page, /addEventListener\('visibilitychange'/);
});

// The page cannot be loaded here, so its refresh logic is run against a
// stand-in for the browser: a few elements, a clock, and a Worker reply.
function pageWithFakeBrowser({ club, token = "token", fetched }) {
  const start = page.indexOf("  var PAYOUT_UNAVAILABLE_TEXT = ");
  const end = page.indexOf("  function openRoster(){", start);
  assert.ok(start > 0 && end > start, "the payout block was not found where expected in public/app/index.html");
  const elements = {};
  const element = (id) => (elements[id] ||= { textContent: "", classes: new Set(), classList: null });
  const fake = {
    clock: { now: NOW },
    timers: [],
    listeners: {},
    fetches: 0,
    text: (id) => element(id).textContent,
    unavailable: (id) => element(id).classes.has("is-unavailable")
  };
  const document = {
    hidden: false,
    getElementById(id) {
      const el = element(id);
      el.classList ||= {
        toggle: (name, on) => (on ? el.classes.add(name) : el.classes.delete(name)),
        remove: (name) => el.classes.delete(name)
      };
      return el;
    },
    addEventListener: (name, fn) => { fake.listeners[name] = fn; }
  };
  const state = { club, team: null };
  const api = new Function(
    "document", "state", "Date", "setInterval", "getClubSessionToken", "fetchClub", "console",
    `${page.slice(start, end)}; return { showPayout, clearPayout, refreshPayouts, stampPayouts, payoutSlots, PAYOUT_UNAVAILABLE_TEXT, PAYOUT_UNAVAILABLE_SHORT, PAYOUT_SHOWN_FOR_MS };`
  )(
    document, state, { now: () => fake.clock.now },
    (fn, ms) => fake.timers.push({ fn, ms }),
    async () => token,
    async (code, tok) => { fake.fetches++; return fetched(code, tok, fake.clock.now); },
    { error() {} }
  );
  // The same object, so that counts kept on it stay live.
  return Object.assign(fake, api, { state, document });
}

test("a club dashboard left open asks the Worker again and never keeps an old figure", async () => {
  const team = { id: "t1", payout: sent({ verified: true, club_net_cents: 97070 }) };
  const club = { code: "TESTCLB", payout: sent({ verified: true, club_net_cents: 97070 }), teams: [team] };
  let next = (now) => ({ payout: sent({ verified: true, club_net_cents: 189070 }, now), teams: [{ id: "t1", payout: sent({ verified: true, club_net_cents: 189070 }, now) }] });
  const p = pageWithFakeBrowser({ club, fetched: (code, tok, now) => next(now) });
  p.state.team = team;

  p.showPayout("overviewPayoutAmt", club.payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_TEXT);
  p.showPayout("bucketFundedAmt", club.payout, "club_net_cents", "");
  p.showPayout("statCollected", team.payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_TEXT);
  assert.equal(p.text("overviewPayoutAmt"), "$970.70");
  assert.equal(p.timers.length, 1);
  assert.equal(p.timers[0].ms, 60 * 1000);

  // Within the time a figure may be held, the page does not ask again.
  p.clock.now += 5 * 60 * 1000;
  await p.timers[0].fn();
  assert.equal(p.fetches, 0);
  assert.equal(p.text("overviewPayoutAmt"), "$970.70");

  // Past it, the page asks, and shows what the Worker says now.
  p.clock.now += p.PAYOUT_SHOWN_FOR_MS;
  await p.timers[0].fn();
  assert.equal(p.fetches, 1);
  assert.equal(p.text("overviewPayoutAmt"), "$1,890.70");
  assert.equal(p.text("bucketFundedAmt"), "$1,890.70");
  assert.equal(p.text("statCollected"), "$1,890.70");

  // The Worker no longer vouches for a figure (a refund, say): the number goes.
  next = (now) => ({ payout: sent({ verified: false }, now), teams: [{ id: "t1", payout: sent({ verified: false }, now) }] });
  p.clock.now += p.PAYOUT_SHOWN_FOR_MS + 1;
  // This time by coming back to the tab. The listener does not wait for the
  // reply, so give the reply a moment to land.
  p.listeners.visibilitychange();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(p.fetches, 2);
  assert.equal(p.text("overviewPayoutAmt"), p.PAYOUT_UNAVAILABLE_TEXT);
  assert.equal(p.unavailable("overviewPayoutAmt"), true);
  assert.equal(p.text("bucketFundedAmt"), "");
  assert.equal(p.text("statCollected"), p.PAYOUT_UNAVAILABLE_TEXT);

  // The Worker cannot be reached at all: the old figure is not kept.
  const q = pageWithFakeBrowser({ club: { code: "TESTCLB", payout: sent({ verified: true, club_net_cents: 500 }), teams: [] }, fetched: () => null });
  q.showPayout("overviewPayoutAmt", q.state.club.payout, "club_net_cents", q.PAYOUT_UNAVAILABLE_TEXT);
  assert.equal(q.text("overviewPayoutAmt"), "$5.00");
  q.clock.now += q.PAYOUT_SHOWN_FOR_MS + 1;
  await q.timers[0].fn();
  assert.equal(q.fetches, 1);
  assert.equal(q.text("overviewPayoutAmt"), q.PAYOUT_UNAVAILABLE_TEXT);

  // Signed out in the meantime: nothing to ask with, and the figure still goes.
  const r = pageWithFakeBrowser({ club: { code: "TESTCLB", payout: sent({ verified: true, club_net_cents: 500 }), teams: [] }, token: null, fetched: () => { throw new Error("should not be asked"); } });
  r.showPayout("overviewPayoutAmt", r.state.club.payout, "club_net_cents", r.PAYOUT_UNAVAILABLE_TEXT);
  r.clock.now += r.PAYOUT_SHOWN_FOR_MS + 1;
  await r.timers[0].fn();
  assert.equal(r.fetches, 0);
  assert.equal(r.text("overviewPayoutAmt"), r.PAYOUT_UNAVAILABLE_TEXT);
});

test("an admin screen left open stops showing figures it has held too long", async () => {
  const p = pageWithFakeBrowser({ club: null, fetched: () => { throw new Error("admin screens do not refetch by themselves"); } });
  const figure = sent({ verified: true, club_net_cents: 4600000, charge_cents: 5000000 });
  p.showPayout("adminTotalFronted", figure, "club_net_cents", p.PAYOUT_UNAVAILABLE_SHORT);
  p.showPayout("adminTotalCollected", figure, "charge_cents", p.PAYOUT_UNAVAILABLE_SHORT);
  p.showPayout("adminClubCardPayout-club_1", figure, "club_net_cents", p.PAYOUT_UNAVAILABLE_SHORT);
  assert.equal(p.text("adminTotalFronted"), "$46,000.00");
  assert.equal(p.text("adminTotalCollected"), "$50,000.00");
  p.clock.now += p.PAYOUT_SHOWN_FOR_MS + 1;
  await p.timers[0].fn();
  assert.equal(p.fetches, 0);
  for (const id of ["adminTotalFronted", "adminTotalCollected", "adminClubCardPayout-club_1"]) {
    assert.equal(p.text(id), p.PAYOUT_UNAVAILABLE_SHORT, id);
    assert.equal(p.unavailable(id), true, id);
  }
  // A slot that is cleared for loading is forgotten, not redrawn from old data.
  p.clearPayout("adminTotalFronted");
  assert.equal(p.text("adminTotalFronted"), "");
  await p.timers[0].fn();
  assert.equal(p.text("adminTotalFronted"), "");
});

test("the app page does no fee arithmetic of its own", () => {
  for (const gone of ["clubPayoutFor", "clubFeeRate", "PAY_IN_FULL_FEE", "fronted_cents", "collected_cents", "teamSummary", "advanceAmt", "recoveryPct", "RecoveryBar"]) {
    assert.equal(page.includes(gone), false, `${gone} is back in public/app/index.html`);
  }
  // The club's rate appears only where staff read and set it, never in a sum
  // that produces a dollar figure.
  const script = page.slice(page.lastIndexOf("<script>"));
  const feeLines = script.split("\n").filter((line) => /fee_bps/.test(line) && !/^\s*\/\//.test(line));
  for (const line of feeLines) {
    assert.match(line, /feeInput\.value = club\.fee_agreed_at \? \(club\.fee_bps \/ 100\)|JSON\.stringify\(\{ fee_bps: feeBps \}\)/, `unexpected use of the club's rate: ${line.trim()}`);
  }
});

test("on the app page every received-money slot is filled only by the Worker's figure", () => {
  for (const id of RECEIVED_MONEY_ELEMENTS) {
    // In the markup the slot starts empty: no "$0" waiting to be mistaken for a figure.
    const markup = page.match(new RegExp(`id="${id}">([^<]*)<`));
    assert.ok(markup, `${id} not found in the markup`);
    assert.equal(markup[1], "", `${id} has a default of "${markup[1]}"`);
    // In the script it is only ever touched through showPayout or clearPayout.
    const uses = [...page.matchAll(new RegExp(`['"]${id}['"]`, "g"))].map((m) => page.slice(page.lastIndexOf("\n", m.index) + 1, page.indexOf("\n", m.index)));
    const scriptUses = uses.filter((line) => !line.includes(`id="${id}"`));
    assert.ok(scriptUses.length > 0, `${id} is never filled`);
    for (const line of scriptUses) {
      assert.match(line, new RegExp(`(showPayout|clearPayout)\\('${id}'`), `${id} is written some other way: ${line.trim()}`);
    }
  }
  // The one bucket amount that is money received is not written by the
  // generic bucket code.
  assert.match(page, /setBucket\('Funded',\s+totalFunded,\s+null\);/);
  // The words shown in place of a figure live in one place.
  assert.equal(page.match(/PAYOUT_UNAVAILABLE_TEXT = /g).length, 1);
  assert.equal(page.match(/PAYOUT_UNAVAILABLE_SHORT = /g).length, 1);
});

test("the admin screens no longer describe the figure as money PlayFund fronted or advanced", () => {
  // Labels and the staff-facing lines, not the frequently asked questions
  // further down the page, which are a separate matter.
  for (const label of [...page.matchAll(/class="(?:admin-fin-label|team-card-funded-label|admin-recovery-label)"[^>]*>([^<]*)</g)].map((m) => m[1])) {
    assert.doesNotMatch(label, /fronted|advance|recovered/i, label);
  }
  assert.doesNotMatch(page, /of advances recovered|Advances Recovered|Fronted to Club/);
});

test("the words shown in place of a figure make no claim", () => {
  const text = page.match(/PAYOUT_UNAVAILABLE_TEXT = '([^']+)'/)[1] + " " + page.match(/PAYOUT_UNAVAILABLE_SHORT = '([^']+)'/)[1];
  assert.doesNotMatch(text, /\d/, "no number, date or time");
  assert.doesNotMatch(text, /—/, "no em dash");
  assert.doesNotMatch(text, /stripe|klarna|refund|dispute|soon|shortly|today|tomorrow|day|hour|guarantee|risk|fee/i);
});

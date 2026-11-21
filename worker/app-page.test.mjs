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
  assert.ok(PAYOUT_SHOWN_FOR_MS > 0 && PAYOUT_SHOWN_FOR_MS <= 2 * 60 * 1000, "a page should not hold a figure for longer than a couple of minutes");
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
  // new team, the admin list (when opened and when asked again), and a team
  // opened from the admin list.
  assert.equal(page.match(/stampPayouts\(await res\.json\(\), Date\.now\(\)\)/g).length, 5);
  // And the page checks again by itself, without waiting to be reloaded.
  assert.match(page, /setInterval\(refreshPayouts, PAYOUT_ASK_EVERY_MS\);/);
  assert.match(page, /addEventListener\('visibilitychange'/);
});

// The page cannot be loaded here, so its refresh logic is run against a
// stand-in for the browser: a few elements, a clock, and the Worker's replies.
function pageWithFakeBrowser({ club = null, token = "token", fetched = () => null, adminSession = null, adminClubs = [], adminReply = null }) {
  const start = page.indexOf("  var PAYOUT_UNAVAILABLE_TEXT = ");
  const end = page.indexOf("  function openRoster(){", start);
  assert.ok(start > 0 && end > start, "the payout block was not found where expected in public/app/index.html");
  const elements = {};
  const fake = {
    clock: { now: NOW },
    timers: [],
    listeners: {},
    fetches: 0,
    adminFetches: 0,
    hiddenScreens: new Set(),
    text: (id) => document.getElementById(id).textContent,
    unavailable: (id) => document.getElementById(id).classes.has("is-unavailable")
  };
  const document = {
    hidden: false,
    getElementById(id) {
      if (!elements[id]) {
        const el = { textContent: "", classes: new Set() };
        el.classList = {
          toggle: (name, on) => (on ? el.classes.add(name) : el.classes.delete(name)),
          remove: (name) => el.classes.delete(name)
        };
        // null while the screen the element sits on is not the one showing.
        Object.defineProperty(el, "offsetParent", { get: () => (fake.hiddenScreens.has(id) ? null : {}) });
        elements[id] = el;
      }
      return elements[id];
    },
    addEventListener: (name, fn) => { fake.listeners[name] = fn; }
  };
  const state = { club, team: null, adminCurrentTeam: null };
  const api = new Function(
    "document", "state", "Date", "setInterval", "getClubSessionToken", "fetchClub", "console",
    "fetch", "WORKER_URL", "adminSession", "adminAllClubs", "adminDetailClubId",
    `${page.slice(start, end)}; return { showPayout, clearPayout, refreshPayouts, stampPayouts, payoutSlots, PAYOUT_UNAVAILABLE_TEXT, PAYOUT_UNAVAILABLE_SHORT, PAYOUT_SHOWN_FOR_MS, PAYOUT_ASK_EVERY_MS };`
  )(
    document, state, { now: () => fake.clock.now },
    (fn, ms) => fake.timers.push({ fn, ms }),
    async () => token,
    async (code, tok) => { fake.fetches++; return fetched(code, tok, fake.clock.now); },
    { error() {} },
    async (url) => {
      fake.adminFetches++;
      assert.equal(url, "https://worker.invalid/admin/clubs");
      const body = fake.adminReply ? fake.adminReply() : null;
      return { ok: body !== null, json: async () => body };
    },
    "https://worker.invalid", adminSession, adminClubs, "club_1"
  );
  fake.adminReply = adminReply;
  // The same object, so that counts kept on it stay live.
  return Object.assign(fake, api, { state, document });
}

test("a club dashboard left open asks the Worker again about every minute and never keeps an old figure", async () => {
  const team = { id: "t1", payout: sent({ verified: true, club_net_cents: 97070 }) };
  const club = { code: "TESTCLB", payout: sent({ verified: true, club_net_cents: 97070 }), teams: [team] };
  let next = (now) => ({ payout: sent({ verified: true, club_net_cents: 189070 }, now), teams: [{ id: "t1", payout: sent({ verified: true, club_net_cents: 189070 }, now) }] });
  const p = pageWithFakeBrowser({ club, fetched: (code, tok, now) => next(now) });
  p.state.team = team;
  const tick = async (ms) => { p.clock.now += ms; await p.timers[0].fn(); };

  // Short enough that a withdrawn figure is gone within about 75 seconds.
  assert.equal(p.PAYOUT_SHOWN_FOR_MS, 60 * 1000);
  assert.equal(p.PAYOUT_ASK_EVERY_MS, 15 * 1000);
  assert.equal(p.timers.length, 1);
  assert.equal(p.timers[0].ms, p.PAYOUT_ASK_EVERY_MS);

  p.showPayout("overviewPayoutAmt", club.payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_TEXT);
  p.showPayout("bucketFundedAmt", club.payout, "club_net_cents", "");
  p.showPayout("statCollected", team.payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_TEXT);
  assert.equal(p.text("overviewPayoutAmt"), "$970.70");

  // For the first minute the page does not ask again.
  for (let i = 0; i < 4; i++) await tick(p.PAYOUT_ASK_EVERY_MS);
  assert.equal(p.fetches, 0);
  assert.equal(p.text("overviewPayoutAmt"), "$970.70");

  // At the next look at the clock it asks, and shows what the Worker says now.
  await tick(p.PAYOUT_ASK_EVERY_MS);
  assert.equal(p.fetches, 1);
  assert.equal(p.text("overviewPayoutAmt"), "$1,890.70");
  assert.equal(p.text("bucketFundedAmt"), "$1,890.70");
  assert.equal(p.text("statCollected"), "$1,890.70");

  // The Worker no longer vouches for a figure (a refund, say): the number
  // goes, at most a minute and a quarter after the page last asked.
  next = (now) => ({ payout: sent({ verified: false }, now), teams: [{ id: "t1", payout: sent({ verified: false }, now) }] });
  let waited = 0;
  while (p.text("overviewPayoutAmt") === "$1,890.70") {
    await tick(p.PAYOUT_ASK_EVERY_MS);
    waited += p.PAYOUT_ASK_EVERY_MS;
    assert.ok(waited <= 75 * 1000, "the old figure stayed up for more than 75 seconds");
  }
  assert.equal(p.text("overviewPayoutAmt"), p.PAYOUT_UNAVAILABLE_TEXT);
  assert.equal(p.unavailable("overviewPayoutAmt"), true);
  assert.equal(p.text("bucketFundedAmt"), "");
  assert.equal(p.text("statCollected"), p.PAYOUT_UNAVAILABLE_TEXT);

  // With no figure on screen the page keeps asking, so one appears by itself
  // once a check has passed again.
  next = (now) => ({ payout: sent({ verified: true, club_net_cents: 97070 }, now), teams: [{ id: "t1", payout: sent({ verified: true, club_net_cents: 97070 }, now) }] });
  for (let i = 0; i < 5; i++) await tick(p.PAYOUT_ASK_EVERY_MS);
  assert.equal(p.text("overviewPayoutAmt"), "$970.70");
});

test("a dashboard in a tab nobody is looking at does not ask, and catches up the moment it is looked at", async () => {
  const club = { code: "TESTCLB", payout: sent({ verified: true, club_net_cents: 500 }), teams: [] };
  let answer = null;
  const p = pageWithFakeBrowser({ club, fetched: async (code, tok, now) => answer(now) });
  p.showPayout("overviewPayoutAmt", club.payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_TEXT);

  p.document.hidden = true;
  p.clock.now += 30 * 60 * 1000;
  await p.timers[0].fn();
  assert.equal(p.fetches, 0, "a hidden tab does not keep asking the Worker");
  // Even unseen, it has stopped holding the old figure.
  assert.equal(p.text("overviewPayoutAmt"), p.PAYOUT_UNAVAILABLE_TEXT);

  // Looked at again: the old figure is already gone before the Worker has
  // answered, and the fresh one replaces the line of text when it arrives.
  let release;
  answer = (now) => new Promise((resolve) => { release = () => resolve({ payout: sent({ verified: true, club_net_cents: 700 }, now), teams: [] }); });
  p.document.hidden = false;
  p.listeners.visibilitychange();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(p.fetches, 1);
  assert.equal(p.text("overviewPayoutAmt"), p.PAYOUT_UNAVAILABLE_TEXT);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(p.text("overviewPayoutAmt"), "$7.00");

  // The same when the tab stays in view but the page has not run for a while
  // (a laptop asleep, say). The first thing it does on running again is take
  // the old figure down. It does not wait for the Worker's reply to do that.
  p.clock.now += 5 * 60 * 1000;
  assert.equal(p.text("overviewPayoutAmt"), "$7.00");
  answer = (now) => new Promise((resolve) => { release = () => resolve({ payout: sent({ verified: true, club_net_cents: 900 }, now), teams: [] }); });
  const running = p.timers[0].fn();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(p.fetches, 2);
  assert.equal(p.text("overviewPayoutAmt"), p.PAYOUT_UNAVAILABLE_TEXT, "the old figure is still up while the page waits for a reply");
  release();
  await running;
  assert.equal(p.text("overviewPayoutAmt"), "$9.00");
});

test("a dashboard that cannot reach the Worker, or is signed out, does not keep its old figure", async () => {
  const make = (options) => {
    const club = { code: "TESTCLB", payout: sent({ verified: true, club_net_cents: 500 }), teams: [] };
    const p = pageWithFakeBrowser({ club, ...options });
    p.showPayout("overviewPayoutAmt", club.payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_TEXT);
    assert.equal(p.text("overviewPayoutAmt"), "$5.00");
    return p;
  };
  // The Worker cannot be reached.
  const down = make({ fetched: () => null });
  down.clock.now += down.PAYOUT_SHOWN_FOR_MS + 1;
  await down.timers[0].fn();
  assert.equal(down.fetches, 1);
  assert.equal(down.text("overviewPayoutAmt"), down.PAYOUT_UNAVAILABLE_TEXT);
  // The request throws.
  const broken = make({ fetched: () => { throw new Error("placeholder network error"); } });
  broken.clock.now += broken.PAYOUT_SHOWN_FOR_MS + 1;
  await broken.timers[0].fn();
  assert.equal(broken.text("overviewPayoutAmt"), broken.PAYOUT_UNAVAILABLE_TEXT);
  // Signed out in the meantime: nothing to ask with, and the figure still goes.
  const out = make({ token: null, fetched: () => { throw new Error("should not be asked"); } });
  out.clock.now += out.PAYOUT_SHOWN_FOR_MS + 1;
  await out.timers[0].fn();
  assert.equal(out.fetches, 0);
  assert.equal(out.text("overviewPayoutAmt"), out.PAYOUT_UNAVAILABLE_TEXT);
  // On another screen: the slot is not showing, so the page does not ask for it.
  const away = make({ fetched: () => { throw new Error("should not be asked"); } });
  away.hiddenScreens.add("overviewPayoutAmt");
  away.clock.now += away.PAYOUT_SHOWN_FOR_MS + 1;
  await away.timers[0].fn();
  assert.equal(away.fetches, 0);
});

test("an admin screen left open asks again too, and never keeps figures it cannot refresh", async () => {
  const figure = (net, charge, now = NOW) => sent({ verified: true, club_net_cents: net, charge_cents: charge }, now);
  const clubOnScreen = { id: "club_1", payout: figure(4600000, 5000000), teams: [{ id: "team_1", payout: figure(4600000, 5000000) }] };
  const p = pageWithFakeBrowser({ adminSession: "token-staff", adminClubs: [clubOnScreen] });
  p.state.adminCurrentTeam = { id: "team_1" };
  const draw = () => {
    p.showPayout("adminTotalFronted", clubOnScreen.payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_SHORT);
    p.showPayout("adminTotalCollected", clubOnScreen.payout, "charge_cents", p.PAYOUT_UNAVAILABLE_SHORT);
    p.showPayout("adminClubCardPayout-club_1", clubOnScreen.payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_SHORT);
    p.showPayout("adminDetailFronted", clubOnScreen.payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_SHORT);
    p.showPayout("adminTeamCardPayout-team_1", clubOnScreen.teams[0].payout, "club_net_cents", p.PAYOUT_UNAVAILABLE_SHORT);
    p.showPayout("adminRosterCollected", clubOnScreen.teams[0].payout, "charge_cents", p.PAYOUT_UNAVAILABLE_SHORT);
  };
  draw();
  assert.equal(p.text("adminTotalFronted"), "$46,000.00");
  assert.equal(p.text("adminTotalCollected"), "$50,000.00");

  // A minute on, the page asks the Worker for every club again.
  p.adminReply = () => ({
    clubs: [{ id: "club_1", payout: { verified: true, club_net_cents: 4697070, charge_cents: 5100000 }, payout_check: { status: "verified" },
      teams: [{ id: "team_1", payout: { verified: true, club_net_cents: 4697070, charge_cents: 5100000 } }] }],
    totals: { payout: { verified: true, club_net_cents: 4697070, charge_cents: 5100000 } }
  });
  p.clock.now += p.PAYOUT_SHOWN_FOR_MS + 1;
  await p.timers[0].fn();
  assert.equal(p.adminFetches, 1);
  assert.equal(p.fetches, 0, "the club endpoint is not used for admin screens");
  assert.equal(p.text("adminTotalFronted"), "$46,970.70");
  assert.equal(p.text("adminTotalCollected"), "$51,000.00");
  assert.equal(p.text("adminClubCardPayout-club_1"), "$46,970.70");
  assert.equal(p.text("adminDetailFronted"), "$46,970.70");
  assert.equal(p.text("adminTeamCardPayout-team_1"), "$46,970.70");
  assert.equal(p.text("adminRosterCollected"), "$51,000.00");
  // The clubs the page is holding were updated in place, for the next screen opened.
  assert.equal(clubOnScreen.payout.club_net_cents, 4697070);
  assert.equal(clubOnScreen.teams[0].payout.club_net_cents, 4697070);

  // One club's figure is withdrawn: its slots and the total go, the screen stays.
  p.adminReply = () => ({
    clubs: [{ id: "club_1", payout: { verified: false }, payout_check: { status: "failed", reason: "refund" }, teams: [{ id: "team_1", payout: { verified: false } }] }],
    totals: { payout: { verified: false, unverified_clubs: 1 } }
  });
  p.clock.now += p.PAYOUT_SHOWN_FOR_MS + 1;
  await p.timers[0].fn();
  for (const id of ["adminTotalFronted", "adminTotalCollected", "adminClubCardPayout-club_1", "adminDetailFronted", "adminTeamCardPayout-team_1", "adminRosterCollected"]) {
    assert.equal(p.text(id), p.PAYOUT_UNAVAILABLE_SHORT, id);
    assert.equal(p.unavailable(id), true, id);
  }
  assert.equal(clubOnScreen.payout_check.reason, "refund");

  // The Worker cannot be reached: nothing old is kept.
  const q = pageWithFakeBrowser({ adminSession: "token-staff", adminClubs: [] });
  q.showPayout("adminTotalFronted", figure(100, 110), "club_net_cents", q.PAYOUT_UNAVAILABLE_SHORT);
  assert.equal(q.text("adminTotalFronted"), "$1.00");
  q.clock.now += q.PAYOUT_SHOWN_FOR_MS + 1;
  await q.timers[0].fn();
  assert.equal(q.adminFetches, 1);
  assert.equal(q.text("adminTotalFronted"), q.PAYOUT_UNAVAILABLE_SHORT);

  // Signed out of admin: no request, and the figure still goes.
  const r = pageWithFakeBrowser({ adminSession: null });
  r.showPayout("adminTotalFronted", figure(100, 110), "club_net_cents", r.PAYOUT_UNAVAILABLE_SHORT);
  r.clock.now += r.PAYOUT_SHOWN_FOR_MS + 1;
  await r.timers[0].fn();
  assert.equal(r.adminFetches, 0);
  assert.equal(r.text("adminTotalFronted"), r.PAYOUT_UNAVAILABLE_SHORT);

  // A slot that is cleared for loading is forgotten, not redrawn from old data.
  r.clearPayout("adminTotalFronted");
  assert.equal(r.text("adminTotalFronted"), "");
  await r.timers[0].fn();
  assert.equal(r.text("adminTotalFronted"), "");
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
  // The payout block itself is the only code allowed to write into a slot,
  // and it does so in exactly two places: drawing a slot and clearing one.
  const blockStart = page.indexOf("  // ---------- payout figures ----------");
  const blockEnd = page.indexOf("  function openRoster(){", blockStart);
  assert.ok(blockStart > 0 && blockEnd > blockStart);
  const block = page.slice(blockStart, blockEnd);
  assert.equal(block.match(/\.textContent\s*=/g).length, 2);
  assert.equal(block.match(/\.innerHTML\s*=/g), null);
  const rest = page.slice(0, blockStart) + page.slice(blockEnd);

  for (const id of RECEIVED_MONEY_ELEMENTS) {
    // In the markup the slot starts empty: no "$0" waiting to be mistaken for a figure.
    const markup = page.match(new RegExp(`id="${id}">([^<]*)<`));
    assert.ok(markup, `${id} not found in the markup`);
    assert.equal(markup[1], "", `${id} has a default of "${markup[1]}"`);
    // Everywhere else in the script it is only ever touched through showPayout or clearPayout.
    const uses = [...rest.matchAll(new RegExp(`['"]${id}['"]`, "g"))].map((m) => rest.slice(rest.lastIndexOf("\n", m.index) + 1, rest.indexOf("\n", m.index)));
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

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
  const start = page.indexOf("  function payoutCents(payout, field){");
  const end = page.indexOf("  // Puts a figure, or the words for \"no figure\", into one element.", start);
  assert.ok(start > 0 && end > start, "payoutCents and fmtCents not found where expected in public/app/index.html");
  return new Function(`${page.slice(start, end)}; return { payoutCents, fmtCents };`)();
}

test("the app page shows the Worker's figure or nothing", () => {
  const { payoutCents, fmtCents } = pageHelpers();
  assert.equal(payoutCents({ verified: true, club_net_cents: 97070 }, "club_net_cents"), 97070);
  assert.equal(payoutCents({ verified: true, club_net_cents: 0 }, "club_net_cents"), 0);
  for (const nothing of [
    undefined, null, {}, { verified: false }, { verified: false, club_net_cents: 97070 }, { club_net_cents: 97070 },
    { verified: "true", club_net_cents: 97070 }, { verified: 1, club_net_cents: 97070 },
    { verified: true }, { verified: true, club_net_cents: null }, { verified: true, club_net_cents: "97070" },
    { verified: true, club_net_cents: NaN }, { verified: true, club_net_cents: Infinity },
    { verified: true, club_net_cents: -1 }, { verified: true, club_net_cents: 970.7 }
  ]) {
    assert.equal(payoutCents(nothing, "club_net_cents"), null, JSON.stringify(nothing));
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

test("the app page does no fee arithmetic of its own", () => {
  for (const gone of ["clubPayoutFor", "clubFeeRate", "PAY_IN_FULL_FEE", "fronted_cents", "collected_cents", "teamSummary", "advanceAmt"]) {
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

test("the words shown in place of a figure make no claim", () => {
  const text = page.match(/PAYOUT_UNAVAILABLE_TEXT = '([^']+)'/)[1] + " " + page.match(/PAYOUT_UNAVAILABLE_SHORT = '([^']+)'/)[1];
  assert.doesNotMatch(text, /\d/, "no number, date or time");
  assert.doesNotMatch(text, /—/, "no em dash");
  assert.doesNotMatch(text, /stripe|klarna|refund|dispute|soon|shortly|today|tomorrow|day|hour|guarantee|risk|fee/i);
});

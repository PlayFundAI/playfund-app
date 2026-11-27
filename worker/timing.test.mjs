// The date rules around a team's season: the registration payment deadline
// and the note on paying by bank. Pure functions, no clock and no network.
//
//   node --test            from the repo root, runs every *.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIRST_PAYOUT_HOLD_DAYS,
  CARD_AND_KLARNA_CUTOFF_BUSINESS_DAYS,
  BANK_CUTOFF_BUSINESS_DAYS,
  DEFAULT_DEADLINE_DAYS_BEFORE_SEASON
} from "./timing-config.js";
import {
  defaultDeadline,
  resolveDeadline,
  businessDaysUntil,
  bankTakesLongerNote,
  todayInUS,
  withTiming
} from "./timing.js";

test("the config holds the four agreed numbers", () => {
  assert.equal(FIRST_PAYOUT_HOLD_DAYS, 7);
  assert.equal(CARD_AND_KLARNA_CUTOFF_BUSINESS_DAYS, 5);
  assert.equal(BANK_CUTOFF_BUSINESS_DAYS, 7);
  assert.equal(DEFAULT_DEADLINE_DAYS_BEFORE_SEASON, 7);
});

// --- the deadline default ---------------------------------------------------

test("the deadline defaults to 7 days before the season starts", () => {
  assert.equal(defaultDeadline("2027-03-07"), "2027-02-28");
  assert.deepEqual(resolveDeadline("2027-03-07", undefined), { deadline: "2027-02-28" });
  assert.deepEqual(resolveDeadline("2027-03-07", null), { deadline: "2027-02-28" });
  assert.deepEqual(resolveDeadline("2027-03-07", ""), { deadline: "2027-02-28" });
});

test("the default crosses a month and a year end correctly", () => {
  assert.equal(defaultDeadline("2027-01-03"), "2026-12-27");
  assert.equal(defaultDeadline("2028-03-05"), "2028-02-27"); // leap year
});

test("the default deadline always leaves the card and Klarna cutoff", () => {
  // Any 7 calendar days hold exactly 5 weekdays, so a payment made on the
  // default deadline is never inside the card and Klarna cutoff.
  for (let day = 1; day <= 28; day++) {
    const start = `2027-02-${String(day).padStart(2, "0")}`;
    const left = businessDaysUntil(defaultDeadline(start), start);
    assert.ok(left >= CARD_AND_KLARNA_CUTOFF_BUSINESS_DAYS, `${start} leaves ${left}`);
  }
});

// --- the deadline cannot be later than the default --------------------------

test("a deadline later than the default is refused", () => {
  const oneDayLate = resolveDeadline("2027-03-07", "2027-03-01");
  assert.equal(oneDayLate.deadline, undefined);
  assert.match(oneDayLate.error, /no later than 2027-02-28/);
  assert.equal(oneDayLate.latest, "2027-02-28");

  assert.ok(resolveDeadline("2027-03-07", "2027-03-07").error, "on the season start");
  assert.ok(resolveDeadline("2027-03-07", "2027-04-01").error, "after the season start");
});

test("a deadline on the default, or earlier, is kept as chosen", () => {
  assert.deepEqual(resolveDeadline("2027-03-07", "2027-02-28"), { deadline: "2027-02-28" });
  assert.deepEqual(resolveDeadline("2027-03-07", "2027-02-01"), { deadline: "2027-02-01" });
});

test("no season start, or a date that is not one, is refused", () => {
  assert.match(resolveDeadline(undefined, "2027-02-01").error, /season start date is required/);
  assert.match(resolveDeadline("", "2027-02-01").error, /season start date is required/);
  assert.match(resolveDeadline("2027-02-30", undefined).error, /season start date is required/);
  assert.match(resolveDeadline("2027-03-07", "next week").error, /not a valid date/);
  assert.equal(defaultDeadline("03/07/2027"), null);
});

// --- business days ----------------------------------------------------------

test("business days skip weekends", () => {
  // 2027-03-01 is a Monday.
  assert.equal(businessDaysUntil("2027-03-01", "2027-03-01"), 0);
  assert.equal(businessDaysUntil("2027-03-01", "2027-03-05"), 4); // Tue to Fri
  assert.equal(businessDaysUntil("2027-03-01", "2027-03-08"), 5); // the next Monday
  assert.equal(businessDaysUntil("2027-03-05", "2027-03-08"), 1); // Fri to Mon
  assert.equal(businessDaysUntil("2027-03-06", "2027-03-07"), 0); // Sat to Sun
  assert.equal(businessDaysUntil("2027-03-08", "2027-03-01"), 0); // already past
  assert.equal(businessDaysUntil("2027-03-01", null), null);
});

// --- the bank note ----------------------------------------------------------

test("the bank note appears inside the bank cutoff window", () => {
  // Season starts Monday 2027-03-15. Seven business days before it is
  // Thursday 2027-03-04.
  const start = "2027-03-15";
  assert.equal(businessDaysUntil("2027-03-04", start), 7);
  assert.equal(bankTakesLongerNote("2027-03-04", start), false, "exactly 7 business days: no note");
  assert.equal(bankTakesLongerNote("2027-03-05", start), true, "6 business days: note");
  assert.equal(bankTakesLongerNote("2027-03-12", start), true, "the Friday before");
  assert.equal(bankTakesLongerNote("2027-03-15", start), true, "the day the season starts");
  assert.equal(bankTakesLongerNote("2027-04-01", start), true, "after the season has started");
});

test("the bank note stays away outside the window", () => {
  assert.equal(bankTakesLongerNote("2027-02-01", "2027-03-15"), false);
  assert.equal(bankTakesLongerNote("2027-03-03", "2027-03-15"), false);
});

test("a weekend does not count toward the window", () => {
  // Saturday 2027-03-06 and Sunday 2027-03-07 have the same business days
  // left as Friday 2027-03-05 has after it.
  assert.equal(businessDaysUntil("2027-03-06", "2027-03-15"), 6);
  assert.equal(businessDaysUntil("2027-03-07", "2027-03-15"), 6);
  assert.equal(bankTakesLongerNote("2027-03-07", "2027-03-15"), true);
});

test("no season start means no bank note", () => {
  assert.equal(bankTakesLongerNote("2027-03-05", null), false);
  assert.equal(bankTakesLongerNote("2027-03-05", undefined), false);
});

// --- what a page is given ---------------------------------------------------

test("a team is given its deadline, the latest allowed, and the bank note", () => {
  const team = { id: "t1", season_start: "2027-03-15", dues_due_date: "2027-03-01" };
  assert.deepEqual(withTiming(team, "2027-03-10"), {
    id: "t1",
    season_start: "2027-03-15",
    dues_due_date: "2027-03-01",
    payment_deadline: "2027-03-01",
    latest_payment_deadline: "2027-03-08",
    bank_takes_longer: true
  });
  const bare = withTiming({ id: "t2", season_start: null, dues_due_date: null }, "2027-03-10");
  assert.equal(bare.payment_deadline, null);
  assert.equal(bare.latest_payment_deadline, null);
  assert.equal(bare.bank_takes_longer, false);
});

test("today is the US calendar date, not the UTC one", () => {
  // 02:00 UTC on the 2nd is still the evening of the 1st in the US.
  assert.equal(todayInUS(new Date("2027-03-02T02:00:00Z")), "2027-03-01");
  assert.equal(todayInUS(new Date("2027-03-02T18:00:00Z")), "2027-03-02");
});

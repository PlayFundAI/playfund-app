// Tests for worker/fees.mjs. No dependencies and no network.
//
//   node --test            from the repo root, runs every *.test.mjs
//   node --test worker/fees.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_FEE_BPS,
  PAY_IN_FULL_FEE_BPS,
  PAY_IN_FULL_FEE_FIXED_CENTS,
  applicationFeeCents,
  clubFeeBps,
  clubPayoutCents,
  paymentTypeForStatus,
  payoutFloor,
  payoutForStatusCents
} from "./fees.mjs";

const usd = (dollars) => Math.round(dollars * 100);

// Dues from 50c (the smallest card charge) to $5,000, including amounts that
// do not divide evenly, and rates from 0% to 100%.
const DUES_SWEEP = [50, 99, 101, 2500, 12345, 25000, 33333, 95000, 100000, 100001, 149999, 200000, 500000];
const BPS_SWEEP = [0, 1, 500, 650, 799, 800, 1000, 2500, 10000];

test("installments: the club's rate is taken as a share of dues", () => {
  assert.equal(applicationFeeCents({ duesCents: usd(1000), paymentType: "bnpl", feeBps: 800 }), usd(80));
  assert.equal(applicationFeeCents({ duesCents: usd(250), paymentType: "bnpl", feeBps: 800 }), usd(20));
  assert.equal(applicationFeeCents({ duesCents: usd(2000), paymentType: "bnpl", feeBps: 800 }), usd(160));
  assert.equal(applicationFeeCents({ duesCents: usd(1000), paymentType: "bnpl", feeBps: 650 }), usd(65));
  assert.equal(applicationFeeCents({ duesCents: usd(1000), paymentType: "bnpl", feeBps: 0 }), 0);
  // $123.45 at 8% is 987.6c, which rounds to 988c.
  assert.equal(applicationFeeCents({ duesCents: 12345, paymentType: "bnpl", feeBps: 800 }), 988);
});

test("installments: the fee is exactly what the Worker charged before this change", () => {
  for (const duesCents of DUES_SWEEP) {
    for (const feeBps of BPS_SWEEP) {
      assert.equal(
        applicationFeeCents({ duesCents, paymentType: "bnpl", feeBps }),
        Math.round(duesCents * feeBps / 1e4),
        `dues ${duesCents} at ${feeBps} bps`
      );
    }
  }
});

test("pay in full: 2.9% of dues plus 30c", () => {
  assert.equal(PAY_IN_FULL_FEE_BPS, 290);
  assert.equal(PAY_IN_FULL_FEE_FIXED_CENTS, 30);
  assert.equal(applicationFeeCents({ duesCents: usd(1000), paymentType: "full", feeBps: 800 }), 2930);
  assert.equal(applicationFeeCents({ duesCents: usd(250), paymentType: "full", feeBps: 800 }), 755);
  assert.equal(applicationFeeCents({ duesCents: usd(2000), paymentType: "full", feeBps: 800 }), 5830);
  // $123.45: 2.9% is 358.005c, which rounds to 358c, plus 30c.
  assert.equal(applicationFeeCents({ duesCents: 12345, paymentType: "full", feeBps: 800 }), 388);
});

test("pay in full: the club's rate makes no difference", () => {
  for (const duesCents of DUES_SWEEP) {
    const expected = Math.round(duesCents * 290 / 1e4) + 30;
    for (const feeBps of [...BPS_SWEEP, undefined, null]) {
      assert.equal(
        applicationFeeCents({ duesCents, paymentType: "full", feeBps }),
        expected,
        `dues ${duesCents} at ${feeBps} bps`
      );
    }
  }
});

test("pay in full costs the club less than installments at the standard rate", () => {
  for (const dollars of [250, 500, 950, 1000, 1500, 2000, 5000]) {
    const full = applicationFeeCents({ duesCents: usd(dollars), paymentType: "full", feeBps: DEFAULT_FEE_BPS });
    const bnpl = applicationFeeCents({ duesCents: usd(dollars), paymentType: "bnpl", feeBps: DEFAULT_FEE_BPS });
    assert.ok(full < bnpl, `$${dollars}: full ${full} should be under installments ${bnpl}`);
  }
});

test("the fee is always a whole number of cents from 0 up to the payment", () => {
  for (const duesCents of [1, 10, 30, 31, ...DUES_SWEEP]) {
    for (const feeBps of BPS_SWEEP) {
      for (const paymentType of ["full", "bnpl"]) {
        const fee = applicationFeeCents({ duesCents, paymentType, feeBps });
        assert.ok(Number.isInteger(fee), `${paymentType} ${duesCents} ${feeBps}: ${fee} is not whole`);
        assert.ok(fee >= 0 && fee <= duesCents, `${paymentType} ${duesCents} ${feeBps}: ${fee} out of range`);
      }
    }
  }
  // Under 31c the flat part alone would be more than the payment, so it is capped.
  assert.equal(applicationFeeCents({ duesCents: 10, paymentType: "full" }), 10);
});

test("an unknown payment type is refused, never given the lower fee", () => {
  for (const paymentType of ["card", "klarna", "FULL", "Full", "", undefined, null, 0, true]) {
    assert.throws(
      () => applicationFeeCents({ duesCents: usd(1000), paymentType, feeBps: 800 }),
      RangeError,
      `paymentType ${String(paymentType)}`
    );
  }
});

test("a bad dues amount is refused", () => {
  for (const duesCents of [0, -1, -100000, 1000.5, NaN, Infinity, "100000", null, undefined]) {
    for (const paymentType of ["full", "bnpl"]) {
      assert.throws(
        () => applicationFeeCents({ duesCents, paymentType, feeBps: 800 }),
        RangeError,
        `${paymentType} with dues ${String(duesCents)}`
      );
    }
  }
});

test("installments: a bad rate is refused", () => {
  for (const feeBps of [-1, 10001, 8.5, NaN, "800", null, undefined]) {
    assert.throws(
      () => applicationFeeCents({ duesCents: usd(1000), paymentType: "bnpl", feeBps }),
      RangeError,
      `feeBps ${String(feeBps)}`
    );
  }
});

test("clubFeeBps: the club's own rate, or the fallback when none was ever set", () => {
  assert.equal(DEFAULT_FEE_BPS, 800);
  assert.equal(clubFeeBps({ fee_bps: 650 }), 650);
  // A rate of 0 is a rate. It must not be mistaken for "not set".
  assert.equal(clubFeeBps({ fee_bps: 0 }), 0);
  assert.equal(clubFeeBps({ fee_bps: null }), 800);
  assert.equal(clubFeeBps({}), 800);
  assert.equal(clubFeeBps(null), 800);
  assert.equal(clubFeeBps(undefined), 800);
});

test("payout is the dues less the fee, to the cent", () => {
  assert.equal(clubPayoutCents({ duesCents: usd(1000), paymentType: "full", feeBps: 800 }), 97070);
  assert.equal(clubPayoutCents({ duesCents: usd(1000), paymentType: "bnpl", feeBps: 800 }), 92000);
  for (const duesCents of DUES_SWEEP) {
    for (const feeBps of BPS_SWEEP) {
      for (const paymentType of ["full", "bnpl"]) {
        const fee = applicationFeeCents({ duesCents, paymentType, feeBps });
        const payout = clubPayoutCents({ duesCents, paymentType, feeBps });
        assert.equal(fee + payout, duesCents, `${paymentType} ${duesCents} ${feeBps}`);
      }
    }
  }
});

test("payment status maps to how the family paid", () => {
  assert.equal(paymentTypeForStatus("paid_full"), "full");
  assert.equal(paymentTypeForStatus("bnpl_active"), "bnpl");
  assert.equal(paymentTypeForStatus("bnpl_complete"), "bnpl");
  for (const status of ["unpaid", "defaulted", "pending", "", null, undefined]) {
    assert.equal(paymentTypeForStatus(status), null, `status ${String(status)}`);
  }
});

test("dashboard payout follows how each athlete paid", () => {
  const club = { duesCents: usd(1000), feeBps: 800 };
  assert.equal(payoutForStatusCents({ ...club, paymentStatus: "paid_full" }), 97070);
  assert.equal(payoutForStatusCents({ ...club, paymentStatus: "bnpl_active" }), 92000);
  assert.equal(payoutForStatusCents({ ...club, paymentStatus: "bnpl_complete" }), 92000);
  // Not paid yet: nothing has reached the club.
  for (const paymentStatus of ["unpaid", "defaulted", null, undefined]) {
    assert.equal(payoutForStatusCents({ ...club, paymentStatus }), 0);
  }
  // A team with no dues set counts as nothing instead of throwing.
  for (const duesCents of [0, null, undefined]) {
    assert.equal(payoutForStatusCents({ duesCents, feeBps: 800, paymentStatus: "paid_full" }), 0);
    assert.equal(payoutForStatusCents({ duesCents, feeBps: 800, paymentStatus: "bnpl_active" }), 0);
  }
  // So does a rate that checkout would have refused to charge.
  for (const feeBps of [-1, 10001, 8.5, "800"]) {
    assert.equal(payoutForStatusCents({ duesCents: usd(1000), feeBps, paymentStatus: "bnpl_active" }), 0);
  }
});

test("projection floor: the lowest payout whichever way a family pays", () => {
  // At the standard rate the lowest case is every family on installments.
  assert.deepEqual(payoutFloor({ duesCents: usd(1000), feeBps: 800 }), { cents: 92000, paymentType: "bnpl" });
  // 50 athletes at $1,000: at least $46,000.
  assert.equal(payoutFloor({ duesCents: usd(1000), feeBps: 800 }).cents * 50, usd(46000));
  // If a club's rate is under the card cost, pay in full becomes the lowest case.
  assert.deepEqual(payoutFloor({ duesCents: usd(1000), feeBps: 0 }), { cents: 97070, paymentType: "full" });
  for (const duesCents of DUES_SWEEP) {
    for (const feeBps of BPS_SWEEP) {
      const floor = payoutFloor({ duesCents, feeBps });
      assert.ok(floor.cents <= clubPayoutCents({ duesCents, paymentType: "full", feeBps }));
      assert.ok(floor.cents <= clubPayoutCents({ duesCents, paymentType: "bnpl", feeBps }));
    }
  }
});

// The club dashboard is a static page and cannot import this module, so it
// carries its own copy of the two pay-in-full numbers. This fails if the page
// and the Worker ever disagree about them.
test("the app page uses the same pay-in-full numbers as the Worker", () => {
  const page = readFileSync(new URL("../public/app/index.html", import.meta.url), "utf8");
  const bps = page.match(/\bPAY_IN_FULL_FEE_BPS\s*=\s*(\d+)/);
  const fixed = page.match(/\bPAY_IN_FULL_FEE_FIXED_CENTS\s*=\s*(\d+)/);
  assert.ok(bps, "PAY_IN_FULL_FEE_BPS not found in public/app/index.html");
  assert.ok(fixed, "PAY_IN_FULL_FEE_FIXED_CENTS not found in public/app/index.html");
  assert.equal(Number(bps[1]), PAY_IN_FULL_FEE_BPS);
  assert.equal(Number(fixed[1]), PAY_IN_FULL_FEE_FIXED_CENTS);
});

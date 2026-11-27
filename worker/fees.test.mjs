// Checks the application fee for each way a parent can pay.
//
//   node --test            from the repo root, runs every *.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { applicationFeeCents } from "./fees.js";
import { KLARNA_MAX_AMOUNT_CENTS } from "./fee-config.js";

test("$650 by card is 2565 cents", () => {
  assert.equal(applicationFeeCents(65000, "card"), 2565);
});

test("$650 by bank is 1150 cents", () => {
  assert.equal(applicationFeeCents(65000, "bank"), 1150);
});

test("$650 with Klarna is 6500 cents", () => {
  assert.equal(applicationFeeCents(65000, "klarna"), 6500);
});

test("$50 by card is 225 cents", () => {
  assert.equal(applicationFeeCents(5000, "card"), 225);
});

test("$1,500 by bank is 2000 cents, with the processor's share capped", () => {
  assert.equal(applicationFeeCents(150000, "bank"), 2000);
});

test("Klarna uses the club's own rate when one is given", () => {
  assert.equal(applicationFeeCents(65000, "klarna", { klarnaPercent: 0.08 }), 5200);
  assert.equal(applicationFeeCents(65000, "klarna", { klarnaPercent: 0.0605 }), 3933);
});

test("the club's rate does not change card or bank", () => {
  assert.equal(applicationFeeCents(65000, "card", { klarnaPercent: 0.08 }), 2565);
  assert.equal(applicationFeeCents(65000, "bank", { klarnaPercent: 0.08 }), 1150);
});

test("the fee is always a whole number of cents", () => {
  for (const amount of [1, 333, 25001, 99999, KLARNA_MAX_AMOUNT_CENTS]) {
    for (const choice of ["card", "bank", "klarna"]) {
      assert.ok(Number.isInteger(applicationFeeCents(amount, choice)), `${amount} ${choice}`);
    }
  }
});

test("an unknown choice or a bad amount is refused, not guessed at", () => {
  assert.throws(() => applicationFeeCents(65000, "cash"), RangeError);
  assert.throws(() => applicationFeeCents(0, "card"), RangeError);
  assert.throws(() => applicationFeeCents(650.5, "card"), RangeError);
  assert.throws(() => applicationFeeCents(65000, "klarna", { klarnaPercent: 8 }), RangeError);
});

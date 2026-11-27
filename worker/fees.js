// The application fee for one payment: what PlayFund keeps out of the amount
// the parent pays. The parent always pays the registration amount and nothing
// more; the fee comes out of what the club receives.
//
// Rates live in fee-config.js.
import {
  CARD_PERCENT,
  CARD_FIXED_CENTS,
  ACH_PLATFORM_PERCENT,
  ACH_STRIPE_PERCENT,
  ACH_STRIPE_CAP_CENTS,
  KLARNA_PERCENT
} from "./fee-config.js";

// The three ways a parent can pay, and the one payment method each maps to on
// the processor's side.
export const PAYMENT_CHOICES = ["bank", "card", "klarna"];
export const STRIPE_METHOD_FOR_CHOICE = {
  bank: "us_bank_account",
  card: "card",
  klarna: "klarna"
};

// amountCents: the registration amount, a whole number of cents.
// choice: "card", "bank" or "klarna".
// options.klarnaPercent: the club's own agreed rate as a fraction (0.08 is
//   8%). Applies to Klarna only. Left out, KLARNA_PERCENT is used.
//
// Returns whole cents, rounded to the nearest cent.
export function applicationFeeCents(amountCents, choice, options = {}) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError("amountCents must be a positive whole number of cents");
  }
  let fee;
  if (choice === "card") {
    fee = amountCents * CARD_PERCENT + CARD_FIXED_CENTS;
  } else if (choice === "bank") {
    fee = amountCents * ACH_PLATFORM_PERCENT +
      Math.min(amountCents * ACH_STRIPE_PERCENT, ACH_STRIPE_CAP_CENTS);
  } else if (choice === "klarna") {
    const percent = options.klarnaPercent != null ? options.klarnaPercent : KLARNA_PERCENT;
    if (typeof percent !== "number" || !(percent >= 0 && percent <= 1)) {
      throw new RangeError("klarnaPercent must be a fraction between 0 and 1");
    }
    fee = amountCents * percent;
  } else {
    throw new RangeError(`Unknown payment choice: ${choice}`);
  }
  // Round to 6 places first so a product like 65000 * 0.039, which floating
  // point holds as 2535.0000000000005, cannot tip a half cent the wrong way.
  return Math.round(Math.round(fee * 1e6) / 1e6);
}

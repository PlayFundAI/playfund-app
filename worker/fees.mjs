// What a club is charged on one family's payment, and what the club receives.
//
// Everything here is a pure function of its arguments: no network, no
// environment, whole cents in and whole cents out. The checkout handler in
// index.js calls applicationFeeCents() for the amount it sends as
// application_fee_amount, so fees.test.mjs exercises the same code that sets
// the fee on a real payment. Run the tests with `node --test` from the repo
// root.
//
// The rule, decided 2026-11-19:
//   Installments   the club's own rate (clubs.fee_bps), as a share of dues.
//   Pay in full    card processing cost only. The club's rate is not used.
//
// The pay-in-full amount has to be fixed when checkout is created, before the
// family has entered a card, so it cannot be the cost of the card actually
// used. It is the processor's published rate for a US card instead. A card
// that costs more than that to process is not passed on to the club.

// Fallback for a club whose rate was never set. It is not a published price:
// see the note where this is imported in index.js.
export const DEFAULT_FEE_BPS = 800;

// The processor's published US rate for an online card payment, checked
// 2026-11-19: 2.9% + 30c per successful payment. If the published rate
// changes, change these two numbers and the matching pair in
// public/app/index.html. fees.test.mjs fails if the two files disagree.
export const PAY_IN_FULL_FEE_BPS = 290;
export const PAY_IN_FULL_FEE_FIXED_CENTS = 30;

export function clubFeeBps(club) {
  return club && club.fee_bps != null ? club.fee_bps : DEFAULT_FEE_BPS;
}

function isDuesCents(duesCents) {
  return Number.isSafeInteger(duesCents) && duesCents > 0;
}

function isFeeBps(feeBps) {
  return Number.isInteger(feeBps) && feeBps >= 0 && feeBps <= 1e4;
}

// The application fee, in cents, for one payment of `duesCents`.
//
//   paymentType "bnpl"  installments: duesCents * feeBps / 10000, rounded.
//   paymentType "full"  pay in full: 2.9% of duesCents, rounded, plus 30c.
//                       feeBps is ignored.
//
// Throws on anything it does not recognise instead of guessing. This is the
// number that decides how a real payment is divided, so an unknown payment
// type must never fall through to the cheaper fee, and a bad amount must never
// become a fee of NaN.
export function applicationFeeCents({ duesCents, paymentType, feeBps }) {
  if (!isDuesCents(duesCents)) {
    throw new RangeError(`duesCents must be a positive whole number of cents, got ${duesCents}`);
  }
  if (paymentType === "bnpl") {
    if (!isFeeBps(feeBps)) {
      throw new RangeError(`feeBps must be a whole number from 0 to 10000, got ${feeBps}`);
    }
    return Math.round(duesCents * feeBps / 1e4);
  }
  if (paymentType === "full") {
    const fee = Math.round(duesCents * PAY_IN_FULL_FEE_BPS / 1e4) + PAY_IN_FULL_FEE_FIXED_CENTS;
    // A fee can never be more than the payment it is taken from. Only reachable
    // for amounts under 31c, which are below the processor's minimum charge.
    return Math.min(fee, duesCents);
  }
  throw new RangeError(`paymentType must be "full" or "bnpl", got ${paymentType}`);
}

// What reaches the club from one payment: the dues less the fee above. This is
// a subtraction rather than a second multiplication on purpose, so the fee and
// the payout always add back up to the dues exactly.
export function clubPayoutCents({ duesCents, paymentType, feeBps }) {
  return duesCents - applicationFeeCents({ duesCents, paymentType, feeBps });
}

// How a funded athlete paid, read from athletes.payment_status. The webhook
// writes paid_full only for a card payment and bnpl_* only for an installment
// plan. Returns null for an athlete who has not paid.
export function paymentTypeForStatus(paymentStatus) {
  if (paymentStatus === "paid_full") return "full";
  if (paymentStatus === "bnpl_active" || paymentStatus === "bnpl_complete") return "bnpl";
  return null;
}

// For dashboards: what one athlete's payment put in the club's account. 0 for
// an athlete who has not paid. Also 0, instead of an error, for a team with no
// dues set or a rate that could not have been charged, so that one bad row
// cannot take a whole dashboard down. Checkout does not use this: it calls
// applicationFeeCents() directly and refuses bad input.
export function payoutForStatusCents({ duesCents, paymentStatus, feeBps }) {
  const paymentType = paymentTypeForStatus(paymentStatus);
  if (!paymentType || !isDuesCents(duesCents)) return 0;
  if (paymentType === "bnpl" && !isFeeBps(feeBps)) return 0;
  return clubPayoutCents({ duesCents, paymentType, feeBps });
}

// For a projection made before anyone has paid, when the mix of pay-in-full
// and installment families is not known: the lowest the club's payout on one
// athlete's dues can be, and which way of paying gives it. A projection built
// on this can be stated as "at least" and stay true however families pay.
export function payoutFloor({ duesCents, feeBps }) {
  const full = clubPayoutCents({ duesCents, paymentType: "full", feeBps });
  const bnpl = clubPayoutCents({ duesCents, paymentType: "bnpl", feeBps });
  return bnpl <= full ? { cents: bnpl, paymentType: "bnpl" } : { cents: full, paymentType: "full" };
}

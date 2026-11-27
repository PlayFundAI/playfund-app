// When a club's money moves, in days. These are the only numbers to change
// when the payment processor's timing changes. The date arithmetic lives in
// timing.js, and the routes in index.js read both.
//
// None of these is shown to a club or a parent as a promise. They decide
// where a default date falls and when a note appears.

// A new club account's first payout is held by the processor for about this
// many calendar days, counted from the club's first payment.
export const FIRST_PAYOUT_HOLD_DAYS = 7;

// A card or Klarna payment made at least this many business days before the
// season starts is expected to reach the club's bank account before it does.
export const CARD_AND_KLARNA_CUTOFF_BUSINESS_DAYS = 5;

// The same for a payment from a bank account, which takes longer to clear.
export const BANK_CUTOFF_BUSINESS_DAYS = 7;

// A team's registration payment deadline defaults to this many calendar days
// before its season starts. A club can move it earlier, never later.
export const DEFAULT_DEADLINE_DAYS_BEFORE_SEASON = 7;

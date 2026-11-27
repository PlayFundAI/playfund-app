// What PlayFund keeps from each payment, by how the parent chose to pay.
//
// These are the only numbers to change when a rate changes. The arithmetic
// lives in fees.js, and the checkout route in index.js reads both.
//
// Percentages are fractions (0.039 is 3.9%). Amounts are in cents.

// Card: a percentage of the payment plus a fixed amount per payment.
export const CARD_PERCENT = 0.039;
export const CARD_FIXED_CENTS = 30;

// Bank (ACH): PlayFund's own percentage, plus the processor's ACH charge
// passed through. The processor's charge is a percentage with a cap.
export const ACH_PLATFORM_PERCENT = 0.01;
export const ACH_STRIPE_PERCENT = 0.008;
export const ACH_STRIPE_CAP_CENTS = 500;

// Klarna: used only for a club that has no rate of its own on record. A club
// with an agreed rate (clubs.fee_bps) is charged that rate instead.
export const KLARNA_PERCENT = 0.10;

// Klarna is not offered above this amount.
export const KLARNA_MAX_AMOUNT_CENTS = 200000;

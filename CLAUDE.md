# PlayFund — project context

Read this before making changes. It captures decisions already made so they don't get re-litigated in code.

## What this is

A payments platform for youth sports clubs. Clubs get registration money upfront; parents can pay in full or in installments. Currently pre-pilot.

## Locked decisions for the pilot

- **Klarna carries the credit risk.** We do not underwrite, do not front our own capital, and do not cover defaults in the pilot. Klarna approves, funds, and carries non-payment.
- **Club-adopting go-to-market.** Clubs onboard, we run registration and payments for them.
- **Any ticket size accepted** ($250–$2,000+). Segment learning is a pilot output, not a precondition.
- **The parent is always the named borrower. Never the child.** No financing agreement is ever in a minor's name.

## Design reference

`/design-reference/playfund-portal.html` is the source of truth for UI. It contains three sections:
1. Parent registration + payment flow (5 screens, including the declined-parent fork)
2. Club dashboard (payout amount, athlete ledger)
3. Club onboarding (5 screens, signup through sending the registration link)

Copy, colors, spacing, and component structure in that file are intentional — each traces to survey data, an operator interview, or a competitor teardown. The annotation panels in the file explain why each decision was made. **Match the design intent; don't redesign.**

Other reference files in the same folder document the flows and pilot structure.

## Non-negotiable constraints

- **Stripe handles all card data.** Never store, log, or transmit raw card numbers, CVVs, or bank details in our own code or database.
- **Stripe Connect handles club KYC and payouts.** Don't build custom KYC.
- **Minors' data is sensitive.** Store the minimum necessary about athletes (name, team, age group). No photos, no addresses, no birthdates unless genuinely required.
- **No hardcoded secrets.** API keys go in environment variables, never in committed code.
- **Never claim a BNPL product doesn't affect credit** in user-facing copy. That varies by product and provider and is unverified.

## Product principles from research

- **No forced account creation for parents.** Roughly a quarter of users abandon at forced registration, and it collides with the app-fatigue complaint that dominated our parent survey.
- **Multi-step checkout with a progress bar**, not one page. Best practice flips on ticket size, and ours are high.
- **Show the payment split at the price** ("$X/month" under the total), not buried behind a payment-method selector.
- **Multiple children register in one flow on one combined plan.** No caps, no minimums, nothing disappears when a second kid is added. 66% of surveyed parents have 2+ kids playing.
- **A Klarna decline is a fork, not a dead end.** Always offer alternatives: split with another payer, smaller deposit, or the club's own plan.
- **Automated reminders before every charge.** Servicing is how default rate is controlled; it is not a nice-to-have.
- **Club onboarding must be completable in one sitting, and resumable.** Save state at every step; most volunteer treasurers won't have their EIN handy and will need to come back.
- **Show value before asking for friction.** The payout number appears before we ask for bank details.

## Known unresolved policies

Don't invent answers to these in code. Flag them instead:

- How parents return without an account (magic link is the likely answer, not yet decided)
- Refund ownership and clawback mechanics when a kid quits mid-season
- Payout timing: rolling per-transaction vs. weekly batch
- Whether the club or PlayFund contacts declined families
- How scholarship/$0 athletes are handled

## Working agreement

- Work on a branch. Never commit directly to `main`.
- This is a payments application handling minors' data. Prefer asking over assuming.
- Small, reviewable commits.

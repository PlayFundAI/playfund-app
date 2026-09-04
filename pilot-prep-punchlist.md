# Pilot prep punchlist

A running list of workstreams to tackle before the pilot, editable across sessions. Check items off as they're done; add new ones as they come up. This is separate from `pilot-readiness-plan.md`, which is an earlier, more technical phase-by-phase plan — this file tracks the items identified in review conversations.

## 1. Email & customer-facing copy consistency

Grounded in: 6 email templates in `worker/index.js` (`sendReminderEmail`, `sendApprovalEmail`, `sendReceiptEmail`, `sendPendingApprovalEmail`, `sendClubWelcomeEmail`, `sendInternalClubAlert`).

- [ ] Audit all 6 templates for one shared header/footer/sign-off pattern (they currently diverge)
- [ ] Replace the amber/orange left-border callout box in `sendClubWelcomeEmail` (`#FFF8E8` bg / `#F59E0B` border, "Have these ready when you connect your bank") with a callout style that matches the brand palette, not an ad hoc color
- [ ] Remove or soften specific response-time promises: the scholarship flow's "within 48 hours" (appears 3 times in `index.html`, around lines 1669, 1698, 1703), and the FAQ's "we typically respond within a few hours" (`index.html` around line 2432)
- [ ] Decide one honest, deliberately vague standard phrase for "we'll get back to you" and use it everywhere instead of specific windows
- [ ] Review `sendInternalClubAlert`'s "reach out within 1 business day" — this one's internal (goes to jackson@/clyde@, not the club), so it's a staff SLA reminder rather than a customer promise; decide if that's still the real target or just needs the same honesty pass
- [ ] Roll in the hello@ → admin@ swap here too (see item 5) since it touches the same templates

## 2. Homepage direction

Grounded in: the two mockups already published (Option A: app-language with a "What is PlayFund?" section; Option B: traditional SaaS layout), both scrubbed of Klarna mentions and specific timelines/terms.

- [ ] Review both options with Clyde and Jackson
- [ ] Pick a direction, or specify a hybrid of the two
- [ ] Re-check the chosen direction's copy against the same bar just applied (no vendor names, no timelines, no unverified terms) since further edits may reintroduce risk
- [ ] Decide what "Get Started" / "Request a demo" actually do today, before real self-serve onboarding exists (a form? a mailto? a Calendly link?)
- [ ] Turn the chosen canvas into real site files once decided

## 3. playfundai.com setup (Squarespace)

Depends on item 2 — need a homepage before "loading stuff in."

- [ ] Confirm where the actual app is hosted today (verify current deployment target, not just what old docs say)
- [ ] Decide the split: root domain (playfundai.com) for marketing, subdomain (e.g. app.playfundai.com) for the real product — matches the URL pattern already used in the homepage mockups' dashboard screenshot
- [ ] Add the new DNS records in Squarespace without breaking the existing Resend sending-domain records (SPF/DKIM) — check those first so they don't get overwritten
- [ ] Point the chosen homepage build at the root domain once item 2 is settled

## 4. Data tracking strategy (Stripe/Klarna + PlayFund's own instrumentation)

- [ ] Write down the actual questions to answer first — the ones a lender or investor will ask: payment-method mix (full vs. installments), approval/decline rates, time-to-registration, club retention, average dues size, geographic/sport demographics
- [ ] Map each question to where the data actually lives: Stripe (payment status/method/fees), Klarna (approval/decline outcomes — confirm what's exposed via the Stripe integration vs. needing direct Klarna dashboard access), Supabase (system of record for clubs/athletes/payments), Resend (send/open/click — not currently captured anywhere but Resend's own dashboard)
- [ ] Add email engagement tracking: nothing today pipes opens/clicks into Supabase; needs a Resend webhook wired in
- [ ] Add a lightweight product-events table in Supabase for things that aren't naturally a payment row (registration started, payment method chosen, decline occurred)
- [ ] Add funnel/click tracking through the actual app flows — club admin signup, parent login/registration — so drop-off points are visible: which screen someone abandons on, not just whether they ever finished. This means instrumenting `showScreen()` transitions and key button clicks in `index.html` and logging them (either into the same Supabase events table above, or a lightweight analytics tool) rather than only knowing final pass/fail state
- [ ] Keep any demographic tracking at the parent/club level, not the athlete level — consistent with CLAUDE.md's minors data-minimization rule
- [ ] Check what regulations actually apply to collecting minors' data (name, team, age group) — e.g. COPPA — and confirm today's minimal fields plus any new tracking added here stay compliant, not just "minimal because CLAUDE.md says so"
- [ ] Confirm PlayFund isn't storing anything Stripe already stores on its side (card numbers, bank details) — CLAUDE.md already locks this for card data, so this is a verification pass on the actual Supabase schema and any new events/analytics tables added here, not a new rule

## 5. Replace hello@playfundai.com with admin@playfundai.com

Grounded in: 14 occurrences across `worker/index.js` and `index.html` (from-addresses, footer mailto links, FAQ copy, decline-screen copy). Zero existing uses of admin@playfundai.com today.

- [ ] Confirm admin@playfundai.com is a real, monitored inbox before switching anything (sending "from" or displaying an unmonitored address is worse than today)
- [ ] Update all 14 occurrences
- [ ] Update the Resend sending identity/verified address if it's tied to hello@ specifically

## 6. Stripe/Klarna: embedded vs. redirect

Grounded in: `openStripeCheckout()` in `index.html` today does a full-page redirect (`window.location.href = data.url`) to a Stripe-hosted Checkout Session created server-side in `worker/index.js`.

- [ ] Document today's flow precisely (done above) as the baseline to compare against
- [ ] Evaluate Stripe's Embedded Checkout / Payment Element as the alternative that keeps the parent on playfundai.com instead of navigating to checkout.stripe.com
- [ ] Confirm Klarna is actually available as a payment method inside that embedded flow for our account/region (verify directly in Stripe's dashboard/docs, don't assume)
- [ ] Weigh the added frontend work (mounting Stripe.js, handling the payment lifecycle client-side) against staying with today's simpler redirect + webhook pattern
- [ ] Decide before doing more checkout-UI work — this determines whether the old paynow/terms screens (removed during the recent merge) should come back in a new embedded form, or stay gone

## 7. Club reporting (Jackson's track)

Grounded in: the TeamSnap/SportsEngine reporting teardown already done, and the per-club payments CSV export already built (`GET /admin/clubs/:clubId/payments` in `worker/index.js`, rendered in `screen-admin-club-detail` in `index.html`).

- [ ] Get specifics from Nikki on exactly what was bad about the SportsEngine reporting she used (a concrete complaint beats "make it better")
- [ ] Decide which additional cuts of the payments data clubs actually want: by team, by date range, by payment method, deposit/payout reconciliation against what Stripe Connect actually transferred
- [ ] Scope as Jackson's own workstream from there

## 8. How PlayFund actually uses AI

- [ ] List real candidate uses without committing yet: support-reply drafting from the existing FAQ content, at-risk-family flagging before a payment fails, natural-language dashboard queries for club admins, roster-import extraction from uploaded spreadsheets during onboarding
- [ ] Decide deliberately after pilot data exists — what's actually painful is clearer once there's real usage, rather than backfilling a feature to justify the name
- [ ] Until decided, keep AI claims out of any marketing copy (ties back to item 2's honesty bar)

## 9. Volume / scaling

Grounded in: real patterns already in `worker/index.js`.

- [ ] Flag the concrete bottleneck: `GET /admin/clubs` and `GET /admin/clubs/:clubId/payments` both fan out multiple sequential Supabase calls per club (teams, athletes, payments); Cloudflare Workers cap subrequests per invocation (50 on the free plan, 1000 on paid), so this degrades once there are more than a handful of clubs
- [ ] Flag `syncPaymentStatuses` in `index.html`, which does one Supabase fetch per athlete on every parent app load
- [ ] Check Supabase plan limits (connections, row counts, egress) against pilot-scale projections
- [ ] Check Resend sending limits and domain reputation as email volume grows
- [ ] None of this is urgent at 5 pilot clubs — the point is writing it down now so it's not forgotten before the next growth stage

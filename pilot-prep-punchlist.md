# Pilot prep punchlist

A running list of workstreams to tackle before the pilot, editable across sessions. Check items off as they're done; add new ones as they come up. This is separate from `pilot-readiness-plan.md`, which is an earlier, more technical phase-by-phase plan — this file tracks the items identified in review conversations.

## 1. Email & customer-facing copy consistency

Grounded in: 6 email templates in `worker/index.js` (`sendReminderEmail`, `sendApprovalEmail`, `sendReceiptEmail`, `sendPendingApprovalEmail`, `sendClubWelcomeEmail`, `sendInternalClubAlert`).

- [x] Audit all 6 templates for one shared header/footer/sign-off pattern — the 5 customer-facing ones (all but the internal alert) now close with the same "reply, contact the club, or reach admin@playfundai.com" line
- [x] Replace the amber/orange left-border callout box in `sendClubWelcomeEmail` with a neutral card (`#F4F7F6` bg, no accent border) matching the rest of the template
- [x] Remove or soften specific response-time promises: the scholarship flow's "within 48 hours" (was 3 places in `index.html`) and the FAQ's "we typically respond within a few hours" are gone
- [x] Decided the standard: no specific time window anywhere customer-facing, just "we'll get back to you" / "reply to this email"
- [ ] **One survivor found later, in the app rather than an email:** `showDeclineClubContact()` in `index.html` ends with an `alert()` reading "Expect to hear from them within 1–2 business days." The original audit only covered the 6 email templates, so this one was never in scope. Seen live while click-testing the decline fork, not by grepping. Same decision should apply to it
- [x] Reviewed `sendInternalClubAlert`'s "reach out within 1 business day" — kept as-is, it's an internal staff SLA reminder (goes to jackson@/clyde@, never seen by a club), not a customer-facing promise
- [x] Rolled in the hello@ → admin@ swap (item 5) across all 6 templates
- [x] **Correction — this was a real double-send bug after all, not two different emails.** You confirmed you got two *identical* copies of the welcome email (same club, same stats), not one welcome + one internal alert as I'd assumed from a code read alone. Real root cause found: `submitRegistration()` had no guard against a double-click on the Continue button — nothing disabled it or blocked a second call while the first request was still in flight, so two clicks fired two real `/club/register` calls, creating two club rows and two identical emails. Fixed: an in-flight guard plus disabling the button during submission. (The separate welcome-vs-internal-alert *dual-audience* email situation is still real and still a legitimate design question — see the club reporting/reg copy area — but it wasn't what caused this specific report)

## 2. Homepage direction

Grounded in: the two mockups already published (Option A: app-language with a "What is PlayFund?" section; Option B: traditional SaaS layout), both scrubbed of Klarna mentions and specific timelines/terms.

- [ ] Review both options with Clyde and Jackson
- [ ] Pick a direction, or specify a hybrid of the two
- [ ] Re-check the chosen direction's copy against the same bar just applied (no vendor names, no timelines, no unverified terms) since further edits may reintroduce risk
- [ ] Decide what "Get Started" / "Request a demo" actually do today, before real self-serve onboarding exists (a form? a mailto? a Calendly link?)
- [ ] Turn the chosen canvas into real site files once decided

## 3. playfundai.com setup (Squarespace)

**Cut over 2026-09-15.** `www.playfundai.com` now serves both the marketing page and the app
from Cloudflare Pages (project `playfund-app`, new company-owned account
`9d5dbaaec8b4dc695ef735345a948fee`, build output directory `public`). DNS stays at Squarespace.

- [x] Confirm where the actual app is hosted today — was GitHub Pages serving the repo root, which
      is why `worker/index.js`, `tools/pf-sql` and this punchlist were on the open web
- [x] Decide the split — **rejected the `app.` subdomain.** Marketing at `/`, app at `/app/`, one
      origin. A second origin would have meant a second TLS cert, a second Supabase allowlist entry,
      CORS between our own pages, and `localStorage` that doesn't follow the user between them.
      The mockups showing `app.playfundai.com` are now wrong; see item 5.
- [x] Add the DNS records without breaking Resend/Google — verified byte-identical before and after
      (MX, SPF, `google._domainkey`, `resend._domainkey`, `links.`, `send.`). Baseline captured first.
- [x] Point the homepage at the domain

### What actually happened, and what it cost

- **Only one record changed**: `www CNAME → playfund-app.pages.dev`. Chose the CNAME route over
  moving nameservers to Cloudflare specifically to keep mail out of the blast radius.
- **Saving that record deleted the entire "Squarespace Defaults" preset**, not just the `www` row —
  taking the four apex `A` records and the apex `HTTPS` record with it. Mail was unaffected (every
  email record lives under Custom records, and MX is a separate type), but **`playfundai.com` bare
  no longer resolves**, and Squarespace's apex forwarding is served *from* those A records, so the
  planned apex→www redirect needs a different mechanism.
- Supabase `site_url` → `https://www.playfundai.com/app/`; `uri_allow_list` gained the www entries
  and kept the github.io ones.
- The old GitHub Pages address is now a redirect shim at the repo root, preserving **query and
  hash** (`#access_token=` from Supabase auth links would be dropped by a 301 or meta-refresh).
  Verified live. **Keep it indefinitely** — it is the only thing holding historical links open.

### Still open

- [ ] **Apex `playfundai.com` does not resolve.** Nothing customer-facing was there, but it needs a
      fix. Cleanest long-term answer is moving DNS to Cloudflare and CNAME-flattening the apex onto
      Pages — see the DNSSEC constraint below before attempting that.
- [ ] **DNSSEC is enabled** (DS `3034 8 2 A310B37F…` live at the registry). Any future nameserver
      move must: disable DNSSEC at Squarespace → wait for the DS to clear the registry → change
      nameservers → re-enable at Cloudflare with a new DS. Flipping nameservers with the old DS
      still published takes the domain hard-dark for validating resolvers, **email included**.
- [ ] **No DMARC record.** SPF and DKIM are in place but nothing tells receivers what to do on
      failure, so `admin@playfundai.com` is spoofable — and phishing parents with fake payment links
      is the obvious attack on this product. Start at `p=none`, read the reports, then tighten.
- [x] **Cloudflare Pages previews are gated by Cloudflare Access** — corrected 2026-09-16.
      Recorded here earlier as an open risk ("previews are public"); that was wrong. Verified by
      loading a branch preview: `https://<hash>.playfund-app.pages.dev` returns the Cloudflare
      Access sign-in, not the app. The production alias `playfund-app.pages.dev` is reachable
      without Access, which is what the earlier claim was actually based on. No action needed —
      note only that a preview cannot be opened by a tool or teammate without a login code.

- [ ] **Production deployment is still attributed to `ajjurko/move-to-www-domain`.** Changing the
      production branch to `main` does not trigger a rebuild; Pages waits for the next commit. The
      content is identical (`git diff 8a0227f 209787e` is empty), so this is bookkeeping only — but
      **don't delete that branch until a production deployment from `main` exists**.
- [ ] **The Worker has not moved.** It still runs in the personal Cloudflare account at
      `playfund-worker.jacksonwwatkins.workers.dev`, and still holds the cron and both webhook
      endpoints. The hostname change must ship as **one commit** covering
      `public/app/index.html`, `public/index.html`, `worker/index.js` *and* the CSP `connect-src` in
      `public/_headers` — if the frontend and the CSP disagree, the browser blocks every API call
      with nothing in the Worker logs.
- [ ] **Register `www.playfundai.com` in Stripe → Payment method domains.** Checkout is *embedded*
      (`stripe.initEmbeddedCheckout` mounts an iframe into `/app/`), so our page is the top-level
      document and Apple Pay / Google Pay need the domain registered. Fixing
      `Permissions-Policy: payment=()` was only half of it. Both halves fail silently — no console
      error, and card payments keep working.

## 4. Data tracking strategy (Stripe/Klarna + PlayFund's own instrumentation)

- [ ] Write down the actual questions to answer first — the ones a lender or investor will ask: payment-method mix (full vs. installments), approval/decline rates, time-to-registration, club retention, average dues size, geographic/sport demographics
- [ ] Map each question to where the data actually lives: Stripe (payment status/method/fees), Klarna (approval/decline outcomes — confirm what's exposed via the Stripe integration vs. needing direct Klarna dashboard access), Supabase (system of record for clubs/athletes/payments), Resend (send/open/click — not currently captured anywhere but Resend's own dashboard)
- [x] Added email engagement tracking: `POST /webhook/resend` in `worker/index.js`, verified via Svix HMAC signature (same pattern as the Stripe webhook), writes `email_opened`/`email_clicked` into the `events` table. Deliberately doesn't store the recipient's email in `properties` — just the Resend email ID, subject, and (for clicks) the link — consistent with the data-minimization pass above.
- [x] Registered the actual Resend webhook via their API (had `RESEND_API_KEY` server-side already) — no dashboard click-through needed. Confirmed live: endpoint `https://playfund-worker.jacksonwwatkins.workers.dev/webhook/resend`, events `email.opened`/`email.clicked`/`email.bounced`/`email.complained`, status `enabled`. Its real signing secret is set as `RESEND_WEBHOOK_SECRET` in Cloudflare.
- [x] Resend now requires a dedicated tracking subdomain (`links.playfundai.com`) rather than a simple per-domain toggle — added the CNAME it required in Squarespace DNS, verified fully via the Resend API afterward: `status: "verified"`, `open_tracking: true`, `click_tracking: true`. Email open/click tracking is now fully live end-to-end
- [x] **Real bug found and fixed:** the `events` table's Supabase role only had `INSERT` granted, not `SELECT` — every `trackEvent()` call all session (screen views, checkout events, login/signup events) had been silently succeeding into a table nothing could read back from. Fixed by running `GRANT ALL ON public.events TO service_role;` in the Supabase SQL editor. Verified directly: inserted a test event via `/events` and read it straight back via a temporary debug route (removed after confirming) — no permission error, row came back exactly as inserted
- [x] Added a lightweight product-events table in Supabase (`events`: event_name, session_id, athlete_id, club_id, properties jsonb, created_at) — see setup step under item 6, since the embedded-checkout build needed it first
- [x] Added funnel/click tracking as of the embedded-checkout build: every `showScreen()` call now logs a `screen_view` event, and the checkout flow logs `payment_method_selected`, `checkout_mounted`, `checkout_completed`, `checkout_confirmed`, `checkout_declined`, `checkout_canceled`, `checkout_error`. Interaction-level only (which screen/button), never what was typed — payment fields are Stripe's own iframe and never touch this page
- [x] Extended the same pattern to club admin login, PlayFund admin login, and club signup: `club_login_attempted/succeeded/failed`, `admin_login_attempted/succeeded/failed`, `club_signup_submitted/completed/failed`. Found and fixed a real bug while doing this — club signup always showed "you're on the list" even if `/club/register` failed outright (network error, server error), since the response was never checked. Now shows a real retry message instead of a false success screen. Parent login/registration funnel already covered by the generic `screen_view` tracking (no separate outcome events needed there — there's no separate success/fail step, just registration, already tracked via `checkout_*` events)
- [x] Keep any demographic tracking at the parent/club level, not the athlete level — checked: the new `events` table logs `athlete_id`/`club_id` as bare UUIDs only, no demographic fields anywhere in `properties`, and no new demographic tracking was added
- [x] Verified today's actual Supabase fields for `athletes` (`name, age, team_id, club_id, parent_email, parent_phone, payment_status, approval_status, enrolled_at, last_reminder_sent_at, parent_user_id, stripe_customer_id, payment_method`) — no birthdate, address, school, or photo anywhere. Matches `privacy-policy.html`'s existing claim exactly (that file already existed in the repo and states this correctly). **What's still open:** whether this is actually COPPA-compliant is a legal conclusion, not a code check — flagging for a real opinion rather than asserting it myself. In PlayFund's favor: COPPA is triggered by collecting data *from* a child, and the athlete never creates an account, logs in, or interacts with PlayFund directly — the parent always does — which doesn't look like a COPPA-triggering flow, but that's worth confirming with someone qualified to say so
- [x] Confirmed PlayFund isn't storing anything Stripe already stores — grepped the full codebase and the actual `payments` table fields (`stripe_payment_intent`, `stripe_event_id`, `amount_cents`, `status`, `payment_method`, `notes`). Only Stripe reference IDs and category labels (`"card"`/`"klarna"`/`"us_bank_account"`) are stored, never card numbers, CVVs, or bank account numbers, anywhere in the app or the database

## 5. Replace hello@playfundai.com with admin@playfundai.com

Grounded in: 11 occurrences across `worker/index.js` and `index.html` (from-addresses, footer mailto links, FAQ copy, decline-screen copy).

- [x] Confirmed admin@playfundai.com is a real, monitored inbox
- [x] Updated all 11 occurrences
- [x] No separate Resend identity update needed — sending is verified at the playfundai.com domain level, not per local-part, so admin@ sends the same as hello@ did
- [x] **Correction (2026-09-15): "all 11" missed the legal documents.** `hello@` was still the
      contact in `privacy-policy.html` (lines 95 and 104) and `terms-of-service.html` (line 104) —
      line 95 being the address a parent writes to **to request deletion of their child's data**.
      Those three are now `admin@`. The earlier audit read `worker/index.js` and the old root
      `index.html` only, and never covered the legal pages.
- [ ] If a `privacy@playfundai.com` alias gets created, repoint the two privacy-policy contacts to
      it. `admin@` was used because it is verified monitored; an address that bounces is worse than
      the wrong address on a data-deletion request.

## 6. Stripe/Klarna: embedded vs. redirect

Was: `openStripeCheckout()` did a full-page redirect (`window.location.href = data.url`) to a Stripe-hosted Checkout Session. Now: the same session is created with `ui_mode: "embedded"` and mounted inline via Stripe.js's `initEmbeddedCheckout`, so the parent stays on playfundai.com for card/bank; Klarna still briefly redirects away and back (required by Klarna's own approval step) via a single `return_url`, handled the same way as before — status is always re-verified against the server/webhook, never trusted from the redirect.

- [x] Documented today's flow as the baseline
- [x] Built Embedded Checkout: `POST /athlete/:id/checkout` now returns `client_secret` instead of `url`; a new `GET /config` endpoint serves the Stripe publishable key; `index.html` loads Stripe.js and mounts checkout into a new `screen-embedded-checkout`
- [x] "Pay in full" and "installments" stay on strictly separate Stripe Checkout Sessions — see below, this needed more than just `payment_method_types`
- [x] **Real bug you caught live:** after a real test payment, "pay in full" still showed Klarna as an option, labeled "Powered by Link" — even though the session's `payment_method_types` was verified server-side to be exactly `["card","us_bank_account"]`. Root cause: Stripe Link recognizes a returning customer/device and offers their previously-saved payment method (including a saved Klarna instrument) regardless of what the merchant restricted that session to — Link treats it as its own cross-session wallet, not something our per-session list gates. Fixed by creating a dedicated Stripe Payment Method Configuration (`pmc_1UD4SnPyhgYp24ebsPEd8LSJ`, hardcoded as `PAY_IN_FULL_PMC_ID` in `worker/index.js`) with card + bank on and Link/Klarna/Affirm/Afterpay all explicitly off, and pointing the "pay in full" session at that configuration instead of `payment_method_types`. "bnpl" is untouched and still explicitly `["klarna"]` only.
- [x] Tested checkout session creation directly against live Stripe (test mode) via a self-contained test club/team/athlete (no production data touched). Found and fixed a real bug: Stripe now rejects `ui_mode: "embedded"` outright ("no longer supported, use embedded_page instead") — every checkout attempt was failing 100% of the time. Fixed in `worker/index.js` and pushed.
- [x] Confirmed Klarna is actually accepted by Stripe for this account: after finishing test-mode Stripe Connect onboarding on a throwaway test club, both `payment_type: "full"` and `payment_type: "bnpl"` checkout sessions were created successfully via direct API calls. Stripe validates `payment_method_types` at session-creation time and would reject `["klarna"]` outright if Klarna weren't enabled/available for the account — it didn't, so Klarna is live and correctly isolated to the installments path only.
- [x] Also caught and fixed a second real bug while testing: `APP_URL` (used for checkout `return_url`, Stripe Connect onboarding links, and Supabase invite redirects) still fell back to the old `jacksonwatkins30.github.io` Pages URL, which no longer serves the app — the app now lives at `playfundai.github.io/playfund-app`. Added `APP_URL` as a proper env var in `worker/wrangler.toml` and fixed the in-code fallback.
- [x] Real, full-flow test completed in the browser: pay in full (card) and installments (Klarna) both run end-to-end against live Stripe test mode, Klarna confirmed absent from pay-in-full after the Link fix above
- [x] **You asked whether the $500-paid confirmation was real or guessed — it was guessed.** The in-app confirmation screen showed the team's configured dues amount and the current browser time, not the actual payment record; harmless in the normal case but not provably real. Fixed: the confirmation now renders from the real webhook-verified payment (real amount, real timestamp, real Stripe transaction ID). Also added a transaction ID and real charge date to the receipt email, which previously had no identifying information at all — nothing a parent could verify a charge against if they ever doubted one.
- [ ] Decline and cancel paths still need a real test-mode run (a card that triggers `payment_intent.payment_failed`, and abandoning checkout mid-flow) — code reviewed and looks correct (cancel never sets false payment state; decline screen correctly offers alternatives per CLAUDE.md), but blocked on finishing a test club's Stripe Connect onboarding to actually click through it. Test fixtures ready: club code `JKGRXE8`, athlete `2443811f-cdf5-4d28-821f-c6278e41076a`, Stripe decline card `4000 0000 0000 0002`
- [x] **Removed "Split with another payer" entirely** from the decline screen — it was a placeholder (`showDeclineSplitInfo()` just alerted "not available yet"), never real, and rather than leave a dead-end button it's gone now, per direction.
- [x] **Actually tested the other two decline-fork options live, not just by reading the code — good thing, because my earlier "these both work" read was half wrong.** "Pay the club directly" → confirmed real: `POST /athlete/:id/notify-club` returns `{"success":true}` and sends a real email to the club. **"Apply for a scholarship" is broken** — the frontend calls `POST /scholarship/apply`, but that route doesn't exist anywhere in `worker/index.js` at all. Confirmed with a direct call: `{"error":"Not found"}`. The frontend does correctly show an error rather than a false success, so no parent would be told their application went through when it didn't — but the option has been silently non-functional this whole time. This is also exactly `CLAUDE.md`'s already-flagged open policy question ("How scholarship/$0 athletes are handled") — not something to invent an answer for and build blind. Needs a decision: pull the option from the decline screen until it's real (same treatment as split-with-another-payer), or scope and build the real endpoint now
- [x] **Fixed: Supabase's Auth redirect allowlist bug.** It only had the dead `jacksonwatkins30.github.io` URL, so every club invite link silently redirected to a dead page regardless of what the Worker sent. You added `https://playfundai.github.io/playfund-app/**` to Redirect URLs — verified fixed: a fresh invite link now redirects to the correct host.
- [x] **Built the standard fix, but couldn't fully confirm it resolves what you saw — needs your own real test, not more of mine.** Original finding: roughly half of real invite emails silently died before anyone clicked them (not the redirect-host bug — that's separately fixed above). Built the correct, standard mitigation: the welcome email's link no longer points straight at Supabase's self-consuming `/auth/v1/verify` endpoint (which burns its single-use token on the mere GET, letting an automated mail-scanner's prefetch kill it before a real click); it now lands on our own page (`screen-club-verify`) and only exchanges the token when `completeClubVerify()` runs — which requires an actual button click, not just a page load. Verified the exchange mechanism itself works correctly (real access token back, still properly single-use after).
  **What I couldn't pin down:** repeated real-world testing — dozens of live `/club/register` calls sending real emails — still showed failures under the new architecture, at a rate that got *worse*, not better, as I ran more trials, while every isolated test (generating and immediately verifying a token with no real email ever sent) stayed 100% reliable throughout, every single time. That pattern is a real warning sign that my own rapid-fire testing (dozens of near-identical emails to the same real inbox in a short window) was likely triggering Gmail's own anti-abuse/security scanning *because of the volume and repetition*, not necessarily reproducing what a single genuine signup experiences — and it's also a real deliverability-reputation risk to the sending domain in its own right, which is why I stopped rather than keep pushing more test volume through it.
  **What this means practically:** the fix that's shipped is correct and worth keeping regardless (it closes a real, known vulnerability class in magic-link auth), but whether it actually solves the original complaint needs a single real test — one real person, one real club signup, checked once — not more automated repetition from me. If a single clean test still fails, the fallback is a numeric one-time code instead of a link (immune to any prefetching since nothing can "type" a code on someone's behalf), which is a bigger change worth scoping separately rather than guessing at blind.
- [x] **Found and fixed the real second-email bug — this is what caused "two different emails, only one link works."** You forwarded two real `.eml` files from one registration: one from `admin@playfundai.com` with our new click-gated link (correct), and a second from `"Jackson at PlayFund" <jackson@playfundai.com>` with the old raw self-consuming Supabase link — an email our own code never sends. Root cause: `/club/register` calls Supabase's `generate_link` with `type: "invite"`, and that specific type makes Supabase's own built-in GoTrue mailer auto-send its own email (default template, its own configured sender, the vulnerable raw link) completely outside our Resend code. Every registration was silently sending two emails with two different links racing each other — exactly matching "only one link worked." Fixed by changing that call to `type: "magiclink"`, which still creates the user but never triggers Supabase's own auto-send; only our Resend email goes out now. Deployed and pushed. Not yet verified with a real signup (holding off on test emails today per the daily send cap) — first real registration tomorrow should show exactly one email.
- [x] **REGRESSION root-caused — and it exposed a bigger bug that had been misdiagnosed.** Read the actual Supabase auth log rather than guessing. The failing call returns **500 `unexpected_failure`**: `failed to close prepared statement: ERROR: current transaction is aborted ... ERROR: duplicate key value violates unique constraint "users_email_partial_key" (SQLSTATE 23505)`. `generate_link` was trying to *create* a user whose email already existed. Reproduced deterministically with two concurrent `/club/register` calls for one new email — both returned `invite_url: null`.

  **The second racer is not a double-click. `/club/register` is not the only thing that invites the club admin.** There are two Supabase **Database Webhooks on `clubs` INSERT** — `on-club-insert` and `on-club-insert-notify` (plus `on-athlete-insert` on `athletes`), all `supabase_functions.http_request` triggers pointing at Supabase **Edge Functions**. One of them calls `generate_link` with `type: "invite"` and sends a *second* branded email. Confirmed three independent ways:
  - Every registration produces two emails: ours from `admin@playfundai.com`, plus **"<Club> — you're on the PlayFund list" from `jackson@playfundai.com`**. It fires on pure `curl` calls with no browser open, so it is server-side.
  - That second email's raw headers show it is sent through **Resend** (`DKIM d=playfundai.com; s=resend`, links wrapped through `links.playfundai.com`) and carries a **raw self-consuming `/auth/v1/verify?...&type=invite` link** — exactly the prefetch-vulnerable link shape we removed from our own email.
  - The Supabase auth log for that call shows `auth_event.action: "user_invited"`, `status 200`, from `remote_addr 34.208.174.25` (an AWS address — Edge Function), while our Worker's calls come from a Cloudflare address.

  **This is the real explanation for "half the invite emails silently died", and it is not mail-scanner prefetching.** GoTrue stores a signup/invite token in `confirmation_token` and a magiclink token in `recovery_token`:
  - **Brand-new club admin (the normal pilot case):** our `generate_link` returns `verification_type: "signup"` → writes `confirmation_token`. The webhook's `invite` writes `confirmation_token` too, and **overwrites ours**. Verified live: a `signup` token taken straight from the API response, never emailed to anything that could consume it, was already `otp_expired` 30 seconds later.
  - **Email that already exists:** ours comes back as `magiclink` → `recovery_token`, a different column, so it survives. Verified live: exchanged successfully ~40s after issue.
  - **Both paths racing to create the same new user:** duplicate key → 500 → `invite_url: null`. That is the overnight regression.

  So the earlier conclusion that `type: "invite"` was making *Supabase's own GoTrue mailer* auto-send the second email was wrong — switching to `"magiclink"` correctly stopped nothing, because the second email never came from our call at all. The `"magiclink"` switch is still right to keep; it just was not the fix.

  **Fix committed locally (branch `ajjurko/fix-invite-link-race`, NOT pushed — see below):** `generate_link` failures are no longer swallowed. The old code never checked `linkRes.ok`, so a 500 just left `inviteUrl` null, the club got a welcome email with no way into their account, and nothing anywhere recorded why. Now the real status and error body are logged, returned as `invite_error`, and `sendInternalClubAlert` switches to an **ACTION NEEDED** subject so a human follows up. A single retry is also attempted.

  **What actually needs to happen — and it is not in this repo.** The duplicate invite path has to be turned off in Supabase (the `on-club-insert` / `on-club-insert-notify` webhooks and whichever Edge Function sends that email). Until it is, first-time club signups keep getting a dead setup link. Its copy is also badly out of date and contradicts the product: **7.5% fee** (vs 5% everywhere else — it quotes a club $18,500 where our own email says $19,000 for the same inputs), "a PlayFund team member will reach out within one business day", "we typically respond within a few hours", and `jackson@` instead of `admin@` — every single thing items 1 and 5 removed from customer-facing copy is still going out on every registration, from an address no one has been editing.

  **Also unresolved:** as of the end of this session `generate_link` began returning `invite_url: null` for *every* registration, new and existing emails alike, while the webhook's own invites kept succeeding (200) in the same seconds. Most likely a GoTrue rate limit tripped by the day's test volume, but that is a guess — the committed error-surfacing change is exactly what would answer it, and it could not be deployed (see below). Test clubs created while root-causing: `KU7BXVS`, `E936KSZ`, `K8ASGN9`, `7MY5VT5`, `EDCTWBY`, plus "Pilot QA Soccer Club" and several "QA Flow Club" rows — all safe to delete.

  **Blocked on deployment:** this machine has no GitHub credentials (`git push` fails, no `gh`, no SSH key, nothing in the keychain), so the fix is committed locally only and could not be merged or deployed. Everything above was tested against the currently-deployed Worker.

- [x] **Found and fixed a real bug you caught: the link died even when you hadn't finished setting up.** Clicking "Continue to account setup" exchanges (consumes) the token right away, before the password is actually submitted — so getting interrupted between that click and finishing the password form, then reopening the same email link, failed outright even though setup was never completed. Fixed: the already-issued session is now cached locally, so reopening the same link resumes account setup instead of dead-ending. (True single-use expiry — reopening after successfully finishing setup — still correctly fails, as it should.)
- [x] **Real browser click-through, Sep 11 — found a total blocker nobody had hit because nobody had clicked the button.** Registered "Parity QA Club 0911" through the live UI with a fresh admin email, received the real welcome email, clicked the real "Set up your account" link. The click-gated verify screen ("Almost there.") loaded correctly. Clicking **"Continue to account setup" did nothing at all** — no progress, no error, no network request. Console: `ReferenceError: completeClubVerify is not defined`. The function is declared inside the `window 'load'` handler (`index.html:2703-2955`) so it is function-scoped, while the button calls it through an inline `onclick`, which resolves against `window`. It threw before any of the function's own error handling, so the admin sees nothing and has no way forward. **Every club was blocked at account setup.** Fixed by exposing it on `window`; checked the other seven functions in that same scope, and this is the only one referenced from an inline handler. This is exactly the class of bug that backend-correct testing cannot find — same lesson as the `ui_mode` bug earlier in this item
- [x] **Confirmed live, not inferred: a first-time club's setup token is dead before it is ever used.** Same run, same club — exchanging the token from that email returned `403 otp_expired` ("Email link is invalid or has expired") thirteen minutes after issue, on a token whose button had never successfully fired, so nothing on our side had consumed it. That is the `on-club-insert` webhook's `type: "invite"` overwriting `auth.users.confirmation_token`, which is where a brand-new admin's `signup` token lives (the email's link carried `verify_type=signup`, confirming the type). Registration also sent the usual two emails one second apart, ours from `admin@` and the webhook's from `jackson@`. **So a new club has two independent blockers, and fixing the button alone is not enough** — `ALTER TABLE clubs DISABLE TRIGGER "on-club-insert";` is still required and still not run (attempted; blocked by a guardrail on running DDL against production, needs a human)
- [x] `generate_link` **succeeded** on this run and returned a real link, so the "null for every registration" seen the night before was transient, not a permanent break — consistent with the rate-limit theory but not proof of it. Worth re-checking whenever test volume is high again, now that the merged error-surfacing reports the real Supabase status instead of swallowing it
- [x] **Decline fork click-tested for the first time.** "Split with another payer" and the scholarship option are both genuinely gone from the screen (verified visually, not by grep). The Klarna section's credit disclosure reads "Using Klarna may affect your credit depending on the plan you're offered" — correct per CLAUDE.md's rule. "Pay the club directly" works end-to-end from the UI, not just via a direct API call: clicking it sent a real email to the club admin (`QA Decline Test's family wants to arrange payment directly`, received 20:51:13)
- [ ] **The decline fork's confirmations are raw browser `alert()` calls** (`showDeclineClubContact()`), not the app's own styled screens — visually inconsistent with every other screen, and a modal `alert` freezes the page hard enough that it blocked browser automation entirely until the tab was closed. Also the place the surviving "1–2 business days" promise lives (see item 1). Worth replacing with a real screen or inline confirmation
- [ ] **Two payout dates disagree inside one registration.** On the fees step the estimate read "Estimated payout: Sep 25, 2026" (today + 14 days); the confirm screen and the welcome email both said "Thursday, October 15, 2026" (season start + 14 days) for the same submission. A club would notice. Pick one basis
- [ ] **Stale copy on the parent payment screen:** "You'll complete payment securely on Stripe's checkout page" and "On Stripe's checkout, enter your card or bank details and tap Pay" — written for the old redirect flow. Checkout is embedded now; the parent stays on playfundai.com for card/bank, and only Klarna leaves
- [ ] **Embedded Stripe Connect onboarding is still unverified** — it needs a club admin session, which requires the setup button fix to be deployed *and* the webhook trigger disabled. Both blockers above sit in front of it. This remains the oldest untested item in this list
- [x] **Sep 13: the whole club path works end to end for the first time.** With `on-club-insert` disabled and the setup-button fix deployed, registered "Clean Run FC 0913" (`Y7XXHLK`) through the live UI: **exactly one email**, from `admin@` (the `jackson@` duplicate is gone), its link exchanged cleanly with no `otp_expired`, password set, signed in, club dashboard reached. `wrangler tail` showed `/club/register` Ok with no `generate_link` error. Adding a team worked and saved correctly (`dues_cents = 60000` for two fee items of $400 + $200). **One unexplained thing:** the first click of "Set password & sign in" showed "Network error. Please try again." and the second click worked. I did not have network capture armed on that first click, so I can't say whether it was a transient blip or something after the password PUT throwing into the catch-all. Seen once, not reproduced, not root-caused — flagging rather than guessing
- [x] **Embedded Stripe Connect onboarding was broken, and is now fixed (PR #14).** The item flagged here as "still needs a real click-through" — the click-through found `window.StripeConnect.loadConnectAndInitialize is not a function`. That function is exported by the npm `@stripe/connect-js` module; this page loads the plain `<script>` build, which instead wants a `StripeConnect.onLoad` hook declared *before* the script tag and then supplies `StripeConnect.init`. Confirmed by reading the served 893KB bundle — its only mention of `loadConnectAndInitialize` is inside a warning string. Verified the real API in the browser before writing the fix (init returned an instance, `create('account-onboarding')` produced the element, Stripe's own "Add information to start accepting money" step rendered), then confirmed the deployed fix through the actual button. The backend was correct the whole time
- [ ] **Completing Connect onboarding can't be automated from here.** The component renders inside cross-origin `connect-js.stripe.com` iframes, so the click-through stops at Stripe's own form. It also asks for business identity and bank/routing details, which shouldn't be filled on someone's behalf regardless. **Needs a human to finish it once** for a test club; after that the payment paths can be exercised against it. The existing fixture club `5D2GU64` (`acct_1UD3r8Pyhg7pV7GM`) is already onboarded, so payment testing isn't blocked on this
- [x] **`on-athlete-insert` is NOT a duplicate — do not disable it.** This was the assumption going in, and testing it directly disproved it. Registering an athlete as a parent produces two *different* emails, one second apart: the club admin gets "Casey Clean needs your approval before they can pay" from `admin@` (our Worker's `sendPendingApprovalEmail`, which is addressed to `club.admin_email`, not the parent), and the parent gets "Register Casey Clean for ... — Upcoming Season" from the Edge Function. Our Worker sends the parent **nothing** at registration time — `sendApprovalEmail` only fires later, once the club approves. So switching that trigger off would silently delete the parent's registration email entirely, which is the single most important email in the parent funnel
- [ ] **`hello@playfundai.com` is still live on a customer-facing email, contradicting item 5.** The parent registration email above arrives from `hello@`, not `admin@`. Item 5's audit was accurate about this repo — `grep` finds zero occurrences of `hello@` in `worker/index.js` and `index.html`, and the Worker only ever sends from `admin@` or `alerts@` — but that email isn't sent by this repo. It comes from the `send-registration-email` Edge Function, which nobody has maintained. If `hello@` is no longer monitored, every parent who replies to the registration email (and the template invites replies) is writing into a void. Either re-point that function at `admin@`, or rebuild the parent registration email in the Worker and retire the function
- [x] **Transactions are now gated on PlayFund actually setting the club's rate.** Before this, a club could register, connect Stripe and start charging families at `DEFAULT_FEE_BPS` — a rate nobody agreed to and the club was never shown. `fee_bps` couldn't express the difference (it is `NOT NULL DEFAULT 500`, so every club is born at 5% and "we negotiated 5%" is indistinguishable from "never discussed"), so `clubs.fee_agreed_at` was added and is stamped when an admin saves the rate. The Worker returns 409 on `POST /athlete/:id/checkout` while it's null — verified against production on a real approved athlete in a Stripe-connected club: `HTTP 409`, nothing charged. The club dashboard and the admin fee field both say what's missing
- [x] **Registration no longer quotes a fee before one is agreed.** The fees step, confirm step and welcome email showed "ESTIMATED PAYOUT ... 5% fee" to a club that didn't exist yet; they now show season dues to collect, which is arithmetic on what the club typed and commits to nothing. Payout still appears everywhere a real rate exists. **Note this walks back a CLAUDE.md principle** ("the payout number appears before we ask for bank details") — deliberately, with a value number kept that makes no pricing claim
- [x] **Fixed a real money-facing bug found on the way:** the fee is per club (`clubs.fee_bps`, driving the real Stripe `application_fee_amount`) but every club-facing payout number hardcoded `0.95` — four sites in `index.html`, two in `worker/index.js`. A club negotiated to 7% was charged 7%, told 7% in its welcome email, and shown 5%-based payouts in its own dashboard. All six now use one helper; zero hardcoded `0.95` remain. `fee_bps` is selected in `GET /club/:code` for that math and stripped from the unauthenticated response, since a parent only needs a club code to reach it
- [x] **CORS was silently breaking every PATCH and DELETE from the browser.** Reported as "Network error" when saving a club's fee. `Access-Control-Allow-Methods` listed only `GET, POST, OPTIONS`, so the browser refused the preflight and the request never left the page — no Worker log, no status code, nothing server-side to find. This killed `PATCH /admin/clubs/:id` (fee and reminder settings) and `DELETE /athlete/:id` (all three roster screens). **It also meant the fee gate above had no working way to be opened** — every club would have been frozen shut. Fixed and verified against production
- [x] **Admin now has a work queue.** `/admin/clubs` returns `needs_fee`, `needs_stripe`, `pending_approvals` and `needs_action` per club, and the admin screen leads with "Needs action (n)" naming what each club is waiting on, most blocking first. Previously finding the clubs that needed something meant opening all 60+ one at a time
- [x] **Pay in full (card) verified end to end, Sep 13.** Real $500 payment on a real athlete: `POST /webhook/stripe` received, `payments` row written (`50000` cents, `succeeded`, real payment intent), `athletes.payment_status` flipped to `paid_full` in the same second as the webhook rather than optimistically, `checkout_confirmed` tracked, and the receipt email arrived from `admin@` one second later. Two earlier fixes confirmed live at the same time: Klarna stayed absent from pay-in-full (the Link/PMC fix) and checkout ran inline without leaving playfundai.com.
- [ ] **Still untested: Klarna installments, and the decline card.** Klarna needs no card in test mode but its own page asks for name, address and date of birth, so it needs a human or explicit sign-off to enter synthetic details. The decline card (`4000 0000 0000 0002`) needs card entry the same way the successful payment did.
- [ ] **Unverified: the money split.** Nobody has confirmed Stripe actually took the 5% application fee to the platform and sent the remainder to the club's connected account. Visible on the payment in the Stripe dashboard; not checkable from this machine, whose Stripe CLI is authorized to a different account than the app uses.
- [ ] **Admin access is a single point of failure.** Only `jacksonwwatkins@gmail.com` and an undocumented `pf-test-playfundadmin@example.com` had `playfund_admin`. Since setting a fee is now what activates a club, every pilot club activation would have gone through one person. A second admin was added during this session
- [x] Old paynow/terms screens stay gone — verified: no `screen-pay-now`/`screen-terms` markup and no dead references to them anywhere in `index.html`, only `screen-decline` (the intended fork) remains

**Setup needed before this can be tested (manual, can't be done from here):**
1. In the Cloudflare dashboard: playfund-worker → Settings → Variables and Secrets → add `STRIPE_PUBLISHABLE_KEY` with your Stripe **test-mode** publishable key (starts `pk_test_...`, found in the Stripe Dashboard under Developers → API keys). This is the public-facing key, safe to store as a plain variable rather than an encrypted secret.
2. In the Supabase SQL editor, run:
   ```sql
   create table events (
     id uuid primary key default gen_random_uuid(),
     event_name text not null,
     session_id text,
     athlete_id uuid,
     club_id uuid,
     properties jsonb not null default '{}'::jsonb,
     created_at timestamptz not null default now()
   );
   create index events_event_name_idx on events (event_name);
   create index events_created_at_idx on events (created_at);
   ```

**Deployment gap found while testing this:** the live Worker had been running a 5-day-old manual deploy this whole time — merging to `main` on GitHub was never actually deploying anything, since no CI/CD was wired up. Connected Cloudflare Workers Builds to the GitHub repo to fix this going forward. Its "Root directory" setting defaulted to `/`, which is wrong (`wrangler.toml` lives in `worker/`, not the repo root) — changed it to `worker`. Still needs a first successful build to confirm the fix; watch the Deployments tab after this commit lands on `main`.

**Update — CI/CD is confirmed working for `main`, and confirmed broken for branches.** Verified in the Cloudflare build history rather than assumed: every `main` merge builds green and really deploys (PR #8 and PR #9 both did; the successful build logs `npx wrangler deploy`, root directory `worker`, 102 KiB uploaded). Every *branch* build fails with `Missing entry-point to Worker script or to assets directory`, because those builds ran with root directory `/` instead of `worker`. That is why PR #10 shows a red X — a pre-existing config gap, not the PR's code. Root cause of the branch failures, confirmed by pushing a fresh commit rather than by reading settings: the "Root directory" setting (`worker`) is applied to the **deploy command** but *not* to the **version command**, so non-production builds run `npx wrangler versions upload` from the repo root, where there is no `wrangler.toml`. A retry does not test this either — a retry replays that build's original settings snapshot. Fixed by making the version command name the config explicitly: `npx wrangler versions upload -c worker/wrangler.toml`. Production deploys were never affected.

- [x] **Built: embedded Stripe Connect onboarding, replacing the redirect.** `POST /club/:id/stripe-onboard` now creates a Stripe Account Session (`components.account_onboarding.enabled`) instead of an Account Link, returning a `client_secret`. `index.html` loads `@stripe/connect-js` and mounts the `account-onboarding` component into a new `screen-club-stripe-onboarding`, same pattern as `screen-embedded-checkout`. Verified the backend directly — a real test club/admin session returned a real `accs_secret_...` client secret. **Still needs a real click-through** to confirm the embedded component actually renders and completes onboarding in a browser (same category of risk as the `ui_mode` bug found testing embedded checkout — backend-correct doesn't guarantee the frontend integration is bug-free until someone actually clicks through it)

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

- [x] Fixed: `GET /admin/clubs` now fetches teams/athletes/payments for all clubs in 3 batched queries total instead of 3 queries per club (was scaling linearly toward Cloudflare's 50-subrequest free-plan cap)
- [x] Fixed: `syncPaymentStatuses` in `index.html` now calls one new bulk endpoint (`GET /athletes/status?ids=...`) instead of hitting `GET /athlete/:id` once per athlete on every parent app load
- [x] Checked Supabase against a real 5-club projection (using the actual "Team Richmond" club as the size reference — 4 teams, ~15-20 athletes/team): roughly 350 athletes, ~900 payment rows, tens of thousands of `events` rows for the whole pilot season. That's a trivial amount of data for Postgres — table/egress limits on Supabase's Free tier are not a real concern at this scale. Both Supabase and Resend are confirmed still on Free tier. **The actual Free-tier risk isn't storage, it's the project pausing after ~1 week with no API activity** — worth a calendar reminder to ping the Worker periodically during any quiet stretch (off-season, between pilot rounds), or just upgrading before the pilot goes live. (Exact current Supabase/Resend numeric limits should be checked on their live pricing pages, not taken from memory — plans change.)
- [x] **Real, concrete Resend risk found, not just "check your limits":** the daily reminder sweep (`runScheduledReminders`, confirmed via the Cloudflare API to run on a live cron at `0 13 * * *` UTC) evaluates every club/team/athlete in one run and emails everyone eligible **in a single batch**. Team Richmond's own data shows 3 of its 4 teams already share one `dues_due_date` — a realistic pattern, since a whole club (or several pilot clubs starting around the same time) naturally lands on the same due date. If teams across multiple clubs share a due date, that's dozens to 100+ reminder emails firing in one daily run, which could hit a Resend Free-tier **daily** send cap even though the monthly total is fine. Not urgent with 1 test club, but worth knowing before 5 real clubs go live with overlapping season calendars — spreading the cron's send times or batching with delay is the fix if it becomes a problem
- [x] Also fixed while checking this: the daily reminder cron trigger (`0 13 * * *`) was live in Cloudflare but only ever configured through the dashboard, never declared in `worker/wrangler.toml` — same class of gap as the Stripe publishable key earlier. Now declared under `[triggers]`, verified via the Cloudflare API that the schedule is unchanged after redeploying with it declared

## 10. Email unsubscribe / suppression tracking

Grounded in: none of this exists today — checked directly. No unsubscribe link in any of the 6 email templates, no suppression list in Supabase, and the Resend webhook built for item 4 only handles `email.opened`/`email.clicked`, not `email.bounced` or `email.complained`. Right now, if a parent unsubscribes or marks a reminder as spam, PlayFund has no way to know and keeps emailing them — a deliverability risk (spam complaints hurt the sending domain) and a real courtesy/compliance gap (CAN-SPAM requires honoring opt-outs).

- [x] Built: `GET /unsubscribe` (HMAC-signed link, no login needed) checked before every send via `getSuppression`/`isSuppressed`/`isHardSuppressed` in `worker/index.js`. Unsubscribe link added to `sendReminderEmail` only (the one genuinely recurring/marketing-like send). `email.bounced`/`email.complained` now auto-suppress in `POST /webhook/resend`. New `UNSUBSCRIBE_SECRET` and `WORKER_URL` set/added directly — tested the full sign/verify round trip against the live endpoint before the table even existed to confirm it fails open (never blocks sending on an error) rather than crashing
- [x] **Decided, not left open:** an unsubscribe only blocks the recurring reminder email — receipts, approval confirmations, club welcome, and pending-approval notices are one-time confirmations of something the recipient just did, not marketing, so only a hard bounce or spam complaint blocks those (via `isHardSuppressed`, reason-aware rather than one flat flag). This matches CAN-SPAM's transactional-email exemption, but treat that as engineering judgment, not legal sign-off
- [x] `suppressed_emails` table created and granted — verified with a real insert-then-read round trip via the live `/unsubscribe` endpoint (then cleaned up the test row). Item 10 is fully live end-to-end
  (Grant included up front this time — same mistake as the `events` table earlier, not repeating it.)

## 11. SMS / text capability

Grounded in: `parent_phone` is already collected and stored (shown in the club's roster CSV export) but never used to send anything — no SMS provider is integrated anywhere in the codebase today.

- [ ] Decide if/when this is worth it — a provider (e.g. Twilio) is real integration work: per-message cost, opt-in consent language, its own delivery/suppression tracking
- [ ] If pursued, scope which messages would actually go by text vs. email (e.g. payment reminders/declines feel more urgent for text; receipts probably don't need it)
- [ ] Not blocking the pilot — flagging so `parent_phone` isn't mistaken for a feature that already works

## 12. CSV roster import for team setup

Grounded in: nothing like this exists today — checked directly, no CSV import anywhere in `worker/index.js` (only CSV export, for a club's payments/roster). Right now every team and athlete gets created one at a time, either through club self-registration (`POST /club/register`, which does accept a `teams` array) or a parent/admin adding athletes individually via `POST /athlete`. A club with an existing roster spreadsheet has no faster path in.

- [x] **Decided:** staff-supported manual import for the pilot — a club shares their roster CSV, a PlayFund person turns it into teams + athletes by hand (via the same admin-side `POST /athlete` path an admin-added athlete already takes: auto-approved, skips the pending-approval flow). No self-serve upload UI or automated parsing yet, not needed at pilot scale
- [ ] Related to item 8's "roster-import extraction from uploaded spreadsheets" AI idea — that's the future automation path once the real spreadsheet formats clubs actually send are known; not before
- [ ] Decide the format expectation up front (a PlayFund-provided template vs. accepting whatever a club already has) — accepting arbitrary formats is much more work than it sounds

## 13. Refund policy: how it actually works with Stripe, a club-facing control, and a contract requirement

Grounded in: zero refund handling exists anywhere in the code today — checked directly, no `refunds` call, no refund endpoint, nothing. This is also already flagged as an open question in `CLAUDE.md`'s "Known unresolved policies" ("Refund ownership and clawback mechanics when a kid quits mid-season") — this item is that question becoming concrete: a UI control and a contract term, not just a note.

**How refunds actually work today, mechanically, with the current setup** (`payment_intent_data.transfer_data.destination` — a destination charge): the parent's payment lands on PlayFund's platform Stripe account first, and Stripe automatically transfers `dues − PlayFund's fee` to the club's connected account. Refunding a destination charge does **not** automatically claw the money back from the club by default — you have to explicitly pass `reverse_transfer: true` on the refund, which pulls the already-transferred amount back out of the *club's* Stripe balance. Two ways this can go wrong:
- Refund without `reverse_transfer` → PlayFund eats the entire refund out of its own balance while the club keeps the money. This is the "losing money" scenario.
- Refund *with* `reverse_transfer` → if the club has already paid that money out to their bank (payouts are usually automatic/daily), there may not be enough balance left in their connected account to reverse, and the transfer reversal fails outright.
- Klarna adds a second layer: for BNPL, Klarna funds the club in full upfront and collects from the parent over time (this is already true today, not new) — so a mid-season refund isn't really "refunding a Stripe charge" at all, it's unwinding a Klarna loan the parent still owes on. That's a conversation with Klarna's own refund/cancellation process, not a Stripe API call.

- [ ] Add a "Define refund policy" control to club setup, but only offer options that are actually safe given the mechanics above — e.g. no refunds (simplest, zero PlayFund exposure), club-handles-it-directly (club refunds the family themselves, outside Stripe, PlayFund never touches the transfer), or a PlayFund-processed refund *only* while the club's connected balance can still cover the reversal (needs a real balance check before offering it, not just an assumption)
- [ ] Work out the Klarna case separately — confirm what Klarna actually allows for a mid-plan cancellation/refund before promising clubs or parents anything there
- [ ] **Contract requirement:** whatever refund policy a club picks needs to be agreed in writing before they're onboarded — not a UI setting they can silently change after money is already moving. Add this to the club onboarding contract/agreement, however that gets formalized (ties to Phase 2's "Privacy Policy + Terms of Service" work already in `pilot-readiness-plan.md`)

## 14. Embedding into a club's existing TeamSnap/SportsEngine setup

This is a research/strategy question, not something checkable in the code — flagging it as one, not answering it. It also runs against the currently locked go-to-market in `CLAUDE.md`: "Club-adopting go-to-market. Clubs onboard, we run registration and payments for them" — that assumes a club replaces (or at least sits outside) their existing tools. This item asks whether there's a second, narrower model worth exploring alongside it, not instead of it.

- [ ] Research whether TeamSnap/SportsEngine actually have a partner, embed, or payments-API program that would let PlayFund's checkout live *inside* a club's existing site/app, rather than requiring the club to adopt a separate PlayFund flow — needs real verification against their current developer/partner docs, not an assumption either way
- [ ] **Two very different asks bundled in "put a link on their website" — split them.** (a) A plain link a club places somewhere they already control — a registration confirmation email, a text reminder, a custom link/button if their site builder allows a basic HTML block — almost certainly needs no cooperation from TeamSnap/SportsEngine at all, since it's just a URL a parent clicks. (b) An actual embedded PlayFund checkout living *inside* their registration/payment flow is a different, much harder ask — payment is their own monetized surface, and letting a competing financing option embed there would need their explicit partner program, not something a club can turn on from their own account regardless of plan tier. Confirm which one is actually being proposed before scoping build work
- [ ] If going with (a), the guardrail already called out is real: a link a parent clicks outside TeamSnap/SportsEngine doesn't update *their* registration record. Needs a defined manual or file-based reconciliation for the pilot (someone marks the family paid/financed back in the club's system), not an assumption that it'll stay in sync on its own
- [ ] Separate the two real audiences this implies: (1) a club with no real payment story today — today's full club-adopting pitch fits them; (2) a club that's already happy with TeamSnap/SportsEngine's registration and roster tools and just wants a better *payment* option — for them, the wedge probably isn't "switch to PlayFund," it's "keep everything, just let families pay through us." Those need different pitches, maybe different products
- [ ] For audience (2): what's actually the sellable difference if their payment process already works fine? Most likely candidates from what's already built: real BNPL via Klarna (if they don't have that), and the reporting gaps already identified in item 7's TeamSnap/SportsEngine teardown — confirm which of those two is the real pain point before building anything else for this audience
- [ ] Decide if this is a pilot-phase distraction or a real second track — CLAUDE.md's existing locked decision may just be right for the pilot's 5 clubs, with this saved as a post-pilot expansion question

## 15. Session parity — every new Claude session (cloud or local) needs to check these before doing real work

Grounded in a real failure, not a hypothetical: the session that root-caused the `invite_url: null` bug (item 6) committed a real fix on branch `ajjurko/fix-invite-link-race` and then hit a dead end — "this machine has no GitHub credentials (`git push` fails, no `gh`, no SSH key), so the fix is committed locally only and could not be merged or deployed." It eventually landed as PR #10 **from that same session** — the dead end lasted about an hour, until `gh` was installed into `~/bin`, authenticated, and the branch pushed and merged from there. (Correcting this because the checklist below is right for the right reason: the session was genuinely stuck and said so, rather than accumulating unlandable work quietly.) Multiple sessions (this cloud one, at least one local one, possibly more later) are now working the same repo in parallel — worth a standard startup check so nobody's work gets stranded again, and nobody duplicates a fix another session already shipped.

**Checklist any new session (cloud or local, this repo) should run through before starting real work:**

- [ ] `git remote -v` and `git fetch origin main` — confirm this session sees the real repo, and pull latest `main` before branching. (This cloud session was itself 6 commits behind `main` at one point this session — another local session's merged PR had moved ahead unnoticed.)
- [ ] Push access: confirm `git push` actually works — a harmless test (push a branch, or check `gh auth status` / SSH key / stored credential) *before* doing an hour of work you can't land. A session that can edit files but can't push should say so immediately, not silently accumulate uncommitted work.
- [ ] Cloudflare deploy access: `npx wrangler whoami` (or `wrangler login` / `CLOUDFLARE_API_TOKEN`) — confirm this session can actually deploy `playfund-worker`, not just edit `worker/index.js`. Editing without deploy access means the fix never goes live until someone else redeploys it.
- [ ] MCP connectors (Gmail, Google Drive, Google Calendar): confirm these are enabled for *this specific session* under the account's connector settings — being logged into the same Claude account doesn't automatically mean every session has the same connectors toggled on.
- [ ] Read `CLAUDE.md`, `pilot-readiness-plan.md`, and this file (`pilot-prep-punchlist.md`) in full before making changes — this file in particular is the shared memory across sessions; skipping it is how duplicate root-causing happens (see item 6's `invite_url` saga, root-caused independently more than once).
- [ ] Before starting a fix, check this file and recent `git log` for whether another session already touched the same area — the branch-naming pattern so far has been `ajjurko/<short-description>`, so `git log --all --oneline -20` shows recent parallel work across sessions.
- [ ] One branch per task, merge (or ask to merge) promptly rather than letting a fix sit local-only — a fix that never leaves one session's disk doesn't exist for anyone else.
- [ ] **Local-only, not expected in cloud sessions:** Claude in Chrome (for actual browser click-through — embedded Stripe onboarding, real email link testing, visual screen checks) only exists where the extension is installed and signed in on that machine. A cloud session should say so rather than pretend it can click through UI.
- [ ] Test fixtures (test club/team/athlete IDs, deep links, Stripe test cards) are already documented in `pilot-readiness-plan.md` — reuse them instead of creating new throwaway clubs unless the test specifically needs a fresh one.

## 16. Stripe Connect: live-mode configuration and the gaps it exposed

Recorded 2026-09-15 while completing live activation of `acct_1U1c5AQ2kPXJfofJ` (the
**live** PlayFund account — `acct_1U1c5LPyhgYp24eb` in the Worker's key is its *sandbox*).

Choices confirmed against what the code actually does, not what sounded right:

| Stripe question | Chosen | Because the code does this |
|---|---|---|
| Funds flow | Buyers purchase from you | `transfer_data.destination` + `application_fee_amount`, no `Stripe-Account` header anywhere — destination charges |
| Payouts | Sellers paid out individually | one `line_items` entry, one `transfer_data`, one athlete per session |
| Account creation | Embedded onboarding components | `POST /account_sessions` (`worker/index.js:1431`); `/account_links` appears nowhere |
| Account management | Express Dashboard | nothing in-app manages accounts — see below |
| Liability | PlayFund responsible for refunds and chargebacks | consequence of destination charges |

Destination charges are not really optional for us: Klarna runs on the **platform** account
(`payment_method_types: ["klarna"]` on a platform-created session). Under direct charges,
payment-method availability comes from the *connected* account, which would mean every youth
club needing Klarna enabled on their own Stripe account. Installments are the product, so the
charge model follows from that.

### Open

- [ ] **Stripe verification requests are invisible to everyone.** `GET /club/:id/stripe-status`
      (`worker/index.js:1448`) returns only `charges_enabled` and `details_submitted`.
      `requirements.currently_due`, `requirements.past_due` and `disabled_reason` are **never
      read anywhere in the codebase**. Stripe routinely asks connected accounts for more
      documentation (thresholds crossed, documents expired, ownership re-verification). When it
      does, neither the club nor PlayFund sees it: payouts pause, `charges_enabled` eventually
      flips false, `clubCanAcceptPayments` (`worker/index.js:577`) starts returning `false`, and
      the club's checkout stops working with no signal saying why. Surface these and alert on
      them.
- [ ] **Clubs have no in-app account management.** The Account Session enables
      `account_onboarding` only — no `account_management`, `payouts`, `documents` or
      `notification_banner`. A club cannot change a bank account, see a balance, or clear a
      requirement without leaving the product. Express Dashboard was selected so the pilot's
      first club isn't stranded; the architecturally consistent fix is to add those components
      and drop the Express redirect, since onboarding is already embedded.
- [ ] **We carry fraud and refund risk, and nothing says so.** Destination charges without
      `on_behalf_of` make PlayFund the settlement merchant: a disputed $1,500 charge is pulled
      from PlayFund's balance in March, months after that money was transferred to the club in
      October. Stripe's dispute fees (confirmed 2026-09-15) are **$15.00 to receive a dispute and
      $15.00 to counter one**, the latter refunded only if we win — so a lost $1,500 dispute is
      $1,530 out of our balance. If the club's balance can't cover it, PlayFund covers it. This sits oddly beside
      "we do not underwrite, do not front our own capital, and do not cover defaults" in
      `CLAUDE.md` — that's about *credit* risk, which Klarna carries, but we are silently taking
      *fraud and refund* risk. Needs a clawback right against future payouts and a club-liability
      term in the club agreement. Lawyer question, not a code one. Radar Standard was enabled as
      partial mitigation (tickets run $1,000–$1,900, so one prevented dispute pays for ~30,000
      screenings).
- [ ] **Three different answers to "when do I get paid."** The signup form says
      `seasonStart − 5 days` (`public/app/index.html:5044`), the welcome email says
      `seasonStart + 14 days` (`worker/index.js:656`), and the app copy promises "Day 1 payout"
      (`public/app/index.html:2273, 2320`). A club sees two of them within a minute of each
      other. Payout timing is listed in `CLAUDE.md` as an unresolved policy — two places invented
      answers anyway, and they disagree. Decide the policy, then make it one shared helper.
      The app's version also has a timezone bug: `new Date("2026-10-01")` parses as UTC midnight,
      so US users see a date one day earlier than the code's own comment describes. The Worker
      does it correctly with `new Date(season_start + "T00:00:00")`.
- [ ] **"One combined plan" for siblings isn't built.** `CLAUDE.md` product principles say
      multiple children register in one flow on one combined plan, and 66% of surveyed parents
      have 2+ kids playing. `POST /athlete/:id/checkout` creates a separate payment per athlete.
      Fine while siblings share a club; siblings in *different* clubs would be one payment split
      across two sellers, which is Stripe's "separate charges and transfers" — a different charge
      type from the one just configured. Stripe allows both, so this is additive, not a redo.
- [ ] **Live mode needs four things changed together**, each per-mode:
      `STRIPE_SECRET_KEY` → `sk_live_`, `STRIPE_PUBLISHABLE_KEY` → `pk_live_`,
      `STRIPE_WEBHOOK_SECRET` → the live endpoint's own signing secret, and
      `PAY_IN_FULL_PMC_ID` → a live-mode Payment Method Configuration. Connected accounts do not
      cross from sandbox to live, so every club re-onboards through Connect; the pilot's first
      real club will be the first ever to complete live Connect onboarding.
- [x] **Platform rate set to 8%, floor set to 6.05%** — decided 2026-09-16, closing the item
      below. Confirmed against Stripe's published rates: cards 2.9% + 30c, Klarna 5.99% + 30c.
      Under destination charges the *platform* pays the processing fee, and `applicationFeeAmount`
      does not vary by payment method, so a single rate has to clear the more expensive path.

      | Dues | at 5% (old) | at 8% |
      |---|---|---|
      | $950 | card +$19.60 / klarna **-$9.70** | card +$48.15 / klarna **+$18.80** |
      | $1,500 | card +$31.15 / klarna **-$15.15** | card +$76.20 / klarna **+$29.85** |
      | $1,900 | card +$39.55 / klarna **-$19.11** | card +$96.60 / klarna **+$37.89** |

      Two numbers, two jobs, deliberately kept apart. **`MIN_FEE_BPS` = 605** is the floor —
      break-even on Klarna, enforced server-side both when a rate is agreed
      (`PATCH /admin/clubs/:id`) and again at the point of charging, so a club discounted
      deliberately can go to 6.05% but nothing can go below it. **`DEFAULT_FEE_BPS` = 800** is the
      price. The `clubs.fee_bps` column default moves to 800 in
      `migrations/2026-09-16-default-fee-bps-800.sql`; existing rows are left at 500 on purpose, so
      the three clubs predating the floor stay blocked until someone agrees a real rate rather than
      being silently repriced.

      Still true and worth remembering in rate conversations: 8% is not 8% in hand. A $1,500 card
      payment nets $76.20 (~5.1% of the charge) and the same payment on Klarna nets $29.85 (~2.0%).
      Stripe takes the difference.

- [ ] **We now owe Stripe a restricted-business review of every club.** The Connect Platform
      Agreement acknowledgement (accepted 2026-09-15) includes "you'll review each seller to
      ensure they're not operating in a restricted business category or selling restricted
      products." No such review exists — `POST /club/register` creates a club straight from the
      signup form. The natural home is the `fee_agreed_at` gate: a club cannot take money until a
      PlayFund admin sets their rate, and `alertIfClubAwaitingFee` already emails us when one is
      Stripe-ready and waiting. Make the category check part of setting the rate rather than
      building a second review step. Also note Radar Standard bills **$1.00 per connected
      account** on top of $0.05 per screened transaction.

- [ ] **Register `www.playfundai.com` under Stripe → Payment method domains.** Checkout is
      embedded (`stripe.initEmbeddedCheckout` mounts an iframe into `/app/`), so our page is the
      top-level document and Apple Pay / Google Pay need the domain registered. The
      `Permissions-Policy: payment=()` half was fixed 2026-09-15; this is the other half. Both
      fail silently — no console error, cards keep working.

# PlayFund — system diagram (target state)

Where money and data should flow once Stripe Connect is wired in. Not yet built — see CLAUDE.md and the Stripe integration to-do list for current state and gaps.

```
                         Parent / Club / Admin
                                  │
                                  ▼
                        ┌───────────────────┐
                        │   Browser (UI)     │
                        └─────────┬──────────┘
                                  │ fetch() → HTTPS request, JSON in/out
                                  │ REST: club, athlete, auth, admin
                                  ▼
┌───────────────┐        ┌───────────────────┐
│    Supabase     │◄─────►│  Cloudflare Worker  │
│ (DB + auth,    │Supabase│   (API + Stripe    │
│  stripe_acct_id)│client, │    server logic)   │
└───────────────┘ SQL over│  └─────────┬──────────┘
                    HTTPS  │            │ Stripe REST API call
                                        │ (server-side, secret key —
                                        │  create Checkout Session with
                                        │  application_fee % + destination)
                                        ▼
                        ┌───────────────────┐
                        │   Stripe Connect    │
                        └────┬─────────┬─────┘
                   card/ACH  │         │  Klarna
                (pay now)    │         │  (parent pays over time,
                             ▼         ▼   club still paid now)
                        ┌───────────────────┐
                        │ Club Connected Acct │──► payout to club bank
                        │ (fee already split) │      (rolling/weekly)
                        └─────────┬──────────┘
                                  │ webhook: Stripe POSTs JSON to a
                                  │ Worker URL when payment_intent.succeeded
                                  ▼
                          back to Worker → marks athlete
                              "funded" in Supabase
```

All arrows are HTTPS calls carrying JSON — same mechanism throughout, just who calls whom differs. Everything is Worker/Browser calling *out*, except the webhook: that's Stripe calling *in* to the Worker, unprompted, when money moves.

Solid arrows = data/money flow. The Browser↔Stripe direct link (today's hardcoded Payment Links) disappears — all payment creation moves server-side through the Worker.

## Where each box actually lives

| Box | File(s) | In this repo? |
|---|---|---|
| Browser (UI) | `index.html` | Yes |
| Cloudflare Worker | unknown — source not available; routes inferred from `index.html` calls (`/club/:code`, `/athlete/:id`, `/auth/login`, `/auth/signup`, `/team`, `/athlete`, `/parent/athletes`, `/remind`, `/club/register`, `/invite`, `/admin/clubs`) | No |
| Supabase | none — hosted Postgres project (`klnbdvwasnnqszlhawbl`), no schema files checked into any repo we have access to | No |
| Stripe Connect / Club Connected Acct | not built yet. Today's placeholder is the `STRIPE_LINKS` object and `openStripeCheckout()` function in `index.html` (3 hardcoded test Payment Links, no Connect) | Partial — placeholder only, in `index.html` |

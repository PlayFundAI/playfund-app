# Demoing PlayFund to a club

Five ways to show the product, what each one costs to run, and the one I'd use
on Wednesday. Everything described here is built and working; the commands at
the bottom are the ones I actually ran.

## Start with the constraint

**The deployed app is on live Stripe keys.** `worker/wrangler.toml` carries
`pk_live_…`, and `worker/index.js` creates real Checkout Sessions against the
live platform account. So demoing `www.playfundai.com/app/` in front of a club
would:

- write a real athlete row into Supabase on "Continue"
- send a real email to the club admin and to whatever address gets typed in
- charge a real card on the one button the whole demo is about

That rules out presenting production, and it is why demo mode exists rather
than a login you click through. The deep links in `pilot-readiness-plan.md`
under "Test credentials & fixtures" are also stale for the same reason: they
were written against the Stripe sandbox, and the Worker has since moved to
live keys.

## The five options

| | What it is | Build state | Risk in the room | Answers "what if?" |
|---|---|---|---|---|
| **1. Clickable demo** | The real app with a fixture instead of a backend | Built | Low | Yes |
| **2. PDF deck** | 12 slides of real screenshots plus the talking points | Built | None | No |
| **3. Their phone** | Same demo, opened by the club on their own phone from a QR | One merge away | Low | Yes |
| **4. Personalised film** | The 43 second explainer re-cut with their club's name and numbers | Built, needs their numbers | None | No |
| **5. Self-advancing walkthrough** | The demo driving itself, for screen recording | Built | None | No |

Option 5 is what to use instead of GIFs. A GIF is a worse version of either
the live demo or the film: it cannot answer a question, it cannot be paused at
the interesting frame, and it goes stale the moment a screen changes. If you
want a video file of the walkthrough, record option 5 with Cmd-Shift-5 and you
have an mp4 in a minute, regenerated the same way whenever the app moves.

### What I'd do

**Option 1 live, with option 2 open in a second tab and option 4 as the
opener.** The club's objection is never "I don't believe the screens exist",
it is "what happens when a family doesn't pay" and "what do I have to do".
Only a clickable demo answers those, and this one answers them without
touching a backend.

Option 3 is the best single upgrade if you are willing to merge. Handing a
treasurer a QR code and letting them register their own kid on their own phone
is a different kind of meeting from watching your screen. It needs
`public/app/demo.js` deployed, which is a decision rather than work. See
"Deciding whether to deploy" below.

## Option 1: the clickable demo

```bash
npx serve -l 4173 public
```

Then open:

```
http://localhost:4173/app/?demo=1&guide=1
```

A presenter panel sits bottom right with the step you are on, the line to say,
and the evidence behind it. Drive it with the keyboard:

| Key | Does |
|---|---|
| `→` or space | Next step, and performs that step's click for you |
| `←` | Back |
| `R` | Reset to the start |
| `G` | Hide or show the panel |
| `1` to `9` | Jump to a step |

You do not have to use the keys. Click the app yourself and the panel follows
you, because it watches which screen is actually on. Reloading the page resets
everything, which is the only recovery you need to remember.

The twelve steps are the club's side, then the same season from the family's
side, then back to the club's side to watch the money move. The payout goes
from $46,000 to $46,920 while they watch, because the family they just saw pay
is a real row in the fixture. That moment is the demo.

### Showing their club instead of Riverside

Every number follows from four values, so their own club can be on screen:

```
http://localhost:4173/app/?demo=1&guide=1&club=Northside+Select&city=Charlotte,+NC&dues=1200&athletes=64
```

Set `dues` and `athletes` only if you know their real ones. A made up dues
figure in front of a treasurer is worse than an obviously generic one, and
they will correct you out loud.

Full parameter list is in the header comment of `public/app/demo.js`.

## Option 2: the PDF deck

```bash
node demo/capture.mjs
```

Twelve pages land at `demo/out/playfund-demo.pdf`: a cover, ten screens with
the line to say and the evidence behind it, and a closing slide on what a
pilot is. The screenshots are taken from the running app, not drawn, so the
deck cannot drift from the product. Re-run it after any screen changes.

For their club:

```bash
node demo/capture.mjs --club "Northside Select" --city "Charlotte, NC" --dues 1200 --athletes 64
```

This is the no wifi fallback and the thing to email afterwards.

## Option 3: the club's own phone

Deploy the branch, then the same URLs work on `www.playfundai.com/app/?demo=1`.
Put a QR to the parent link on screen and let them register their own child:

```
https://www.playfundai.com/app/?demo=1&code=RIVER26&athlete=a-marcus-bell
```

`code` there is the app's own parameter, the club code a parent would type,
and it is what makes the link open on the child rather than on the home
screen. `clubcode` is demo mode's, and it only renames the fixture. If you
rename the club you have to change both and keep them identical:
`&clubcode=NSS26&code=NSS26`.

Demo mode makes no network calls, so nothing they do reaches the Worker, the
database or Stripe.

## Option 4: the film, cut for them

```bash
cd video
node scripts/render-for-club.mjs --club "Northside Select" --city "Charlotte, NC" --dues 1200 --athletes 64
```

Lands at `video/out/playfund-<slug>.mp4` and leaves the homepage film alone.
It takes about four minutes. There is one already rendered to look at:
`video/out/playfund-northside-select.mp4`, 64 athletes at $1,200.

No line of the voiceover contains a figure or a club name, which is why this
works without re-recording anything. Every number on screen is computed from
dues, roster size and the fee, so their numbers change the picture and leave
the read and the timing exactly as they were.

Leave `--dues` and `--athletes` off to get the homepage film with their name
on it, which is the right call when you do not have their real numbers.

## Option 5: the self-advancing walkthrough

```
http://localhost:4173/app/?demo=1&guide=1&auto=1
```

Advances itself every 5.2 seconds. `&hold=3000` to speed it up. Record the
window and you have a shareable walkthrough; it survives the app changing,
because it is the app.

## Fixed: the club dashboard's three buckets now sum

They used to add to $54,000 under a hero that said `$58,000 in dues`, because
Funded carried the net advance while Still deciding and Needs another option
carried gross dues. A treasurer does that arithmetic.

The hero and the buckets answer two different questions, so they now hold two
different totals rather than sharing one:

| | |
|---|---|
| `$46,000` landing in your account | net of the club's rate, because that is what reaches the bank |
| Funded `$50,000` · Still deciding `$6,000` · Needs another option `$2,000` | gross dues, because the three split the season by where each family has got to |

$50,000 + $6,000 + $2,000 is $58,000, which is the dues figure in the hero's
own subline. Verified at two club sizes, and the payment still moves both
numbers live: the hero goes to $46,920 and Funded to $51,000 when the demo
family pays.

**Still open, and not something I'd touch before Wednesday:** the film's
payout card says `50 of 58 athletes · $50,000 in dues` where the app now says
`$58,000`, because the film counts funded dues and the app counts all dues.
One line in `video/src/script.ts`, but fixing it means re-rendering and
replacing the film on the homepage, so it is your call rather than a tidy-up.
It only matters if you play the film and open the dashboard in the same
meeting, which the run of show below does.

## Two things to decide before Wednesday

### 1. The sibling panel promises something the next screen takes away

On "Your athletes", the dark panel says **"Pay for all your athletes at
Riverside Soccer Club together in one checkout."** Tap through and the
combined plan screen says **"Each athlete is paid for separately"** and
**"Shown for reference only. Pay for each athlete individually using the
button next to their name above."**

Both are live today. The design reference and `CLAUDE.md` are on the panel's
side ("Multiple children register in one flow on one combined plan"), so what
shipped is the weaker half of a decision that was already made.

This matters on Wednesday because multi-kid families are one of your stated
wedges and 66% of surveyed parents have two or more kids playing, so a club
will ask about it. Until it is resolved, **do not say "one payment" in the
room.** Say both children live in one place and the season total is always in
front of the family, which is what the screens actually do. The deck is
written that way.

Resolving it is either a copy change on the panel or a real combined Checkout
Session in the Worker. The second is the one that matches the locked decision.
Not something to start before Wednesday either way.

### 2. Whether `demo.js` ships to production

For: it unlocks option 3, and it means you can send a club a link after the
meeting that is not a slide deck.

Against: anyone who appends `?demo=1` to the app URL sees a club dashboard
full of invented figures. The app is already `noindex, nofollow`, the page
carries a "DEMO · NO LIVE DATA" badge throughout, and nothing is loaded unless
the parameter is present, so the realistic exposure is a parent who is sent
the wrong link. The fixture is openly fake (Riverside Soccer Club, example.com
addresses) rather than plausibly real, which is deliberate.

I'd ship it. But it is a payments app, so it is your call, which is why this
is a branch and not a merge.

## What demo mode actually does

`public/app/demo.js`, loaded only when `?demo=1` is in the URL by a four line
injector in `public/app/index.html`. It does three things:

1. **Replaces `window.fetch`** for the Worker and Supabase origins only, and
   answers every route from a local fixture. An unrecognised route is answered
   locally with a 501 and a console warning rather than being passed through,
   so no call can escape by accident. Everything else, fonts included, goes to
   the real network untouched.
2. **Replaces both Stripe SDKs** with stand-ins, via a property getter so it
   does not matter whether `js.stripe.com` loaded first or at all. The card
   sheet and the installment sheet are drawings labelled "STAND-IN FOR THE
   PAYMENT SHEET / NO CARD IS CHARGED". Card fields are read only and carry
   the well known test number.
3. **Shadows the app's five storage keys in memory**, so a parent who ever
   opens a demo link does not lose their own saved athletes, and so reloading
   the page is a clean reset.

It draws no product screen. Every screen, style, label and code path in the
demo is the app's own, which is the point: if something looks wrong in demo
mode it is wrong in production too.

## What I changed in the app itself

Four things, all small:

- `public/app/index.html`: the demo mode injector in `<head>`.
- `public/app/index.html`: the club dashboard's three status buckets now all
  carry gross dues, so they sum to the dues figure in the payout hero's
  subline. The hero keeps its own net total. See the section above.
- `public/app/index.html`: `safeFmtDate(null)` returned `new Date(null)`,
  which is the epoch rather than an invalid date, so every installment
  confirmation printed **"December 31, 1969"** under the Klarna schedule line.
  Real bug, live today, and it would have been on screen in the demo. Fixed,
  and the row now omits the date entirely rather than printing an empty one.
- `video/src/script.ts`: the club name, dues, roster size and fee can be
  overridden by `REMOTION_`-prefixed environment variables, defaulting to
  exactly what was there before. I re-rendered the default film to check:
  1279 frames, 42.6s, 3,998,457 bytes against the committed 3,996,691, which
  is encoder noise on an identical film.

## Suggested run of show, 30 minutes

| | |
|---|---|
| 0:00 | What they run. How many athletes, what a season costs a family, when spring registration opens. |
| 0:04 | Play `public/playfund-pilot.mp4`, 43 seconds. It sets up the problem so you do not have to. |
| 0:06 | The live demo, steps 1 to 10. Stop at the payout moving. |
| 0:15 | Reload with their club name and numbers. "This is your dashboard." |
| 0:18 | Steps 11 and 12: the declined family, and what onboarding asks of them. |
| 0:22 | What a pilot is: they keep registration, rosters and messaging, we run how families pay, one season, no cost to set up. |
| 0:25 | Questions. |

Three answers worth leaving with, from section 14 of the punchlist, because
they decide whether a link-based pilot is even possible for this club and only
they can answer them:

1. Which platform do they run registration on, and which plan tier?
2. Can they put an arbitrary link or HTML block in their registration
   confirmation email?
3. Who at the club actually administers it?

## Known rough edges

- **Webfonts need one online load.** Anton and Inter come from Google Fonts.
  Open the demo once on wifi before the meeting and Chrome caches them; with
  no network at all the type falls back and the payout number stops looking
  like the brand. The PDF is the real no-wifi answer.
- **The roster says "BNPL Active" and tags payments "Klarna".** That is
  existing product copy, not demo copy, and it sits against the design
  reference's own note about status written in club language. Fine in front of
  a club, worth knowing before a parent sees it.
- **The pending approval banner is off by default.** Add `&pending=1` if you
  want to show that a parent cannot add themselves to a roster and pay without
  the club confirming them. It puts a yellow banner on the dashboard, which is
  why it is not on for the opening screen.

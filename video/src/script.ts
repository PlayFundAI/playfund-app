// ─────────────────────────────────────────────────────────────────────────────
// THE ONLY FILE YOU NEED TO EDIT.
//
// Every word on screen, every number, and how long each beat holds. Components
// read from here and never hardcode copy or timing, so retiming the whole video
// to a voiceover means changing `frames` below and nothing else.
//
// Durations are in frames at 30fps: 30 frames = 1 second.
// ─────────────────────────────────────────────────────────────────────────────

import voDurations from '../public/vo/durations.json';

export const FPS = 30;

export const sec = (s: number) => Math.round(s * FPS);

// ── Numbers ──────────────────────────────────────────────────────────────────
// All illustrative, in the same spirit as the marketing site's dashboard shot.
// The payout is COMPUTED from dues and the fee rather than typed, so the
// arithmetic on screen always holds: change duesPerAthlete and every figure in
// the video follows.
const duesPerAthlete = 1000;
const serviceFeeBps = 800; // 8%, the default in migrations/2026-09-16-default-fee-bps-800.sql

// Sized to a real club rather than a league. A treasurer at a 60-athlete club
// does not see themselves in a 312-athlete roster, and eight names on screen
// read as a sample of 58 but as a rounding error out of 312.
const funded = 50;
const deciding = 6;
const needsOption = 2;

const gross = funded * duesPerAthlete;
const payout = Math.round(gross * (1 - serviceFeeBps / 10000));

export const data = {
  club: {
    name: 'Riverside Soccer Club',
    location: 'Richmond, VA',
    duesPerAthlete,
    funded,
    deciding,
    needsOption,
    get athletesTotal() {
      return funded + deciding + needsOption;
    },
    payout,
    // Dues collected for funded athletes, which is what the bucket counts.
    // The payout above is this less the service fee, so the two differ on
    // purpose and the three buckets sum to total dues.
    fundedAmount: funded * duesPerAthlete,
    decidingAmount: deciding * duesPerAthlete,
    needsOptionAmount: needsOption * duesPerAthlete,
  },

  // Shown inside the Act 1 phone, as the app's "What this covers" panel.
  // Must add up to duesPerAthlete.
  duesBreakdown: [
    {label: 'League registration', amount: 420},
    {label: 'Coaching', amount: 280},
    {label: 'Uniform and kit', amount: 180},
    {label: 'Tournament travel', amount: 120},
  ],

  // The club's own bills, which is the whole reason waiting on dues hurts.
  expenses: [
    {label: 'Field and facility rental', amount: 8400},
    {label: 'Tournament entry fees', amount: 3200},
    {label: 'Referees', amount: 1100},
  ],

  // Act 2's closing beat. What a club keeps versus what actually moves.
  //
  // Deliberately describes a division of labour, not an integration: nothing
  // syncs, and a club admin marks each payment back in their own system by
  // hand. See pilot-prep-punchlist.md section 14 before strengthening any of
  // this wording.
  alongside: {
    stays: ['Rosters', 'Schedules', 'Team messaging', 'Your club website'],
    moves: ['How families pay'],
  },

  // Act 3. Four payments, two weeks apart, which is what the product actually
  // offers (see the installments section of screen-athlete-detail).
  installments: {
    total: duesPerAthlete,
    count: 4,
    everyWeeks: 2,
    // Edit these four labels to move the schedule; nothing else reads dates.
    schedule: ['March 1', 'March 15', 'March 29', 'April 12'],
    get each() {
      return duesPerAthlete / 4;
    },
  },

  // Top of the ledger. The first three match the marketing site's shot so a
  // club arriving from playfundai.com sees the same names.
  roster: [
    {name: 'Maya Rivera', age: '12U Travel', status: 'funded'},
    {name: 'Jordan Rivera', age: '12U Travel', status: 'funded'},
    {name: 'Marcus Bell', age: '14U Select', status: 'deciding'},
    {name: 'Ava Bennett', age: '14U Select', status: 'funded'},
    {name: 'Liam Carter', age: '14U Select', status: 'funded'},
    {name: 'Sophia Dawson', age: '16U Elite', status: 'funded'},
    {name: 'Noah Foster', age: '16U Elite', status: 'deciding'},
    {name: 'Isabella Grant', age: '16U Elite', status: 'funded'},
  ] as const,
} as const;

// ── Copy ─────────────────────────────────────────────────────────────────────
// `voice` is the script you'll read. It is not rendered, it lives here so the
// picture and the read stay in one file.

export const copy = {
  act1Dues: {
    voice: 'Families should be able to spread the cost of a season.',
    caption: 'A whole season,\ndue in one payment.',
    eyebrow: 'What a family sees',
    label: 'Riverside Soccer Club · Fall season',
    amountLabel: 'Season dues',
    due: 'Due in full, March 1',
  },

  act1Expenses: {
    voice:
      "But a club can't wait on that money. Facilities, tournament fees, refs. Those bills come due now.",
    eyebrow: 'What a club owes',
    heading: 'Due before the season starts',
    footnote: 'Figures are examples, not a real club.',
  },

  act1Split: {
    voice:
      'PlayFund gives families time to pay, and gives the club the season up front.',
    families: {kicker: 'Families', line: 'Pay over time.'},
    clubs: {kicker: 'Clubs', line: 'Get paid up front.'},
  },

  act2Roster: {
    voice: 'Fifty families sign up.',
    caption: 'Fifty families\nsign up.',
    eyebrow: 'Club dashboard',
    heading: 'Fall registration',
  },

  act2Payout: {
    voice: 'The whole season lands in your account.',
  },

  act2Buckets: {
    voice: 'And you can see where every athlete stands.',
    caption: 'Where every\nathlete stands.',
  },

  act2Alongside: {
    voice:
      'Keep the platform you already use. PlayFund only changes how families pay.',
    caption: 'Keep the platform\nyou already use.',
    staysLabel: 'Stays where it is',
    movesLabel: 'Moves to PlayFund',
  },

  act3Dues: {
    voice: "That thousand dollars isn't one payment.",
    caption: 'Pay now,\nor pay over time.',
  },

  act3Split: {
    voice: "If they're approved, it's four, two weeks apart.",
    heading: 'Four payments, two weeks apart',
    // Mirrors step 3 of the installments section in screen-athlete-detail,
    // with the provider genericized for a public video. Do not cut this for
    // pacing: it is the only place the video qualifies a credit offer.
    disclosure:
      'Installments are offered by our payment partner, subject to approval. Terms are set by them, not PlayFund, and some plans may affect your credit.',
  },

  act4Card: {
    voice: 'Explore a club pilot.',
    headline: 'Families pay over time.\nClubs get paid up front.',
    cta: 'Explore a club pilot',
    url: 'playfundai.com',
  },
} as const;

// ── Timeline ─────────────────────────────────────────────────────────────────
// Durations are COMPUTED from the voiceover, not typed. Re-record the track,
// run `npm run vo`, and every beat retimes itself to the new read.
//
// Each beat holds for: a lead-in, the line itself, then a tail so the picture
// lands before the cut. `minHold` is the floor for beats whose animation needs
// longer than the line does, or whose text needs reading time.

export type BeatId =
  | 'act1-dues'
  | 'act1-expenses'
  | 'act1-split'
  | 'act2-roster'
  | 'act2-payout'
  | 'act2-buckets'
  | 'act2-alongside'
  | 'act3-dues'
  | 'act3-split'
  | 'act4-card';

/**
 * Playback rate for the voiceover. The engine's own pace control turned out
 * to be unreliable (asking for a brisk read moved the total by 4% and made
 * one line slower), so speed is set here instead. Remotion preserves pitch.
 *
 * This is the dial to turn if the read feels slow or rushed. Nothing else
 * needs to change: the effective length of every clip is derived from it, so
 * the cuts stay on the words.
 */
export const SPEED = 1.3;

/** Silence before the line starts, in seconds. */
export const LEAD = 0.3;
/** Silence after the line ends, before the cut. */
export const TAIL = 0.7;

const spec: {id: BeatId; minHold: number}[] = [
  {id: 'act1-dues', minHold: 4},
  {id: 'act1-expenses', minHold: 6},
  {id: 'act1-split', minHold: 4},
  {id: 'act2-roster', minHold: 3.2},
  {id: 'act2-payout', minHold: 3.2},
  {id: 'act2-buckets', minHold: 3.4},
  {id: 'act2-alongside', minHold: 5},
  {id: 'act3-dues', minHold: 3.2},
  // The disclosure appears part-way in and is the longest text in the video.
  // This floor is what keeps it on screen long enough to actually be read;
  // do not lower it to tighten the edit.
  {id: 'act3-split', minHold: 8.5},
  {id: 'act4-card', minHold: 3.2},
];

/** Seconds of speech per beat as recorded, before SPEED is applied. */
export const speech: Partial<Record<BeatId, number>> = voDurations.seconds;

/** How long a line actually takes on screen, once sped up. */
export const spokenFor = (id: BeatId) => (speech[id] ?? 0) / SPEED;

/** Per-beat minimum hold, exposed so tooling need not duplicate it. */
export const floors: Record<BeatId, number> = Object.fromEntries(
  spec.map((b) => [b.id, b.minHold]),
) as Record<BeatId, number>;

export const timeline: {id: BeatId; frames: number; voice: boolean}[] = spec.map(
  (beat) => {
    const line = spokenFor(beat.id);
    const needed = line > 0 ? LEAD + line + TAIL : 0;
    return {
      id: beat.id,
      frames: sec(Math.max(needed, beat.minHold)),
      voice: line > 0,
    };
  },
);

/** Frames of cross-dissolve between beats. */
export const TRANSITION = sec(0.35);

export const totalFrames = timeline.reduce((n, b) => n + b.frames, 0);

/** First frame of a beat, for jumping straight to it in Remotion Studio. */
export const startOf = (id: BeatId) => {
  let n = 0;
  for (const beat of timeline) {
    if (beat.id === id) return n;
    n += beat.frames;
  }
  throw new Error(`Unknown beat: ${id}`);
};

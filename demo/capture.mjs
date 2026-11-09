#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   Screenshots and a PDF deck, from the app itself.

   Drives headless Chrome against the local preview of the real app in demo
   mode (public/app/demo.js), so nothing here draws a product screen or keeps
   its own copy of one. Change the app and re-run this: the deck follows.

     node demo/capture.mjs                     Riverside Soccer Club
     node demo/capture.mjs --club "Northside Select" --city "Charlotte, NC" \
                           --dues 1200 --athletes 64

   Output lands in demo/out/ (git-ignored): one PNG per screen, plus
   playfund-demo.pdf, which is the thing to email or present with no wifi.

   Needs the preview server running on :4173 —
     npx serve -l 4173 public
   or the "marketing" configuration in .claude/launch.json.
   ═══════════════════════════════════════════════════════════════════════════ */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('No Chrome found. Install Google Chrome, or point CHROME at a Chromium binary.');
  process.exit(1);
}

// ── arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name, dflt) {
  const i = args.indexOf('--' + name);
  return i === -1 ? dflt : args[i + 1];
}
const base = arg('base', 'http://localhost:4173');
const club = {
  club: arg('club', 'Riverside Soccer Club'),
  city: arg('city', 'Richmond, VA'),
  dues: arg('dues', '1000'),
  athletes: arg('athletes', '58'),
  fee: arg('fee', '800'),
  clubcode: arg('clubcode', 'RIVER26')
};
const width = Number(arg('width', 640));

// ── the deck ────────────────────────────────────────────────────────────────
// `say` is the line to say over the slide. `note` is the evidence behind it,
// for the back pocket rather than the screen. Both are the presenter guide's,
// so the deck and the live demo never tell different stories.
const slides = [
  {
    file: 'club-payout',
    screen: 'club-overview',
    title: 'What lands in your account',
    say: 'One number, before the season starts. And underneath it, who has not paid.',
    note: 'Our partner approves the installments, so some families are declined — the ones who needed flexibility most. A club that finds that out in March is a club we lose, so it is on the front page from day one.'
  },
  {
    file: 'club-roster',
    screen: 'roster',
    max: 1500,
    title: 'Every athlete, in club language',
    say: '“Awaiting payment”, not “In Progress - Checkout”.',
    note: 'Card or installments, the club is paid the same either way. Reminders go out before every charge without anyone pressing anything.'
  },
  {
    file: 'parent-dues',
    screen: 'athlete-detail',
    max: 1500,
    title: 'What a family sees',
    say: 'The true-cost receipt leads. No account, no app.',
    note: 'Hidden cost was the second-biggest theme in 514 free-text survey answers; travel was the most-named at 42%. A quarter of people abandon at forced registration.'
  },
  {
    file: 'parent-installments',
    screen: 'embedded-checkout',
    title: 'Or spread it',
    say: 'Four payments, two weeks apart, shown at the price.',
    note: 'Terms are set by our payment partner, not PlayFund, and some plans may affect credit. The screen says so.'
  },
  {
    file: 'parent-confirmed',
    screen: 'confirm-terms',
    title: 'Confirmed',
    say: 'The family is on a schedule. The club was paid in full today.',
    note: 'Our partner carries the credit risk in the pilot. PlayFund does not underwrite and fronts no capital of its own.'
  },
  {
    file: 'parent-siblings',
    screen: 'parent-home',
    title: 'Every child in one place',
    say: 'A second kid does not mean starting again.',
    note: '66% of surveyed parents have two or more kids playing. Incumbent installment plans switch off below $5 a payment and cap at $10,000, so multi-kid families lose the plan exactly when they need it.'
  },
  {
    file: 'parent-combined',
    screen: 'combined-plan',
    title: 'The season, totalled',
    say: 'Both children, both teams, one running total.',
    note: 'Each athlete is paid for on their own, with the season total in front of the family the whole way. No cap on how many children, and no minimum payment that quietly switches the plan off.'
  },
  {
    file: 'parent-declined',
    screen: 'decline',
    title: 'A decline is a fork, not a wall',
    say: 'Pay in full, or the club’s own plan, and the club can see they tried.',
    note: 'Flywire’s authorised-payer feature took payment-plan defaults from 34% to under 1%. Nobody in youth sports offers it.'
  },
  {
    file: 'club-onboarding',
    screen: 'club-register-1',
    max: 1400,
    title: 'Set up in one sitting',
    say: 'And you can stop halfway and come back.',
    note: 'The payout number appears before we ask for bank details. Most volunteer treasurers will not have the EIN to hand.'
  },
  {
    file: 'club-bank',
    screen: 'club-stripe-onboarding',
    title: 'Where the money lands',
    say: 'Bank details go to our payment partner, never to PlayFund.',
    note: 'Anyone owning 25% or more is verified, or, for a 501(c)(3), directors and officers. Worth warning a treasurer before they start.'
  }
];

function url(slide, extra = {}) {
  const q = new URLSearchParams({
    demo: '1',
    chrome: '0',
    shot: '1',
    screen: slide.screen,
    ...club,
    ...extra
  });
  return `${base}/app/?${q}`;
}

async function chrome(flags) {
  const profile = path.join(outDir, '.chrome-profile');
  return run(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    ...flags
  ], { maxBuffer: 1024 * 1024 * 64 });
}

// The page reports its own content height in <title> once it has settled.
// Reading it back from --dump-dom avoids needing a headless driver at all.
async function heightOf(u, cap) {
  const { stdout } = await chrome(['--dump-dom', '--virtual-time-budget=9000', '--window-size=640,2000', u]);
  const m = stdout.match(/<title>shot:(\d+)<\/title>/);
  return m ? Math.min(cap || 2600, Math.max(560, Number(m[1]))) : 1100;
}

async function shoot(slide) {
  const u = url(slide);
  // A long screen scaled into a 720px slide is unreadable, so a slide may cap
  // its capture and show the top of the screen instead of all of it.
  const h = await heightOf(u, slide.max);
  const file = path.join(outDir, slide.file + '.png');
  await chrome([
    `--screenshot=${file}`,
    `--window-size=${width},${h}`,
    '--virtual-time-budget=9000',
    u
  ]);
  console.log(`  ${slide.file}.png  ${width}x${h}`);
  return { ...slide, h };
}

// ── deck ────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function deckHtml(shots) {
  const cover = `
  <section class="slide cover">
    <div class="mark">PLAY<span>FUND</span></div>
    <h1>Families pay over time.<br>Clubs get paid up front.</h1>
    <p class="sub">${esc(club.club)} &middot; ${esc(club.city)}</p>
    <p class="foot">Figures are examples, not a real club.</p>
  </section>`;

  const body = shots.map((s, i) => `
  <section class="slide">
    <div class="shot"><img src="${s.file}.png" alt="${esc(s.title)}"></div>
    <div class="words">
      <div class="num">${String(i + 1).padStart(2, '0')}</div>
      <h2>${esc(s.title)}</h2>
      <p class="say">${esc(s.say)}</p>
      <p class="note">${esc(s.note)}</p>
    </div>
  </section>`).join('');

  const close = `
  <section class="slide cover">
    <div class="mark">PLAY<span>FUND</span></div>
    <h1>What a pilot looks like</h1>
    <ul class="ask">
      <li>You keep your registration, rosters and messaging exactly as they are.</li>
      <li>We run how families pay, for one season.</li>
      <li>You are paid up front for every approved athlete, net of our rate.</li>
      <li>No cost to set up, no commitment past the season.</li>
    </ul>
    <p class="sub">admin@playfundai.com &middot; playfundai.com</p>
  </section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>PlayFund — ${esc(club.club)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--ink:#004643;--ink-soft:#6B7280;--ink-faint:#9CA3AF;--green:#5BA888;--paper:#fff;--tint:#E8EEEE;--line:#E8EDEC}
  *{box-sizing:border-box}
  body{margin:0;font-family:Inter,-apple-system,sans-serif;color:var(--ink);background:#f3f6f5}
  .slide{width:1280px;height:720px;margin:0 auto 20px;background:var(--paper);display:flex;
    align-items:center;gap:56px;padding:56px 64px;page-break-after:always;break-after:page;overflow:hidden}
  .shot{flex:0 0 420px;display:flex;justify-content:center;align-items:center;height:100%}
  .shot img{max-height:100%;max-width:100%;border-radius:18px;box-shadow:0 18px 50px rgba(0,70,67,.14)}
  .words{flex:1}
  .num{font:700 11px/1 Inter;letter-spacing:.14em;color:var(--green);margin-bottom:14px}
  h2{font-family:Anton,sans-serif;font-weight:400;font-size:46px;line-height:1.06;margin:0 0 18px}
  .say{font-size:21px;line-height:1.45;font-weight:600;margin:0 0 18px}
  .note{font-size:15.5px;line-height:1.65;color:var(--ink-soft);margin:0;max-width:46ch}
  .cover{flex-direction:column;justify-content:center;align-items:flex-start;background:var(--ink);color:#fff}
  .cover .mark{font-family:Anton,sans-serif;font-size:30px;letter-spacing:.01em;margin-bottom:40px}
  .cover .mark span{color:var(--green)}
  .cover h1{font-family:Anton,sans-serif;font-weight:400;font-size:62px;line-height:1.05;margin:0 0 22px}
  .cover .sub{font-size:19px;color:rgba(255,255,255,.72);margin:0}
  .cover .foot{position:absolute;bottom:48px;font-size:13px;color:rgba(255,255,255,.4)}
  .cover .ask{margin:0 0 30px;padding-left:22px;font-size:19px;line-height:1.95;color:rgba(255,255,255,.86);max-width:40ch}
  @page{size:1280px 720px;margin:0}
  @media print{body{background:#fff}.slide{margin:0}}
</style></head><body>${cover}${body}${close}</body></html>`;
}

// ── go ──────────────────────────────────────────────────────────────────────
console.log(`Capturing ${club.club} from ${base}`);
await mkdir(outDir, { recursive: true });

const shots = [];
for (const slide of slides) shots.push(await shoot(slide));

const deck = path.join(outDir, 'deck.html');
await writeFile(deck, deckHtml(shots), 'utf8');

const pdf = path.join(outDir, 'playfund-demo.pdf');
await chrome([
  `--print-to-pdf=${pdf}`,
  '--no-pdf-header-footer',
  '--virtual-time-budget=9000',
  'file://' + deck
]);

await rm(path.join(outDir, '.chrome-profile'), { recursive: true, force: true });
console.log(`\nDeck:  ${pdf}`);
console.log(`Slides: ${deck}`);

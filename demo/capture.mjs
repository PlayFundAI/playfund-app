#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   Screenshots and a PDF deck, from the app itself.

   Drives headless Chrome against the local preview of the real app in demo
   mode (public/app/demo.js), so nothing here draws a product screen or keeps
   its own copy of one. Change the app and re-run this: the deck follows.

     node demo/capture.mjs                     Riverside Soccer Club
     node demo/capture.mjs --deck-only         rebuild the deck, reuse the PNGs
     node demo/capture.mjs --club "Northside Select" --city "Charlotte, NC" \
                           --dues 1200 --athletes 64

   Output lands in demo/out/ (git-ignored): one PNG per screen, plus
   playfund-demo.pdf, which is the thing to email or present with no wifi.

   Needs the preview server running on :4173  
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

// Fail loudly if the preview server is not up. Without this check Chrome
// happily photographs its own "This site can't be reached" page twelve times
// and you get a complete, plausible-looking deck of error screens.
try {
  await fetch(base + '/app/', { method: 'HEAD' });
} catch {
  console.error(
    `\nNothing is serving ${base}.\n\n` +
    `  npx -y serve -l 4173 public\n\n` +
    `Run that from the repository root, in another terminal, then try again.\n`
  );
  process.exit(1);
}

// ── the deck ─────────────────────────────────────────────────
// Nine steps in the order a club lives them, start to finish. `title` is the
// whole slide. `say` is there only where a club would otherwise ask the
// question out loud, and most slides do not have one.
const slides = [
  {
    file: 'club-account',
    screen: 'club-register-1',
    max: 1200,
    title: 'You create a PlayFund account for your club'
  },
  {
    file: 'club-bank',
    screen: 'club-stripe-onboarding',
    title: 'You connect the bank account where the money lands',
    say: 'Bank details go to our payment partner, never to PlayFund.'
  },
  {
    file: 'club-athletes',
    screen: 'add-athlete-admin',
    title: 'You enter your families\u2019 information'
  },
  {
    file: 'club-send',
    screen: 'send-links',
    max: 900,
    title: 'We email every family a link',
    say: 'No account to create, nothing to install.'
  },
  {
    file: 'parent-dues',
    screen: 'athlete-detail',
    max: 1240,
    title: 'Families sign up and pay'
  },
  {
    file: 'parent-options',
    screen: 'embedded-checkout',
    title: 'Families choose how to pay',
    say: 'In full today, or spread over time.'
  },
  {
    file: 'club-payout',
    screen: 'club-overview',
    max: 1180,
    title: 'You get paid up front either way',
    say: 'Our payment partner collects the installments. You are paid at the start of the season.'
  },
  {
    file: 'parent-declined',
    screen: 'decline',
    title: 'If a family does not qualify, we work with you',
    say: 'Pay in full, a smaller deposit, or your club\u2019s own plan.'
  },
  {
    file: 'club-roster',
    screen: 'roster',
    max: 1240,
    title: 'Check progress whenever you want',
    say: 'You will not need to.'
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
    // Draw only once every compositor stage has run. Without it a capture can
    // land before the webfonts paint, which gives you a phone with an empty
    // header and nothing in the logo.
    '--run-all-compositor-stages-before-draw',
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
  // A capped capture stops mid-card. Marked so the deck can fade its bottom
  // edge rather than show a hard cut that reads as a broken image.
  return { ...slide, h, cropped: !!slide.max && h >= slide.max };
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
    <div class="shot${s.cropped ? ' is-cropped' : ''}"><img src="${s.file}.png" alt="${esc(s.title)}"></div>
    <div class="words">
      <div class="num">${String(i + 1).padStart(2, '0')}</div>
      <h2>${esc(s.title)}</h2>
      ${s.say ? `<p class="say">${esc(s.say)}</p>` : ''}
    </div>
  </section>`).join('');

  const close = `
  <section class="slide cover">
    <div class="mark">PLAY<span>FUND</span></div>
    <h1>What a pilot looks like</h1>
    <ul class="ask">
      <li>One season.</li>
      <li>You keep registration, rosters and messaging.</li>
      <li>We run how families pay.</li>
      <li>No setup cost. No commitment after the season.</li>
    </ul>
    <p class="sub">admin@playfundai.com &middot; playfundai.com</p>
  </section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>PlayFund &middot; ${esc(club.club)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--ink:#004643;--ink-soft:#6B7280;--ink-faint:#9CA3AF;--green:#5BA888;--paper:#fff;--tint:#E8EEEE;--line:#E8EDEC}
  *{box-sizing:border-box}
  body{margin:0;font-family:Inter,-apple-system,sans-serif;color:var(--ink);background:#f3f6f5}
  .slide{width:1280px;height:720px;margin:0 auto 20px;background:var(--paper);display:flex;
    align-items:center;gap:48px;padding:48px 56px;page-break-after:always;break-after:page;overflow:hidden}
  /* Both boxes are in pixels on purpose. A percentage max-height resolves
     against a containing block that Chrome's paged layout does not give it,
     so in the PDF, and only in the PDF, every screenshot drew at its natural
     size and ran off the right-hand edge of the page. On screen it looked
     perfect, which is why it survived several rebuilds. 624 is the slide's
     720 less its 48px of padding top and bottom. */
  .shot{flex:0 0 470px;display:flex;justify-content:center;align-items:center;
    height:624px;position:relative}
  .shot img{max-height:624px;max-width:470px;width:auto;height:auto;
    border-radius:18px;box-shadow:0 18px 50px rgba(0,70,67,.14)}
  /* A capped capture ends mid-card. Fading it says "continues below"; a hard
     edge says the image is broken. The fade is a white gradient laid over the
     image rather than a mask on it: a mask forces the image into its own
     composited layer, which the PDF export rasterises separately and, often
     enough to matter, at the wrong scale. */
  .shot.is-cropped img{box-shadow:none;border-radius:18px 18px 0 0}
  .shot.is-cropped::after{content:'';position:absolute;left:0;right:0;bottom:0;
    height:86px;background:linear-gradient(rgba(255,255,255,0),#fff)}
  .words{flex:1}
  .num{font:700 11px/1 Inter;letter-spacing:.14em;color:var(--green);margin-bottom:14px}
  h2{font-family:Anton,sans-serif;font-weight:400;font-size:52px;line-height:1.04;margin:0 0 20px}
  .say{font-size:21px;line-height:1.5;font-weight:500;color:var(--ink-soft);margin:0;max-width:40ch}
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

// --deck-only rebuilds deck.html and the PDF from the screenshots already in
// demo/out, which is what you want when only the words changed.
const deckOnly = args.includes('--deck-only');
// --only club-send re-shoots one slide and reuses the PNGs already on disk for
// the rest, which is the difference between a six-second loop and a two-minute
// one when a single screen is being fiddled with.
const only = arg('only', null);
const shots = [];
for (const slide of slides) {
  const skip = deckOnly || (only && slide.file !== only);
  shots.push(skip
    ? { ...slide, cropped: !!slide.max }
    : await shoot(slide));
}

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

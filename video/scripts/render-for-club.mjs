#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   The same 43-second film, cut for one club.

     node scripts/render-for-club.mjs --club "Northside Select" \
          --city "Charlotte, NC" --dues 1200 --athletes 64

   Why this works without re-recording anything: no line of the voiceover
   contains a figure or a club name. Every number on screen is computed from
   dues, the roster size and the fee (see src/script.ts), so a club's own
   numbers change the picture and leave the read — and therefore the timing —
   exactly as it was.

   Output: out/playfund-<club-slug>.mp4, alongside the homepage film rather
   than replacing it. Nothing committed changes.

   Leave --dues and --athletes off and you get the homepage film with the
   club's name on it, which is usually the right call when you do not have
   their real numbers yet: an invented dues figure in front of a treasurer is
   worse than a generic one.
   ═══════════════════════════════════════════════════════════════════════════ */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const args = process.argv.slice(2);
function arg(name, dflt) {
  const i = args.indexOf('--' + name);
  return i === -1 ? dflt : args[i + 1];
}

const club = arg('club', 'Riverside Soccer Club');
const city = arg('city', 'Richmond, VA');
const dues = arg('dues', '');
const athletes = arg('athletes', '');
const fee = arg('fee', '');
const composition = arg('composition', 'Main');

const slug = club.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const out = path.join(root, 'out', `playfund-${slug}.mp4`);

const env = { ...process.env, REMOTION_CLUB_NAME: club, REMOTION_CLUB_CITY: city };
if (dues) env.REMOTION_DUES = String(dues);
if (athletes) env.REMOTION_ATHLETES = String(athletes);
if (fee) env.REMOTION_FEE_BPS = String(fee);

console.log(`Cutting ${composition} for ${club}${dues ? ` · $${dues} dues` : ''}${athletes ? ` · ${athletes} athletes` : ''}`);

await mkdir(path.join(root, 'out'), { recursive: true });

function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { cwd: root, env, stdio: 'inherit', shell: false });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

// sync-css first, exactly as `npm run render` does, so the film keeps using
// the app's real stylesheet rather than a stale copy of it.
await run('node', [path.join(root, 'scripts', 'sync-app-css.mjs')]);
await run(path.join(root, 'node_modules', '.bin', 'remotion'), ['render', composition, out]);

console.log(`\n${out}`);

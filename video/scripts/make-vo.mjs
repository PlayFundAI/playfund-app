// Generates a scratch voiceover from the `voice` lines in src/script.ts, so
// the read and the on-screen copy cannot drift apart.
//
// macOS `say` is a placeholder for timing, not the final track. Swap VOICE for
// a real recording (or a better engine) and rerun; durations.json is what the
// timeline reads, so the picture retimes itself either way.
import {execFileSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const voDir = join(root, 'public', 'vo');

const VOICE = process.env.VO_VOICE ?? 'Samantha';
const RATE = process.env.VO_RATE ?? '158'; // words per minute; 175 is the default and rushes

// src/script.ts is TypeScript, so bundle it to something importable rather
// than re-typing the lines here.
const tmp = join(root, 'node_modules', '.cache-vo.mjs');
mkdirSync(dirname(tmp), {recursive: true});
await build({
  entryPoints: [join(root, 'src', 'script.ts')],
  outfile: tmp,
  format: 'esm',
  bundle: true,
  platform: 'node',
  logLevel: 'silent',
});
const {copy, timeline} = await import(`file://${tmp}?t=${Date.now()}`);
rmSync(tmp, {force: true});

const camel = (id) => id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

mkdirSync(voDir, {recursive: true});
const durations = {};

for (const beat of timeline) {
  const key = camel(beat.id);
  const line = copy[key]?.voice;
  if (!line) {
    console.log(`  ${beat.id}: no voice line, skipping`);
    continue;
  }

  const aiff = join(voDir, `${beat.id}.aiff`);
  const out = join(voDir, `${beat.id}.m4a`);

  execFileSync('say', ['-v', VOICE, '-r', String(RATE), '-o', aiff, line]);
  // AAC mono at 48kbps: speech-transparent, and small enough that the track
  // can live in the repo instead of being a build artefact.
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '48000', '-c', '1', aiff, out]);
  rmSync(aiff, {force: true});

  const info = execFileSync('afinfo', [out], {encoding: 'utf8'});
  const seconds = Number(info.match(/estimated duration: ([\d.]+) sec/)?.[1]);
  if (!Number.isFinite(seconds)) throw new Error(`No duration for ${beat.id}`);

  durations[beat.id] = Number(seconds.toFixed(3));
  console.log(`  ${beat.id.padEnd(16)} ${seconds.toFixed(2)}s  "${line.slice(0, 54)}"`);
}

writeFileSync(
  join(voDir, 'durations.json'),
  JSON.stringify({voice: VOICE, rate: Number(RATE), seconds: durations}, null, 2) + '\n',
);
console.log(`\nvoice: ${VOICE} at ${RATE}wpm`);
console.log(`total speech: ${Object.values(durations).reduce((a, b) => a + b, 0).toFixed(1)}s`);

// Generates the voiceover from the `voice` lines in src/script.ts, so the read
// and the on-screen copy cannot drift apart. Writes one clip per beat plus
// durations.json, which is what the timeline reads: re-run this after any copy
// change and every cut retimes itself to the new read.
//
//   npm run vo                        macOS `say` (default, no key, scratch only)
//   VO_ENGINE=elevenlabs npm run vo   ElevenLabs   (ELEVENLABS_API_KEY)
//   VO_ENGINE=openai     npm run vo   OpenAI TTS   (OPENAI_API_KEY)
//
// Keys come from the environment and are never written to disk, logged, or
// committed. Export one in your shell before running; this script only reads it.
import {execFileSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {STYLES, DEFAULT_STYLE, DEFAULT_OPENAI_VOICE} from './vo-styles.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const voDir = join(root, 'public', 'vo');

const ENGINE = process.env.VO_ENGINE ?? 'say';

// ── Engines ──────────────────────────────────────────────────────────────────
// Each returns a Buffer of encoded audio. afconvert normalises whatever comes
// back to AAC, so the rest of the pipeline does not care which one ran.

async function sayEngine(line, id) {
  const voice = process.env.VO_VOICE ?? 'Samantha';
  const rate = process.env.VO_RATE ?? '158';
  const aiff = join(voDir, `${id}.tmp.aiff`);
  execFileSync('say', ['-v', voice, '-r', String(rate), '-o', aiff, line]);
  return {path: aiff, label: `say/${voice}@${rate}wpm`};
}

async function elevenLabsEngine(line, id) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error(
      'ELEVENLABS_API_KEY is not set. Export it in your shell first:\n' +
        '  export ELEVENLABS_API_KEY=...\n' +
        'Get one at elevenlabs.io > Profile > API Keys.',
    );
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? (await pickElevenLabsVoice(key));
  const model = process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2';

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {'xi-api-key': key, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        text: line,
        model_id: model,
        // Steady and unhurried: this is product narration, not an audiobook.
        voice_settings: {stability: 0.5, similarity_boost: 0.75, style: 0.0},
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const mp3 = join(voDir, `${id}.tmp.mp3`);
  writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  return {path: mp3, label: `elevenlabs/${voiceId}`};
}

let cachedVoiceId = null;
async function pickElevenLabsVoice(key) {
  if (cachedVoiceId) return cachedVoiceId;
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {headers: {'xi-api-key': key}});
  if (!res.ok) throw new Error(`ElevenLabs /voices ${res.status}`);
  const {voices} = await res.json();
  if (!voices?.length) throw new Error('No voices on this ElevenLabs account.');

  const wanted = process.env.ELEVENLABS_VOICE_NAME?.toLowerCase();
  const match = wanted
    ? voices.find((v) => v.name?.toLowerCase() === wanted)
    : voices[0];
  if (!match) {
    throw new Error(
      `No voice named "${process.env.ELEVENLABS_VOICE_NAME}". Available:\n` +
        voices.map((v) => `  ${v.name}  ${v.voice_id}`).join('\n'),
    );
  }
  console.log(`  voices on this account: ${voices.map((v) => v.name).join(', ')}`);
  console.log(`  using "${match.name}" (${match.voice_id})\n`);
  cachedVoiceId = match.voice_id;
  return cachedVoiceId;
}

async function openAiEngine(line, id) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      'OPENAI_API_KEY is not set. Export it in your shell first:\n' +
        '  export OPENAI_API_KEY=...',
    );
  }
  const voice = process.env.OPENAI_VOICE ?? DEFAULT_OPENAI_VOICE;
  const style = process.env.VO_STYLE ?? DEFAULT_STYLE;
  const instructions = STYLES[style];
  if (!instructions) {
    throw new Error(`Unknown VO_STYLE "${style}". Known: ${Object.keys(STYLES).join(', ')}`);
  }

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
      voice,
      input: line,
      response_format: 'mp3',
      instructions,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const mp3 = join(voDir, `${id}.tmp.mp3`);
  writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
  return {path: mp3, label: `openai/${voice}/${style}`};
}

const engines = {say: sayEngine, elevenlabs: elevenLabsEngine, openai: openAiEngine};
const engine = engines[ENGINE];
if (!engine) {
  console.error(`Unknown VO_ENGINE "${ENGINE}". Use one of: ${Object.keys(engines).join(', ')}`);
  process.exit(1);
}

// ── Run ──────────────────────────────────────────────────────────────────────

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
let label = ENGINE;

for (const beat of timeline) {
  const line = copy[camel(beat.id)]?.voice;
  if (!line) {
    console.log(`  ${beat.id}: no voice line, skipping`);
    continue;
  }

  const out = join(voDir, `${beat.id}.m4a`);
  let raw, engineLabel;
  try {
    ({path: raw, label: engineLabel} = await engine(line, beat.id));
  } catch (err) {
    // A missing key or a provider error is a configuration problem, not a
    // crash: say what to do and stop, without a stack trace on top of it.
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
  label = engineLabel;

  // AAC mono at 48kbps: speech-transparent, and small enough that the track
  // can live in the repo instead of being a build artefact.
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '48000', '-c', '1', raw, out]);
  rmSync(raw, {force: true});

  const info = execFileSync('afinfo', [out], {encoding: 'utf8'});
  const seconds = Number(info.match(/estimated duration: ([\d.]+) sec/)?.[1]);
  if (!Number.isFinite(seconds)) throw new Error(`No duration for ${beat.id}`);

  durations[beat.id] = Number(seconds.toFixed(3));
  console.log(`  ${beat.id.padEnd(16)} ${seconds.toFixed(2)}s  "${line.slice(0, 50)}"`);
}

writeFileSync(
  join(voDir, 'durations.json'),
  JSON.stringify({engine: label, seconds: durations}, null, 2) + '\n',
);
const total = Object.values(durations).reduce((a, b) => a + b, 0);
console.log(`\nengine: ${label}`);
console.log(`total speech: ${total.toFixed(1)}s`);
console.log('Run `npm run render` to rebuild the video at the new timings.');

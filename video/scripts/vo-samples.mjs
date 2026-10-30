// Renders one line of the script across voices and style directions, so both
// can be chosen by ear before committing to a full regeneration. Writes to a
// temp directory, never to public/vo.
//
//   VO_ENGINE=openai node scripts/vo-samples.mjs
//
// What makes TTS sound synthetic is usually the direction, not the voice:
// even pacing, no breath, and every sentence landing on the same pitch. The
// styles below vary that deliberately. Reads the key from the environment only.
import {execFileSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {STYLES} from './vo-styles.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = process.env.VO_SAMPLE_DIR ?? join(tmpdir(), 'playfund-vo-samples');


const VOICES = process.env.OPENAI_VOICES?.split(',') ?? [
  'ballad',
  'coral',
  'echo',
  'fable',
  'shimmer',
];

const tmp = join(root, 'node_modules', '.cache-vo-samples.mjs');
mkdirSync(dirname(tmp), {recursive: true});
await build({
  entryPoints: [join(root, 'src', 'script.ts')],
  outfile: tmp,
  format: 'esm',
  bundle: true,
  platform: 'node',
  logLevel: 'silent',
});
const {copy} = await import(`file://${tmp}?t=${Date.now()}`);
rmSync(tmp, {force: true});

// The expenses line, not the thesis: a short list is where synthetic prosody
// gives itself away fastest, so it is the more useful audition.
const line = process.env.VO_SAMPLE_LINE ?? copy.act1Expenses.voice;
const styles = process.env.VO_STYLES?.split(',') ?? Object.keys(STYLES);


mkdirSync(outDir, {recursive: true});
console.log(`line:   "${line}"`);
console.log(`styles: ${styles.join(', ')}`);
console.log(`out:    ${outDir}\n`);

const ENGINE = process.env.VO_ENGINE ?? 'openai';

// ── ElevenLabs ──────────────────────────────────────────────────────────────
// It returns 44.1kHz where OpenAI caps at 24kHz, and its voice list is
// per-account, so this asks the account what it has rather than guessing at
// voice ids.

// Output format: pcm_44100 is Pro tier and above only, so the default is
// 44.1kHz mp3, which is still well past OpenAI's 24kHz ceiling. Set
// ELEVENLABS_FORMAT=pcm_44100 on a Pro account to drop the last lossy step.
async function elevenLabsSamples(line) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.error(
      'ELEVENLABS_API_KEY is not set. Add it to ~/.playfund-env, then:\n' +
        '  source ~/.playfund-env\n',
    );
    process.exit(1);
  }

  const vres = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: {'xi-api-key': key},
  });
  if (!vres.ok) {
    console.error(`ElevenLabs /voices ${vres.status}: ${(await vres.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const {voices} = await vres.json();

  console.log(`${voices.length} voices on this account:`);
  for (const v of voices) {
    const l = v.labels ?? {};
    const tags = [l.gender, l.accent, l.age, l.use_case || l.description]
      .filter(Boolean)
      .join(', ');
    console.log(`  ${(v.name ?? '?').padEnd(14)} ${tags}`);
  }
  console.log();

  // Prefer voices the account labels for narration or news; those are the
  // ones tuned for exactly this job. Fall back to whatever is there.
  const named = process.env.ELEVENLABS_VOICES?.split(',').map((n) => n.trim().toLowerCase());
  const narration = voices.filter((v) => {
    const u = `${v.labels?.use_case ?? ''} ${v.labels?.description ?? ''}`.toLowerCase();
    return u.includes('narrat') || u.includes('news') || u.includes('informative');
  });
  // Names come back as "Eric - Smooth, Trustworthy", so match the leading
  // part rather than the whole string.
  const shortName = (v) => (v.name ?? '').split(/\s+-\s+/)[0].trim().toLowerCase();
  const picked = named
    ? named.map((n) => voices.find((v) => shortName(v) === n)).filter(Boolean)
    : (narration.length >= 3 ? narration : voices).slice(0, 6);

  if (!picked.length) {
    console.error('No matching voices. Set ELEVENLABS_VOICES to names from the list above.');
    process.exit(1);
  }

  const model = process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2';
  const FORMAT = process.env.ELEVENLABS_FORMAT ?? 'mp3_44100_128';
  console.log(`sampling ${picked.length} with ${model}\n`);
  let chars = 0;

  for (const voice of picked) {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice.voice_id}?output_format=${FORMAT}`,
      {
        method: 'POST',
        headers: {'xi-api-key': key, 'Content-Type': 'application/json'},
        body: JSON.stringify({
          text: line,
          model_id: model,
          // Lower stability means more variation between phrases, which is
          // what stops a read sounding metronomic. Too low and it wanders.
          voice_settings: {
            stability: Number(process.env.ELEVENLABS_STABILITY ?? 0.45),
            similarity_boost: 0.75,
            style: 0,
            use_speaker_boost: true,
          },
        }),
      },
    );
    if (!res.ok) {
      console.error(`\n${voice.name}: ElevenLabs ${res.status}: ${(await res.text()).slice(0, 250)}\n`);
      process.exit(1);
    }
    const stem = shortName(voice) || voice.voice_id;
    const raw = join(outDir, `${stem}.tmp`);
    const out = join(outDir, `${stem}.wav`);
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    execFileSync('afconvert', [
      '-f', 'WAVE', '-d', 'LEI16', '-c', '1',
      ...(FORMAT.startsWith('pcm_')
        ? ['--raw', '--rawformat', 'LEI16@44100', '--rawchannels', '1']
        : []),
      raw, out,
    ]);
    rmSync(raw, {force: true});
    const info = execFileSync('afinfo', [out], {encoding: 'utf8'});
    const seconds = Number(info.match(/estimated duration: ([\d.]+) sec/)?.[1]);
    chars += line.length;
    console.log(`  ${stem.padEnd(18)} ${seconds.toFixed(2)}s   ${voice.voice_id}`);
  }
  console.log(`\n${chars} credits used of 10,000 on the free tier.`);
}

if (ENGINE === 'elevenlabs') {
  await elevenLabsSamples(line);
  process.exit(0);
}

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('OPENAI_API_KEY is not set.\n');
  process.exit(1);
}


let spent = 0;

for (const style of styles) {
  const instructions = STYLES[style];
  if (!instructions) {
    console.error(`Unknown style "${style}". Known: ${Object.keys(STYLES).join(', ')}`);
    process.exit(1);
  }
  for (const voice of VOICES) {
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
      console.error(`\n${voice}/${style}: OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}\n`);
      process.exit(1);
    }
    const stem = `${voice}-${style}`;
    const mp3 = join(outDir, `${stem}.tmp.mp3`);
    const out = join(outDir, `${stem}.m4a`);
    writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '48000', '-c', '1', mp3, out]);
    rmSync(mp3, {force: true});

    const info = execFileSync('afinfo', [out], {encoding: 'utf8'});
    const seconds = Number(info.match(/estimated duration: ([\d.]+) sec/)?.[1]);
    spent += line.length;
    console.log(`  ${stem.padEnd(18)} ${seconds.toFixed(2)}s`);
  }
}

console.log(`\n${spent} characters, about $${((spent * 15) / 1e6).toFixed(4)}.`);

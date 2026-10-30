# PlayFund pilot video

A screens-only explainer, built as code rather than screen-recorded. Beats
compose the app's real markup and its real stylesheet, so the video cannot
drift from the product.

## Why not a screen recording

Filming the app would mean adding a demo mode to a live payments app.
`submitCode()` in `public/app/index.html` POSTs a real athlete row on every
run, analytics fire on every screen view, and `seededRoster()` is random per
team, so takes would not match each other. Rendering sidesteps all three: the
video carries its own data and makes no network calls.

## Editing

Everything mutable is in [`src/script.ts`](src/script.ts): copy, every figure,
and the voiceover lines. Beat durations are *computed* from the audio, not
typed. Cutting a beat is deleting one line from `timeline`.

```bash
npm run dev       # Remotion Studio, live scrubber
npm run render    # out/playfund-pilot.mp4
npm run vo        # regenerate the voiceover and retime every beat
```

`npm run sync-css` runs automatically before dev and render; it re-extracts the
stylesheet from `../public/app/index.html`.

## Voiceover

The committed track is OpenAI `gpt-4o-mini-tts`, voice **echo**, style
**natural**, chosen by ear over two rounds of auditions.

Clips are stored as **lossless WAV**, so Remotion's own encode is the only
lossy step. They were briefly mp3 from the API re-encoded to 48kbps AAC, which
is three generations of compression and audibly muffled. Do not reintroduce an
intermediate codec to save repo space; ten clips of speech is about 2MB.

`gpt-4o-mini-tts` outputs 24kHz whatever format you ask for, so 12kHz is the
top end available from OpenAI. ElevenLabs returns 44.1kHz, which is the main
reason to switch if the track still sounds thin.

```bash
source ~/.playfund-env && VO_ENGINE=openai npm run vo && npm run render
```

```bash
export ELEVENLABS_API_KEY=...          # elevenlabs.io > Profile > API Keys
VO_ENGINE=elevenlabs npm run vo && npm run render
```

Keys are read from the environment only. Never put one in a file here.

### Style, not just voice

What makes TTS sound synthetic is mostly delivery: metronomic pacing, no
breath between ideas, every sentence landing on the same pitch,
over-enunciation. `scripts/vo-styles.mjs` holds two directions. `level` sets a
mood and leaves all four tells in place; `natural` names them. Switching
`level` to `natural` did more for how human the track sounds than any change
of voice did.

### Speed

`SPEED` in `src/script.ts` is the dial for how fast the voiceover plays
(currently `1.2`). Remotion preserves pitch, and the effective length of every
clip is derived from it, so the cuts stay on the words and no regeneration is
needed to change it.

Asking the engine for a brisker read does *not* work reliably: rewriting the
style direction to demand pace moved the total by 4% and made one line
slower. Set the speed here instead.

```bash
npm run timeline    # how every beat's length was arrived at
```

A beat marked FLOOR is holding longer than its line needs. That is correct for
`act3-split`, where the floor exists so the disclosure stays readable, and is
usually dead air anywhere else.

Audition before committing to a full regeneration:

```bash
source ~/.playfund-env && VO_ENGINE=openai node scripts/vo-samples.mjs
```

```bash
source ~/.playfund-env && VO_ENGINE=elevenlabs node scripts/vo-samples.mjs
```

The ElevenLabs run prints every voice on the account with its labels, then
samples the ones tagged for narration (or the first six). `ELEVENLABS_VOICES`
takes a comma-separated list of names from that printout.

Its free tier has **no commercial licence**, so audition on free but regenerate
on a paid plan before the video ships.

That renders one line across voices and both styles into a temp directory, for
well under a cent. `OPENAI_VOICES`, `VO_STYLES` and `VO_SAMPLE_LINE` narrow it.

The script is ~440 characters, so a full regeneration fits ElevenLabs' free
tier about 22 times over, or costs under a cent on OpenAI.

| Variable | Applies to | Default |
|---|---|---|
| `VO_ENGINE` | all | `say` |
| `VO_VOICE`, `VO_RATE` | `say` | `Samantha`, `158` |
| `ELEVENLABS_VOICE_NAME` or `ELEVENLABS_VOICE_ID` | `elevenlabs` | first voice on the account |
| `ELEVENLABS_MODEL` | `elevenlabs` | `eleven_multilingual_v2` |
| `OPENAI_VOICE` | `openai` | `echo` |
| `VO_STYLE` | `openai` | `natural` |
| `OPENAI_TTS_MODEL` | `openai` | `gpt-4o-mini-tts` |

Running with no voice name prints every voice on the account and uses the
first, so you can see what you have before choosing.

## Two constraints that are not style choices

- **The video never names the payment provider.** `screen-athlete-detail`
  names both Klarna and Stripe; the marketing site says "our payment partner",
  and so does this.
- **`act3-split` holds for 8.5s** because the installment disclosure is the
  longest text in the video and has to stay readable. Do not lower that floor
  to tighten the edit.

## Compositions

| id | what |
|---|---|
| `Main` | the explainer, ~0:48, narrated |
| `HeroLoop` | the payout beat alone, 8s, silent, for the homepage hero |

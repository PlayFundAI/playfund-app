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

Audition before committing to a full regeneration:

```bash
source ~/.playfund-env && VO_ENGINE=openai node scripts/vo-samples.mjs
```

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
| `Main` | the explainer, ~0:57, narrated |
| `HeroLoop` | the payout beat alone, 8s, silent, for the homepage hero |

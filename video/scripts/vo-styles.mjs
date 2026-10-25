// Delivery directions for engines that accept them (currently OpenAI's
// gpt-4o-mini-tts). Shared by make-vo.mjs and vo-samples.mjs so the voice you
// auditioned is the voice you ship.
//
// What makes TTS sound synthetic is mostly delivery, not timbre: metronomic
// pacing, no breath between ideas, every sentence landing on the same pitch,
// and over-enunciation. `level` sets a mood and leaves all four in place,
// which is why it reads as narration. `natural` names them.
export const STYLES = {
  level:
    'Calm, grounded, unhurried. A confident person explaining something ' +
    'useful to a colleague. No upsell energy, no rising enthusiasm.',

  // The four tells, named. Note the pace instruction: the first version of
  // this asked only for breath and emphasis, and every voice took that as
  // licence to linger, which read as slow rather than calm.
  natural:
    'Talk to one person, do not narrate. Brisk and efficient, the pace of ' +
    'someone who is busy but not rushed; keep it moving and do not linger on ' +
    'any phrase. Move quickly through small connecting words, and give only ' +
    'the numbers a little room. Breathe between ideas, not between phrases. ' +
    'Let the last word of a sentence fall, never lift. Do not over-enunciate; ' +
    'swallow a consonant here and there the way people actually do. Slightly ' +
    'dry. Sound like you have said this before and are not savouring it.',
};

/** Chosen by ear over two rounds of auditions; see video/README.md. */
export const DEFAULT_STYLE = 'natural';
export const DEFAULT_OPENAI_VOICE = 'echo';

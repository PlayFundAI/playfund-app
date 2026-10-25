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

  natural:
    'Talk to one person, do not narrate. Vary the pace: move quickly through ' +
    'small connecting words and slow down on the numbers. Take a short breath ' +
    'before each new idea. Let the last word of a sentence fall, never lift. ' +
    'Do not over-enunciate; swallow a consonant here and there the way people ' +
    'actually do. Slightly dry. Sound like you have said this before.',
};

/** Chosen by ear over two rounds of auditions; see video/README.md. */
export const DEFAULT_STYLE = 'natural';
export const DEFAULT_OPENAI_VOICE = 'echo';

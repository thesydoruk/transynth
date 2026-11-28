import type { VoiceTtsMarkupStyle } from '../../../voice/prepareVoiceTtsText';

/** A sound the actor makes, written between asterisks: `*Spits*`, `*Cough cough*`. */
const STAGE_DIRECTION_RE = /\*[^*]+\*/g;

/** Elder Speech braces that held nothing but a stage direction: `{*Whistles*}`. */
const EMPTY_BRACES_RE = /\{\s*\}/g;

/**
 * What TTS should not read out of a Witcher 3 line: the HTML-like tags the
 * tables carry (`<br>`, `<i>`, `<font …>`) and `*stage directions*`.
 *
 * Asterisks never mark emphasis here. Every one of the 64 distinct `*…*` blocks
 * in the voiced English lines names a sound (`*Sigh*`, `*Whistles*`,
 * `*Buuurrrrrp*`), and so do the blocks translators wrote («*Позіхає*»), so a
 * block goes, and a line that is nothing else is not speech. The game censors
 * nothing, so the rest passes through — Elder Speech braces included.
 */
export const WITCHER3_VOICE_MARKUP: VoiceTtsMarkupStyle = {
  stripEmphasis: (text) =>
    text
      .replace(/<[^>]*>/g, ' ')
      .replace(STAGE_DIRECTION_RE, ' ')
      .replace(EMPTY_BRACES_RE, ' '),
  emphasisLineIsNonSpeech: true,
  restoreCensoredSpeech: (text) => text,
};

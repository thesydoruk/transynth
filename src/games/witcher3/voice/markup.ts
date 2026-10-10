import type { VoiceTtsMarkupStyle } from '../../../voice/prepareVoiceTtsText';

/**
 * What TTS should not read out of a Witcher 3 line: the HTML-like tags the
 * tables carry (`<br>`, `<i>`, `<font …>`). The game has no `*stage direction*`
 * convention and censors nothing, so the rest passes through.
 */
export const WITCHER3_VOICE_MARKUP: VoiceTtsMarkupStyle = {
  stripEmphasis: (text) => text.replace(/<[^>]*>/g, ' '),
  emphasisLineIsNonSpeech: false,
  restoreCensoredSpeech: (text) => text,
};

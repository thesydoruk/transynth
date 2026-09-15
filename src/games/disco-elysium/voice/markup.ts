import type { VoiceTtsMarkupStyle } from '../../../voice/prepareVoiceTtsText';
import { restoreDiscoCensoredSpeech } from '../text/censorship';

/**
 * Disco Elysium markup rules for TTS.
 *
 * `*…*` is italics the narrator actually says, so the asterisks are dropped and
 * the words kept — including for a line that is nothing but emphasis. The
 * shipped `.po` files also censor profanity (`f%$#ing`), which has to be undone
 * before the line is spoken.
 */
export const DISCO_VOICE_MARKUP: VoiceTtsMarkupStyle = {
  stripEmphasis: (text) => text.replace(/\*/g, ''),
  emphasisLineIsNonSpeech: false,
  restoreCensoredSpeech: restoreDiscoCensoredSpeech,
};

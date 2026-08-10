/**
 * Prepare INFO NAM1 text before XTTS / Fish Speech synthesis.
 *
 * Fallout dialogue strings mix speakable lines with stage directions and sound
 * effects. XTTS clones timbre from the reference `.fuz` but still tries to
 * speak the target text, so non-speech markers must be filtered out and
 * inline *...* / [...] blocks stripped from both payload fields:
 *
 *   text        — Ukrainian translation (POST /v1/synthesize "text")
 *   speakerText — English transcript of the reference clip ("speaker_text")
 *
 * Decision flow:
 *   1. Skip — companion interject stub (EDID), full-line sound marker, or
 *      nothing left after stripping asterisk blocks.
 *   2. Synthesize — strip every *...* block from translation and speaker
 *      source, then send the remainder to TTS and FaceFX LIP.
 *
 * Examples (Fallout 4):
 *
 *   Animal sound — (Whine) / *скавчить* → skip (non_speech_marker)
 *   Human SFX    — *Sigh* / *зітхає* → skip (non_speech_marker)
 *   Tone tag     — Sarcastic / [Сарказм] → skip (non_speech_marker)
 *   Interject stub — "Cait interjects", EDID CA_Interject_Stub_Cait → skip (interject_stub)
 *   Prefix strip — "*chuckle* This troublemaker…" → synth (dialogue only)
 *   Prefix strip — "[Сарказм] Ну звісно…" → synth (dialogue only)
 *   Suffix strip — "…take your time *groan*" → synth (without *groan*)
 *   Multi-block  — "*Gasping* *Coughing*" → skip (empty_after_strip)
 *
 * Bracketed [...] blocks are tone tags and UI tokens ([Сарказм], [Click]).
 * They are never spoken, and FaceFXWrapper hangs on non-ASCII text inside
 * brackets, so they are stripped exactly like *...* blocks.
 *
 * Parentheses (...) count as non-speech only when the entire line matches.
 * Mid-line parens are left untouched. Vanilla FO4: animals use (Bark!), (Growl);
 * human grunts use *Sigh*, *gasp*.
 */

/** Inline stage direction / sound-effect block: `*chuckle*`, `*groan*`, … */
const ASTERISK_BLOCK_RE = /\*[^*]+\*/g;

/** Inline tone tag / UI token: `[Сарказм]`, `[Click]`, … */
const BRACKET_BLOCK_RE = /\[[^[\]]*\]/g;

/** Whole line is one asterisk block, e.g. `*Sigh*`, `*heavy breathing*`. */
const FULL_ASTERISK_LINE_RE = /^\*[^*]+\*$/;

/** Whole line is one bracketed tag, e.g. `[Сарказм]`, `[Brotherhood]`. */
const FULL_BRACKET_LINE_RE = /^\[[^[\]]+\]$/;

/** Whole line is one parenthesized sound label, e.g. `(Whine)`, `(Bark!)`. */
const FULL_PAREN_LINE_RE = /^\([^)]+\)$/;

/** Companion auto-interject placeholders, e.g. `CA_Interject_Stub_Cait`. */
const INTERJECT_STUB_EDID_RE = /^CA_Interject_Stub_/i;

/** Why a voiced line was excluded from TTS synthesis. */
export type VoiceTtsSkipReason = 'interject_stub' | 'non_speech_marker' | 'empty_after_strip';

export type PrepareVoiceTtsTextResult =
  | { action: 'skip'; reason: VoiceTtsSkipReason }
  | { action: 'synthesize'; text: string; speakerText: string | undefined };

const normalizeLine = (text: string | null | undefined): string => text?.trim() ?? '';

/**
 * Remove all `*...*` and `[...]` blocks anywhere in the string and collapse
 * whitespace.
 *
 * @example stripVoiceNonSpeechBlocks('*ahem* Now, was there anything?')
 *          → 'Now, was there anything?'
 * @example stripVoiceNonSpeechBlocks('Yeah, just take your time... *groan*')
 *          → 'Yeah, just take your time...'
 * @example stripVoiceNonSpeechBlocks('[Сарказм] Ну звісно.') → 'Ну звісно.'
 * @example stripVoiceNonSpeechBlocks('*Gasping* *Coughing*') → ''
 */
export const stripVoiceNonSpeechBlocks = (text: string): string =>
  text.replace(ASTERISK_BLOCK_RE, ' ').replace(BRACKET_BLOCK_RE, ' ').replace(/\s+/g, ' ').trim();

/**
 * True when the INFO record is a companion interject engine stub.
 *
 * These lines are not player-facing dialogue; the game plays a separate voiced
 * interjection clip. Detection uses **EDID only** (not source text like
 * `"Cait interjects"`), because the same phrase pattern can appear in real
 * dialogue.
 *
 * @example isInterjectStubEdid('CA_Interject_Stub_Cait') → true
 * @example isInterjectStubEdid('CA_Interject_Stub_Piper') → true
 * @example isInterjectStubEdid('SomeQuestDialogue') → false
 */
export const isInterjectStubEdid = (edid?: string | null): boolean => {
  const editorId = edid?.trim();
  return !!editorId && INTERJECT_STUB_EDID_RE.test(editorId);
};

/**
 * True when the **entire** trimmed line is a single non-speech marker.
 *
 * Does **not** match dialogue that merely contains a marker:
 * `*chuckle* Hello` and `Hello *chuckle*` return false here (those go through
 * {@link stripVoiceNonSpeechBlocks} instead).
 *
 * @example isFullNonSpeechMarkerLine('*Sigh*') → true
 * @example isFullNonSpeechMarkerLine('(Whine)') → true
 * @example isFullNonSpeechMarkerLine('(Growl)') → true
 * @example isFullNonSpeechMarkerLine('[Сарказм]') → true
 * @example isFullNonSpeechMarkerLine('*chuckle* Hello there') → false
 */
export const isFullNonSpeechMarkerLine = (text: string): boolean => {
  const line = text.trim();
  if (!line) return false;
  return (
    FULL_ASTERISK_LINE_RE.test(line) ||
    FULL_PAREN_LINE_RE.test(line) ||
    FULL_BRACKET_LINE_RE.test(line)
  );
};

/** Human-readable skip reason for logs and batch `skipped[]` messages. */
export const voiceTtsSkipMessage = (reason: VoiceTtsSkipReason): string => {
  switch (reason) {
    case 'interject_stub':
      return 'Companion interject stub — not synthesizable speech';
    case 'non_speech_marker':
      return 'Non-speech sound/stage-direction line';
    case 'empty_after_strip':
      return 'No speakable text after removing stage-direction markers';
  }
};

/**
 * Returns a skip reason when the line must not be sent to TTS, or `null` when
 * synthesis may proceed (possibly after asterisk stripping).
 *
 * Skip if **any** of:
 * - `edid` matches `CA_Interject_Stub_*`
 * - entire `lineSource` is `*...*`, `(...)` or `[...]`
 * - entire `translation` is `*...*`, `(...)` or `[...]`
 *
 * @example detectVoiceTtsSkipReason('(Whine)', '*скавчить*') → 'non_speech_marker'
 * @example detectVoiceTtsSkipReason('Cait interjects', '*…*', 'CA_Interject_Stub_Cait')
 *          → 'interject_stub'
 * @example detectVoiceTtsSkipReason('*ahem* Hello?', 'Привіт?') → null
 */
export const detectVoiceTtsSkipReason = (
  lineSource: string | null | undefined,
  translation: string,
  edid?: string | null,
): VoiceTtsSkipReason | null => {
  if (isInterjectStubEdid(edid)) return 'interject_stub';

  const source = normalizeLine(lineSource);
  const target = normalizeLine(translation);
  if (isFullNonSpeechMarkerLine(source) || isFullNonSpeechMarkerLine(target)) {
    return 'non_speech_marker';
  }
  return null;
};

/**
 * Whether the mod editor / batch job should offer TTS for this line.
 *
 * @example canSynthesizeVoiceLine('(Growl)', '(ричить)') → false
 * @example canSynthesizeVoiceLine('Cait interjects', '*…*', 'CA_Interject_Stub_Cait') → false
 * @example canSynthesizeVoiceLine('*ahem* Hello?', 'Привіт?') → true
 */
export const canSynthesizeVoiceLine = (
  lineSource: string | null | undefined,
  translation: string,
  edid?: string | null,
): boolean => {
  if (detectVoiceTtsSkipReason(lineSource, translation, edid)) return false;
  return stripVoiceNonSpeechBlocks(translation).length > 0;
};

/**
 * Build the TTS payload for one voiced line.
 *
 * @param input.lineSource — English INFO NAM1 of the line being synthesized
 *   (used for skip checks and as fallback speaker transcript).
 * @param input.translation — Ukrainian text → `text` field after stripping.
 * @param input.speakerSource — English transcript of the reference `.fuz`
 *   (line mode: same as `lineSource`; speaker mode: text of the picked ref
 *   line). Also stripped of `*...*` / `[...]` before `speaker_text` is sent.
 * @param input.edid — INFO record EDID from `records.edid` (needed for
 *   interject stub detection).
 *
 * @example
 * prepareVoiceTtsText({
 *   lineSource: '*chuckle* This troublemaker here…',
 *   translation: '*смішок* Цей негідник…',
 *   speakerSource: '*chuckle* This troublemaker here…',
 * })
 * // → { action: 'synthesize', text: 'Цей негідник…', speakerText: 'This troublemaker here…' }
 *
 * @example
 * prepareVoiceTtsText({
 *   lineSource: '(Whine)',
 *   translation: '*скавчить*',
 *   speakerSource: '(Whine)',
 * })
 * // → { action: 'skip', reason: 'non_speech_marker' }
 */
export const prepareVoiceTtsText = (input: {
  lineSource: string | null | undefined;
  translation: string;
  /** When valid, used for TTS `text` instead of {@link translation}. */
  stressedTranslation?: string | null;
  speakerSource: string | null | undefined;
  edid?: string | null;
}): PrepareVoiceTtsTextResult => {
  const skipReason = detectVoiceTtsSkipReason(input.lineSource, input.translation, input.edid);
  if (skipReason) return { action: 'skip', reason: skipReason };

  const ttsSource = input.stressedTranslation?.trim() || input.translation;
  const text = stripVoiceNonSpeechBlocks(ttsSource);
  if (!text) return { action: 'skip', reason: 'empty_after_strip' };

  const speakerRaw = normalizeLine(input.speakerSource) || normalizeLine(input.lineSource);
  const speakerText = speakerRaw ? stripVoiceNonSpeechBlocks(speakerRaw) : '';

  return {
    action: 'synthesize',
    text,
    speakerText: speakerText || undefined,
  };
};

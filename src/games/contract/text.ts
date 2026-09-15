/**
 * Game-specific handling of the *text itself*: markup a game embeds in its
 * strings, tokens the LLM must not touch, and quality checks that depend on
 * that markup.
 *
 * Placeholder masking (`%s`, `<Alias=…>`, …) is shared; everything below is
 * what one game does on top of it.
 */

/** Text with game markup replaced by opaque `¤KEY¤` tokens, plus the map back. */
export type MaskedText = { masked: string; mapping: Record<string, string> };

/** One source/translation pair handed to the verify guard. */
export type VerifyGuardItem = { source: string; translation: string };

/** The part of an LLM verify verdict a guard may sharpen. */
export type VerifyGuardVerdict = {
  verdict: 'ok' | 'suspicious' | 'incorrect';
  reason: string;
  confidence: number;
};

/**
 * What a record holds, for the few shared checks that have to vary by it.
 *
 * Deliberately small and semantic. Shared code used to ask this in Bethesda
 * record signatures — `grup === 'TERM'`, `signature === 'PEX'` — which is a
 * question only one engine can answer and every other game answered wrongly by
 * default. These are the kinds something outside the plugin genuinely needs to
 * distinguish; everything else is `other`.
 */
export type GameRecordKind =
  /** Human-readable script text, where engine keywords are identifiers. */
  | 'script_source'
  /** Compiled script bytecode with strings inside it. */
  | 'compiled_script'
  /** A mod's own settings menu — option labels, not prose. */
  | 'settings_menu'
  /** Character-creation morph labels, which glossary terms must not be forced onto. */
  | 'face_morph'
  /** Narration nobody speaks aloud: a terminal entry, a note, a book. */
  | 'prose'
  /** Holds somebody's name or designation, so a short code may still be text. */
  | 'actor_name'
  | 'other';

export type GameTextAdapter = {
  /**
   * Legacy engine keywords that must survive translation verbatim
   * (Creation Engine `FunctionKeywords` corpora). Empty when a game has none.
   */
  functionKeywords: readonly string[];

  /**
   * Classify a record so shared checks need not know this game's vocabulary.
   *
   * @param grup - Record type as the game names it.
   * @param field - Subrecord or field within it, where the game has one.
   */
  recordKind(grup: string | null | undefined, field?: string | null): GameRecordKind;

  /**
   * Mask markup the LLM must reproduce exactly but must not translate —
   * Disco's lockit `*italics*` / `"speech"` / `--`, for example.
   *
   * Called after placeholder and function-keyword masking. Return the text
   * unchanged with an empty mapping when a game has no such markup.
   */
  maskMarkup(text: string): MaskedText;

  /**
   * Undo in-game censorship so TTS and the LLM see real words
   * (Disco ships `f%$#ing` in its `.po` files). Identity for most games.
   */
  restoreCensoredSpeech(text: string): string;

  /**
   * Copy the source's markup shape onto a translation before storing it,
   * so a model that dropped an italic pair or an em dash does not corrupt
   * the exported file. Identity for most games.
   */
  restoreMarkupShape(source: string, translation: string): string;

  /**
   * Sharpen an LLM verify verdict using checks only this game can make.
   * Return `result` unchanged when nothing is wrong.
   */
  guardVerifyResult<T extends VerifyGuardVerdict>(item: VerifyGuardItem, result: T): T;
};

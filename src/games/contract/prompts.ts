import type { LlmPromptFamily } from '../../llm/promptFamily';
import type { GlossaryEntry } from '../../resources/glossary/types';

/**
 * Rule bullets injected into the shared prompt scaffolding.
 *
 * `en` / `uk` are the translate rules; the `verify*` variants add audit-only
 * bullets on top of them.
 */
export type GamePromptRules = {
  en: (targetLang: string) => string[];
  uk: () => string[];
  verifyEn?: () => string[];
  verifyUk?: () => string[];
};

/**
 * The English prompt is assembled from shared scaffolding plus these
 * per-game pieces, so a new game never edits `llm/prompts/en.ts`.
 */
export type EnglishPromptSections = {
  /** First line of the translate prompt: who the model is for this game. */
  translateRole: (targetLang: string) => string;
  /** First line of the verify prompt. */
  verifyRole: (targetLang: string) => string;
  /** Worked examples appended to the translate prompt. */
  examples: (targetLang: string) => string;
  /**
   * Whether the shared cross-game rule bullets apply. Games whose text has
   * nothing in common with the shared set (no records, no item rarities)
   * turn this off and rely on their own `rules` alone.
   */
  useCommonRules: boolean;
  /** Extra bullets under "source ↔ translation pairing mismatch" in verify. */
  pairingMismatchNotes: readonly string[];
  /** Extra bullets under "what to check during audit" in verify. */
  auditNotes: readonly string[];
};

/**
 * Prompts, rules, and terminology for one game.
 *
 * Ukrainian gets a hand-written standalone prompt per game; every other
 * target language gets the shared English scaffolding filled in with
 * {@link EnglishPromptSections}.
 */
export type GamePromptAdapter = {
  /** Human-readable title used inside prompts, e.g. `Fallout 4`. */
  label: string;
  /** Ukrainian translate prompt. `family` lets one game vary by text kind. */
  translateUk: (family?: LlmPromptFamily | null) => string;
  /** Ukrainian verify prompt. */
  verifyUk: (family?: LlmPromptFamily | null) => string;
  rules: GamePromptRules;
  english: EnglishPromptSections;
  /**
   * Classify one record's text so the game can use a different prompt per kind
   * (Fallout 4 splits dialogue, item names, prose, quests, MCM and faces).
   * Games with a single prompt leave this out.
   */
  resolveFamily?: (grup: string | null | undefined, field?: string | null) => LlmPromptFamily;
  /** Canonical EN→UK terminology for prompts and glossary seeding. */
  glossary: GlossaryEntry[];
  /**
   * Optional second LLM pass over a finished draft, e.g. FO4's Ukrainian
   * dialogue gender/register recast.
   */
  recast?: {
    prompt: string;
    /** Which target language and text family the pass applies to. */
    appliesTo: (targetLang: string, family: LlmPromptFamily) => boolean;
  };
};

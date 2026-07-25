import type { LlmTranslateOverwriteMode } from '../../data/queries';
import type { RagRetrievalOptions } from '../../../llm/rag';
import type { LlmTranslateItem } from '../../../llm/translate';
import type { DialogParticipantsRow } from '../../data/queries/dialogs';

export type TranslateBatchResult = {
  stringId: number;
  text?: string;
  error?: string;
};

export type TranslateBatchOptions = {
  srcLang: string;
  targetLang: string;
  modGame?: string | null;
  modName?: string | null;
  overwriteMode?: LlmTranslateOverwriteMode;
  rag?: RagRetrievalOptions;
  shouldCancel?: () => boolean;
  /** Aborts in-flight LLM requests when the owning job is stopped. */
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, result: TranslateBatchResult) => void;
};

export type StringRow = DialogParticipantsRow & {
  id: number;
  text_raw: string;
  text_norm: string | null;
  text_norm_nopunct: string | null;
  context: string | null;
  signature: string | null;
  path: string | null;
  edid: string | null;
  formid_hex: string | null;
  game: string;
  mod_name: string;
};

export type PreparedLlmItem = {
  stringId: number;
  sourceText: string;
  textNorm: string | null;
  textNormNopunct: string | null;
  grup: string | null;
  field: string | null;
  recordPath: string | null;
  placeholderMap: Record<string, string>;
  functionKeywordMap: Record<string, string>;
  game: string | null;
  modName: string | null;
  llmItem: LlmTranslateItem;
};

export type GlossaryEntryWithRe = {
  term: string;
  translation: string | null;
  re: RegExp;
};

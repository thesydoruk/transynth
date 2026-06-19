// Thin API client — all calls go through the same base URL
import { getSrcLang, getTgtLang } from './langDefaults';

const BASE = import.meta.env.VITE_API_URL ?? '';

const req = async <T>(path: string, init?: RequestInit): Promise<T> => {
  /* Only set Content-Type: application/json when the request carries a body.
     Fastify 5 rejects requests with Content-Type: application/json but no body
     (FST_ERR_CTP_EMPTY_JSON_BODY), which breaks DELETE / POST calls without a payload. */
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body) {
    headers['Content-Type'] ??= 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
};

/**
 * Fetches a binary file from the API and triggers a browser download.
 * Used for endpoints that return raw binary content (e.g. ZIP archives)
 * instead of JSON.
 *
 * @param path - API endpoint path
 * @param fallbackName - Filename to use if the server doesn't provide one
 */
const downloadBinary = async (path: string, fallbackName: string): Promise<void> => {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  // Extract filename from Content-Disposition header if available
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  const fileName = match?.[1] ?? fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

/** Authenticated user profile. */
export type User = {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'translator' | 'reviewer';
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** A single activity log entry returned by /api/activity. */
export type ActivityEntry = {
  id: number;
  user_id: number | null;
  username: string | null;
  display_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

/** Paginated response from /api/activity. */
export type ActivityLogResponse = {
  entries: ActivityEntry[];
  total: number;
  limit: number;
  offset: number;
};

export type Mod = {
  id: number;
  name: string;
  abs_path: string;
  version_hash: string;
  game: string;
  nexus_mod_id: number | null;
  nexus_name: string | null;
  nexus_thumbnail: string | null;
  created_at: string;
  record_count: number;
  string_count: number;
  translated_count: number;
  approved_count: number;
  fuzzy_count: number;
};

/** A single entry from GET /api/games — matches GameInfo in src/web/routes/games.ts */
export type GameInfo = {
  /** Internal game identifier: fo4 | fo76 | fo3 | fnv | ob | mw | sse | sle */
  id: string;
  /** Human-readable title, e.g. "Fallout 4" */
  name: string;
  /** Developer / studio name */
  developer: string;
  /** Original release year */
  releaseYear: number;
  /** NexusMods numeric game ID, used to build the cover image URL */
  nexusId: number;
  /**
   * NexusMods URL-safe domain name (e.g. "fallout4").
   * Used as the gameDomainName filter in NexusMods GraphQL requests.
   */
  domainName: string;
  /** Engine family label */
  engine: string;
  /** Whether the game uses localized (external .STRINGS) plugins */
  localized: boolean;
};

/**
 * A mod record returned by the NexusMods GraphQL API v2.
 * Matches NexusMod in src/nexus/types.ts (shapes are kept in sync).
 */
export type NexusModItem = {
  id: number;
  modId: number;
  uid: string;
  name: string;
  summary: string;
  description?: string;
  category?: string;
  version: string;
  status: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  downloads: number;
  endorsements: number;
  adultContent: boolean | null;
  pictureUrl: string | null;
  thumbnailUrl: string | null;
  gameId: number;
  game: { id: number; name: string; domainName: string };
  uploader: { memberId: number | null; name: string } | null;
  tags: string[];
};

/** A single attached archive/file for a Nexus mod. */
export type NexusModFile = {
  fileId: number;
  name: string;
  version: string | null;
  categoryName: string | null;
  isPrimary: boolean;
  uploadedTime: string | null;
  sizeBytes: number | null;
  fileName: string | null;
  description: string | null;
};

/** Compound response for mod details page. */
export type NexusModDetails = {
  mod: NexusModItem;
  files: NexusModFile[];
};

/** Paginated NexusMods mod search result from GET /api/games/:gameId/nexus/mods */
export type NexusModsPage = {
  totalCount: number;
  nodesCount: number;
  items: NexusModItem[];
};

/** A scored translation candidate from GET /api/games/:gameId/nexus/translations */
export type NexusTranslationCandidate = {
  mod: NexusModItem;
  /** Heuristic relevance score — higher is more likely a translation */
  score: number;
  /** Human-readable scoring reason tags, e.g. ["same-game", "title-contains-translation"] */
  reasons: string[];
};

/** Full result from GET /api/games/:gameId/nexus/translations */
export type NexusTranslationsResult = {
  sourceMod: NexusModItem;
  totalCount: number;
  nodesCount: number;
  /** Candidates sorted by score descending. Score-0 entries are excluded. */
  items: NexusTranslationCandidate[];
};

/** One Nexus mod relation entry from mod requirements data. */
export type NexusModRelationItem = {
  modId: number;
  modName: string;
  notes: string | null;
  externalRequirement: boolean;
};

/** Full relation payload for one source mod. */
export type NexusModRelationsResult = {
  sourceMod: NexusModItem;
  requires: NexusModRelationItem[];
  requiredBy: NexusModRelationItem[];
};

export type StringRow = {
  string_id: number;
  formid_hex: string;
  signature: string;
  path: string;
  edid: string | null;
  source: string;
  /** Speaker NPC name for dialog strings (INFO records). Populated at import time from ANAM. */
  context: string | null;
  translation_id: number | null;
  translation: string | null;
  status: 'draft' | 'reviewed' | 'rejected' | 'human' | 'fuzzy' | 'auto' | 'tm' | null;
  confidence: number | null;
  provenance: string | null;
  model: string | null;
  updated_at: string | null;
  qa_issue_count: number;
};

export type StringsResult = {
  rows: StringRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type DialogTopic = {
  topic_id: number;
  topic_formid_hex: string;
  topic_edid: string | null;
  node_count: number;
};

export type DialogTreeNode = {
  node_id: number;
  info_formid_hex: string;
  previous_info_formid_hex: string | null;
  speaker_formid_hex: string | null;
  speaker_name: string | null;
  string_id: number | null;
  source: string | null;
  context: string | null;
  translation_id: number | null;
  translation: string | null;
  status: 'draft' | 'reviewed' | 'rejected' | 'human' | 'fuzzy' | 'auto' | 'tm' | null;
  confidence: number | null;
  provenance: string | null;
  model: string | null;
  updated_at: string | null;
  qa_issue_count: number;
};

export type DialogTreeEdge = {
  edge_id: number;
  from_info_formid_hex: string;
  to_info_formid_hex: string;
  edge_kind: string;
  confidence: string;
};

export type DialogTreeResult = {
  nodes: DialogTreeNode[];
  edges: DialogTreeEdge[];
};

export type DialogScene = {
  scene_id: number;
  scene_formid_hex: string;
  scene_edid: string | null;
  quest_formid_hex: string | null;
  phase_count: number;
};

export type DialogConversation = {
  conversation_key: string;
  quest_formid_hex: string | null;
  sample_scene_edid: string | null;
  sample_scene_formid_hex: string;
  scene_count: number;
  phase_count: number;
};

export type SceneDialogLine = {
  scene_id: number;
  scene_formid_hex: string;
  scene_edid: string | null;
  phase_order: number;
  alias_id: number;
  topic_formid_hex: string;
  topic_edid: string | null;
  node_id: number | null;
  info_formid_hex: string | null;
  speaker_name: string | null;
  string_id: number | null;
  source: string | null;
  translation_id: number | null;
  translation: string | null;
  status: string | null;
  qa_issue_count: number;
};

export type Stats = {
  total: number;
  translated: number;
  approved: number;
  draft: number;
  rejected: number;
  tm: number;
  fuzzy: number;
  auto_translated: number;
  untranslated: number;
  percent: number;
};

export type TranslationHistoryEntry = {
  id: number;
  translation_id: number | null;
  text: string | null;
  status: string;
  provenance: string | null;
  model: string | null;
  note: string | null;
  created_at: string;
};

export type QAIssue = {
  id: number;
  issue_type: string;
  severity: 'warning' | 'error';
  message: string;
  updated_at: string;
};

export type Signature = { signature: string; count: number };

export type GlossaryEntry = {
  id: number;
  term: string;
  translation: string | null;
  src_lang: string;
  tgt_lang: string;
  source: string;
  created_at: string;
};

/** Result of a batch glossary enforcement run. */
export type GlossaryEnforceResult = { checked: number; violations: number };

/** A configurable QA validation rule (forbidden characters or max length per GRUP/field). */
export type QARule = {
  id: number;
  game: string;
  rule_type: 'forbidden_chars' | 'max_length';
  signature: string | null;
  path: string | null;
  value: string;
  severity: 'warning' | 'error';
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TMApplyResult = { applied: number; skipped: number; byMethod: Record<string, number> };

/**
 * A single string entry within a coherence group — one source string whose
 * current translation differs from at least one other string in the same group.
 */
export type CoherenceEntry = {
  string_id: number;
  source_text: string;
  text_norm: string;
  edid: string | null;
  signature: string;
  path_simplified: string;
  mod_id: number;
  mod_name: string;
  /** Game identifier for the mod — used for editor deep-links. */
  mod_game: string;
  translation_id: number | null;
  /** The current best translation for this string. */
  translation: string;
  status: string;
};

/**
 * A coherence group — all source strings sharing the same normalised text
 * that are currently translated inconsistently.
 */
export type CoherenceGroup = {
  text_norm: string;
  /** Representative raw source text for display. */
  source_text: string;
  /** Number of distinct translation variants in this group. */
  variant_count: number;
  entries: CoherenceEntry[];
};

/** Paginated coherence report returned by GET /api/coherence. */
export type CoherenceResult = {
  groups: CoherenceGroup[];
  /** Total number of inconsistency groups (before pagination). */
  total: number;
};

/**
 * One row from the review queue — a string that has been automatically
 * translated (or is a draft/fuzzy match) and needs human verification.
 */
export type ReviewQueueRow = {
  string_id: number;
  mod_id: number;
  mod_name: string;
  mod_game: string;
  formid_hex: string;
  signature: string;
  path: string;
  edid: string | null;
  source: string;
  translation_id: number;
  translation: string;
  status: string;
  /** Confidence in [0, 1] — null means unknown.  Lower = higher review priority. */
  confidence: number | null;
  model: string | null;
  qa_issue_count: number;
  /** Display name (or username) of the last human who saved this translation. Null for automated strings. */
  translator_name: string | null;
};

/** Paginated result from GET /api/review-queue. */
export type ReviewQueueResult = {
  rows: ReviewQueueRow[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * One component row within an INNR naming rule group.
 *
 * Each row represents a single INNR FormID — one component slot (e.g. material,
 * quality, item type) within a compound naming rule.  Translators must see all
 * slots of the same rule together to maintain grammatical agreement.
 */
export type InnrRow = {
  string_id: number;
  formid_hex: string;
  /** Full EDID including numeric suffix, e.g. "ArmorMaterialSteel001". */
  edid: string | null;
  source: string;
  translation_id: number | null;
  translation: string | null;
  status: string | null;
  confidence: number | null;
  qa_issue_count: number;
};

/** A group of INNR rows sharing the same base EDID prefix. */
export type InnrGroup = {
  /** Base EDID without numeric suffix, e.g. "ArmorMaterialSteel". */
  base_edid: string;
  rows: InnrRow[];
};

/** Response from GET /api/mods/:modId/innr. */
export type InnrResult = {
  mod_id: number;
  mod_name: string;
  total_rows: number;
  groups: InnrGroup[];
};

export type DashboardModRow = {
  id: number;
  name: string;
  game: string;
  total: number;
  translated: number;
  approved: number;
  draft: number;
  tm: number;
  fuzzy: number;
  auto: number;
  rejected: number;
  reviewed: number;
  qa_issues: number;
};

export type DashboardData = {
  mods: DashboardModRow[];
  qaByType: { issue_type: string; count: number }[];
  qaBySeverity: { severity: string; count: number }[];
  /** Mod IDs that currently have an active job (used for live badges in the dashboard table). */
  activeJobs: { llmModIds: number[]; importModIds: number[] };
};

/** One row from GET /api/stats/grup — translation progress for a single GRUP signature. */
export type GrupStatRow = {
  signature: string;
  total: number;
  translated: number;
  approved: number;
  draft: number;
  tm: number;
  auto: number;
};

/* ── Ops / Health dashboard types ──────────────────────────────────────── */

/** A single import job row (EET / CSV / Mod — unified). */
export type OpsImportJob = {
  id: number;
  kind: 'eet' | 'csv' | 'mod';
  file_name: string;
  status: string;
  total_records: number;
  imported_records: number;
  last_error: string | null;
  updated_at: string;
};

/** Per-model breakdown of auto-translated strings. */
export type OpsModelBreakdown = { model: string; count: number };

/** Row count + disk size for one database table. */
export type OpsTableSize = { table_name: string; row_count: number; size: string };

/**
 * Runtime configuration snapshot returned by `GET /api/settings`.
 * All values are safe to display — no secrets are included.
 */
export type SettingsPayload = {
  /** Active LLM provider: 'vllm' | 'openai'. */
  llmProvider: string;
  /** Fallback LLM provider when the primary fails: 'vllm' | 'openai' | 'none'. */
  llmFallback: string;
  /** vLLM / OpenAI-compatible server base URL. */
  vllmBaseUrl: string;
  /** vLLM model used for translation. */
  vllmModel: string;
  /** vLLM model used for embeddings. */
  vllmEmbedModel: string;
  /** Whether a vLLM API key is configured. */
  vllmApiKeyConfigured: boolean;
  /** OpenAI model name used for translation. */
  translateModel: string;
  /** OpenAI model name used for embeddings. */
  embedModel: string;
  /** Whether the OpenAI API key is configured (key itself is never sent). */
  openaiKeyConfigured: boolean;
  /** Whether the Nexus Mods personal API key is configured. */
  nexusApiKeyConfigured: boolean;
  /** Translation batch size for LLM auto-translate jobs. */
  batchSize: number;
  /** Whether multi-user authentication mode is active. */
  multiUser: boolean;
  /** Session lifetime in hours. */
  sessionLifetimeHours: number;
  /** Computed readiness snapshot used by the Settings LLM tab. */
  llmReadiness: {
    /** Overall readiness level for badges and alerts. */
    level: 'ok' | 'warn' | 'error';
    /** Whether current primary provider can translate with current config. */
    canTranslate: boolean;
    /** Per-check readiness flags. */
    checks: {
      primaryProvider: boolean;
      fallbackProvider: boolean;
      translateModel: boolean;
      embedModel: boolean;
    };
    /** Machine-readable issue codes returned by backend. */
    issues: string[];
  };
};

/** A single LLM batch-translate job row from the backend llm_jobs table. */
export type OpsLlmJob = {
  id: number;
  mod_id: number | null;
  mod_game: string | null;
  mod_name: string | null;
  string_count: number;
  done_count: number;
  /** running | completed | failed */
  status: string;
  error: string | null;
  started_at: string;
  updated_at: string;
};

/** Full response from GET /api/ops. */
export type OpsOverview = {
  system: {
    uptimeSeconds: number;
    nodeVersion: string;
    memoryRssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    dbConnected: boolean;
    dbTime: string | null;
  };
  importJobs: OpsImportJob[];
  llmJobs: OpsLlmJob[];
  llm: {
    cacheEntries: number;
    autoTranslated: number;
    byModel: OpsModelBreakdown[];
  };
  rag: {
    pgvectorAvailable: boolean;
    indexedCount: number;
    eligibleCount: number;
    embedModel: string;
    embedDimensions: number;
  };
  db: {
    totalSize: string;
    tables: OpsTableSize[];
  };
};

/* ── TradAuto (pattern-match translation rules) ───────────────────────── */

/** A single TradAuto rule row from the DB. */
export type TradAutoRule = {
  id: number;
  game: string;
  priority: number;
  pattern: string;
  replacement: string;
  signature: string | null;
  path: string | null;
  src_lang: string;
  tgt_lang: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** Result of testing rules against sample texts. */
export type TradAutoTestResult = {
  results: ({ ruleId: number; translated: string } | null)[];
};

/** Result of applying rules to a mod's untranslated strings. */
export type TradAutoApplyResult = {
  matched: number;
  saved: number;
  total: number;
  dryRun?: boolean;
  message?: string;
};

/** A discovered rule candidate from TM pattern learning. */
export type TradAutoCandidate = {
  pattern: string;
  replacement: string;
  signature: string | null;
  path: string | null;
  occurrences: number;
  examples: Array<{ source: string; target: string }>;
};

/** Result of the rule-learning discovery endpoint. */
export type TradAutoLearnResult = {
  candidates: TradAutoCandidate[];
};

export type ExportedStringsFile = {
  fileName: string;
  size: number;
  contentBase64: string;
};

export type ExportStringsResult = {
  modId: number;
  srcLang: string;
  targetLang: string;
  files: ExportedStringsFile[];
};

export type DiffEntry = {
  formid_hex: string;
  path: string;
  signature: string;
  edid: string | null;
  source: string;
  translation: string | null;
  status: string | null;
  changeType: 'added' | 'removed' | 'changed' | 'unchanged';
};

export type DiffResult = {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffEntry[];
  unchanged: number;
};

/** Result of carrying over translations from an old mod version to a new one */
export type CarryOverResult = {
  carried: number;
  needsReview: number;
  skipped: number;
};

/** Result of applying imported mod strings as translations on another mod. */
export type ApplyImportedResult = {
  applied: number;
  skipped: number;
  unmatched: number;
  empty: number;
};

/** Result of deleting all imported rows for a mod while keeping the mod entry. */
export type ClearModRowsResult = {
  ok: boolean;
  deletedRecords: number;
};

/**
 * One row from GET /api/mods/:id/previous-versions.
 * Represents an older version of the same mod (same name, different file hash).
 */
export type PreviousVersionRow = {
  id: number;
  name: string;
  version_hash: string;
  created_at: string;
  total_strings: number;
  translated_strings: number;
};

/** Statistics for the translation memory for a given language pair. */
export type TmxStats = {
  totalStrings: number;
  translatedStrings: number;
  /** Coverage percentage in the range 0–100 with one decimal place (e.g. 82.7). */
  coverage: number;
  byStatus: { human: number; tm: number; fuzzy: number; auto: number; draft: number };
};

/** Result of importing a TMX file into the translation memory */
export type TmxImportResult = {
  parsed: number;
  imported: number;
  skipped: number;
};

export type SearchReplaceMatch = {
  translationId: number;
  stringId: number;
  formid_hex: string;
  path: string;
  originalText: string;
  newText: string;
};

export type EetImportJob = {
  id: number;
  file_name: string;
  file_hash: string;
  mod_id: number | null;
  total_records: number;
  imported_records: number;
  status: string;
  src_lang: string;
  tgt_lang: string;
  /** Error message stored when status transitions to 'failed'. Null otherwise. */
  last_error: string | null;
  created_at: string;
  updated_at: string;
  running: boolean;
};

export type EetProgressEvent = { type: 'progress'; imported: number; total: number; jobId: number };
export type EetDoneEvent = { type: 'done'; job: EetImportJob };
export type EetErrorEvent = { type: 'error'; error: string };

export type EetPreviewRow = {
  signature: string;
  formId: string;
  edid: string;
  field: string;
  source: string;
  target: string;
  status: number;
};

export type EetPreviewResult = {
  rows: EetPreviewRow[];
  total: number;
  page: number;
  pageSize: number;
  signatures: string[];
};

export type CsvImportJob = {
  id: number;
  file_name: string;
  file_hash: string;
  mod_id: number | null;
  total_records: number;
  imported_records: number;
  status: string;
  src_lang: string;
  tgt_lang: string;
  created_at: string;
  updated_at: string;
  running: boolean;
};

export type CsvProgressEvent = { type: 'progress'; imported: number; total: number; jobId: number };
export type CsvDoneEvent = { type: 'done'; job: CsvImportJob };
export type CsvErrorEvent = { type: 'error'; error: string };

export type CsvPreviewRow = {
  signature: string;
  formId: string;
  edid: string;
  field: string;
  source: string;
  target: string;
  status: number;
};

export type CsvPreviewResult = {
  rows: CsvPreviewRow[];
  total: number;
  page: number;
  pageSize: number;
  signatures: string[];
};

export type ModImportJob = {
  id: number;
  file_name: string;
  file_hash: string;
  mod_id: number | null;
  total_records: number;
  imported_records: number;
  status: string;
  src_lang: string;
  tgt_lang: string;
  is_localized: number;
  game: 'fo4' | 'fo76' | 'fo3' | 'fnv' | 'ob' | 'mw' | 'sse' | 'sle';
  esp_path: string | null;
  created_at: string;
  updated_at: string;
  running: boolean;
};

export type ModImportDeleteDataMode = 'job' | 'rows' | 'mod';

export type ModImportLocaleInfo = {
  jobId: number;
  modId: number | null;
  currentSrcLang: string;
  storedLangs: string[];
  availableLocales: string[];
  isLocalized: boolean;
  stringCount: number;
};

export type ChangeModImportLocaleResult = {
  modId: number;
  jobId: number;
  oldLang: string;
  newLang: string;
  stringsUpdated: number;
  translationsUpdated: number;
};

export type ModProgressEvent = { type: 'progress'; imported: number; total: number; jobId: number };
export type UploadProgressEvent = { loaded: number; total: number; percent: number };

export type ModPreviewRow = {
  formId: string;
  signature: string;
  edid: string;
  path: string;
  source: string;
};

export type ModPreviewResult = {
  rows: ModPreviewRow[];
  total: number;
  page: number;
  pageSize: number;
  signatures: string[];
  locales: string[];
  isLocalized: boolean;
};

export type ProgressEvent = {
  type: 'progress';
  done: number;
  total: number;
  result: { stringId: number; text?: string; error?: string };
};
export type DoneEvent = {
  type: 'done';
  results: Array<{ stringId: number; text?: string; error?: string }>;
};

// ── Mods ──────────────────────────────────────────────────────────────────────

export type TMSuggestion = {
  id: number;
  text: string;
  status: string;
  confidence: number | null;
  provenance: string | null;
  source_text: string;
  match_method: 'exact' | 'numeric' | 'punct_norm' | 'fuzzy' | 'segment';
  similarity: number;
};

export const api = {
  mods: {
    list: (game?: string, srcLang = getSrcLang(), targetLang = getTgtLang()) => {
      const params = new URLSearchParams({ srcLang, targetLang });
      if (game) params.set('game', game);
      return req<Mod[]>(`/api/mods?${params}`);
    },
    get: (id: number) => req<Mod & { stats: Stats }>(`/api/mods/${id}`),
    clearRows: (modId: number) =>
      req<ClearModRowsResult>(`/api/mods/${modId}/rows`, { method: 'DELETE' }),
    langs: (id: number) => req<string[]>(`/api/mods/${id}/langs`),
    tmApply: (modId: number, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
      req<TMApplyResult>(
        `/api/mods/${modId}/tm-apply?srcLang=${srcLang}&targetLang=${targetLang}`,
        { method: 'POST' },
      ),
    diff: (newModId: number, compareModId: number, targetLang = getTgtLang()) =>
      req<DiffResult>(
        `/api/mods/${newModId}/diff?compareModId=${compareModId}&targetLang=${targetLang}`,
      ),
    exportStrings: (modId: number, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
      req<ExportStringsResult>(
        `/api/mods/${modId}/export/strings?srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
      ),
    exportEsp: (modId: number, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
      req<ExportStringsResult>(
        `/api/mods/${modId}/export/esp?srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
      ),
    exportBa2: (modId: number, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
      req<ExportStringsResult>(
        `/api/mods/${modId}/export/ba2?srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
      ),
    /** Downloads a complete project ZIP (BA2 + patched ESP) as a single file */
    exportProject: (modId: number, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
      downloadBinary(
        `/api/mods/${modId}/export/project?srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
        `mod_${modId}_${targetLang}.zip`,
      ),
    /** Copy translations from an older mod version into a newer one */
    carryOver: (newModId: number, fromModId: number, targetLang = getTgtLang()) =>
      req<CarryOverResult>(
        `/api/mods/${newModId}/carry-over?fromModId=${fromModId}&targetLang=${encodeURIComponent(targetLang)}`,
        { method: 'POST' },
      ),
    /** Apply imported raw strings (e.g. RU translation mod) to a base mod as translations */
    applyImported: (
      targetModId: number,
      fromModId: number,
      importedLang: string,
      srcLang = getSrcLang(),
      targetLang = getTgtLang(),
    ) =>
      req<ApplyImportedResult>(
        `/api/mods/${targetModId}/apply-imported?fromModId=${fromModId}` +
          `&importedLang=${encodeURIComponent(importedLang)}` +
          `&srcLang=${encodeURIComponent(srcLang)}` +
          `&targetLang=${encodeURIComponent(targetLang)}`,
        { method: 'POST' },
      ),
    /** List older versions (same mod name, different file hash) for a given mod ID */
    previousVersions: (modId: number) =>
      req<PreviousVersionRow[]>(`/api/mods/${modId}/previous-versions`),
    bulkReview: (
      modId: number,
      stringIds: number[],
      status: 'reviewed' | 'rejected',
      targetLang = getTgtLang(),
    ) =>
      req<{ updated: number }>(`/api/mods/${modId}/bulk-review`, {
        method: 'PATCH',
        body: JSON.stringify({ stringIds, status, targetLang }),
      }),
  },

  stats: {
    mod: (modId: number) => req<Stats>(`/api/stats?modId=${modId}`),
    global: () => req<Array<Mod & { stats: Stats }>>('/api/stats/global'),
    dashboard: () => req<DashboardData>('/api/stats/dashboard'),
    grup: (modId: number, lang = getTgtLang()) =>
      req<GrupStatRow[]>(`/api/stats/grup?modId=${modId}&lang=${lang}`),
  },

  ops: {
    overview: () => req<OpsOverview>('/api/ops'),
    reindexRag: () =>
      req<{ indexed: number; skipped: number; failed: number; total: number }>(
        '/api/ops/rag/reindex',
        { method: 'POST' },
      ),
  },

  strings: {
    list: (params: {
      modId: number;
      srcLang?: string;
      targetLang?: string;
      status?: string;
      qaOnly?: boolean;
      signature?: string;
      q?: string;
      grup?: string;
      formid?: string;
      edid?: string;
      field?: string;
      src?: string;
      transl?: string;
      hideIgnored?: boolean;
      page?: number;
      pageSize?: number;
      sort?: string;
      order?: 'asc' | 'desc';
    }) => {
      const qs = new URLSearchParams();
      qs.set('modId', String(params.modId));
      if (params.srcLang) qs.set('srcLang', params.srcLang);
      if (params.targetLang) qs.set('targetLang', params.targetLang);
      if (params.status) qs.set('status', params.status);
      if (params.qaOnly) qs.set('qaOnly', '1');
      if (params.signature) qs.set('signature', params.signature);
      if (params.q) qs.set('q', params.q);
      if (params.grup) qs.set('grup', params.grup);
      if (params.formid) qs.set('formid', params.formid);
      if (params.edid) qs.set('edid', params.edid);
      if (params.field) qs.set('field', params.field);
      if (params.src) qs.set('src', params.src);
      if (params.transl) qs.set('transl', params.transl);
      if (params.hideIgnored) qs.set('hideIgnored', '1');
      if (params.page) qs.set('page', String(params.page));
      if (params.pageSize) qs.set('pageSize', String(params.pageSize));
      if (params.sort) qs.set('sort', params.sort);
      if (params.order) qs.set('order', params.order);
      return req<StringsResult>(`/api/strings?${qs}`);
    },
    signatures: (modId: number, srcLang?: string) => {
      const qs = new URLSearchParams({ modId: String(modId) });
      if (srcLang) qs.set('srcLang', srcLang);
      return req<Signature[]>(`/api/strings/signatures?${qs}`);
    },
    suggestions: (stringId: number, targetLang: string) =>
      req<TMSuggestion[]>(
        `/api/strings/${stringId}/suggestions?targetLang=${encodeURIComponent(targetLang)}`,
      ),
    saveTranslation: (
      stringId: number,
      text: string,
      status: 'draft' | 'reviewed' | 'rejected' | 'human' | 'fuzzy' | 'auto' | 'tm' = 'draft',
      targetLang = getTgtLang(),
    ) =>
      req<{ id: number; text: string; status: string }>(`/api/strings/${stringId}/translation`, {
        method: 'PATCH',
        body: JSON.stringify({ text, status, targetLang }),
      }),
    clearTranslation: (stringId: number, targetLang = getTgtLang()) =>
      req<{ removed: number }>(
        `/api/strings/${stringId}/translation?targetLang=${encodeURIComponent(targetLang)}`,
        {
          method: 'DELETE',
        },
      ),
    updateStatus: (stringId: number, translationId: number, status: string) =>
      req<{ ok: boolean }>(`/api/strings/${stringId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ translationId, status }),
      }),
    history: (stringId: number, targetLang = getTgtLang()) =>
      req<TranslationHistoryEntry[]>(
        `/api/strings/${stringId}/history?targetLang=${encodeURIComponent(targetLang)}`,
      ),
    qa: (stringId: number, targetLang = getTgtLang()) =>
      req<QAIssue[]>(`/api/strings/${stringId}/qa?targetLang=${encodeURIComponent(targetLang)}`),

    /** Toggle the is_ignored flag on a source string. */
    setIgnored: (stringId: number, ignore: boolean) =>
      req<{ id: number; is_ignored: boolean }>(`/api/strings/${stringId}/ignore`, {
        method: 'PATCH',
        body: JSON.stringify({ ignore }),
      }),

    /** SSE-streaming batch translate. Calls onProgress for each completed string.
     *  Returns final results array after stream closes. */
    async batchTranslate(
      stringIds: number[],
      srcLang = getSrcLang(),
      targetLang = getTgtLang(),
      onProgress?: (e: ProgressEvent) => void,
      modId?: number,
    ): Promise<Array<{ stringId: number; text?: string; error?: string }>> {
      const response = await fetch(`${BASE}/api/strings/translate`, {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stringIds, srcLang, targetLang, modId }),
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let results: Array<{ stringId: number; text?: string; error?: string }> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as ProgressEvent | DoneEvent;
            if (event.type === 'progress' && onProgress) onProgress(event);
            if (event.type === 'done') results = event.results;
          } catch {
            // ignore malformed SSE line
          }
        }
      }
      return results;
    },
  },

  search: {
    replace: (
      modId: number,
      body: {
        search: string;
        replace: string;
        isRegex?: boolean;
        targetLang?: string;
        dryRun?: boolean;
      },
    ) =>
      req<{ matches: SearchReplaceMatch[]; applied: number }>(`/api/mods/${modId}/search-replace`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  dialogs: {
    topics: (modId: number) => req<DialogTopic[]>(`/api/dialogs/topics?modId=${modId}`),
    tree: (topicId: number, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
      req<DialogTreeResult>(
        `/api/dialogs/tree?topicId=${topicId}&srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
      ),
    scenes: (modId: number) => req<DialogScene[]>(`/api/dialogs/scenes?modId=${modId}`),
    conversations: (modId: number) =>
      req<DialogConversation[]>(`/api/dialogs/conversations?modId=${modId}`),
    sceneDialog: (sceneId: number, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
      req<SceneDialogLine[]>(
        `/api/dialogs/scene?sceneId=${sceneId}&srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
      ),
    conversationDialog: (
      modId: number,
      key: string,
      srcLang = getSrcLang(),
      targetLang = getTgtLang(),
    ) =>
      req<SceneDialogLine[]>(
        `/api/dialogs/conversation?modId=${modId}&key=${encodeURIComponent(key)}&srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
      ),
  },

  glossary: {
    list: (params?: { srcLang?: string; tgtLang?: string; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.srcLang) qs.set('srcLang', params.srcLang);
      if (params?.tgtLang) qs.set('tgtLang', params.tgtLang);
      if (params?.q) qs.set('q', params.q);
      return req<GlossaryEntry[]>(`/api/glossary?${qs}`);
    },
    add: (
      term: string,
      translation: string | null,
      srcLang = getSrcLang(),
      tgtLang = getTgtLang(),
    ) =>
      req<GlossaryEntry>('/api/glossary', {
        method: 'POST',
        body: JSON.stringify({ term, translation, srcLang, tgtLang }),
      }),
    update: (id: number, term: string, translation: string | null) =>
      req<GlossaryEntry>(`/api/glossary/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ term, translation }),
      }),
    remove: (id: number) => req<{ ok: boolean }>(`/api/glossary/${id}`, { method: 'DELETE' }),

    /** Batch-enforce glossary terms as QA rules across translated strings. */
    enforce: (opts?: { modId?: number; targetLang?: string }) =>
      req<GlossaryEnforceResult>('/api/glossary/enforce', {
        method: 'POST',
        body: JSON.stringify(opts ?? {}),
      }),
  },

  eet: {
    list: () => req<EetImportJob[]>('/api/eet'),

    upload: async (file: File): Promise<EetImportJob> => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${BASE}/api/eet/upload`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<EetImportJob>;
    },

    startImport(
      jobId: number,
      onProgress?: (e: EetProgressEvent) => void,
    ): { promise: Promise<EetImportJob>; abort: AbortController } {
      const ctrl = new AbortController();

      const promise = (async () => {
        const res = await fetch(`${BASE}/api/eet/${jobId}/import`, {
          signal: ctrl.signal,
          credentials: 'include',
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let result: EetImportJob | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'progress' && onProgress) onProgress(ev);
              if (ev.type === 'done') result = ev.job;
              if (ev.type === 'error') throw new Error(ev.error);
            } catch (e) {
              if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
            }
          }
        }
        if (!result) throw new Error('Stream ended without done event');
        return result;
      })();

      return { promise, abort: ctrl };
    },

    pause: (jobId: number) => req<{ ok: boolean }>(`/api/eet/${jobId}/pause`, { method: 'POST' }),
    cancel: (jobId: number) => req<{ ok: boolean }>(`/api/eet/${jobId}/cancel`, { method: 'POST' }),
    remove: (jobId: number) => req<{ ok: boolean }>(`/api/eet/${jobId}`, { method: 'DELETE' }),

    updateLanguages: (jobId: number, srcLang: string, tgtLang: string) =>
      req<EetImportJob>(`/api/eet/${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify({ srcLang, tgtLang }),
      }),

    preview: (
      jobId: number,
      params?: { page?: number; pageSize?: number; signature?: string; q?: string },
    ) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
      if (params?.signature) qs.set('signature', params.signature);
      if (params?.q) qs.set('q', params.q);
      return req<EetPreviewResult>(`/api/eet/${jobId}/preview?${qs}`);
    },
  },

  csv: {
    list: () => req<CsvImportJob[]>('/api/csv'),

    upload: async (file: File): Promise<CsvImportJob> => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${BASE}/api/csv/upload`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<CsvImportJob>;
    },

    startImport(
      jobId: number,
      onProgress?: (e: CsvProgressEvent) => void,
    ): { promise: Promise<CsvImportJob>; abort: AbortController } {
      const ctrl = new AbortController();

      const promise = (async () => {
        const res = await fetch(`${BASE}/api/csv/${jobId}/import`, {
          signal: ctrl.signal,
          credentials: 'include',
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let result: CsvImportJob | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'progress' && onProgress) onProgress(ev);
              if (ev.type === 'done') result = ev.job;
              if (ev.type === 'error') throw new Error(ev.error);
            } catch (e) {
              if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
            }
          }
        }
        if (!result) throw new Error('Stream ended without done event');
        return result;
      })();

      return { promise, abort: ctrl };
    },

    pause: (jobId: number) => req<{ ok: boolean }>(`/api/csv/${jobId}/pause`, { method: 'POST' }),
    cancel: (jobId: number) => req<{ ok: boolean }>(`/api/csv/${jobId}/cancel`, { method: 'POST' }),
    remove: (jobId: number) => req<{ ok: boolean }>(`/api/csv/${jobId}`, { method: 'DELETE' }),

    updateLanguages: (jobId: number, srcLang: string, tgtLang: string) =>
      req<CsvImportJob>(`/api/csv/${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify({ srcLang, tgtLang }),
      }),

    preview: (
      jobId: number,
      params?: { page?: number; pageSize?: number; signature?: string; q?: string },
    ) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
      if (params?.signature) qs.set('signature', params.signature);
      if (params?.q) qs.set('q', params.q);
      return req<CsvPreviewResult>(`/api/csv/${jobId}/preview?${qs}`);
    },
  },

  modImport: {
    list: () => req<ModImportJob[]>('/api/mod-import'),

    upload: async (
      file: File,
      options?: {
        game?: 'fo4' | 'fo76' | 'fo3' | 'fnv' | 'ob' | 'mw' | 'sse' | 'sle';
        srcLang?: string;
        tgtLang?: string;
      },
      onUploadProgress?: (event: UploadProgressEvent) => void,
      onExtractingStart?: () => void,
    ): Promise<ModImportJob> => {
      const qs = new URLSearchParams();
      if (options?.game) qs.set('game', options.game);
      if (options?.srcLang) qs.set('srcLang', options.srcLang);
      if (options?.tgtLang) qs.set('tgtLang', options.tgtLang);
      const form = new FormData();
      form.append('file', file);
      const url = `${BASE}/api/mod-import/upload${qs.toString() ? '?' + qs : ''}`;
      return await new Promise<ModImportJob>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.withCredentials = true;

        xhr.upload.onprogress = (e) => {
          if (!onUploadProgress || !e.lengthComputable) return;
          const total = e.total || file.size || 1;
          const percent = Math.max(0, Math.min(100, Math.round((e.loaded / total) * 100)));
          onUploadProgress({ loaded: e.loaded, total, percent });
        };

        xhr.upload.onload = () => {
          onExtractingStart?.();
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));

        xhr.onload = () => {
          let body: unknown = {};
          try {
            body = xhr.responseText ? (JSON.parse(xhr.responseText) as unknown) : {};
          } catch {
            body = {};
          }

          if (xhr.status < 200 || xhr.status >= 300) {
            const message = (body as { error?: string }).error ?? `HTTP ${xhr.status}`;
            reject(new Error(message));
            return;
          }

          resolve(body as ModImportJob);
        };

        xhr.send(form);
      });
    },

    startImport(
      jobId: number,
      onProgress?: (e: ModProgressEvent) => void,
    ): { promise: Promise<ModImportJob>; abort: AbortController } {
      const ctrl = new AbortController();

      const promise = (async () => {
        const res = await fetch(`${BASE}/api/mod-import/${jobId}/import`, {
          signal: ctrl.signal,
          credentials: 'include',
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let result: ModImportJob | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'progress' && onProgress) onProgress(ev);
              if (ev.type === 'done') result = ev.job;
              if (ev.type === 'error') throw new Error(ev.error);
            } catch (e) {
              if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
            }
          }
        }
        if (!result) throw new Error('Stream ended without done event');
        return result;
      })();

      return { promise, abort: ctrl };
    },

    pause: (jobId: number) =>
      req<{ ok: boolean }>(`/api/mod-import/${jobId}/pause`, { method: 'POST' }),
    cancel: (jobId: number) =>
      req<{ ok: boolean }>(`/api/mod-import/${jobId}/cancel`, { method: 'POST' }),
    remove: (jobId: number, deleteData: ModImportDeleteDataMode = 'mod') =>
      req<{ ok: boolean }>(`/api/mod-import/${jobId}?deleteData=${deleteData}`, {
        method: 'DELETE',
      }),
    restart: (jobId: number) =>
      req<ModImportJob>(`/api/mod-import/${jobId}/restart`, { method: 'POST' }),

    updateLanguages: (jobId: number, srcLang: string, tgtLang: string) =>
      req<ModImportJob>(`/api/mod-import/${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify({ srcLang, tgtLang }),
      }),

    preview: (
      jobId: number,
      params?: { page?: number; pageSize?: number; signature?: string; q?: string },
    ) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
      if (params?.signature) qs.set('signature', params.signature);
      if (params?.q) qs.set('q', params.q);
      return req<ModPreviewResult>(`/api/mod-import/${jobId}/preview?${qs}`);
    },
  },

  /** TMX (Translation Memory eXchange) import/export */
  tmx: {
    /** Download TMX export as a file. modId is optional — omit for global export. */
    exportFile: (srcLang = getSrcLang(), targetLang = getTgtLang(), modId?: number) => {
      const qs = new URLSearchParams({ srcLang, targetLang });
      if (modId != null) qs.set('modId', String(modId));
      return downloadBinary(`/api/tmx/export?${qs}`, `tm_${targetLang}.tmx`);
    },
    /** Returns TM statistics (total strings, translated, coverage %) for the given language pair. */
    stats: (srcLang = getSrcLang(), targetLang = getTgtLang()) => {
      const qs = new URLSearchParams({ srcLang, targetLang });
      return req<TmxStats>(`/api/tmx/stats?${qs}`);
    },
    /** Upload a TMX file for import. modId is optional — omit for global match. */
    importFile: async (file: File, modId?: number): Promise<TmxImportResult> => {
      const form = new FormData();
      form.append('file', file);
      const qs = modId != null ? `?modId=${modId}` : '';
      const res = await fetch(`${BASE}/api/tmx/import${qs}`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<TmxImportResult>;
    },
  },

  /** Auth, users, and activity log */
  auth: {
    /** Returns whether multi-user mode is enabled */
    mode: () => req<{ multiUser: boolean }>('/api/auth/mode'),
    /** Returns the current authenticated user (or default admin in single-user mode) */
    me: () => req<User>('/api/auth/me'),
    /** Logs in with username and password. Sets a session cookie on success. */
    login: (username: string, password: string) =>
      req<User>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    /** Logs out and clears the session cookie. */
    logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  },

  users: {
    /** Lists all users */
    list: () => req<User[]>('/api/users'),
    /** Creates a new user (admin only) */
    create: (data: { username: string; display_name: string; password: string; role: string }) =>
      req<User>('/api/users', { method: 'POST', body: JSON.stringify(data) }),
    /** Updates a user's profile (admin only) */
    update: (id: number, data: { display_name?: string; role?: string; is_active?: boolean }) =>
      req<User>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    /** Changes a user's password */
    changePassword: (id: number, new_password: string) =>
      req<{ ok: boolean }>(`/api/users/${id}/password`, {
        method: 'POST',
        body: JSON.stringify({ new_password }),
      }),
  },

  activity: {
    /** Fetches paginated activity log entries */
    list: (params?: {
      limit?: number;
      offset?: number;
      userId?: number;
      action?: string;
      entityType?: string;
      entityId?: number;
      dateFrom?: string;
      dateTo?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.offset) qs.set('offset', String(params.offset));
      if (params?.userId) qs.set('userId', String(params.userId));
      if (params?.action) qs.set('action', params.action);
      if (params?.entityType) qs.set('entityType', params.entityType);
      if (params?.entityId) qs.set('entityId', String(params.entityId));
      if (params?.dateFrom) qs.set('dateFrom', params.dateFrom);
      if (params?.dateTo) qs.set('dateTo', params.dateTo);
      return req<ActivityLogResponse>(`/api/activity?${qs}`);
    },
    /**
     * Triggers a CSV download of the filtered activity log (max 10 000 rows).
     * Uses fetch + Blob so that auth cookies are included automatically.
     */
    csvDownload: async (params?: {
      action?: string;
      entityType?: string;
      entityId?: number;
      dateFrom?: string;
      dateTo?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params?.action) qs.set('action', params.action);
      if (params?.entityType) qs.set('entityType', params.entityType);
      if (params?.entityId) qs.set('entityId', String(params.entityId));
      if (params?.dateFrom) qs.set('dateFrom', params.dateFrom);
      if (params?.dateTo) qs.set('dateTo', params.dateTo);
      const res = await fetch(`/api/activity/csv?${qs}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`CSV export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'activity.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  },

  /** Configurable QA validation rules (forbidden characters, max length per GRUP/field). */
  qaRules: {
    list: (params?: { game?: string; ruleType?: string; isActive?: string }) => {
      const qs = new URLSearchParams();
      if (params?.game) qs.set('game', params.game);
      if (params?.ruleType) qs.set('ruleType', params.ruleType);
      if (params?.isActive) qs.set('isActive', params.isActive);
      return req<QARule[]>(`/api/qa-rules?${qs}`);
    },
    get: (id: number) => req<QARule>(`/api/qa-rules/${id}`),
    create: (data: Omit<QARule, 'id' | 'created_at' | 'updated_at'>) =>
      req<QARule>('/api/qa-rules', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Omit<QARule, 'id' | 'created_at' | 'updated_at'>>) =>
      req<QARule>(`/api/qa-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: boolean }>(`/api/qa-rules/${id}`, { method: 'DELETE' }),
  },

  /** TradAuto — pattern-match automatic translation rules. */
  tradAuto: {
    list: (params?: { game?: string; srcLang?: string; tgtLang?: string }) => {
      const qs = new URLSearchParams();
      if (params?.game) qs.set('game', params.game);
      if (params?.srcLang) qs.set('srcLang', params.srcLang);
      if (params?.tgtLang) qs.set('tgtLang', params.tgtLang);
      return req<TradAutoRule[]>(`/api/tradauto?${qs}`);
    },
    get: (id: number) => req<TradAutoRule>(`/api/tradauto/${id}`),
    create: (data: Omit<TradAutoRule, 'id' | 'created_at' | 'updated_at'>) =>
      req<TradAutoRule>('/api/tradauto', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Omit<TradAutoRule, 'id' | 'created_at' | 'updated_at'>>) =>
      req<TradAutoRule>(`/api/tradauto/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: boolean }>(`/api/tradauto/${id}`, { method: 'DELETE' }),
    test: (texts: string[], game?: string, srcLang?: string, tgtLang?: string) =>
      req<TradAutoTestResult>('/api/tradauto/test', {
        method: 'POST',
        body: JSON.stringify({ texts, game, srcLang, tgtLang }),
      }),
    apply: (modId: number, dryRun = false, targetLang = getTgtLang()) =>
      req<TradAutoApplyResult>(`/api/tradauto/apply/${modId}`, {
        method: 'POST',
        body: JSON.stringify({ dryRun, targetLang }),
      }),
    learn: (opts?: {
      game?: string;
      srcLang?: string;
      tgtLang?: string;
      minOccurrences?: number;
      limit?: number;
    }) =>
      req<TradAutoLearnResult>('/api/tradauto/learn', {
        method: 'POST',
        body: JSON.stringify(opts ?? {}),
      }),
  },

  /**
   * Coherence checking — source strings that share the same normalised text
   * but have different translations across strings/mods.
   */
  coherence: {
    /**
     * Returns a paginated coherence report.
     * Groups are ordered by variant_count DESC (most conflicted first).
     */
    list: (params?: { targetLang?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.targetLang) qs.set('targetLang', params.targetLang);
      if (params?.limit !== undefined) qs.set('limit', String(params.limit));
      if (params?.offset !== undefined) qs.set('offset', String(params.offset));
      return req<CoherenceResult>(`/api/coherence?${qs}`);
    },
    /**
     * Resolves a coherence group by propagating a single chosen translation
     * to all strings in the group that currently have a different translation.
     */
    resolve: (textNorm: string, translation: string, targetLang = getTgtLang()) =>
      req<{ updated: number }>('/api/coherence/resolve', {
        method: 'POST',
        body: JSON.stringify({ textNorm, translation, targetLang }),
      }),
    /**
     * Auto-resolves all inconsistency groups for the target language in one pass.
     * The most-used translation wins per group; ties are broken by status quality.
     */
    resolveAll: (targetLang = getTgtLang()) =>
      req<{ resolved: number; updated: number }>('/api/coherence/resolve-all', {
        method: 'POST',
        body: JSON.stringify({ targetLang }),
      }),
  },

  /**
   * Review queue — cross-mod list of translations that need human review,
   * sorted by confidence ascending (least certain first).
   */
  reviewQueue: {
    /**
     * Returns a paginated list of strings awaiting review.
     * Defaults: statuses = [auto, fuzzy, tm, draft], all mods, no confidence ceiling.
     */
    list: (params?: {
      targetLang?: string;
      statuses?: string[];
      modId?: number;
      maxConfidence?: number;
      page?: number;
      pageSize?: number;
    }) => {
      const qs = new URLSearchParams();
      if (params?.targetLang) qs.set('targetLang', params.targetLang);
      if (params?.statuses?.length) qs.set('statuses', params.statuses.join(','));
      if (params?.modId !== undefined) qs.set('modId', String(params.modId));
      if (params?.maxConfidence !== undefined)
        qs.set('maxConfidence', String(params.maxConfidence));
      if (params?.page !== undefined) qs.set('page', String(params.page));
      if (params?.pageSize !== undefined) qs.set('pageSize', String(params.pageSize));
      return req<ReviewQueueResult>(`/api/review-queue?${qs}`);
    },
  },

  /**
   * INNR editor — Instance Naming Rules grouped by base EDID for a single mod.
   */
  innr: {
    /**
     * Returns all INNR strings for a mod, grouped by base EDID prefix.
     * Translators see all naming rule slots together for grammatical agreement.
     */
    list: (modId: number, params?: { targetLang?: string; srcLang?: string }) => {
      const qs = new URLSearchParams();
      if (params?.targetLang) qs.set('targetLang', params.targetLang);
      if (params?.srcLang) qs.set('srcLang', params.srcLang);
      return req<InnrResult>(`/api/mods/${modId}/innr?${qs}`);
    },
  },

  /**
   * Project settings — exposes active runtime configuration (read-only).
   * All sensitive values (API keys, DB URL) are omitted on the server side.
   */
  settings: {
    /** Returns the current server configuration snapshot. */
    get: () => req<SettingsPayload>('/api/settings'),
  },

  /** Project-level workflow and QA settings stored in the database. */
  projectSettings: {
    /** Returns all project settings merged with built-in defaults. */
    getAll: () => req<Record<string, unknown>>('/api/project-settings'),
    /** Updates a single project setting by key. */
    update: (key: string, value: boolean | number) =>
      req<{ key: string; value: boolean | number }>(
        `/api/project-settings/${encodeURIComponent(key)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ value }),
        },
      ),
  },

  /**
   * Supported games catalogue.
   * Cover images are served by the backend which fetches from NexusMods CDN
   * and caches to disk on first request.
   */
  games: {
    /** Returns all supported games as a JSON array. */
    list: () => req<GameInfo[]>('/api/games'),
    /** Returns the URL for a game's cover image (served via backend cache). */
    coverUrl: (gameId: string) => `${BASE}/api/games/cover/${gameId}`,
    /**
     * Searches NexusMods for mods in a specific game.
     * Requires NEXUS_API_KEY to be configured on the server.
     *
     * @param gameId  - Internal game ID (e.g. "fo4")
     * @param query   - Search query (mod title / keywords)
     * @param count   - Max results per page (default 20, max 50)
     * @param offset  - Zero-based result offset for pagination
     */
    searchMods: (gameId: string, query: string, count = 20, offset = 0) =>
      req<NexusModsPage>(
        `/api/games/${encodeURIComponent(gameId)}/nexus/mods?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}`,
      ),
    /**
     * Loads one mod with full metadata and all attached files.
     *
     * @param gameId - Internal game ID (e.g. "fo4")
     * @param modId  - Nexus public mod ID
     */
    modDetails: (gameId: string, modId: number) =>
      req<NexusModDetails>(`/api/games/${encodeURIComponent(gameId)}/nexus/mod/${modId}`),
    /** Downloads a Nexus file through the backend proxy. */
    downloadModFile: (gameId: string, modId: number, fileId: number, fallbackName: string) =>
      downloadBinary(
        `/api/games/${encodeURIComponent(gameId)}/nexus/mod/${modId}/file/${fileId}/download`,
        fallbackName,
      ),
    /** Downloads a Nexus file to the server and creates a mod import job. */
    importModFile: (
      gameId: string,
      modId: number,
      fileId: number,
      srcLang = getSrcLang(),
      tgtLang = getTgtLang(),
    ) =>
      req<ModImportJob>(
        `/api/games/${encodeURIComponent(gameId)}/nexus/mod/${modId}/file/${fileId}/import`,
        {
          method: 'POST',
          body: JSON.stringify({ srcLang, tgtLang }),
        },
      ),
    /**
     * Loads official Nexus requirement relations for one mod.
     *
     * @param gameId - Internal game ID (e.g. "fo4")
     * @param modId  - Nexus public mod ID
     * @param count  - Max items per relation list (default 100, max 200)
     */
    modRelations: (gameId: string, modId: number, count = 100) =>
      req<NexusModRelationsResult>(
        `/api/games/${encodeURIComponent(gameId)}/nexus/mod/${modId}/relations?count=${count}`,
      ),
    /**
     * Finds heuristically ranked translation candidates for a mod.
     * Requires NEXUS_API_KEY to be configured on the server.
     *
     * @param gameId   - Internal game ID (e.g. "fo4")
     * @param modId    - NexusMods public mod ID of the source mod
     * @param language - Optional language filter (e.g. "ukrainian", "russian")
     * @param count    - Max raw candidates to score (default 50, max 100)
     */
    findTranslations: (gameId: string, modId: number, language?: string, count = 50) => {
      const params = new URLSearchParams({ modId: String(modId), count: String(count) });
      if (language) params.set('language', language);
      return req<NexusTranslationsResult>(
        `/api/games/${encodeURIComponent(gameId)}/nexus/translations?${params.toString()}`,
      );
    },
  },
};

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
  /** vLLM / OpenAI-compatible server base URL (legacy single-server display). */
  vllmBaseUrl: string;
  /** Configured vLLM chat servers. */
  vllmServers: Array<{
    host: string;
    maxParallel: number;
    apiKeyConfigured: boolean;
  }>;
  /** True when `VLLM_SERVERS` JSON is set. */
  vllmMultiServer: boolean;
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
  /** Max concurrent LLM chat/translate HTTP requests. */
  llmMaxParallel: number;
  /** Max concurrent embedding HTTP requests. */
  embedMaxParallel: number;
  /** External TTS server base URL (read-only, from env). */
  ttsBaseUrl: string;
  /** Max concurrent TTS HTTP requests per model backend. */
  ttsMaxParallel: {
    xtts: number;
    'fish-speech': number;
  };
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

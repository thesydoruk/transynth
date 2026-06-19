/**
 * ops.ts — Health / Operations dashboard API.
 *
 * Provides a single `GET /api/ops` endpoint that aggregates system health,
 * import-job status, LLM cache statistics, and database metrics into one
 * payload consumed by the frontend OpsPage component.
 *
 * All queries are read-only and lightweight (COUNT, pg_total_relation_size).
 * The endpoint is admin-visible but does not mutate any data.
 */

import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { getRagStats, reindexAllTranslationExamples } from '../../llm/ragService';

/* ── Response types ──────────────────────────────────────────────────────── */

/** A single import job row (EET / CSV / Mod — unified shape). */
export interface ImportJobRow {
  /** Numeric primary key of the import job. */
  id: number;
  /** Source table the job comes from: 'eet' | 'csv' | 'mod'. */
  kind: 'eet' | 'csv' | 'mod';
  /** Original file name uploaded by the user. */
  file_name: string;
  /** Current lifecycle status: pending → extracting → in_progress → completed | failed. */
  status: string;
  /** Total records expected for this import. */
  total_records: number;
  /** Records imported so far (progress counter). */
  imported_records: number;
  /** Error message when status = 'failed'; null otherwise. */
  last_error: string | null;
  /** ISO timestamp of last status update. */
  updated_at: string;
}

/** Breakdown of auto-translated strings by LLM model name. */
export interface ModelBreakdown {
  /** Model identifier, e.g. "openai:gpt-4o" or "vllm:Meta-Llama-3-8B-Instruct". */
  model: string;
  /** Number of translations produced by this model. */
  count: number;
}

/** Row count + estimated disk size for one database table. */
export interface TableSizeRow {
  /** Table name (e.g. "translations", "strings"). */
  table_name: string;
  /** Approximate row count (from pg_class.reltuples). */
  row_count: number;
  /** Human-readable disk size, e.g. "12 MB". */
  size: string;
}

/** A single LLM batch-translate job row from the llm_jobs table. */
export interface LlmJobRow {
  /** Auto-increment primary key. */
  id: number;
  /** FK to mods — null if the mod was deleted. */
  mod_id: number | null;
  /** Snapshot of mods.game at job creation time. */
  mod_game: string | null;
  /** Snapshot of mods.name at job creation time. */
  mod_name: string | null;
  /** Total strings in the batch. */
  string_count: number;
  /** Successfully translated strings (set at job completion). */
  done_count: number;
  /** running → completed | failed. */
  status: string;
  /** Error message for failed jobs. */
  error: string | null;
  /** ISO timestamp when the job was inserted. */
  started_at: string;
  /** ISO timestamp of last status update. */
  updated_at: string;
}

/** Full response payload returned by GET /api/ops. */
export interface OpsOverview {
  /** System section — runtime info. */
  system: {
    /** Server uptime in seconds. */
    uptimeSeconds: number;
    /** Node.js version string. */
    nodeVersion: string;
    /** Resident set size (heap + native) in bytes. */
    memoryRssBytes: number;
    /** Heap used in bytes. */
    heapUsedBytes: number;
    /** Heap total allocated in bytes. */
    heapTotalBytes: number;
    /** Whether the database is reachable. */
    dbConnected: boolean;
    /** Database server timestamp (ISO). */
    dbTime: string | null;
  };
  /** Recent import jobs across all three tables, newest first. */
  importJobs: ImportJobRow[];
  /** Recent LLM batch translate jobs, newest first (last 24 h). */
  llmJobs: LlmJobRow[];
  /** LLM / auto-translate statistics. */
  llm: {
    /** Total rows in the translation cache. */
    cacheEntries: number;
    /** Number of translations with provenance = 'llm'. */
    autoTranslated: number;
    /** Per-model breakdown of auto-translated strings. */
    byModel: ModelBreakdown[];
  };
  /** Database size metrics for the most important tables. */
  db: {
    /** Total database size as a human-readable string. */
    totalSize: string;
    /** Per-table breakdown. */
    tables: TableSizeRow[];
  };
  /** Translation RAG index statistics. */
  rag: {
    pgvectorAvailable: boolean;
    indexedCount: number;
    eligibleCount: number;
    embedModel: string;
    embedDimensions: number;
  };
}

/* ── Route registration ──────────────────────────────────────────────────── */

/**
 * Registers the `GET /api/ops` route on the Fastify app.
 *
 * The endpoint runs several lightweight SQL queries in parallel and merges
 * the results with Node.js runtime stats into a single {@link OpsOverview}
 * payload.
 *
 * @param app - Fastify instance to attach the route to.
 * @param db  - PostgreSQL connection pool / transaction wrapper.
 */
export const opsRoutes = async (app: FastifyInstance, db: Tx) => {
  app.get('/api/ops', async (_req, reply) => {
    /* ── 1. System info (synchronous, no SQL) ──────────────────────────── */
    const mem = process.memoryUsage();

    /* ── 2. Fire all independent SQL queries in parallel ───────────────── */
    const [
      dbTimeResult,
      eetJobs,
      csvJobs,
      modJobs,
      llmJobsResult,
      cacheCount,
      autoCount,
      modelBreakdown,
      dbSize,
      tableSizes,
      ragStats,
    ] = await Promise.all([
      /* DB connectivity + server time */
      db.query('SELECT NOW() AS now').catch(() => ({ rows: [] as { now: string }[] })),

      /* Recent EET import jobs (last 20) */
      db.query(
        `SELECT id, file_name, status, total_records, imported_records,
                last_error, updated_at
         FROM eet_imports ORDER BY updated_at DESC LIMIT 20`,
      ),

      /* Recent CSV import jobs (last 20) */
      db.query(
        `SELECT id, file_name, status, total_records, imported_records,
                NULL AS last_error, updated_at
         FROM csv_imports ORDER BY updated_at DESC LIMIT 20`,
      ),

      /* Recent Mod import jobs (last 20) */
      db.query(
        `SELECT id, file_name, status, total_records, imported_records,
                NULL AS last_error, updated_at
         FROM mod_imports ORDER BY updated_at DESC LIMIT 20`,
      ),

      /* Recent LLM batch jobs (last 24 h, up to 30 rows) */
      db
        .query(
          `SELECT id, mod_id, mod_game, mod_name, string_count, done_count,
                status, error, started_at, updated_at
         FROM llm_jobs
         WHERE updated_at > NOW() - INTERVAL '24 hours'
         ORDER BY updated_at DESC LIMIT 30`,
        )
        .catch(() => ({ rows: [] })),

      /* LLM translation cache row count */
      db.query('SELECT COUNT(*)::int AS count FROM translation_cache'),

      /* Auto-translated string count (provenance = 'llm') */
      db.query(`SELECT COUNT(*)::int AS count FROM translations WHERE provenance = 'llm'`),

      /* Per-model breakdown of auto-translated strings */
      db.query(
        `SELECT COALESCE(model, 'unknown') AS model, COUNT(*)::int AS count
         FROM translations
         WHERE provenance = 'llm'
         GROUP BY model
         ORDER BY count DESC`,
      ),

      /* Total database size */
      db.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS total_size`),

      /* Per-table row estimates + disk size for the most relevant tables */
      db.query(
        `SELECT
           c.relname                                      AS table_name,
           c.reltuples::bigint                            AS row_count,
           pg_size_pretty(pg_total_relation_size(c.oid))  AS size
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND c.relname IN (
             'mods','records','strings','translations',
             'translation_revisions','qa_issues','glossary',
             'translation_cache','eet_imports','csv_imports',
             'mod_imports','users','activity_log','translation_examples'
           )
         ORDER BY c.reltuples DESC`,
      ),

      getRagStats(db).catch(() => ({
        pgvectorAvailable: false,
        indexedCount: 0,
        eligibleCount: 0,
        embedModel: '',
        embedDimensions: 0,
      })),
    ]);

    /* ── 3. Merge import jobs into a single sorted list ────────────────── */
    const tagKind = <K extends 'eet' | 'csv' | 'mod'>(
      rows: Record<string, unknown>[],
      kind: K,
    ): ImportJobRow[] => rows.map((r) => ({ ...r, kind }) as unknown as ImportJobRow);

    const importJobs = [
      ...tagKind(eetJobs.rows, 'eet'),
      ...tagKind(csvJobs.rows, 'csv'),
      ...tagKind(modJobs.rows, 'mod'),
    ]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 30);

    /* ── 4. Assemble response ──────────────────────────────────────────── */
    const dbTimeRow = dbTimeResult.rows[0] as { now: string } | undefined;

    const overview: OpsOverview = {
      system: {
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        memoryRssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        dbConnected: !!dbTimeRow,
        dbTime: dbTimeRow?.now ?? null,
      },
      importJobs,
      llmJobs: llmJobsResult.rows as unknown as LlmJobRow[],
      llm: {
        cacheEntries: (cacheCount.rows[0] as { count: number })?.count ?? 0,
        autoTranslated: (autoCount.rows[0] as { count: number })?.count ?? 0,
        byModel: modelBreakdown.rows as unknown as ModelBreakdown[],
      },
      db: {
        totalSize: (dbSize.rows[0] as { total_size: string })?.total_size ?? '?',
        tables: tableSizes.rows as unknown as TableSizeRow[],
      },
      rag: ragStats,
    };

    return reply.send(overview);
  });

  app.post('/api/ops/rag/reindex', async (_req, reply) => {
    try {
      const result = await reindexAllTranslationExamples(db);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: message });
    }
  });
};

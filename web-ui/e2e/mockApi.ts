import type { Page, Route } from '@playwright/test';

/*
 * A fake backend for the device tests.
 *
 * The device suite checks layout, not server logic, so it runs on the Vite dev
 * server alone and answers every `/api` call from here. The data is shaped to
 * stress a narrow screen: long mod names, long source lines, a full page of
 * grid rows, a busy import queue.
 */

const NOW = '2026-10-01T12:00:00.000Z';

const CE_EDITOR = {
  modes: ['strings', 'dialogs', 'voice'],
  columns: { formId: true, signature: true, gender: true },
  actions: { genderDetect: true, innrLink: true },
  labels: { signature: 'grup', edid: 'edid', field: 'field' },
  recordPathStyle: 'record-path',
};

const games = [
  {
    id: 'fo4',
    name: 'Fallout 4',
    developer: 'Bethesda Game Studios',
    releaseYear: 2015,
    nexusId: 1151,
    domainName: 'fallout4',
    engine: 'Creation Engine',
    localized: true,
    uploadExtensions: ['.esp', '.esm', '.esl', '.ba2'],
    editor: CE_EDITOR,
  },
  {
    id: 'sse',
    name: 'The Elder Scrolls V: Skyrim Special Edition',
    developer: 'Bethesda Game Studios',
    releaseYear: 2016,
    nexusId: 1704,
    domainName: 'skyrimspecialedition',
    engine: 'Creation Engine',
    localized: true,
    uploadExtensions: ['.esp', '.esm', '.esl', '.bsa'],
    editor: CE_EDITOR,
  },
  {
    id: 'disco',
    name: 'Disco Elysium',
    developer: 'ZA/UM',
    releaseYear: 2019,
    engine: 'Unity',
    localized: false,
    uploadExtensions: ['.po'],
    editor: {
      modes: ['strings', 'dialogs'],
      columns: { formId: false, signature: false, gender: false },
      actions: { genderDetect: false, innrLink: false },
      labels: { signature: 'grup', edid: 'edid', field: 'field' },
      recordPathStyle: 'po-key',
    },
  },
];

const mod = (id: number, name: string, strings: number, translated: number) => ({
  id,
  name,
  abs_path: `C:/Games/Fallout 4/Data/${name.replace(/\s+/g, '')}.esp`,
  version_hash: `hash${id}`,
  game: 'fo4',
  nexus_mod_id: 1000 + id,
  nexus_name: name,
  nexus_thumbnail: null,
  origin: 'upload',
  vortex_group_id: null,
  channel: null,
  game_release_id: null,
  version_label: '1.2.3',
  is_current: true,
  created_at: NOW,
  record_count: strings,
  string_count: strings,
  translated_count: translated,
  approved_count: Math.floor(translated / 2),
  fuzzy_count: 3,
});

const mods = [
  mod(1, 'Sim Settlements 2 — Chapter 3: Unfinished Business and Everything After', 48210, 31002),
  mod(2, 'Unofficial Fallout 4 Patch', 15022, 15022),
  mod(3, 'Nuka World Expanded Raider Settlements', 812, 0),
];

const stats = {
  total: 48210,
  translated: 31002,
  approved: 15501,
  draft: 9000,
  rejected: 12,
  tm: 4000,
  fuzzy: 3,
  auto_translated: 2500,
  skipped: 40,
  untranslated: 17208,
  percent: 64,
};

const LONG_SOURCE =
  "Look, I've been running this settlement for longer than you've been out of the Vault, " +
  'and I am telling you that the caravan from Bunker Hill is not coming back this week.';

const stringRows = Array.from({ length: 40 }, (_, i) => ({
  string_id: 100 + i,
  formid_hex: (0x0001f00a + i).toString(16).toUpperCase().padStart(8, '0'),
  signature: i % 3 === 0 ? 'INFO' : i % 3 === 1 ? 'NPC_' : 'MESG',
  path: i % 3 === 0 ? 'INFO\\NAM1' : i % 3 === 1 ? 'NPC_\\FULL' : 'MESG\\DESC',
  edid: `SS2_Chapter3_Quest_Dialogue_Line_${i}`,
  source: i % 4 === 0 ? LONG_SOURCE : `Settler ${i}`,
  context: i % 3 === 0 ? 'Sturges' : null,
  is_ignored: false,
  translation_id: i % 2 === 0 ? 500 + i : null,
  translation: i % 2 === 0 ? `Поселенець ${i}` : null,
  status: i % 2 === 0 ? 'draft' : null,
  confidence: null,
  provenance: null,
  model: null,
  updated_at: NOW,
  qa_issue_count: i % 7 === 0 ? 1 : 0,
  line_gender: i % 3 === 0 ? 'male' : null,
  line_speaker_name: i % 3 === 0 ? 'Sturges' : null,
  line_addressee_gender: null,
}));

const settings = {
  llmProvider: 'vllm',
  llmFallback: 'none',
  vllmBaseUrl: 'http://ai-pipeline.local:8000/v1',
  vllmServers: [
    {
      host: 'http://ai-pipeline.local:8000/v1',
      maxParallel: 8,
      apiKeyConfigured: false,
      healthy: true,
    },
  ],
  vllmMultiServer: false,
  vllmModel: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
  vllmEmbedModel: 'Qwen/Qwen3-Embedding-8B',
  vllmApiKeyConfigured: false,
  translateModel: 'gpt-4o-mini',
  embedModel: 'text-embedding-3-small',
  openaiKeyConfigured: false,
  nexusApiKeyConfigured: true,
  batchSize: 20,
  llmMaxParallel: 8,
  embedMaxParallel: 4,
  ttsBaseUrl: 'http://ai-pipeline.local:8020',
  llmReadiness: {
    level: 'ok',
    canTranslate: true,
    checks: {
      primaryProvider: true,
      fallbackProvider: true,
      translateModel: true,
      embedModel: true,
    },
    issues: [],
  },
};

const ops = {
  system: {
    uptimeSeconds: 86400,
    nodeVersion: 'v22.11.0',
    memoryRssBytes: 512_000_000,
    heapUsedBytes: 200_000_000,
    heapTotalBytes: 300_000_000,
    dbConnected: true,
    dbTime: NOW,
  },
  importJobs: [],
  llmJobs: [],
  llm: {
    autoTranslated: 2500,
    byModel: [{ model: 'Qwen/Qwen3-30B-A3B-Instruct-2507', count: 2500 }],
  },
  rag: {
    pgvectorAvailable: true,
    indexedCount: 120000,
    eligibleCount: 125000,
    embedModel: 'Qwen/Qwen3-Embedding-8B',
    embedDimensions: 4096,
  },
  db: {
    totalSize: '4.2 GB',
    tables: [{ table_name: 'strings', row_count: 900000, size: '1.1 GB' }],
  },
};

const dashboard = {
  mods: mods.map((m) => ({
    id: m.id,
    name: m.name,
    game: m.game,
    total: m.string_count,
    translated: m.translated_count,
    approved: m.approved_count,
    draft: 100,
    tm: 50,
    fuzzy: 3,
    auto: 20,
    rejected: 1,
    reviewed: 10,
    qa_issues: 7,
  })),
  qaByType: [{ issue_type: 'placeholder_mismatch', count: 7 }],
  qaBySeverity: [{ severity: 'warning', count: 7 }],
  activeJobs: { llmModIds: [], importModIds: [] },
};

const importJob = (id: number, status: string) => ({
  id,
  file_name: `VeryLongModArchiveName_Version_${id}_FinalFinal-v2.7z`,
  file_hash: `filehash${id}`,
  mod_id: id === 1 ? 1 : null,
  total_records: 1000,
  imported_records: status === 'running' ? 420 : 1000,
  status,
  src_lang: 'en',
  tgt_lang: 'uk',
  is_localized: 1,
  game: 'fo4',
  esp_path: null,
  created_at: NOW,
  updated_at: NOW,
  running: status === 'running',
  vortex_group_id: null,
});

const glossary = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  term: i === 0 ? 'Commonwealth Minutemen General' : `Term ${i}`,
  translation: i === 0 ? 'Генерал мінитменів Співдружності' : `Термін ${i}`,
  src_lang: 'en',
  tgt_lang: 'uk',
  game: 'fo4',
  source: 'manual',
  created_at: NOW,
}));

const reference = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  game: 'fo4',
  src_lang: 'en',
  tgt_lang: 'uk',
  formid_hex: (0x0001f00a + i).toString(16).toUpperCase().padStart(8, '0'),
  path: 'NPC_\\FULL',
  edid: `SS2_Reference_Entry_${i}`,
  signature: 'NPC_',
  source_text: i === 0 ? LONG_SOURCE : `Settler ${i}`,
  translation: `Поселенець ${i}`,
  origin: 'manual',
  origin_mod_name: mods[0].name,
  origin_mod_version: '1.2.3',
  origin_status: 'reviewed',
  note: null,
  created_at: NOW,
  updated_at: NOW,
}));

const systemLog = {
  entries: Array.from({ length: 15 }, (_, i) => ({
    id: i + 1,
    level: i % 3 === 0 ? 'error' : i % 3 === 1 ? 'warning' : 'info',
    source: 'llm',
    message:
      i % 3 === 0
        ? 'LLM batch 17/240 timed out after 120000 ms on http://ai-pipeline.local:8000/v1 — retrying in halves'
        : `Job ${i} finished`,
    job_id: 40 + i,
    job_kind: 'translate',
    mod_id: 1,
    details: { attempt: 2 },
    created_at: NOW,
  })),
  total: 15,
  limit: 50,
  offset: 0,
};

const qaRules = [
  {
    id: 1,
    game: 'fo4',
    rule_type: 'max_length',
    signature: 'NPC_',
    path: 'NPC_\\FULL',
    value: '32',
    severity: 'warning',
    description: 'Pip-Boy name column truncates past 32 characters',
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
  },
];

const dialogLine = (i: number, kind: 'response' | 'prompt') => ({
  kind,
  string_id: 900 + i,
  source: i % 2 === 0 ? LONG_SOURCE : `Fine. Take the generator, but bring it back by sundown.`,
  context: 'Sturges',
  translation_id: i % 2 === 0 ? 950 + i : null,
  translation: i % 2 === 0 ? 'Гаразд. Бери генератор, але поверни до заходу сонця.' : null,
  status: i % 2 === 0 ? 'draft' : null,
  provenance: null,
  qa_issue_count: i % 3 === 0 ? 1 : 0,
  voice_variant: null,
});

const dialogEntries = Array.from({ length: 12 }, (_, i) => ({
  id: `entry-${i}`,
  depth: i % 4 === 3 ? 1 : 0,
  section: i === 0 ? 'Sanctuary Hills — workshop' : null,
  speaker: i % 2 === 0 ? 'Sturges' : 'Preston Garvey',
  speaker_key: i % 2 === 0 ? 'sturges' : 'preston',
  speaker_gender: 'male',
  addressee_kind: i % 2 === 0 ? 'player' : 'npc',
  addressee: i % 2 === 0 ? null : 'Sturges',
  addressee_gender: i % 2 === 0 ? 'any' : 'male',
  alias_id: null,
  info_formid_hex: (0x0002a00a + i).toString(16).toUpperCase().padStart(8, '0'),
  topic_formid_hex: '0001F0A0',
  variant_index: 0,
  variant_count: 1,
  lines: [dialogLine(i, 'response'), ...(i % 2 === 0 ? [dialogLine(100 + i, 'prompt')] : [])],
}));

const dialogTree = [
  {
    kind: 'quest',
    scope: 'topics',
    key: 'quest:MinRecruit02',
    label: 'MinRecruit02 — Taking Independence: the long one that does not fit',
    sublabel: 'Minutemen',
    node_count: 3,
    line_count: 14,
    translated_count: 7,
    qa_count: 2,
    timing_sensitive: false,
    children: Array.from({ length: 3 }, (_, i) => ({
      kind: 'topic',
      scope: 'topics',
      key: `topic:${i}`,
      label: `MinRecruit02Topic0${i}`,
      sublabel: i === 0 ? 'Sturges' : null,
      node_count: 1,
      line_count: 4,
      translated_count: 2,
      qa_count: i === 0 ? 2 : 0,
      timing_sensitive: false,
      children: [],
    })),
  },
  {
    kind: 'scene',
    scope: 'scenes',
    key: 'scene:MinRecruit02Scene01',
    label: 'MinRecruit02Scene01',
    sublabel: null,
    node_count: 1,
    line_count: 6,
    translated_count: 3,
    qa_count: 0,
    timing_sensitive: true,
    children: [],
  },
];

const dialogSpeakers = [
  {
    speaker_key: 'sturges',
    display_name: 'Sturges',
    voice_type: 'MaleEvenToned',
    is_player: false,
    detected_gender: 'male',
    detected_source: 'voice_type',
    gender_override: null,
    effective_gender: 'male',
    line_count: 8,
  },
  {
    speaker_key: 'preston',
    display_name: 'Preston Garvey',
    voice_type: 'MaleEvenToned',
    is_player: false,
    detected_gender: 'male',
    detected_source: 'voice_type',
    gender_override: null,
    effective_gender: 'male',
    line_count: 6,
  },
];

const voiceSpeakers = [
  {
    key: 'MaleEvenToned',
    displayName: 'Sturges (MaleEvenToned)',
    referencePick: null,
    gender: 'male',
    genderMismatch: false,
    lineCount: 8,
    dubbedCount: 3,
    orphanCount: 0,
  },
  {
    key: 'FemaleBoston',
    displayName: 'Piper Wright — a long display name that overruns the list',
    referencePick: { lineKey: '02A00A:0', variant: 0 },
    gender: 'female',
    genderMismatch: true,
    lineCount: 5,
    dubbedCount: 0,
    orphanCount: 1,
  },
];

const voiceLines = Array.from({ length: 8 }, (_, i) => ({
  lineKey: `02A0${i}A:0`,
  infoFormidHex: (0x0002a00a + i).toString(16).toUpperCase().padStart(8, '0'),
  variant: 0,
  fileName: `0002a00${i}_1.fuz`,
  speakerKey: 'MaleEvenToned',
  stringId: 900 + i,
  translationId: i % 2 === 0 ? 950 + i : null,
  status: i % 2 === 0 ? 'draft' : null,
  source: i % 2 === 0 ? LONG_SOURCE : 'Fine. Take the generator.',
  translation: i % 2 === 0 ? 'Гаразд. Бери генератор, але поверни до заходу сонця.' : null,
  isReference: i === 0,
  isInheritedAudio: false,
  inheritedFrom: null,
  isOrphanAudio: false,
  hasTranslationAudio: i % 3 === 0,
  canGenerateVoice: i % 2 === 0,
  ttsSkipReason: null,
  voiceSimilarity: i % 3 === 0 ? 0.42 : null,
}));

type Answer = unknown | ((url: URL) => unknown);

/** Matched against the request path; the first hit answers. */
const routes: Array<[RegExp, Answer]> = [
  [/^\/api\/games$/, games],
  [/^\/api\/games\/[^/]+\/nexus\/mods$/, { totalCount: 0, nodesCount: 0, items: [] }],
  [/^\/api\/games\/cover\//, null], // handled as an image below
  [/^\/api\/settings$/, settings],
  [/^\/api\/project-settings$/, { 'workflow.autoApprove': false }],
  [/^\/api\/ops$/, ops],
  [/^\/api\/stats\/dashboard$/, dashboard],
  [/^\/api\/stats\/global$/, mods.map((m) => ({ ...m, stats }))],
  [/^\/api\/stats\/grup$/, []],
  [/^\/api\/stats$/, stats],
  [/^\/api\/mods$/, mods],
  [/^\/api\/mods\/\d+\/langs$/, ['en', 'uk']],
  [/^\/api\/dialogs\/tree$/, dialogTree],
  [/^\/api\/dialogs\/groups$/, []],
  [/^\/api\/dialogs\/speakers$/, dialogSpeakers],
  [
    /^\/api\/dialogs\/transcript$/,
    (url: URL) => ({
      scope: url.searchParams.get('scope') ?? 'topics',
      key: url.searchParams.get('key') ?? '',
      label: 'MinRecruit02Topic00',
      timing_sensitive: false,
      entries: dialogEntries,
    }),
  ],
  [
    /^\/api\/mods\/\d+\/voice\/lines$/,
    (url: URL) =>
      url.searchParams.has('speakerKey')
        ? { ok: true, speakerKey: url.searchParams.get('speakerKey'), lines: voiceLines }
        : { ok: true, speakers: voiceSpeakers, totalLines: 13 },
  ],
  [
    /^\/api\/mods\/\d+\/voice\/availability$/,
    {
      ok: true,
      targetLang: 'uk',
      source: voiceLines.map((l) => l.lineKey),
      translation: ['02A00A:0', '02A03A:0'],
      stale: [],
      skipReasons: {},
    },
  ],
  [/^\/api\/mods\/\d+\/previous-versions$/, []],
  [
    /^\/api\/mods\/\d+$/,
    (url: URL) => mods.find((m) => url.pathname.endsWith(`/${m.id}`)) ?? mods[0],
  ],
  [/^\/api\/strings$/, { rows: stringRows, total: 48210, page: 1, pageSize: 40 }],
  [
    /^\/api\/strings\/signatures$/,
    [
      { signature: 'INFO', count: 30000 },
      { signature: 'NPC_', count: 12000 },
      { signature: 'MESG', count: 6210 },
    ],
  ],
  [/^\/api\/strings\/ids$/, { ids: stringRows.map((r) => r.string_id) }],
  [/^\/api\/strings\/\d+\/(history|qa|suggestions)$/, []],
  [/^\/api\/ai-jobs\/active$/, []],
  [
    /^\/api\/mod-import$/,
    [importJob(1, 'running'), importJob(2, 'completed'), importJob(3, 'failed')],
  ],
  [/^\/api\/(csv|eet)$/, []],
  [/^\/api\/exports$/, { archives: [] }],
  [/^\/api\/vortex\/groups$/, { groups: [] }],
  [/^\/api\/glossary$/, glossary],
  [/^\/api\/reference\/count$/, { count: reference.length }],
  [/^\/api\/reference$/, { rows: reference, total: reference.length }],
  [/^\/api\/qa-rules$/, qaRules],
  [/^\/api\/system-log$/, systemLog],
  [/^\/api\/activity$/, { entries: [], total: 0, limit: 50, offset: 0 }],
  [/^\/api\/coherence/, []],
];

// A 1×1 transparent PNG — cover art only has to load, not look like anything.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * Answers `/api` calls from the fixtures above.
 *
 * Returns the list of paths nothing here knew about, so a test can fail when a
 * page starts calling an endpoint the fake backend does not cover yet.
 */
export const mockApi = async (page: Page): Promise<string[]> => {
  const unmocked: string[] = [];

  // Match on the path, not a glob: `**/api/**` would also catch Vite serving `/src/api/*.ts`.
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route: Route) => {
      const url = new URL(route.request().url());
      // The voice editor opens an event stream; 204 tells EventSource not to retry.
      if (/^\/api\/mods\/\d+\/voice\/live$/.test(url.pathname)) {
        await route.fulfill({ status: 204 });
        return;
      }
      if (url.pathname.startsWith('/api/games/cover/')) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
        return;
      }
      if (route.request().method() !== 'GET') {
        await route.fulfill({ status: 200, json: { ok: true } });
        return;
      }
      const hit = routes.find(([pattern]) => pattern.test(url.pathname));
      if (!hit) {
        unmocked.push(url.pathname);
        await route.fulfill({ status: 404, json: { error: `not mocked: ${url.pathname}` } });
        return;
      }
      const answer = hit[1];
      await route.fulfill({
        status: 200,
        json: typeof answer === 'function' ? (answer as (u: URL) => unknown)(url) : answer,
      });
    },
  );

  return unmocked;
};

export const FIXTURE_MOD_ID = mods[0].id;

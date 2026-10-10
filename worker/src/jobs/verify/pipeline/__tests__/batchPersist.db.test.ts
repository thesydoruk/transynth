import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/*
 * What verify writes once the audit has spoken. The model's own calls — the
 * source rewrite, the editor passes, the "which is better" comparison, the
 * gender pass — and the gender detector are replaced, so each test decides
 * what they answer and checks what reaches the database.
 */
const ROOT = '../../../../../../src';

const rewriteVerifyTranslationsFromSource = jest.fn(
  async (_opts: { items: Array<{ id: number }> }) => ({
    rewritten: [] as Array<{ id: number; text: string }>,
    confirmedUnchanged: [] as number[],
  }),
);
const editVerifyFixes = jest.fn(async () => new Map<number, string>());
const repairProvenGenderLeaks = jest.fn(async () => new Map<number, string>());
const preferBetterTranslations = jest.fn(async () => new Set<number>());
/** The detector: a wording "leaks" when it says so. */
const findGenderLeaks = jest.fn((text: string) => (text.includes('LEAK') ? ['leak'] : []));

jest.unstable_mockModule(`${ROOT}/llm/verifySourceRewrite`, () => ({
  rewriteVerifyTranslationsFromSource,
}));
jest.unstable_mockModule('../editVerifyFixes', () => ({
  editVerifyFixes,
  repairProvenGenderLeaks,
  verifyRowToTranslateItem: () => ({}),
}));
jest.unstable_mockModule(`${ROOT}/llm/preferBetterTranslation`, () => ({
  preferBetterTranslations,
}));
jest.unstable_mockModule(`${ROOT}/llm/genderGuard`, () => ({
  findGenderLeaks,
  isGenderGuardLanguage: () => true,
  describeGenderLeaks: () => '',
  genderRetryInstruction: () => '',
  isPlayerGenderConflict: () => false,
  genderAgreementInstruction: () => '',
}));
jest.unstable_mockModule(`${ROOT}/web/services/ragHooks`, () => ({ scheduleRagSync: () => {} }));

const { scheduleBatchPersist, persistPreRepairs, drainPersistJobs, VERIFY_ADVISORY_ISSUE_TYPE } =
  await import('../batchPersist');
const { Semaphore } = await import(`${ROOT}/utils/concurrency`);
const { insertMod, insertString, insertTranslation, translationOf, useTestDb } = await import(
  `${ROOT}/testing/testDb`
);
type Ctx = import('../batchPersist').BatchPersistContext;
type Job = import('../types').VerifyBatchPersistJob;
type Row = import('../types').VerifyStringRow;
type VerifyItem = import('../../../../../../src/llm/verifyTranslate').LlmVerifyItem;

const verifyItem = (row: Row): VerifyItem => ({
  id: row.string_id,
  source: row.source,
  translation: row.translation,
  grup: 'NPC_',
  edid: null,
  field: 'FULL',
  context: null,
});

describe('verify persistence', () => {
  const db = useTestDb();
  let actions: Array<{ id: number; action: string; detail?: string | null }>;

  beforeEach(() => {
    for (const mock of [
      rewriteVerifyTranslationsFromSource,
      editVerifyFixes,
      repairProvenGenderLeaks,
      preferBetterTranslations,
      findGenderLeaks,
    ]) {
      mock.mockClear();
    }
    actions = [];
  });

  const context = (overrides: Partial<Ctx> = {}): Ctx => ({
    db: db(),
    opts: { modId: 1, srcLang: 'en', targetLang: 'uk', game: 'fo4', modName: 'Test Mod' },
    dryRun: false,
    autoApproveVerified: true,
    model: 'test-model',
    counters: { done: 0, approved: 0, fixed: 0, suspicious: 0, incorrect: 0, errors: 0 },
    persistPool: new Semaphore(2),
    persistJobs: [],
    emitProgress: () => {},
    logAction: (row, action, detail) => actions.push({ id: row.string_id, action, detail }),
    ...overrides,
  });

  /** A translated line as the verify query returns it. */
  const line = async (text: string, translation: string, status = 'draft'): Promise<Row> => {
    const modId = await insertMod(db());
    const stringId = await insertString(db(), { modId, text, formid: `F${text.length}` });
    await insertTranslation(db(), { stringId, text: translation, status });
    return { string_id: stringId, source: text, translation } as Row;
  };

  const job = (parts: Partial<Job> & { okRows?: Row[] }): Job => {
    const okRows = parts.okRows ?? [];
    return {
      okStringIds: okRows.map((row) => row.string_id),
      advisories: [],
      genderRepairs: [],
      fixes: [],
      rewrites: [],
      issues: [],
      rowById: new Map(),
      progressRows: okRows.map((row) => ({
        result: { id: row.string_id, verdict: 'ok' } as Job['progressRows'][number]['result'],
        row,
      })),
      ...parts,
    };
  };

  const persist = async (ctx: Ctx, persistJob: Job) => {
    scheduleBatchPersist(ctx, persistJob);
    await drainPersistJobs(ctx.persistJobs);
  };

  describe('lines the audit passed', () => {
    it('approves them when the run auto-approves', async () => {
      const ok = await line('Sturges', 'Стерджес');
      const ctx = context();

      await persist(ctx, job({ okRows: [ok] }));

      expect((await translationOf(db(), ok.string_id))?.status).toBe('reviewed');
      expect(ctx.counters).toMatchObject({ approved: 1, done: 1 });
      expect(actions).toEqual([{ id: ok.string_id, action: 'approved', detail: undefined }]);
    });

    it('leaves them as they are when it does not', async () => {
      const ok = await line('Sturges', 'Стерджес');

      await persist(context({ autoApproveVerified: false }), job({ okRows: [ok] }));

      expect((await translationOf(db(), ok.string_id))?.status).toBe('draft');
    });

    it('never approves a line a person rejected', async () => {
      const rejected = await line('Sturges', 'Стерджес', 'rejected');
      const ctx = context();

      await persist(ctx, job({ okRows: [rejected] }));

      expect((await translationOf(db(), rejected.string_id))?.status).toBe('rejected');
      expect(ctx.counters.approved).toBe(0);
    });
  });

  describe('fixes', () => {
    it('writes a fix for a proven defect once the detector stops objecting, without asking the model', async () => {
      const row = await line('I did it.', 'Я це зробив.');

      await persist(
        context(),
        job({ fixes: [{ stringId: row.string_id, text: 'Це зроблено.', row, proven: true }] }),
      );

      expect(await translationOf(db(), row.string_id)).toMatchObject({
        text: 'Це зроблено.',
        status: 'auto',
      });
      expect(preferBetterTranslations).not.toHaveBeenCalled();
    });

    it('refuses a fix for a proven defect that still leaks', async () => {
      const row = await line('I did it.', 'Я це зробив.');

      await persist(
        context(),
        job({ fixes: [{ stringId: row.string_id, text: 'Я це зробив LEAK.', row, proven: true }] }),
      );

      expect((await translationOf(db(), row.string_id))?.text).toBe('Я це зробив.');
      expect(actions).toEqual([
        expect.objectContaining({ id: row.string_id, action: 'issue', detail: expect.any(String) }),
      ]);
    });

    it('writes advice only when the rewrite beats the current translation', async () => {
      const better = await line('Settlement', 'Поселення');
      const worse = await line('Settler', 'Поселенець');
      preferBetterTranslations.mockResolvedValueOnce(new Set([better.string_id]));

      await persist(
        context(),
        job({
          fixes: [
            { stringId: better.string_id, text: 'Осада', row: better, proven: false },
            { stringId: worse.string_id, text: 'Осадник', row: worse, proven: false },
          ],
        }),
      );

      expect((await translationOf(db(), better.string_id))?.text).toBe('Осада');
      expect((await translationOf(db(), worse.string_id))?.text).toBe('Поселенець');
    });

    it('writes the wording the editor passes produced, not the raw suggestion', async () => {
      const row = await line('I did it.', 'Я це зробив.');
      editVerifyFixes.mockResolvedValueOnce(new Map([[row.string_id, 'Це вже зроблено.']]));

      await persist(
        context(),
        job({ fixes: [{ stringId: row.string_id, text: 'Це зроблено.', row, proven: true }] }),
      );

      expect((await translationOf(db(), row.string_id))?.text).toBe('Це вже зроблено.');
    });
  });

  it('records the model’s unaided objections on the row, and still approves it', async () => {
    const row = await line('Sturges', 'Стерджес');

    await persist(
      context(),
      job({ okRows: [row], advisories: [{ stringId: row.string_id, message: 'Calque?' }] }),
    );

    const { rows } = await db().query(
      `SELECT issue_type, severity, message FROM qa_issues WHERE src_string_id = $1`,
      [row.string_id],
    );
    expect(rows).toContainEqual({
      issue_type: VERIFY_ADVISORY_ISSUE_TYPE,
      severity: 'warning',
      message: 'Calque?',
    });
    expect((await translationOf(db(), row.string_id))?.status).toBe('reviewed');
  });

  describe('source rewrites', () => {
    it('writes what was rewritten and approves what the rewrite confirmed', async () => {
      const rewritten = await line('Water', 'Вогонь');
      const confirmed = await line('Fire', 'Вогонь');
      rewriteVerifyTranslationsFromSource.mockResolvedValueOnce({
        rewritten: [{ id: rewritten.string_id, text: 'Вода' }],
        confirmedUnchanged: [confirmed.string_id],
      });

      await persist(
        context(),
        job({
          rewrites: [rewritten, confirmed].map((row) => ({ item: verifyItem(row), row })),
        }),
      );

      expect(await translationOf(db(), rewritten.string_id)).toMatchObject({
        text: 'Вода',
        status: 'auto',
      });
      expect((await translationOf(db(), confirmed.string_id))?.status).toBe('reviewed');
    });

    it('counts a failed rewrite batch as errors and writes nothing', async () => {
      const row = await line('Water', 'Вогонь');
      rewriteVerifyTranslationsFromSource.mockRejectedValueOnce(new Error('timeout'));
      const ctx = context();

      await persist(
        ctx,
        job({
          rewrites: [{ item: verifyItem(row), row }],
        }),
      );

      expect(ctx.counters.errors).toBe(1);
      expect((await translationOf(db(), row.string_id))?.text).toBe('Вогонь');
    });
  });

  it('writes a gender repair only for the lines the pass actually fixed', async () => {
    const fixed = await line('I did it.', 'Я це зробив.');
    const unfixed = await line('I saw it.', 'Я це бачив.');
    repairProvenGenderLeaks.mockResolvedValueOnce(new Map([[fixed.string_id, 'Це зроблено.']]));

    await persist(context(), job({ genderRepairs: [fixed, unfixed] }));

    expect((await translationOf(db(), fixed.string_id))?.text).toBe('Це зроблено.');
    expect((await translationOf(db(), unfixed.string_id))?.text).toBe('Я це бачив.');
  });

  it('writes nothing at all on a dry run', async () => {
    const ok = await line('Sturges', 'Стерджес');
    const fix = await line('I did it.', 'Я це зробив.');

    await persist(
      context({ dryRun: true }),
      job({
        okRows: [ok],
        fixes: [{ stringId: fix.string_id, text: 'Це зроблено.', row: fix, proven: true }],
        advisories: [{ stringId: ok.string_id, message: 'Calque?' }],
      }),
    );

    expect((await translationOf(db(), ok.string_id))?.status).toBe('draft');
    expect((await translationOf(db(), fix.string_id))?.text).toBe('Я це зробив.');
    const { rows } = await db().query(`SELECT 1 FROM qa_issues WHERE issue_type = $1`, [
      VERIFY_ADVISORY_ISSUE_TYPE,
    ]);
    expect(rows).toEqual([]);
    expect(editVerifyFixes).not.toHaveBeenCalled();
  });

  describe('persistPreRepairs', () => {
    it('writes the repaired wordings ahead of the audit and returns what landed', async () => {
      const row = await line('I did it.', 'Я це зробив.');

      const persisted = await persistPreRepairs(context(), [
        { stringId: row.string_id, text: 'Це зроблено.', row },
      ] as never);

      expect([...persisted]).toEqual([row.string_id]);
      expect((await translationOf(db(), row.string_id))?.text).toBe('Це зроблено.');
    });

    it('writes nothing on a dry run', async () => {
      const row = await line('I did it.', 'Я це зробив.');

      const persisted = await persistPreRepairs(context({ dryRun: true }), [
        { stringId: row.string_id, text: 'Це зроблено.', row },
      ] as never);

      expect(persisted.size).toBe(0);
      expect((await translationOf(db(), row.string_id))?.text).toBe('Я це зробив.');
    });
  });
});

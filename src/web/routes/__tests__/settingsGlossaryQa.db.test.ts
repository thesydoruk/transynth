import { describe, expect, it, jest } from '@jest/globals';

// Saving the vLLM pool rebuilds the live pool, which health-probes the hosts in
// the background; this file tests the HTTP contract, not the pool.
jest.unstable_mockModule('../../../llm/llmProjectSettings', () => ({
  syncLlmPoolFromProjectSettings: () => {},
}));

const { projectSettingsRoutes } = await import('../projectSettings');
const { glossaryRoutes } = await import('../glossary');
const { qaRulesRoutes } = await import('../qaRules');
const { useTestDb } = await import('../../../testing/testDb');
const { useTestApp } = await import('../../../testing/testApp');

describe('project settings, glossary and QA rules API', () => {
  const db = useTestDb();
  const app = useTestApp(db, projectSettingsRoutes, glossaryRoutes, qaRulesRoutes);

  describe('PUT /api/project-settings/:key', () => {
    const put = (key: string, value: unknown) =>
      app().inject({
        method: 'PUT',
        url: `/api/project-settings/${key}`,
        payload: { value } as object,
      });

    it('stores a value and returns it from GET', async () => {
      expect((await put('workflow.auto_approve_on_save', true)).statusCode).toBe(200);

      const res = await app().inject({ url: '/api/project-settings' });

      expect(res.json()['workflow.auto_approve_on_save']).toBe(true);
    });

    it.each([
      ['an unknown key', 'workflow.nope', true],
      ['the wrong type', 'workflow.auto_approve_on_save', 'yes'],
      ['no value', 'workflow.auto_approve_on_save', null],
      ['a vLLM pool that is not a list', 'llm.vllm_servers', 'http://a'],
      ['a vLLM host that is not a URL', 'llm.vllm_servers', [{ host: 'not a url' }]],
    ])('rejects %s with 400', async (_case, key, value) => {
      expect((await put(key, value)).statusCode).toBe(400);
    });

    it('never returns a stored vLLM API key', async () => {
      await put('llm.vllm_servers', [
        { host: 'http://gpu:8000/v1', maxParallel: 4, apiKey: 'sk-secret' },
      ]);

      const body = (await app().inject({ url: '/api/project-settings' })).body;

      expect(body).not.toContain('sk-secret');
    });

    it('keeps the stored vLLM key when the client sends the pool back without it', async () => {
      await put('llm.vllm_servers', [{ host: 'http://gpu:8000/v1', apiKey: 'sk-secret' }]);
      await put('llm.vllm_servers', [{ host: 'http://gpu:8000/v1' }]);

      const { rows } = await db().query(
        `SELECT value FROM project_settings WHERE key = 'llm.vllm_servers'`,
      );
      expect(JSON.stringify(rows[0].value)).toContain('sk-secret');
    });
  });

  describe('glossary', () => {
    const add = (payload: object) =>
      app().inject({ method: 'POST', url: '/api/glossary', payload });

    it('adds a pair, and adding the same term again updates it', async () => {
      await add({ term: 'Vault', translation: 'Волт', game: 'fo4' });
      const res = await add({ term: 'Vault', translation: 'Сховище', game: 'fo4' });

      expect(res.statusCode).toBe(201);
      const { rows } = await db().query(`SELECT term, translation FROM glossary`);
      expect(rows).toEqual([{ term: 'Vault', translation: 'Сховище' }]);
    });

    it('rejects a missing or blank term', async () => {
      expect((await add({ translation: 'x' })).statusCode).toBe(400);
      expect((await add({ term: '   ', translation: 'x' })).statusCode).toBe(400);
      const { rows } = await db().query(`SELECT term FROM glossary`);
      expect(rows).toEqual([]);
    });

    it('answers 409 when an edit renames a term onto another one', async () => {
      await add({ term: 'Vault', translation: 'Сховище', game: 'fo4' });
      const { id } = (await add({ term: 'Vlt', translation: 'Сховище', game: 'fo4' })).json();

      const res = await app().inject({
        method: 'PUT',
        url: `/api/glossary/${id}`,
        payload: { term: 'Vault' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('deletes a term, and answers 404 the second time', async () => {
      const { id } = (await add({ term: 'Vault', translation: 'Сховище' })).json();
      const del = () => app().inject({ method: 'DELETE', url: `/api/glossary/${id}` });
      expect((await del()).statusCode).toBe(200);
      expect((await del()).statusCode).toBe(404);
    });
  });

  describe('QA rules', () => {
    const create = (payload: object) =>
      app().inject({ method: 'POST', url: '/api/qa-rules', payload });

    it('creates a rule and lists it for its game', async () => {
      const res = await create({
        game: 'fo4',
        rule_type: 'max_length',
        signature: 'NPC_',
        value: '32',
        severity: 'warning',
      });
      expect(res.statusCode).toBe(201);

      const list = await app().inject({ url: '/api/qa-rules?game=fo4' });
      expect(list.json()).toMatchObject([{ rule_type: 'max_length', value: '32' }]);
    });

    it.each([
      ['no value', { rule_type: 'max_length' }],
      ['an unknown type', { rule_type: 'banana', value: 'x' }],
      ['an unknown severity', { rule_type: 'forbidden_chars', value: '©', severity: 'fatal' }],
      ['a length that is not a number', { rule_type: 'max_length', value: 'long' }],
      ['a length of zero', { rule_type: 'max_length', value: '0' }],
      ['a length with trailing junk', { rule_type: 'max_length', value: '32px' }],
    ])('rejects %s with 400', async (_case, payload) => {
      expect((await create(payload)).statusCode).toBe(400);
    });

    it('checks the length even when an edit changes only the value', async () => {
      const { id } = (await create({ rule_type: 'max_length', value: '32' })).json();

      const res = await app().inject({
        method: 'PUT',
        url: `/api/qa-rules/${id}`,
        payload: { value: 'long' },
      });

      expect(res.statusCode).toBe(400);
      expect((await app().inject({ url: `/api/qa-rules/${id}` })).json()).toMatchObject({
        value: '32',
      });
    });

    it('updates and deletes a rule', async () => {
      const { id } = (
        await create({ rule_type: 'forbidden_chars', value: '©', severity: 'warning' })
      ).json();

      const updated = await app().inject({
        method: 'PUT',
        url: `/api/qa-rules/${id}`,
        payload: { is_active: false },
      });
      expect(updated.json()).toMatchObject({ is_active: false });

      expect(
        (await app().inject({ method: 'DELETE', url: `/api/qa-rules/${id}` })).statusCode,
      ).toBe(200);
      expect((await app().inject({ url: `/api/qa-rules/${id}` })).statusCode).toBe(404);
    });
  });
});

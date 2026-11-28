import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { gameAnalyzesVocalEffort, modVoiceEffortRoutes } from '../modVoiceEffort';

/** Answers the mod lookup only; the requests below never get as far as the queue. */
const fakeDb = (mods: Record<number, { name: string; game: string }>): Tx =>
  ({
    query: async (_sql: string, params: unknown[]) => {
      const mod = mods[Number(params[0])];
      return { rows: mod ? [mod] : [] };
    },
  }) as unknown as Tx;

describe('gameAnalyzesVocalEffort', () => {
  it('follows whether the game plugin reads line directions', () => {
    expect(gameAnalyzesVocalEffort('fo4')).toBe(true);
    expect(gameAnalyzesVocalEffort('disco')).toBe(false);
    expect(gameAnalyzesVocalEffort('no-such-game')).toBe(false);
  });
});

describe('POST /api/mods/:modId/voice-effort', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await modVoiceEffortRoutes(
      app,
      fakeDb({ 7: { name: 'Dialogue', game: 'disco' }, 8: { name: 'Base', game: 'fo4' } }),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a bad id and an unknown mod', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/mods/abc/voice-effort' });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({ method: 'POST', url: '/api/mods/99/voice-effort' });
    expect(missing.statusCode).toBe(404);
  });

  it('refuses a mod of a game that records nothing about delivery', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/mods/7/voice-effort' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.stringContaining('delivered') });
  });

  it('answers 404 for the summary of an unknown game', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/games/no-such-game/voice-effort-summary',
    });
    expect(res.statusCode).toBe(404);
  });
});

import { afterEach, describe, expect, it } from '@jest/globals';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { isSpaNavigation, spaNotFoundHandler } from '../spaFallback';

// The 101-character unitId of run #40 that missed the upload route.
const LONG_UNIT =
  'mods%3Asim%20settlements%202%20-%20all%20chapters%20pack%2073394%203.8.1a%202026-10-27t05-48z%2086dab3tia%3Ass2_xpac_chapter2';

describe('spaNotFoundHandler', () => {
  let app: FastifyInstance;

  const build = async () => {
    app = Fastify();
    // Stand-in for @fastify/static: the page is just a marker here.
    app.decorateReply('sendFile', function sendFile(this: FastifyReply) {
      return this.send('<!doctype html>index');
    });
    app.put('/api/vortex/sync/:runId/packs/:unitId', async () => ({ ok: true }));
    app.setNotFoundHandler(spaNotFoundHandler);
    await app.ready();
    return app;
  };

  afterEach(async () => {
    await app?.close();
  });

  it('answers an API call that missed its route with a JSON 404, not the page', async () => {
    await build();
    const res = await app.inject({ method: 'PUT', url: `/api/vortex/sync/40/packs/${LONG_UNIT}` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: expect.stringContaining('PUT /api/vortex/sync/40/packs/'),
    });
  });

  it('serves the page for browser navigation inside the app', async () => {
    await build();
    const res = await app.inject({ method: 'GET', url: '/games/fo4/vortex?tab=runs' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<!doctype html>index');
  });

  it('answers an unknown API GET with a 404', async () => {
    await build();
    expect((await app.inject({ method: 'GET', url: '/api/nope' })).statusCode).toBe(404);
  });
});

describe('isSpaNavigation', () => {
  it.each([
    ['GET', '/mods/12', true],
    ['HEAD', '/', true],
    ['GET', '/api', false],
    ['GET', '/api/mods?x=1', false],
    ['POST', '/mods/12', false],
    ['PUT', '/anything', false],
    ['GET', '/apiary', true],
  ] as const)('%s %s → %s', (method, url, expected) => {
    expect(isSpaNavigation(method, url)).toBe(expected);
  });
});

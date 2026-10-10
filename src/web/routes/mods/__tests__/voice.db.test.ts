import { describe, expect, it } from '@jest/globals';
import { registerVoiceRoutes } from '../voice';
import { registerVoiceRegenerateRoutes } from '../voiceRegenerate';
import { useTestDb } from '../../../../testing/testDb';
import { useTestApp } from '../../../../testing/testApp';

describe('voice API mod ids', () => {
  const db = useTestDb();
  const app = useTestApp(db, registerVoiceRoutes, registerVoiceRegenerateRoutes);

  it.each([
    ['GET', '/api/mods/abc/voice/live'],
    ['GET', '/api/mods/abc/voice/lines'],
    ['GET', '/api/mods/abc/voice/availability'],
    ['GET', '/api/mods/abc/voice/audio/0001A2B3/1'],
    ['GET', '/api/mods/abc/voice/translation-audio/0001A2B3/1'],
    ['POST', '/api/mods/abc/voice/translation-audio/0001A2B3/1'],
    ['PUT', '/api/mods/abc/voice/speaker-ref'],
    ['DELETE', '/api/mods/abc/voice/speaker-ref/npc'],
    ['POST', '/api/mods/abc/voice/regenerate/0001A2B3/1/session'],
    ['GET', '/api/mods/abc/voice/regenerate/session-1'],
    ['POST', '/api/mods/abc/voice/regenerate/session-1/preview'],
    ['GET', '/api/mods/abc/voice/regenerate/session-1/preview-1.wav'],
    ['POST', '/api/mods/abc/voice/regenerate/session-1/commit'],
    ['DELETE', '/api/mods/abc/voice/regenerate/session-1'],
  ] as const)('answers 400 to %s %s', async (method, url) => {
    const res = await app().inject({ method, url, payload: method === 'GET' ? undefined : {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid mod id' });
  });
});

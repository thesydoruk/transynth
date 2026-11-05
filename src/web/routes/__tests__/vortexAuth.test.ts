import { describe, expect, it } from '@jest/globals';
import { isVortexAgentWrite } from '../vortexAuth';

describe('isVortexAgentWrite', () => {
  it.each([
    ['POST', '/api/vortex/sync/plan'],
    ['PUT', '/api/vortex/sync/12/packs/mods%3Afoo%3Abar'],
    ['POST', '/api/vortex/sync/12/start'],
    ['POST', '/api/vortex/agent/heartbeat'],
    ['POST', '/api/vortex/groups/3/export-order?x=1'],
  ])('gates %s %s', (method, url) => {
    expect(isVortexAgentWrite(method, url)).toBe(true);
  });

  it.each([
    ['GET', '/api/vortex/groups'],
    ['GET', '/api/vortex/sync/12'],
    ['GET', '/api/vortex/groups/3/state'],
    ['POST', '/api/vortex/groups/3/stage/llm'],
    ['POST', '/api/vortex/sync/12/stop'],
    ['POST', '/api/mods/5/tm-apply'],
  ])('leaves %s %s open', (method, url) => {
    expect(isVortexAgentWrite(method, url)).toBe(false);
  });
});

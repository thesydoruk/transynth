import { describe, expect, it } from '@jest/globals';
import { parseFleetInventory } from '../inventory';

const base = `
hosts:
  - name: a
    context: ctx-a
    ssh: me@a
    gpus: [{ index: 0, name: card, vramMb: 1000 }]
    allow: [llm, tts]
services:
  - name: s1
    kinds: [llm]
    host: a
    compose: { dir: /opt/s1, files: [], project: null, services: [s1] }
    url: http://a:8000/
    vramMb: 500
`;

describe('parseFleetInventory', () => {
  it('fills defaults and normalizes the url', () => {
    const inv = parseFleetInventory(base);
    expect(inv.pollSec).toBe(15);
    expect(inv.hosts[0]).toMatchObject({
      name: 'a',
      context: 'ctx-a',
      ssh: 'me@a',
      allow: ['llm', 'tts'],
    });
    expect(inv.services[0]).toMatchObject({
      name: 's1',
      kinds: ['llm'],
      gpu: 0,
      url: 'http://a:8000',
      maxParallel: 1,
      priority: 0,
      idleUnloadSec: 300,
      startTimeoutSec: 600,
      compose: { dir: '/opt/s1', files: [], project: null, services: ['s1'] },
    });
  });

  it('rejects unknown hosts, disallowed kinds, missing gpus and duplicates', () => {
    expect(() => parseFleetInventory(base.replace('host: a', 'host: b'))).toThrow('unknown host b');
    expect(() => parseFleetInventory(base.replace('kinds: [llm]', 'kinds: [asr]'))).toThrow(
      'not allowed on host a',
    );
    expect(() =>
      parseFleetInventory(base.replace('vramMb: 500', 'vramMb: 500\n    gpu: 3')),
    ).toThrow('wants gpu 3');
    expect(() => parseFleetInventory(base.replace('kinds: [llm]', 'kinds: [nope]'))).toThrow(
      'unknown service kind',
    );
    expect(() =>
      parseFleetInventory(
        `${base}  - name: s1\n    kinds: [tts]\n    host: a\n    compose: { dir: /x, files: [], project: null, services: [y] }\n    url: http://x\n    vramMb: 1\n`,
      ),
    ).toThrow('duplicate service s1');
    expect(() => parseFleetInventory('hosts: []')).toThrow('no hosts');
  });
});

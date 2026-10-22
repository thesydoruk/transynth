import { describe, expect, it } from '@jest/globals';
import type { ServiceEndpoint } from '../../services/kinds';
import { FleetController, type FleetSnapshot } from '../controller';
import type { ContainerState, HostDriver } from '../driver';
import type { QueueCounts } from '../demand';
import { parseFleetInventory } from '../inventory';

// Demand only arises from queues that carry job kinds (voice → tts, llm → llm+embed), so the
// scenarios use a TTS service and an LLM service on one 20 GB card.
const inventory = parseFleetInventory(`
pollSec: 5
hosts:
  - name: box
    context: box
    gpus: [{ index: 0, name: card, vramMb: 20000 }]
services:
  - { name: fish, kinds: [tts], host: box, gpu: 0, url: http://fish:8080, vramMb: 9000, priority: 5,
      idleUnloadSec: 30, startTimeoutSec: 20, maxParallel: 2, compose: { dir: /x, files: [], project: null, services: [fish] } }
  - { name: gemma, kinds: [llm], host: box, gpu: 0, url: http://gemma:8000, vramMb: 12000,
      priority: 7, idleUnloadSec: 30, startTimeoutSec: 20, compose: { dir: /x, files: [], project: null, services: [gemma] } }
`);

class FakeDriver implements HostDriver {
  containers = new Map<string, ContainerState>([
    ['fish', 'stopped'],
    ['gemma', 'missing'],
  ]);
  calls: string[] = [];
  async containerState(_host: unknown, service: { name: string }): Promise<ContainerState> {
    return this.containers.get(service.name) ?? 'missing';
  }
  async up(_host: unknown, service: { name: string }): Promise<void> {
    this.calls.push(`up ${service.name}`);
    this.containers.set(service.name, 'running');
  }
  async stop(_host: unknown, service: { name: string }): Promise<void> {
    this.calls.push(`stop ${service.name}`);
    this.containers.set(service.name, 'stopped');
  }
  async gpuUsedMb(): Promise<number | null> {
    return 1234;
  }
}

const build = () => {
  const driver = new FakeDriver();
  const healthy = new Set<string>();
  const counts = new Map<string, QueueCounts>();
  let endpoints: ServiceEndpoint[] = [
    { kind: 'asr', host: 'http://manual-asr', maxParallel: 1, apiKey: '', managed: false },
  ];
  const overrides: Record<string, 'start' | 'stop'> = {};
  let now = 1_000_000;
  const snapshots: FleetSnapshot[] = [];
  const controller = new FleetController(inventory, driver, {
    readCounts: async (name) => counts.get(name) ?? { waiting: 0, active: 0 },
    probe: async (endpoint) =>
      healthy.has(endpoint.host) ? { ok: true } : { ok: false, error: 'down' },
    readEndpoints: async () => endpoints,
    writeEndpoints: async (rows) => {
      endpoints = rows;
    },
    readOverrides: async () => overrides,
    publish: async (s) => {
      snapshots.push(s);
    },
    log: { info: () => undefined, warn: () => undefined },
    now: () => now,
  });
  return {
    controller,
    driver,
    healthy,
    counts,
    overrides,
    snapshots,
    endpoints: () => endpoints,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

describe('FleetController', () => {
  it('starts a wanted service, marks it running when healthy, and registers it as managed', async () => {
    const f = build();
    f.counts.set('transynth-voice', { waiting: 2, active: 0 });
    let snap = await f.controller.tick();
    expect(f.driver.calls).toEqual(['up fish']);
    expect(snap.services.find((s) => s.name === 'fish')).toMatchObject({
      status: 'starting',
      healthy: false,
    });
    expect(f.endpoints().some((e) => e.managed)).toBe(false);

    f.healthy.add('http://fish:8080');
    f.advance(5_000);
    snap = await f.controller.tick();
    expect(snap.services.find((s) => s.name === 'fish')).toMatchObject({
      status: 'running',
      healthy: true,
    });
    expect(f.endpoints()).toEqual([
      { kind: 'asr', host: 'http://manual-asr', maxParallel: 1, apiKey: '', managed: false },
      { kind: 'tts', host: 'http://fish:8080', maxParallel: 2, apiKey: '', managed: true },
    ]);
    expect(snap.gpus[0]).toMatchObject({ committedMb: 9000, usedMb: 1234 });
    expect(snap.actions[0]).toMatchObject({ type: 'start', service: 'fish', ok: true });
  });

  it('fails a start that never turns healthy and retries only after the cooldown', async () => {
    const f = build();
    f.counts.set('transynth-voice', { waiting: 1, active: 0 });
    await f.controller.tick();
    f.advance(25_000);
    let snap = await f.controller.tick();
    expect(snap.services.find((s) => s.name === 'fish')?.status).toBe('failed');
    expect(f.driver.calls).toEqual(['up fish']);
    f.advance(5_000);
    snap = await f.controller.tick();
    expect(f.driver.calls).toEqual(['up fish']); // still cooling down
    f.advance(25_000);
    snap = await f.controller.tick();
    expect(f.driver.calls).toEqual(['up fish', 'up fish']);
    expect(snap.services.find((s) => s.name === 'fish')?.status).toBe('starting');
  });

  it('frees the card for a higher-priority kind once the resident has idled, then drops its managed row', async () => {
    const f = build();
    f.counts.set('transynth-voice', { waiting: 1, active: 0 });
    f.healthy.add('http://fish:8080');
    await f.controller.tick(); // fish starting
    await f.controller.tick(); // fish running, managed row written
    expect(f.endpoints().some((e) => e.kind === 'tts' && e.managed)).toBe(true);

    f.counts.delete('transynth-voice'); // tts no longer wanted
    f.counts.set('transynth-llm', { waiting: 1, active: 0 });
    await f.controller.tick(); // gemma (12000) does not fit beside fish (9000) on 20000
    expect(f.driver.calls).toEqual(['up fish']); // fish just went idle: nothing yet
    f.advance(31_000);
    await f.controller.tick();
    expect(f.driver.calls).toEqual(['up fish', 'stop fish']);
    expect(f.endpoints().some((e) => e.kind === 'tts')).toBe(false);
    const snap = await f.controller.tick();
    expect(f.driver.calls).toEqual(['up fish', 'stop fish', 'up gemma']);
    expect(snap.services.find((s) => s.name === 'gemma')?.status).toBe('starting');
  });

  it('operator stop takes a service down and keeps it down while demand persists', async () => {
    const f = build();
    f.counts.set('transynth-voice', { waiting: 1, active: 0 });
    f.healthy.add('http://fish:8080');
    await f.controller.tick();
    await f.controller.tick();
    f.overrides.fish = 'stop';
    await f.controller.tick();
    expect(f.driver.calls).toEqual(['up fish', 'stop fish']);
    await f.controller.tick();
    await f.controller.tick();
    expect(f.driver.calls).toEqual(['up fish', 'stop fish']);
    delete f.overrides.fish;
    await f.controller.tick();
    expect(f.driver.calls).toEqual(['up fish', 'stop fish', 'up fish']);
  });
});

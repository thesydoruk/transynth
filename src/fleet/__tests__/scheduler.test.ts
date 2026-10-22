import { describe, expect, it } from '@jest/globals';
import { parseFleetInventory } from '../inventory';
import { planFleet, type ServiceState } from '../scheduler';

const YAML = `
hosts:
  - name: gpu-box
    context: gpu-box
    gpus: [{ index: 0, name: card, vramMb: 32000 }]
services:
  - { name: gemma, kinds: [llm], host: gpu-box, gpu: 0, url: http://g:1, vramMb: 18000, priority: 10,
      idleUnloadSec: 60, compose: { dir: /x, files: [], project: null, services: [gemma] } }
  - { name: fish, kinds: [tts], host: gpu-box, gpu: 0, url: http://f:1, vramMb: 9000, priority: 5,
      idleUnloadSec: 60, compose: { dir: /x, files: [], project: null, services: [fish] } }
  - { name: audio, kinds: [asr, separate], host: gpu-box, gpu: 0, url: http://a:1, vramMb: 8000,
      priority: 7, idleUnloadSec: 60, compose: { dir: /x, files: [], project: null, services: [audio] } }
`;
const inventory = parseFleetInventory(YAML);
const TOOLS = `  - { name: tools, kinds: [tools], host: gpu-box, keep: true, url: http://t:1, priority: 1,
      compose: { dir: /x, files: [], project: null, services: [tools] } }
`;
const cpuInventory = parseFleetInventory(YAML + TOOLS);

const state = (name: string, over: Partial<ServiceState> = {}): ServiceState => ({
  name,
  status: 'stopped',
  healthy: false,
  inFlight: 0,
  idleSinceMs: null,
  manual: null,
  ...over,
});

const NOW = 1_000_000;

describe('planFleet', () => {
  it('starts the provider of a wanted kind when the VRAM fits', () => {
    const actions = planFleet({
      inventory,
      states: [state('gemma'), state('fish'), state('audio')],
      demand: { tts: { waiting: 3, active: 0 } },
      nowMs: NOW,
    });
    expect(actions).toEqual([
      { type: 'start', service: 'fish', reason: expect.stringContaining('tts wanted') },
    ]);
  });

  it('does nothing while a provider is already starting or running healthy', () => {
    for (const status of ['starting', 'running'] as const) {
      const actions = planFleet({
        inventory,
        states: [
          state('gemma'),
          state('fish', { status, healthy: status === 'running' }),
          state('audio'),
        ],
        demand: { tts: { waiting: 1, active: 0 } },
        nowMs: NOW,
      });
      expect(actions).toEqual([]);
    }
  });

  it('evicts an idle, unwanted, lower-priority resident to make room, then starts next tick', () => {
    const states = [
      state('gemma', { status: 'running', healthy: true, idleSinceMs: NOW - 120_000 }),
      state('fish', { status: 'running', healthy: true, idleSinceMs: NOW - 120_000 }),
      state('audio'),
    ];
    // gemma 18000 + fish 9000 = 27000 committed; audio needs 8000 of the 5000 left.
    const first = planFleet({
      inventory,
      states,
      demand: { asr: { waiting: 1, active: 0 } },
      nowMs: NOW,
    });
    expect(first).toEqual([
      { type: 'stop', service: 'fish', reason: expect.stringContaining('for audio') },
    ]);
    // fish (priority 5) goes before gemma (10 > audio's 7, never a victim).
    const after = planFleet({
      inventory,
      states: [states[0]!, state('fish'), state('audio')],
      demand: { asr: { waiting: 1, active: 0 } },
      nowMs: NOW,
    });
    expect(after).toEqual([{ type: 'start', service: 'audio', reason: expect.any(String) }]);
  });

  it('never evicts a wanted, busy or still-fresh service', () => {
    const base = { status: 'running' as const, healthy: true };
    const cases: Array<[string, ServiceState[], object]> = [
      [
        'wanted',
        [state('gemma', { ...base, idleSinceMs: null })],
        { llm: { waiting: 0, active: 1 }, tts: { waiting: 1, active: 0 } },
      ],
      [
        'busy',
        [state('gemma', { ...base, inFlight: 2, idleSinceMs: NOW - 120_000 })],
        { tts: { waiting: 1, active: 0 } },
      ],
      [
        'fresh',
        [state('gemma', { ...base, idleSinceMs: NOW - 10_000 })],
        { tts: { waiting: 1, active: 0 } },
      ],
    ];
    for (const [label, states, demand] of cases) {
      const actions = planFleet({
        inventory: {
          ...inventory,
          services: inventory.services.map((s) =>
            s.name === 'fish' ? { ...s, vramMb: 20000 } : s,
          ),
        },
        states: [...states, state('fish'), state('audio')],
        demand,
        nowMs: NOW,
      });
      expect(actions.filter((a) => a.type === 'stop')).toEqual([]);
      expect(actions.filter((a) => a.type === 'start')).toEqual([]);
      expect(label).toBeTruthy();
    }
  });

  it('honours operator overrides: stop wins, start counts as demand', () => {
    const stopActions = planFleet({
      inventory,
      states: [
        state('gemma', { status: 'running', healthy: true, manual: 'stop' }),
        state('fish'),
        state('audio'),
      ],
      demand: { llm: { waiting: 5, active: 0 } },
      nowMs: NOW,
    });
    expect(stopActions).toEqual([
      { type: 'stop', service: 'gemma', reason: 'stopped by operator' },
    ]);

    const startActions = planFleet({
      inventory,
      states: [state('gemma'), state('fish', { manual: 'start' }), state('audio')],
      demand: {},
      nowMs: NOW,
    });
    expect(startActions).toEqual([
      { type: 'start', service: 'fish', reason: expect.stringContaining('operator') },
    ]);
  });

  it('one container covering two kinds is started once', () => {
    const actions = planFleet({
      inventory,
      states: [state('gemma'), state('fish'), state('audio')],
      demand: { asr: { waiting: 1, active: 0 }, separate: { waiting: 2, active: 0 } },
      nowMs: NOW,
    });
    expect(actions).toEqual([{ type: 'start', service: 'audio', reason: expect.any(String) }]);
  });
});

describe('planFleet with CPU and kept services', () => {
  it('starts a kept CPU service regardless of demand and VRAM, and never evicts it', () => {
    const full = planFleet({
      inventory: cpuInventory,
      states: [state('gemma', { status: 'running', healthy: true }), state('tools')],
      demand: { llm: { waiting: 1, active: 0 } },
      nowMs: NOW,
    });
    expect(full).toEqual([{ type: 'start', service: 'tools', reason: 'tools is kept up' }]);

    const quiet = planFleet({
      inventory: cpuInventory,
      states: [state('tools', { status: 'missing' })],
      demand: {},
      nowMs: NOW,
    });
    expect(quiet).toEqual([{ type: 'start', service: 'tools', reason: 'tools is kept up' }]);

    const up = planFleet({
      inventory: cpuInventory,
      states: [state('tools', { status: 'running', healthy: true, idleSinceMs: NOW - 10_000_000 })],
      demand: {},
      nowMs: NOW,
    });
    expect(up).toEqual([]);
  });

  it('respects an operator stop on a kept service', () => {
    expect(
      planFleet({
        inventory,
        states: [state('tools', { manual: 'stop' })],
        demand: {},
        nowMs: NOW,
      }),
    ).toEqual([]);
  });
});

describe('planFleet evicts an idle higher-priority resident', () => {
  it('stops an idle, unwanted Gemma (10) to make room for a wanted Fish (5)', () => {
    const actions = planFleet({
      inventory: {
        ...inventory,
        services: inventory.services.map((s) => (s.name === 'fish' ? { ...s, vramMb: 20000 } : s)),
      },
      states: [
        state('gemma', { status: 'running', healthy: true, idleSinceMs: NOW - 600_000 }),
        state('fish'),
        state('audio'),
      ],
      demand: { tts: { waiting: 0, active: 1 } },
      nowMs: NOW,
    });
    expect(actions).toEqual([
      { type: 'stop', service: 'gemma', reason: expect.stringContaining('for fish') },
    ]);
  });
});

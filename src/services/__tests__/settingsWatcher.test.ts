import { describe, expect, it, jest } from '@jest/globals';
import { settingsPollMs, startServiceSettingsWatcher } from '../settingsWatcher';
import type { ProjectSettings } from '../../web/services/projectSettings';

const flush = () => new Promise((resolve) => setImmediate(resolve));

const setup = () => {
  let settings: Record<string, unknown> = { 'services.endpoints': [] };
  const apply = jest.fn();
  const log = { info: jest.fn(), warn: jest.fn() };
  let fire: () => void = () => {};
  const stop = startServiceSettingsWatcher(
    {
      read: async () => settings as ProjectSettings,
      apply,
      log,
      schedule: (fn) => {
        fire = fn;
        return () => {
          fire = () => {};
        };
      },
    },
    1000,
  );
  return {
    apply,
    log,
    stop,
    set: (next: Record<string, unknown>) => {
      settings = next;
    },
    tick: async () => {
      fire();
      await flush();
    },
  };
};

describe('startServiceSettingsWatcher', () => {
  it('records the first read and applies only when a watched key changes', async () => {
    const w = setup();
    await flush();
    expect(w.apply).not.toHaveBeenCalled();
    await w.tick();
    expect(w.apply).not.toHaveBeenCalled();
    w.set({ 'services.endpoints': [{ kind: 'tts', host: 'http://x', managed: true }] });
    await w.tick();
    expect(w.apply).toHaveBeenCalledTimes(1);
    await w.tick();
    expect(w.apply).toHaveBeenCalledTimes(1);
    w.set({
      'services.endpoints': [{ kind: 'tts', host: 'http://x', managed: true }],
      'ui.theme': 'dark',
    });
    await w.tick();
    expect(w.apply).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it('logs a failed read and keeps going', async () => {
    let fail = true;
    const apply = jest.fn();
    const log = { info: jest.fn(), warn: jest.fn() };
    let fire: () => void = () => {};
    startServiceSettingsWatcher(
      {
        read: async () => {
          if (fail) throw new Error('db down');
          return { 'services.endpoints': [{ kind: 'llm', host: 'http://y' }] } as ProjectSettings;
        },
        apply,
        log,
        schedule: (fn) => {
          fire = fn;
          return () => {};
        },
      },
      1000,
    );
    await flush();
    expect(log.warn).toHaveBeenCalledTimes(1);
    fail = false;
    fire();
    await flush();
    // The first successful read is the baseline, not a change.
    expect(apply).not.toHaveBeenCalled();
  });

  it('reads the interval from the environment and treats 0 as off', () => {
    expect(settingsPollMs({})).toBe(30_000);
    expect(settingsPollMs({ SERVICES_SETTINGS_POLL_SEC: '5' })).toBe(5_000);
    expect(settingsPollMs({ SERVICES_SETTINGS_POLL_SEC: '0' })).toBe(0);
    expect(startServiceSettingsWatcher({} as never, 0)).toBeInstanceOf(Function);
  });
});

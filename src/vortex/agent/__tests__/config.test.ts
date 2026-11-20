import { describe, expect, it } from '@jest/globals';
import '../../../games';
import { parseAgentConfig } from '../config';
import { retryDelayMs } from '../state';

describe('agent config', () => {
  it('fills defaults, trims, and lets the environment token win', () => {
    const config = parseAgentConfig(
      {
        game: 'fo4',
        gameDir: ' D:/Games/Fallout4 ',
        api: 'http://host:3200/',
        token: 'file-token',
      },
      { TRANSYNTH_CLI_TOKEN: 'env-token' },
    );
    expect(config).toMatchObject({
      api: 'http://host:3200',
      token: 'env-token',
      gameDir: 'D:/Games/Fallout4',
      channel: 'all',
      pollSec: 30,
      settleSec: 90,
      autoStages: 'tm',
      deliverLangpack: true,
    });
    expect(config.stagingPath).toMatch(/Vortex[\\/]fallout4[\\/]mods$/);
    expect(config.downloadsDir).toMatch(/Vortex[\\/]downloads[\\/]fallout4$/);
  });

  it('keeps the group to join only when one is set', () => {
    const base = { game: 'fo4', gameDir: 'x' };
    expect(parseAgentConfig({ ...base, group: ' home ' }, {}).group).toBe('home');
    expect(parseAgentConfig({ ...base, group: '  ' }, {})).not.toHaveProperty('group');
    expect(parseAgentConfig(base, {})).not.toHaveProperty('group');
  });

  it('never lets autoStages go past TM, and needs a deployable game and a game dir', () => {
    expect(() => parseAgentConfig({ game: 'fo4', gameDir: 'x', autoStages: 'llm' }, {})).toThrow(
      /autoStages/,
    );
    expect(() => parseAgentConfig({ game: 'disco', gameDir: 'x' }, {})).toThrow(/deploys/);
    expect(() => parseAgentConfig({ game: 'fo4' }, {})).toThrow(/gameDir/);
    expect(parseAgentConfig({ game: 'fo4', gameDir: 'x', pollSec: 1 }, {}).pollSec).toBe(30);
  });

  it('serves its page on 3220 unless told another port, and 0 turns the page off', () => {
    const port = (uiPort?: unknown) => parseAgentConfig({ game: 'fo4', gameDir: 'x', uiPort }, {});
    expect(port().uiPort).toBe(3220);
    expect(port(4000).uiPort).toBe(4000);
    expect(port(0).uiPort).toBe(0);
    expect(port('nope').uiPort).toBe(3220);
  });

  it('backs off exponentially up to half an hour', () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(240_000);
    expect(retryDelayMs(20)).toBe(30 * 60_000);
  });
});

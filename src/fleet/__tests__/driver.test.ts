import { describe, expect, it } from '@jest/globals';
import { composeCommand, containerStateOf, parseComposePs, shellQuote } from '../driver';
import type { FleetService } from '../inventory';

const service = (compose: Partial<FleetService['compose']>): FleetService => ({
  name: 'x',
  kinds: ['tts'],
  host: 'h',
  gpu: 0,
  keep: false,
  compose: { dir: '/srv/x', files: [], project: null, services: ['x'], ...compose },
  url: 'http://x',
  maxParallel: 1,
  apiKey: '',
  vramMb: 1,
  priority: 0,
  idleUnloadSec: 1,
  startTimeoutSec: 1,
});

describe('composeCommand', () => {
  it('pins the project directory and resolves extra files against it', () => {
    expect(
      composeCommand(
        service({ files: ['docker-compose.yml', 'docker-compose.gpu.yml', '/etc/x/extra.yml'] }),
        ['ps'],
      ),
    ).toEqual([
      'compose',
      '--project-directory',
      '/srv/x',
      '-f',
      '/srv/x/docker-compose.yml',
      '-f',
      '/srv/x/docker-compose.gpu.yml',
      '-f',
      '/etc/x/extra.yml',
      'ps',
    ]);
  });

  it('passes the project name when set', () => {
    expect(composeCommand(service({ project: 'p1' }), ['stop', 'a'])).toEqual([
      'compose',
      '--project-directory',
      '/srv/x',
      '-p',
      'p1',
      'stop',
      'a',
    ]);
  });
});

describe('shellQuote', () => {
  it('leaves plain words alone and single-quotes the rest', () => {
    expect(shellQuote('/srv/x/docker-compose.yml')).toBe('/srv/x/docker-compose.yml');
    expect(shellQuote('--format=json')).toBe('--format=json');
    expect(shellQuote('a b')).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe('parseComposePs / containerStateOf', () => {
  it('reads one object per line and an array alike', () => {
    const lines = '{"Service":"a","State":"running"}\n{"Service":"b","State":"exited"}\n';
    const array = '[{"Service":"a","State":"running"},{"Service":"b","State":"exited"}]';
    expect(parseComposePs(lines)).toEqual(parseComposePs(array));
    expect(parseComposePs('  \n')).toEqual([]);
  });

  it('is running only when every listed compose service runs', () => {
    const rows = parseComposePs(
      '{"Service":"vllm","State":"running"}\n{"Service":"server","State":"exited"}',
    );
    expect(containerStateOf([], ['vllm', 'server'])).toBe('missing');
    expect(containerStateOf(rows, ['vllm'])).toBe('running');
    expect(containerStateOf(rows, ['vllm', 'server'])).toBe('stopped');
  });
});

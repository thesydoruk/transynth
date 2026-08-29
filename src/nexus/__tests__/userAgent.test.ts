import { createRequire } from 'node:module';
import { describe, expect, it } from '@jest/globals';
import { NEXUS_USER_AGENT } from '../userAgent';

const { version } = createRequire(import.meta.url)('../../../package.json') as {
  version: string;
};

describe('NEXUS_USER_AGENT', () => {
  it('uses the package name and version', () => {
    expect(NEXUS_USER_AGENT).toBe(`transynth/${version}`);
  });
});

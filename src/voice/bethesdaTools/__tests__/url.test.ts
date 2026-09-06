import { afterEach, describe, expect, it } from '@jest/globals';
import { requireBethesdaToolsUrl, resolveBethesdaToolsUrl } from '../url';

describe('resolveBethesdaToolsUrl', () => {
  const original = process.env.BETHESDA_TOOLS_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.BETHESDA_TOOLS_URL;
    else process.env.BETHESDA_TOOLS_URL = original;
  });

  it('trims trailing slashes', () => {
    process.env.BETHESDA_TOOLS_URL = 'http://192.168.50.140:3210/';
    expect(resolveBethesdaToolsUrl()).toBe('http://192.168.50.140:3210');
  });

  it('is null when unset', () => {
    delete process.env.BETHESDA_TOOLS_URL;
    expect(resolveBethesdaToolsUrl()).toBeNull();
  });

  it('require throws when unset', () => {
    delete process.env.BETHESDA_TOOLS_URL;
    expect(() => requireBethesdaToolsUrl()).toThrow('BETHESDA_TOOLS_URL is not set');
  });
});

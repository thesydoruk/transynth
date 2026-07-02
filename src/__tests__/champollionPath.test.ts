import { describe, it, expect, afterEach } from '@jest/globals';
import { defaultChampollionExePath, resolveChampollionPath } from '../champollionPath';

describe('resolveChampollionPath', () => {
  const original = process.env.CHAMPOLLION_PATH;

  afterEach(() => {
    if (original === undefined) delete process.env.CHAMPOLLION_PATH;
    else process.env.CHAMPOLLION_PATH = original;
  });

  it('uses CHAMPOLLION_PATH when set', () => {
    process.env.CHAMPOLLION_PATH = 'C:\\Tools\\Champollion.exe';
    expect(resolveChampollionPath()).toBe('C:\\Tools\\Champollion.exe');
  });

  it('falls back to data/tools/champollion/Champollion.exe', () => {
    delete process.env.CHAMPOLLION_PATH;
    expect(resolveChampollionPath()).toBe(defaultChampollionExePath());
  });
});

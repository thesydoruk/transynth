import { resolveDirectoryInput } from '../file';
import path from 'path';

describe('resolveDirectoryInput', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('preserves Windows UNC paths', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(resolveDirectoryInput('\\\\nas\\mods\\fallout4')).toBe('\\\\nas\\mods\\fallout4');
  });

  it('normalizes forward-slash UNC paths on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(resolveDirectoryInput('//nas/mods/fallout4')).toBe('\\\\nas\\mods\\fallout4');
  });

  it('strips wrapping quotes', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(resolveDirectoryInput('"\\\\nas\\mods"')).toBe(path.normalize('\\\\nas\\mods'));
  });

  it('resolves relative local paths', () => {
    expect(resolveDirectoryInput('./mods')).toMatch(/mods$/);
  });
});

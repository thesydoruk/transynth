import {
  looksLikeUnixPathArg,
  resolveWinePrefix,
  wineifyArgs,
  withWineJob,
} from '../windowsToolExec';
import { hintProcessGc } from '../../utils/processGc';

describe('resolveWinePrefix', () => {
  const originalPrefix = process.env.WINEPREFIX;
  const originalPrefix64 = process.env.WINEPREFIX64;

  afterEach(() => {
    if (originalPrefix === undefined) delete process.env.WINEPREFIX;
    else process.env.WINEPREFIX = originalPrefix;
    if (originalPrefix64 === undefined) delete process.env.WINEPREFIX64;
    else process.env.WINEPREFIX64 = originalPrefix64;
  });

  it('defaults to tools/.wine under DATA_DIR', () => {
    delete process.env.WINEPREFIX;
    expect(resolveWinePrefix()).toMatch(/[\\/]tools[\\/]\.wine$/);
  });

  it('defaults win64 prefix to tools/.wine64', () => {
    delete process.env.WINEPREFIX64;
    expect(resolveWinePrefix('win64')).toMatch(/[\\/]tools[\\/]\.wine64$/);
  });
});

describe('looksLikeUnixPathArg', () => {
  it('detects unix paths and ignores flags or plain text', () => {
    expect(looksLikeUnixPathArg('/app/data/test.wav')).toBe(true);
    expect(looksLikeUnixPathArg('./tmp/out.xwm')).toBe(true);
    expect(looksLikeUnixPathArg('-b')).toBe(false);
    expect(looksLikeUnixPathArg('Fallout4')).toBe(false);
    expect(looksLikeUnixPathArg('Hello test')).toBe(false);
  });
});

describe('wineifyArgs', () => {
  const platform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
  });

  it('leaves args unchanged on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const args = ['-b', '48000', '/tmp/a.wav', '/tmp/a.xwm'];
    expect(wineifyArgs(args, {})).toEqual(args);
  });
});

describe('withWineJob', () => {
  it('returns the inner result and allows nesting', async () => {
    const nested = await withWineJob(async () => withWineJob(async () => 21));
    expect(nested).toBe(21);
  });
});

describe('hintProcessGc', () => {
  it('does not throw when gc is unavailable', () => {
    expect(() => hintProcessGc()).not.toThrow();
  });
});

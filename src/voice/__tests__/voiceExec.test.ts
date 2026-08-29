import path from 'node:path';
import { isWineExePath, resolveVoiceExecutable, resolveWinePrefix } from '../voiceExec';

describe('resolveWinePrefix', () => {
  const originalPrefix = process.env.WINEPREFIX;

  afterEach(() => {
    if (originalPrefix === undefined) delete process.env.WINEPREFIX;
    else process.env.WINEPREFIX = originalPrefix;
  });

  it('defaults to tools/.wine under DATA_DIR', () => {
    delete process.env.WINEPREFIX;
    expect(resolveWinePrefix()).toMatch(/[\\/]tools[\\/]\.wine$/);
  });
});

describe('resolveVoiceExecutable', () => {
  const platform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    delete process.env.WINE_PATH;
  });

  it('runs .exe via wine on Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const exe = path.join('/app/data/tools/voice', 'xWMAEncode.exe');
    expect(resolveVoiceExecutable(exe)).toEqual({
      command: 'wine',
      argsPrefix: [path.resolve(exe)],
    });
  });

  it('uses WINE_PATH when set', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.WINE_PATH = '/opt/wine/bin/wine';
    const exe = '/tools/FaceFXWrapper.exe';
    expect(resolveVoiceExecutable(exe)).toEqual({
      command: '/opt/wine/bin/wine',
      argsPrefix: [path.resolve(exe)],
    });
  });

  it('runs wrapper scripts directly on Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const wrapper = '/app/bin/xwma-encode';
    expect(resolveVoiceExecutable(wrapper)).toEqual({
      command: path.resolve(wrapper),
      argsPrefix: [],
    });
  });

  it('runs .exe directly on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const exe = 'C:\\tools\\xWMAEncode.exe';
    expect(resolveVoiceExecutable(exe)).toEqual({
      command: exe,
      argsPrefix: [],
    });
  });
});

describe('isWineExePath', () => {
  it('detects .exe paths case-insensitively', () => {
    expect(isWineExePath('/tmp/xWMAEncode.exe')).toBe(true);
    expect(isWineExePath('/tmp/xWMAEncode.EXE')).toBe(true);
    expect(isWineExePath('/app/bin/xwma-encode')).toBe(false);
  });
});

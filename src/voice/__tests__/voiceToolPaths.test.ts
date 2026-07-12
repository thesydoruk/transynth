import { resolveFfmpegPath, resolveTtsLanguage } from '../voiceToolPaths';

describe('resolveFfmpegPath', () => {
  const platform = process.platform;
  const ffmpegPath = process.env.FFMPEG_PATH;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    if (ffmpegPath === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = ffmpegPath;
  });

  it('uses system ffmpeg on Linux even when ffmpeg.exe is bundled in data/tools', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    delete process.env.FFMPEG_PATH;
    expect(resolveFfmpegPath()).toBe('ffmpeg');
  });
});

describe('resolveTtsLanguage', () => {
  it('maps target locale to TTS language code', () => {
    expect(resolveTtsLanguage('uk')).toBe('uk');
    expect(resolveTtsLanguage('UA')).toBe('uk');
    expect(resolveTtsLanguage('de')).toBe('de');
  });

  it('rejects empty target locale', () => {
    expect(() => resolveTtsLanguage('  ')).toThrow('Target language is required for TTS');
  });
});

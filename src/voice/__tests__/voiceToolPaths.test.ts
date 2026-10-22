import { resolveFfmpegPath, resolveTtsLanguage } from '../voiceToolPaths';

describe('resolveFfmpegPath', () => {
  const ffmpegPath = process.env.FFMPEG_PATH;

  afterEach(() => {
    if (ffmpegPath === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = ffmpegPath;
  });

  it('is the ffmpeg on PATH unless FFMPEG_PATH points elsewhere', () => {
    delete process.env.FFMPEG_PATH;
    expect(resolveFfmpegPath()).toBe('ffmpeg');
    process.env.FFMPEG_PATH = '/opt/ffmpeg/bin/ffmpeg';
    expect(resolveFfmpegPath()).toBe('/opt/ffmpeg/bin/ffmpeg');
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

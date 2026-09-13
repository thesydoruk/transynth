import { encodeLipJob, parseFxwLine } from '../faceFxServe';

describe('encodeLipJob', () => {
  it('writes length-prefixed UTF-8 text after the path lines', () => {
    const text = 'prihveet';
    const buf = encodeLipJob({
      language: 'USEnglish',
      fonixWinPath: 'Z:\\data\\tools\\FonixData.cdf',
      wavWinPath: 'Z:\\tmp\\fx.wav',
      lipWinPath: 'Z:\\tmp\\out.lip',
      text,
    });
    const raw = buf.toString('binary');
    expect(
      raw.startsWith(
        'LIP\nUSEnglish\nZ:\\data\\tools\\FonixData.cdf\nZ:\\tmp\\fx.wav\nZ:\\tmp\\out.lip\n8\n',
      ),
    ).toBe(true);
    expect(raw.endsWith(`${text}\n`)).toBe(true);
    expect(buf.subarray(buf.length - text.length - 1, buf.length - 1).toString('utf8')).toBe(text);
  });

  it('prefixes Ukrainian UTF-8 by byte length', () => {
    const text = 'Привіт';
    const buf = encodeLipJob({
      language: 'Ukrainian',
      fonixWinPath: 'Z:\\FonixData.cdf',
      wavWinPath: 'Z:\\in.wav',
      lipWinPath: 'Z:\\out.lip',
      text,
    });
    const bytes = Buffer.from(text, 'utf8');
    expect(
      buf
        .toString('binary')
        .startsWith(
          `LIP\nUkrainian\nZ:\\FonixData.cdf\nZ:\\in.wav\nZ:\\out.lip\n${bytes.length}\n`,
        ),
    ).toBe(true);
    expect(buf.subarray(buf.length - bytes.length - 1, buf.length - 1).toString('utf8')).toBe(text);
  });
});

describe('parseFxwLine', () => {
  it('parses READY, OK, ERR, and BYE', () => {
    expect(parseFxwLine('FXW READY Fallout4\r')).toEqual({ kind: 'ready', type: 'Fallout4' });
    expect(parseFxwLine('FXW OK')).toEqual({ kind: 'ok' });
    expect(parseFxwLine('FXW ERR LIP generation failed')).toEqual({
      kind: 'err',
      message: 'LIP generation failed',
    });
    expect(parseFxwLine('FXW BYE')).toEqual({ kind: 'bye' });
  });

  it('ignores Wine noise', () => {
    expect(parseFxwLine('wine: created the configuration directory')).toBeNull();
  });
});

import { describe, it, expect } from '@jest/globals';
import { decodeGameText } from '..';

const cp1252 = (text: string): Buffer => Buffer.from(text, 'latin1');

describe('decodeGameText', () => {
  it.each([
    ['é', '\xe9'],
    ['ç', '\xe7'],
    ['À', '\xc0'],
    ['’', '\x92'],
    ['“…” – €', '\x93\x85\x94 \x96 \x80'],
  ])('reads Windows-1252 %s', (text, bytes) => {
    expect(decodeGameText(cp1252(bytes))).toBe(text);
  });

  it.each(['plain ASCII', 'Café ’ — ™', 'Привіт', '日本語', '﻿with a BOM', 'kept � here'])(
    'leaves valid UTF-8 as it is: %s',
    (text) => {
      expect(decodeGameText(Buffer.from(text, 'utf8'))).toBe(text);
    },
  );

  it('maps every byte of the 0x80–0x9F block as Windows-1252 does', () => {
    const block = Buffer.from(Array.from({ length: 32 }, (_, i) => 0x80 + i));
    expect(decodeGameText(block)).toBe('€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ');
  });

  it('decodes only the requested range and keeps the terminator', () => {
    const buf = cp1252('xxTouch\xe9.\0yy');
    expect(decodeGameText(buf, 2, 10)).toBe('Touché.\0');
  });

  it('reads a string that mixes both encodings as Windows-1252', () => {
    const mixed = Buffer.concat([Buffer.from('é', 'utf8'), cp1252(' \xe9')]);
    expect(decodeGameText(mixed)).toBe('Ã© é');
  });
});

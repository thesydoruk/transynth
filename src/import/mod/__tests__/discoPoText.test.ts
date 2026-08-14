import { describe, expect, it } from '@jest/globals';
import type { PoEntry } from '../../../formats/po';
import { discoPoLocaleText, isDiscoPlaceholderMsgid } from '../discoPoText';

const entry = (partial: Partial<PoEntry> & Pick<PoEntry, 'msgid'>): PoEntry => ({
  msgctxt: partial.msgctxt ?? '',
  msgid: partial.msgid,
  msgstr: partial.msgstr ?? '',
  key: partial.key ?? `${partial.msgctxt ?? ''}::${partial.msgid}`,
});

describe('isDiscoPlaceholderMsgid', () => {
  it('treats empty and N/A as placeholders', () => {
    expect(isDiscoPlaceholderMsgid('')).toBe(true);
    expect(isDiscoPlaceholderMsgid('  ')).toBe(true);
    expect(isDiscoPlaceholderMsgid('N/A')).toBe(true);
    expect(isDiscoPlaceholderMsgid('n/a')).toBe(true);
  });

  it('keeps real English msgids', () => {
    expect(isDiscoPlaceholderMsgid('Hello')).toBe(false);
    expect(isDiscoPlaceholderMsgid('N/A lock')).toBe(false);
  });
});

describe('discoPoLocaleText', () => {
  it('uses msgstr when msgid is N/A (effects / passive checks)', () => {
    expect(
      discoPoLocaleText(
        entry({
          msgctxt: 'Dialogue Text/0x1_EFFECT',
          msgid: 'N/A',
          msgstr: ' Heal Volition [1]',
        }),
      ),
    ).toBe(' Heal Volition [1]');
  });

  it('prefers msgstr when both msgid and msgstr have text', () => {
    expect(discoPoLocaleText(entry({ msgid: 'Hello', msgstr: 'Привіт' }))).toBe('Привіт');
  });

  it('falls back to msgid when msgstr is empty', () => {
    expect(discoPoLocaleText(entry({ msgid: 'Hello', msgstr: '' }))).toBe('Hello');
  });

  it('returns empty msgstr for placeholder msgid with no translation', () => {
    expect(discoPoLocaleText(entry({ msgid: 'N/A', msgstr: '' }))).toBe('');
  });
});

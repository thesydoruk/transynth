import { describe, expect, it, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDiscoPoCsvRows, collectDiscoPoLocales } from '../discoPoLocales';

const EFFECTS_PO = `msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

msgctxt "Dialogue Text/0x01000058000060E5_EFFECT"
msgid "N/A"
msgstr " Heal Volition [1]"

msgctxt "Kim Kitsuragi-YARD-1"
msgid "This is the RCM."
msgstr "This is the RCM."
`;

describe('collectDiscoPoLocales', () => {
  let root = '';

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('stores msgstr when msgid is N/A and keeps the N/A path key', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'disco-po-locales-'));
    const lang = path.join(root, 'English_English_en');
    fs.mkdirSync(lang, { recursive: true });
    fs.writeFileSync(path.join(lang, 'DialoguesEffectsLockitEnglish.po'), EFFECTS_PO, 'utf8');

    const locales = collectDiscoPoLocales(root);
    const en = locales.get('en');
    expect(en).toBeDefined();
    const rows = buildDiscoPoCsvRows(en!.entries);
    const effect = rows.find((r) => r.Path.includes('_EFFECT'));
    const line = rows.find((r) => r.Path.includes('Kim'));

    expect(effect?.Source).toBe(' Heal Volition [1]');
    expect(effect?.Path).toContain('::N/A');
    expect(effect?.Signature).toBe('FX');
    expect(line?.Source).toBe('This is the RCM.');
    expect(line?.Signature).toBe('DLG');
  });
});

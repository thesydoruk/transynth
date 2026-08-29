import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoLangFolderNameForLocale,
  discoverDiscoLangFolders,
  hasDiscoPoPack,
  parseDiscoLangFolderName,
  parsePoBuffer,
  poEntryKey,
  writePoWithOverlays,
} from '../index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'sample.po');

describe('parsePoBuffer', () => {
  it('parses entries and skips the header', () => {
    const entries = parsePoBuffer(fs.readFileSync(FIXTURE));
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.key).sort()).toEqual([
      '::Thought Cabinet',
      'Kim Kitsuragi-YARD-1::This is the RCM.',
      'UI::Save',
    ]);
    expect(entries.find((e) => e.msgctxt.startsWith('Kim'))!.msgstr).toBe('This is the RCM.');
  });
});

describe('writePoWithOverlays', () => {
  it('overlays msgstr by entry key and round-trips', () => {
    const source = fs.readFileSync(FIXTURE);
    const overlays = new Map<string, string>([
      [poEntryKey('Kim Kitsuragi-YARD-1', 'This is the RCM.'), 'Це РГМ.'],
      [poEntryKey('', 'Thought Cabinet'), 'Кабінет думок'],
    ]);
    const compiled = writePoWithOverlays(source, overlays);
    const entries = parsePoBuffer(compiled);
    const byKey = new Map(entries.map((e) => [e.key, e.msgstr]));
    expect(byKey.get('Kim Kitsuragi-YARD-1::This is the RCM.')).toBe('Це РГМ.');
    expect(byKey.get('::Thought Cabinet')).toBe('Кабінет думок');
    expect(byKey.get('UI::Save')).toBe('Save');
  });
});

describe('discoPackLayout', () => {
  it('parses Final Cut folder names', () => {
    expect(parseDiscoLangFolderName('English_English_en')).toMatchObject({
      locale: 'en',
      displayName: 'English',
      englishName: 'English',
    });
    expect(parseDiscoLangFolderName('Ukrainian_Ukrainian_uk')?.locale).toBe('uk');
    expect(parseDiscoLangFolderName('Interface')).toBeNull();
  });

  it('builds Ukrainian folder name', () => {
    expect(discoLangFolderNameForLocale('uk')).toBe('Ukrainian_Ukrainian_uk');
  });

  it('discovers language folders with .po files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disco-po-'));
    try {
      const langDir = path.join(tmp, 'English_English_en');
      fs.mkdirSync(langDir);
      fs.copyFileSync(FIXTURE, path.join(langDir, 'Dialogues.po'));
      expect(hasDiscoPoPack(tmp)).toBe(true);
      const folders = discoverDiscoLangFolders(tmp);
      expect(folders).toHaveLength(1);
      expect(folders[0]!.locale).toBe('en');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

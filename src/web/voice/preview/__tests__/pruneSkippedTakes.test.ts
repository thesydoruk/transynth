import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../../../db';
import '../../../../games';
import { gamePlugin } from '../../../../games/registry';
import { toDiskPath } from '../../../../modImport';
import {
  modImportLocalizeDir,
  modImportLocalizeRoot,
  modStorageRoot,
} from '../../../../modStorage/paths';
import type { VoiceFileEntry } from '../../../../voice/discoverVoiceFiles';
import type { VoiceLineCatalog } from '../../../../voice/lineCatalog';
import { voiceTranslationMapKey } from '../../../../voice/loadVoiceTranslations';
import { BETHESDA_VOICE_MARKUP } from '../../../../voice/prepareVoiceTtsText';
import { originFormidKey } from '../../../../voice/voiceOrigin';
import { resolveVoicePackageContext } from '../context';
import { pruneSkippedTakesOfCatalog } from '../pruneSkippedTakes';

const write = (file: string): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
  return file;
};

const ORIGIN = 'demo.esp';
const entryOf = (speaker: string, formid: string): VoiceFileEntry => ({
  relPath: `Sound/Voice/Demo.esp/${speaker}/${formid}_1.fuz`,
  absolutePath: '',
  fileName: `${formid}_1.fuz`,
  lineKey: formid.slice(2),
  variant: 1,
  ext: 'fuz',
  originPlugin: ORIGIN,
});

describe('pruneSkippedTakesOfCatalog', () => {
  const modId = 910_000 + (process.pid % 10_000);
  const voice = gamePlugin('fo4').voice!;
  let extractRoot: string;
  let uk: string;
  let catalog: VoiceLineCatalog;

  const BARK = entryOf('DemoVoice', '000219D8');
  const BARK_OTHER = entryOf('OtherVoice', '000219D8');
  const SPEECH = entryOf('DemoVoice', '00825D9B');
  const UNDUBBED_BARK = entryOf('DemoVoice', '000219D9');
  const lines: Array<[VoiceFileEntry, string, string]> = [
    [BARK, 'Nuh.', 'Не-а.'],
    [BARK_OTHER, 'Nuh.', 'Не-а.'],
    [SPEECH, 'Hello there.', 'Привіт.'],
    [UNDUBBED_BARK, 'Yeagh!', 'Є-е-ах!'],
  ];
  const takeOf = (entry: VoiceFileEntry): string =>
    toDiskPath(uk, voice.localizedTakeRelPath(entry));

  beforeEach(() => {
    extractRoot = path.join(modStorageRoot(), `_extracted_prune_${process.pid}_${Date.now()}`);
    const pluginPath = write(path.join(extractRoot, 'Demo.esp'));
    for (const [entry] of lines) write(path.join(extractRoot, ...entry.relPath.split('/')));
    uk = modImportLocalizeDir(extractRoot, 'uk');
    for (const entry of [BARK, BARK_OTHER, SPEECH]) write(takeOf(entry));

    const rows = lines.map(([entry, source, translation]) => ({
      key: voiceTranslationMapKey(entry.lineKey, entry.variant, entry.originPlugin),
      row: { source, translation, edid: null, stringId: 1, infoFormidHex: entry.fileName },
    }));
    catalog = {
      ok: true,
      modId,
      ctx: resolveVoicePackageContext(pluginPath, 'uk')!,
      voiceFiles: lines.map(([entry]) => entry),
      sources: new Map(rows.map(({ key, row }) => [key, row])),
      translations: new Map(rows.map(({ key, row }) => [key, row])),
      inheritedLookup: null,
      sourceFormids: new Set(lines.map(([entry]) => originFormidKey(ORIGIN, entry.lineKey))),
      speakerRefs: {},
      voiceSimilarities: new Map(),
      markupStyle: BETHESDA_VOICE_MARKUP,
      speakerKeyOf: (entry: VoiceFileEntry) => entry.relPath.split('/')[3]!,
      hasLocalizedTake: (entry: VoiceFileEntry) => fs.existsSync(takeOf(entry)),
    } as unknown as VoiceLineCatalog;
  });

  afterEach(() => {
    fs.rmSync(extractRoot, { recursive: true, force: true });
    fs.rmSync(modImportLocalizeRoot(extractRoot), { recursive: true, force: true });
  });

  const fakeDb = (deletes: unknown[][]): Tx =>
    ({
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.startsWith('DELETE')) deletes.push(params);
        return { rows: [], rowCount: sql.startsWith('DELETE') ? 1 : 0 };
      },
    }) as unknown as Tx;

  it('only counts on a dry run', async () => {
    const deletes: unknown[][] = [];
    const result = await pruneSkippedTakesOfCatalog(fakeDb(deletes), catalog, voice, 'uk');

    expect(result).toMatchObject({
      lines: 2,
      byReason: { phonetic_vocalization: 2 },
      takesRemoved: 0,
      stampsRemoved: 0,
    });
    expect(result.samples[0]).toBe('DemoVoice 0219D8_1 "Nuh." → "Не-а."');
    expect(deletes).toEqual([]);
    for (const entry of [BARK, BARK_OTHER, SPEECH]) expect(fs.existsSync(takeOf(entry))).toBe(true);
  });

  it('removes the takes of skipped lines and leaves speech alone', async () => {
    const deletes: unknown[][] = [];
    const result = await pruneSkippedTakesOfCatalog(fakeDb(deletes), catalog, voice, 'uk', {
      apply: true,
    });

    expect(result).toMatchObject({ lines: 2, takesRemoved: 2, stampsRemoved: 2 });
    expect(fs.existsSync(takeOf(BARK))).toBe(false);
    expect(fs.existsSync(takeOf(BARK_OTHER))).toBe(false);
    expect(fs.existsSync(takeOf(SPEECH))).toBe(true);
    // The original takes stay.
    for (const [entry] of lines) {
      expect(fs.existsSync(path.join(extractRoot, ...entry.relPath.split('/')))).toBe(true);
    }
    expect(deletes).toEqual([
      [modId, '0219D8', 1, 'uk', 'DemoVoice', ORIGIN],
      [modId, '0219D8', 1, 'uk', 'OtherVoice', ORIGIN],
    ]);
  });

  it('finds nothing the second time', async () => {
    await pruneSkippedTakesOfCatalog(fakeDb([]), catalog, voice, 'uk', { apply: true });
    const again = await pruneSkippedTakesOfCatalog(fakeDb([]), catalog, voice, 'uk', {
      apply: true,
    });
    expect(again).toMatchObject({ lines: 0, takesRemoved: 0 });
  });
});

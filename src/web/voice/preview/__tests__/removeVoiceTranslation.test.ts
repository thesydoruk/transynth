import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../../../db';
import { toDiskPath } from '../../../../modImport';
import {
  modImportLocalizeDir,
  modImportLocalizeRoot,
  modStorageRoot,
} from '../../../../modStorage/paths';
import { PATHS } from '../../../../paths';
import { cachedPreviewWavPath } from '../audioCache';
import { resolveVoicePackageContext } from '../context';
import {
  removeLocalizedTakeFiles,
  removeVoiceTranslationForMod,
  voiceLocalizeDirsFor,
} from '../removeVoiceTranslation';

const write = (file: string, body = 'x'): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
};

const NORA = 'Sound/Voice/Demo.esp/DemoVoice/00825D9B_1.fuz';
const NATE = 'Sound/Voice/Demo.esp/OtherVoice/00825D9B_1.fuz';

describe('removeLocalizedTakeFiles', () => {
  let root: string;
  let localizeDir: string;
  let cacheDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-take-'));
    localizeDir = path.join(root, '_localize_x', 'uk');
    cacheDir = path.join(root, 'cache');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const remove = (takeRelPath: string, sidecarExtensions: string[] = []) =>
    removeLocalizedTakeFiles({
      localizeDir,
      takeRelPath,
      entry: { relPath: takeRelPath },
      sidecarExtensions,
      previewCacheDir: cacheDir,
    });

  it('removes the take, its sidecar and its browser copy, and nothing else', () => {
    const rel = 'Sound/Voice/Demo.esm/Npc/00ae4a02.wem';
    const take = write(toDiskPath(localizeDir, rel));
    const animation = write(take.replace(/\.wem$/, '.ffxanim'));
    const cached = write(cachedPreviewWavPath(take, cacheDir));
    const marker = write(cached.replace(/\.wav$/, '.source'));
    const otherSpeaker = write(toDiskPath(localizeDir, 'Sound/Voice/Demo.esm/Npc2/00ae4a02.wem'));
    const otherLanguage = write(path.join(root, '_localize_x', 'de', ...rel.split('/')));
    const source = write(path.join(root, '_extracted_x', ...rel.split('/')));

    expect(remove(rel, ['.ffxanim'])).toBe(1);
    for (const gone of [take, animation, cached, marker]) expect(fs.existsSync(gone)).toBe(false);
    for (const kept of [otherSpeaker, otherLanguage, source]) {
      expect(fs.existsSync(kept)).toBe(true);
    }
  });

  it('is a no-op the second time and for a line never dubbed', () => {
    write(toDiskPath(localizeDir, NORA));
    expect(remove(NORA)).toBe(1);
    expect(remove(NORA)).toBe(0);
    expect(remove(NATE)).toBe(0);
  });

  it('also removes a copy an older run left under another extension', () => {
    const fuz = write(toDiskPath(localizeDir, NORA));
    const wav = write(fuz.replace(/\.fuz$/, '.wav'));

    expect(remove(NORA)).toBe(2);
    expect(fs.existsSync(fuz)).toBe(false);
    expect(fs.existsSync(wav)).toBe(false);
  });

  it('never deletes outside the localize tree', () => {
    const outside = write(path.join(root, '_extracted_x', 'Demo', '00825D9B_1.fuz'));
    expect(remove('../../_extracted_x/Demo/00825D9B_1.fuz')).toBe(0);
    expect(fs.existsSync(outside)).toBe(true);
  });
});

describe('removeVoiceTranslationForMod', () => {
  const modId = 900_000 + (process.pid % 10_000);
  const previewDir = path.join(PATHS.voicePreview, String(modId));
  let extractRoot: string;
  let pluginPath: string;

  beforeEach(() => {
    extractRoot = path.join(modStorageRoot(), `_extracted_removetake_${process.pid}_${Date.now()}`);
    pluginPath = write(path.join(extractRoot, 'Demo.esp'));
    write(path.join(extractRoot, ...NORA.split('/')));
    write(path.join(extractRoot, ...NATE.split('/')));
  });

  afterEach(() => {
    fs.rmSync(extractRoot, { recursive: true, force: true });
    fs.rmSync(modImportLocalizeRoot(extractRoot), { recursive: true, force: true });
    fs.rmSync(previewDir, { recursive: true, force: true });
  });

  /** Answers the mod lookups and records the stamp delete. */
  const fakeDb = (queries: Array<{ sql: string; params: unknown[] }>): Tx =>
    ({
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('FROM mods')) {
          return { rows: [{ name: 'Demo', abs_path: pluginPath, game: 'fo4' }] };
        }
        return { rows: [], rowCount: sql.startsWith('DELETE') ? 1 : 0 };
      },
    }) as unknown as Tx;

  it("removes one speaker's take in one language and forgets its stamp", async () => {
    const uk = modImportLocalizeDir(extractRoot, 'uk');
    const nora = write(toDiskPath(uk, NORA));
    const nate = write(toDiskPath(uk, NATE));
    const german = write(toDiskPath(modImportLocalizeDir(extractRoot, 'de'), NORA));
    const cached = write(cachedPreviewWavPath(nora, path.join(previewDir, 'translation')));
    const queries: Array<{ sql: string; params: unknown[] }> = [];

    const result = await removeVoiceTranslationForMod(
      fakeDb(queries),
      modId,
      '825D9B',
      1,
      'en',
      'uk',
      'DemoVoice',
      'demo.esp',
    );

    expect(result).toEqual({ ok: true, takesRemoved: 1, stampsRemoved: 1 });
    expect(fs.existsSync(nora)).toBe(false);
    expect(fs.existsSync(cached)).toBe(false);
    for (const kept of [nate, german, path.join(extractRoot, ...NORA.split('/'))]) {
      expect(fs.existsSync(kept)).toBe(true);
    }
    const stamp = queries.find((query) => query.sql.includes('DELETE FROM voice_synthesis_state'));
    expect(stamp?.params).toEqual([modId, '825D9B', 1, 'uk', 'DemoVoice', 'demo.esp']);
  });

  it('answers ok with nothing removed for a line without a take', async () => {
    const result = await removeVoiceTranslationForMod(
      fakeDb([]),
      modId,
      '825D9B',
      1,
      'en',
      'uk',
      'DemoVoice',
    );
    expect(result).toEqual({ ok: true, takesRemoved: 0, stampsRemoved: 1 });
  });

  it('reports a line the mod has no take of', async () => {
    const result = await removeVoiceTranslationForMod(fakeDb([]), modId, 'ABCDEF', 1, 'en', 'uk');
    expect(result).toMatchObject({ ok: false, reason: 'line_not_found' });
  });

  it("does not take a tree of the import's other language for this one", () => {
    const de = modImportLocalizeDir(extractRoot, 'de');
    write(toDiskPath(de, NORA));
    const ctx = resolveVoicePackageContext(pluginPath, 'uk')!;
    // The editor falls back to the import's localize tree when it has none for the language.
    ctx.localizeDir = de;

    expect(voiceLocalizeDirsFor(ctx, 'uk')).toEqual([]);
    write(toDiskPath(modImportLocalizeDir(extractRoot, 'uk'), NORA));
    expect(voiceLocalizeDirsFor(ctx, 'uk')).toEqual([
      path.resolve(modImportLocalizeDir(extractRoot, 'uk')),
    ]);
  });
});

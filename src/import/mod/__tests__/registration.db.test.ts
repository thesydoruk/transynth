import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { afterEach, describe, expect, it } from '@jest/globals';
import { registerArchiveFile, registerPluginFile } from '../registration';
import { useTestDb } from '../../../testing/testDb';
import { makeModDir, npcPlugin } from '../../../testing/espFixture';

describe('registering an upload as an import job', () => {
  const db = useTestDb();
  const dirs: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of dirs.splice(0)) cleanup();
  });

  const modDir = () => {
    const dir = makeModDir();
    dirs.push(dir.cleanup);
    return dir;
  };

  const writePlugin = (dir: string, name: string, plugin: Buffer) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, plugin);
    return file;
  };

  const zip = (file: string, entries: Record<string, Buffer | string>) =>
    new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(file);
      const archive = archiver('zip');
      out.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(out);
      for (const [name, data] of Object.entries(entries)) archive.append(data, { name });
      void archive.finalize();
    });

  const jobCount = async () =>
    (await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM mod_imports`)).rows[0]!.n;

  describe('a plugin', () => {
    it('becomes a pending job sized by the strings it holds', async () => {
      const { modDir: dir } = modDir();
      const plugin = writePlugin(dir, 'Settlers.esp', npcPlugin(['Sturges', 'Preston Garvey']));

      const job = await registerPluginFile(db(), 'Settlers.esp', plugin, 'en', 'uk', 'fo4');

      expect(job).toMatchObject({
        file_name: 'Settlers.esp',
        status: 'pending',
        total_records: 2,
        is_localized: 0,
        src_lang: 'en',
        tgt_lang: 'uk',
        game: 'fo4',
        esp_path: plugin,
        mod_id: null,
      });
    });

    it('notes a localized plugin, whose text lives in string tables', async () => {
      const { modDir: dir } = modDir();
      const plugin = writePlugin(dir, 'Localized.esp', npcPlugin(['Sturges'], true));

      const job = await registerPluginFile(db(), 'Localized.esp', plugin, 'en', 'uk', 'fo4');

      expect(job.is_localized).toBe(1);
    });

    it('returns the existing job for the same file uploaded again, under any name', async () => {
      const { modDir: dir } = modDir();
      const bytes = npcPlugin(['Sturges']);
      const first = await registerPluginFile(
        db(),
        'A.esp',
        writePlugin(dir, 'A.esp', bytes),
        'en',
        'uk',
      );

      const again = await registerPluginFile(
        db(),
        'B.esp',
        writePlugin(dir, 'B.esp', bytes),
        'en',
        'uk',
      );

      expect(again.id).toBe(first.id);
      expect(await jobCount()).toBe(1);
    });

    it('fills in Nexus details on a re-upload, and never overwrites them', async () => {
      const { modDir: dir } = modDir();
      const plugin = writePlugin(dir, 'Settlers.esp', npcPlugin(['Sturges']));
      await registerPluginFile(db(), 'Settlers.esp', plugin, 'en', 'uk');

      await registerPluginFile(db(), 'Settlers.esp', plugin, 'en', 'uk', 'fo4', {
        nexusModId: 101,
        nexusModName: 'Settlers',
      });
      await registerPluginFile(db(), 'Settlers.esp', plugin, 'en', 'uk', 'fo4', {
        nexusModId: 999,
        nexusModName: 'Wrong',
      });

      const { rows } = await db().query(`SELECT nexus_mod_id, nexus_mod_name FROM mod_imports`);
      expect(rows).toEqual([{ nexus_mod_id: 101, nexus_mod_name: 'Settlers' }]);
    });
  });

  describe('an archive', () => {
    it('is unpacked and anchored on the plugin inside it', async () => {
      const { root } = modDir();
      const archivePath = path.join(root, 'Settlers.zip');
      await zip(archivePath, { 'Data/Settlers.esp': npcPlugin(['Sturges', 'Preston Garvey']) });
      const extractDir = path.join(root, 'extracted');

      const job = await registerArchiveFile(
        db(),
        'Settlers.zip',
        archivePath,
        extractDir,
        'en',
        'uk',
        'fo4',
      );

      expect(job).toMatchObject({ file_name: 'Settlers.zip', total_records: 2, status: 'pending' });
      expect(path.basename(job.esp_path ?? '')).toBe('Settlers.esp');
      expect(path.resolve(job.esp_path ?? '').startsWith(path.resolve(extractDir))).toBe(true);
    });

    it('is refused when it holds nothing this game can import', async () => {
      const { root } = modDir();
      const archivePath = path.join(root, 'Readme.zip');
      await zip(archivePath, { 'readme.txt': 'Just a readme.' });

      await expect(
        registerArchiveFile(
          db(),
          'Readme.zip',
          archivePath,
          path.join(root, 'out'),
          'en',
          'uk',
          'fo4',
        ),
      ).rejects.toThrow(/no files this game can import/);
      expect(await jobCount()).toBe(0);
    });

    it('is not unpacked again when its hash is already known', async () => {
      const { modDir: dir, root } = modDir();
      const plugin = writePlugin(dir, 'Settlers.esp', npcPlugin(['Sturges']));
      const first = await registerPluginFile(db(), 'Settlers.esp', plugin, 'en', 'uk');

      const again = await registerArchiveFile(
        db(),
        'Settlers.zip',
        path.join(root, 'does-not-exist.zip'),
        path.join(root, 'never-created'),
        'en',
        'uk',
        'fo4',
        undefined,
        first.file_hash,
      );

      expect(again.id).toBe(first.id);
      expect(fs.existsSync(path.join(root, 'never-created'))).toBe(false);
    });
  });
});

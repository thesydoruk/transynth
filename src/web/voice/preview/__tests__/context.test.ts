import fs from 'node:fs';
import path from 'node:path';
import { creationEngineVoiceAdapter } from '../../../../games/creation-engine/voice';
import { resolveImportPackages, toDiskPath } from '../../../../modImport';
import { modImportLocalizeRoot, modStorageRoot } from '../../../../modStorage/paths';
import { resolveVoicePackageContext } from '../context';
import { buildTranslationAudioSet, hasTranslationAudioForEntry } from '../translationAudioIndex';
import { discoverVoiceEntries } from '../voiceEntries';

const TAKE = 'Sound/Voice/Demo.esp/DemoVoice/00825D9B_1.fuz';

const write = (file: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
};

describe('resolveVoicePackageContext', () => {
  const extractRoots: string[] = [];

  /** An extract tree with the plugin and one take under `pluginDir` (`''` or `Data`). */
  const makeExtract = (pluginDir: string): { extractRoot: string; pluginPath: string } => {
    const extractRoot = path.join(
      modStorageRoot(),
      `_extracted_voicectx_${process.pid}_${extractRoots.length}_${Date.now()}`,
    );
    extractRoots.push(extractRoot);
    const pluginPath = path.join(extractRoot, pluginDir, 'Demo.esp');
    write(pluginPath);
    write(path.join(extractRoot, pluginDir, ...TAKE.split('/')));
    return { extractRoot, pluginPath };
  };

  afterEach(() => {
    for (const extractRoot of extractRoots.splice(0)) {
      fs.rmSync(extractRoot, { recursive: true, force: true });
      fs.rmSync(modImportLocalizeRoot(extractRoot), { recursive: true, force: true });
    }
  });

  it.each(['', 'Data'])(
    'sees the take the voice job wrote when the plugin sits in "%s"',
    (pluginDir) => {
      const { extractRoot, pluginPath } = makeExtract(pluginDir);

      // Where the mod-wide job puts the dub: its own package, its own take path.
      const pkg = resolveImportPackages(extractRoot, 'uk', pluginPath)[0]!;
      const jobEntries = discoverVoiceEntries({
        packageDir: pkg.packageDir,
        pluginRel: path.relative(pkg.packageDir, pluginPath).replace(/\\/g, '/'),
        pluginPath,
        localizeDir: pkg.localizeDir,
      });
      expect(jobEntries).toHaveLength(1);
      write(toDiskPath(pkg.localizeDir, jobEntries[0]!.relPath));

      const ctx = resolveVoicePackageContext(pluginPath, 'uk');
      expect(ctx).not.toBeNull();
      const entries = discoverVoiceEntries(ctx!);
      expect(entries).toHaveLength(1);
      const dubbed = buildTranslationAudioSet(ctx!.localizeDir, creationEngineVoiceAdapter);
      expect(hasTranslationAudioForEntry(dubbed, entries[0]!)).toBe(true);
    },
  );
});

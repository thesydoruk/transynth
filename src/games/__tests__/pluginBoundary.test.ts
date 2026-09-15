/**
 * The plugin boundary, enforced rather than remembered.
 *
 * `GamePlugin`'s contract says a plugin is the only place a game id may be
 * reasoned about: shared code looks one up with `gamePlugin(id)` and calls
 * through the adapters. That rule is easy to state and easy to erode — one
 * `game === 'disco'` at a time — and every erosion is a place a new title
 * silently gets Fallout's behaviour or none at all.
 *
 * So the rule is a test. Both checks scan source rather than behaviour, which
 * is unusual, but the thing being protected is a property of the layout: no
 * runtime assertion can notice a `switch` that happens to have the right arms
 * today.
 */
import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allGameIds } from '../registry';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCANNED = ['src', 'worker/src', 'scripts'];
const PLUGIN_TREE = path.join('src', 'games') + path.sep;

const sourceFiles = (dir: string): string[] => {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      found.push(...sourceFiles(rel));
      continue;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(rel);
  }
  return found;
};

/** Files outside the plugin tree, normalized to forward slashes. */
const nonPluginFiles = (): Array<{ rel: string; text: string }> =>
  SCANNED.flatMap(sourceFiles)
    .filter((rel) => !rel.startsWith(PLUGIN_TREE))
    .map((rel) => ({
      rel: rel.split(path.sep).join('/'),
      text: fs.readFileSync(path.join(ROOT, rel), 'utf8'),
    }));

const isTest = (rel: string): boolean => rel.includes('__tests__/');

describe('no shared code branches on a specific game', () => {
  it('never compares a game id to a literal outside the plugin that owns it', () => {
    // `game === 'fo4'` is the shape every one of these violations took: it reads
    // as a harmless special case and quietly means "and every other title gets
    // the else branch". Ask the plugin instead — add an adapter member if the
    // question it answers is new.
    const ids = allGameIds().join('|');
    const comparison = new RegExp(String.raw`[!=]==\s*['"\`](?:${ids})['"\`]`);

    const offenders = nonPluginFiles()
      .filter(({ rel }) => !isTest(rel))
      .filter(({ text }) => comparison.test(text))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });
});

/**
 * Layers that run for every game and must not name one game's record types.
 *
 * `src/formats/**` and the Bethesda import and query modules are that engine's
 * own domain and keep their vocabulary; these four are not, and each of them
 * used to decide something with a literal — `grup === 'TERM'`,
 * `signature === 'PEX'` — that is false for every game but one.
 */
const GAME_NEUTRAL_LAYERS = ['src/llm/', 'src/utils/', 'src/dialog/', 'worker/src/'];

describe('no game-neutral layer names a record type', () => {
  it('asks the plugin for the record kind instead of matching a signature', () => {
    // Any record type, not a list of the ones that happened to be here: the
    // next engine's vocabulary is unknown, so match the *shape* of the
    // decision — a grup or signature compared against a literal.
    //
    // Only decisions, not data: a prompt example that shows the model a payload
    // with `"grup": "INFO"` in it teaches the shape and branches on nothing.
    const decision = /\b(?:grup|signature)\w*\s*[!=]==\s*['"`]|\b(?:GRUPS?|SIGNATURES?)\w*\.has\(/i;

    const offenders = nonPluginFiles()
      .filter(({ rel }) => GAME_NEUTRAL_LAYERS.some((layer) => rel.startsWith(layer)))
      .filter(({ rel }) => !isTest(rel))
      .filter(({ text }) => decision.test(text))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });
});

/**
 * Modules outside `src/games/` that still import a plugin's internals.
 *
 * These are Creation Engine helpers that predate the plugin layout and sit in
 * shared folders — none of them branches between games, so none can give a new
 * title the wrong answer, but each is a file a new engine's author has to read
 * and decide about. The list is allowed to shrink and nothing else: a new entry
 * fails this test.
 */
const KNOWN_PLUGIN_IMPORTERS = [
  'src/import/dialogSpeakers/masterPlugins.ts',
  'src/import/mod/localeSources.ts',
  'src/import/stringsPack/espIndex.ts',
  'src/import/stringsPack/importStringsPack.ts',
  'src/locale/exportSlots.ts',
  'src/modImport/bethesdaArchivePaths.ts',
  'src/modImport/packBethesdaArchives.ts',
  'src/voice/faceFx/lipCore.ts',
  'src/web/export/archiveExportPlan.ts',
  'src/web/export/exportArchives.ts',
  'src/web/export/sourceStringsLoader.ts',
  'src/web/export/translationOverlay.ts',
];

describe('plugin internals stay inside the plugin', () => {
  it('grows no new importer of a plugin outside src/games', () => {
    const importsPlugin = /from\s+'[^']*games\/(?:creation-engine|disco-elysium)[^']*'/;

    const offenders = nonPluginFiles()
      // A test may reach for a concrete title as a fixture; production code may not.
      .filter(({ rel }) => !isTest(rel))
      .filter(({ text }) => importsPlugin.test(text))
      .map(({ rel }) => rel)
      .filter((rel) => !KNOWN_PLUGIN_IMPORTERS.includes(rel));

    expect(offenders).toEqual([]);
  });

  it('keeps the known list honest — every entry still importing a plugin', () => {
    // Stops the list outliving the debt: once a module is moved or cleaned up,
    // its line here has to go too.
    const importsPlugin = /from\s+'[^']*games\/(?:creation-engine|disco-elysium)[^']*'/;
    const stale = KNOWN_PLUGIN_IMPORTERS.filter((rel) => {
      const abs = path.join(ROOT, rel);
      return !fs.existsSync(abs) || !importsPlugin.test(fs.readFileSync(abs, 'utf8'));
    });

    expect(stale).toEqual([]);
  });
});

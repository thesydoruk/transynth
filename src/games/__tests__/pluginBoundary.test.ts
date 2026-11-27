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
 * Every plugin directory under `src/games/`, read from disk rather than listed,
 * so a newly added game is covered without anyone remembering to add it.
 */
const PLUGIN_DIRS = fs
  .readdirSync(path.join(ROOT, 'src', 'games'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !['contract', '__tests__'].includes(entry.name))
  .map((entry) => entry.name);

const importsPlugin = new RegExp(
  String.raw`from\s+'[^']*games\/(?:${PLUGIN_DIRS.join('|')})[/'][^']*'`,
);

describe('plugin internals stay inside the plugin', () => {
  it('finds the plugin directories it guards', () => {
    expect(PLUGIN_DIRS).toEqual(expect.arrayContaining(['creation-engine', 'disco-elysium']));
  });

  it('has no importer of a plugin outside src/games', () => {
    // Code only one plugin uses lives inside it; code several use takes explicit
    // parameters. Shared code that needs a game's answer asks through the contract.
    const offenders = nonPluginFiles()
      // A test may reach for a concrete title as a fixture; production code may not.
      .filter(({ rel }) => !isTest(rel))
      .filter(({ text }) => importsPlugin.test(text))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });
});

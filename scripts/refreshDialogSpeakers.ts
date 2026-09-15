/**
 * Re-resolve dialog speakers and addressees for mods that are already imported.
 *
 * The speaker table and the `dialog_nodes` addressee columns are written during
 * import, so a fix to how they are derived only reaches new imports. This
 * re-runs that one step against the files on disk, which is far cheaper than
 * re-importing and touches nothing else: strings, translations and review
 * status are left exactly as they are.
 *
 *   npm run dialog:refresh -- --mod 122
 *   npm run dialog:refresh -- --game fo4
 *   npm run dialog:refresh -- --all --dry-run
 *
 * How speakers are derived is each game's own business — a game whose plugin
 * declares no `refreshDialogSpeakers` has no dialog graph to re-read and is
 * skipped. Manual gender overrides survive either way: the resolver only ever
 * writes `detected_gender`.
 */
// Registers the game plugins; the registry lookups below depend on it.
import '../src/games';
import { openDb } from '../src/db';
import { log } from '../src/logger';
import { gamePlugin } from '../src/games/registry';

type Args = { modId: number | null; game: string | null; all: boolean; dryRun: boolean };

const parseArgs = (argv: string[]): Args => {
  const get = (name: string): string | null => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? (argv[index + 1] ?? null) : null;
  };
  return {
    modId: get('mod') ? Number(get('mod')) : null,
    game: get('game'),
    all: argv.includes('--all'),
    dryRun: argv.includes('--dry-run'),
  };
};

type ModRow = {
  id: number;
  name: string;
  game: string | null;
  abs_path: string | null;
  /** Locale the plugin's own strings were imported under. */
  src_lang: string | null;
};

const loadMods = async (args: Args): Promise<ModRow[]> => {
  const db = openDb();
  const filters = ['m.abs_path IS NOT NULL'];
  const params: unknown[] = [];

  if (args.modId != null) {
    params.push(args.modId);
    filters.push(`m.id = $${params.length}`);
  }
  if (args.game) {
    params.push(args.game);
    filters.push(`m.game = $${params.length}`);
  }

  const { rows } = await db.query<ModRow>(
    `SELECT DISTINCT ON (m.id)
            m.id, m.name, m.game, m.abs_path, mi.src_lang
       FROM mods m
       LEFT JOIN mod_imports mi ON mi.mod_id = m.id AND mi.status = 'completed'
      WHERE ${filters.join(' AND ')}
      ORDER BY m.id, mi.updated_at DESC`,
    params,
  );
  return rows;
};

const refreshMod = async (mod: ModRow, dryRun: boolean): Promise<void> => {
  const refresh = gamePlugin(mod.game).import.refreshDialogSpeakers;
  if (!refresh) {
    log.info(`mod ${mod.id} "${mod.name}": ${mod.game ?? 'no game'} has no dialog graph, skipping`);
    return;
  }

  const result = await refresh({
    db: openDb(),
    modId: mod.id,
    modPath: mod.abs_path!,
    srcLang: mod.src_lang ?? 'en',
    dryRun,
  });

  if (dryRun) {
    log.info(`mod ${mod.id} "${mod.name}": would re-resolve (${result.actors} actor record(s))`);
    return;
  }
  log.info(
    `mod ${mod.id} "${mod.name}": ${result.speakers} speaker(s), ${result.withGender} gendered, ` +
      `${result.recoveredSpeakers} node(s) named from a scene alias`,
  );
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (args.modId == null && !args.game && !args.all) {
    console.error('Pass --mod <id>, --game <id>, or --all.');
    process.exitCode = 1;
    return;
  }

  const mods = await loadMods(args);
  if (mods.length === 0) {
    console.error('No mods matched.');
    process.exitCode = 1;
    return;
  }

  log.info(
    `Refreshing dialog speakers for ${mods.length} mod(s)${args.dryRun ? ' (dry run)' : ''}`,
  );
  for (const mod of mods) {
    try {
      await refreshMod(mod, args.dryRun);
    } catch (err) {
      log.error(
        `mod ${mod.id} "${mod.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
};

await main();

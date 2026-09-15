/**
 * The mod row behind an import job, and the context every phase shares.
 *
 * The context type itself lives in the game plugin contract — it is what a
 * plugin's `ingest` receives — and is re-exported here so the ingestion
 * modules can import it from one place.
 */
import { upsertMod, upsertVortexMod } from '../../../db';
import { logImport } from '../../../logging/loggers';
import { parseVortexModFolder } from '../../../utils/vortexFolder';
import { inferModVersionLabel } from '../../../vortex/versionLabel';
import { deriveModNameFromFileName } from '../jobs';

export type { ModImportRunContext } from '../../../games/contract';
import type { ModImportRunContext } from '../../../games/contract';

/**
 * Create (or reuse) the `mods` row this import writes into, and link the job
 * to it so a resumed run keeps the same mod.
 */
export const ensureImportModId = async (ctx: ModImportRunContext): Promise<number> => {
  if (ctx.importModId != null) return ctx.importModId;

  const modName =
    ctx.job.nexus_mod_name?.trim() ||
    (ctx.job.source_folder ? parseVortexModFolder(ctx.job.source_folder)?.modName : null) ||
    deriveModNameFromFileName(ctx.job.file_name);
  const versionHash = ctx.job.file_hash.includes(':')
    ? ctx.job.file_hash.slice(ctx.job.file_hash.indexOf(':') + 1)
    : ctx.job.file_hash;
  const channel = ctx.job.source_folder ? 'mods' : 'game';

  let gameReleaseLabel: string | null = null;
  if (ctx.job.vortex_group_id != null && channel === 'game') {
    const { rows: releaseRows } = await ctx.db.query<{ version_label: string }>(
      `SELECT version_label FROM vortex_game_releases
       WHERE vortex_group_id = $1 AND is_current = TRUE
       ORDER BY created_at DESC LIMIT 1`,
      [ctx.job.vortex_group_id],
    );
    gameReleaseLabel = releaseRows[0]?.version_label ?? null;
  }

  const versionLabel = inferModVersionLabel({
    sourceFolder: ctx.job.source_folder,
    channel,
    gameReleaseLabel,
    contentHash: versionHash,
  });

  const importModId =
    ctx.job.vortex_group_id != null
      ? await upsertVortexMod(ctx.db, {
          name: modName,
          absPath: ctx.anchorPath,
          versionHash,
          game: ctx.game,
          groupId: ctx.job.vortex_group_id,
          channel,
          versionLabel,
          nexus: {
            nexusModId: ctx.job.nexus_mod_id ?? undefined,
            nexusName: ctx.job.nexus_mod_name ?? undefined,
          },
        })
      : await upsertMod(ctx.db, modName, ctx.anchorPath, versionHash, ctx.game, {
          nexusModId: ctx.job.nexus_mod_id ?? undefined,
          nexusName: ctx.job.nexus_mod_name ?? undefined,
        });

  if (ctx.job.nexus_mod_id) {
    logImport.info(
      `[Mod Import #${ctx.job.id}] Nexus link: mod ${ctx.job.nexus_mod_id}${
        ctx.job.nexus_mod_name ? ` (${ctx.job.nexus_mod_name})` : ''
      }`,
    );
  }

  await ctx.db.query('UPDATE mod_imports SET mod_id = $1, updated_at = NOW() WHERE id = $2', [
    importModId,
    ctx.job.id,
  ]);
  ctx.importModId = importModId;
  return importModId;
};

/**
 * The Papyrus source line behind one PEX string row, for the mod editor.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { collectModPexSources } from '../../formats/pex';
import { ensureChampollionInstalled } from '../../formats/pex/champollion';
import { decompilePexScript, type DecompiledPexScript } from '../../formats/pex/pexDecompile';
import {
  locatePexLiteralInPsc,
  pexScriptKeyFromRecordPath,
  type PexSourceLocateResult,
} from '../../formats/pex/pexSourceLocate';
import { parsePexStoredContext } from '../../formats/pex/pexStoredContext';
import { log } from '../../logger';

export type PexSourceSnippetResult =
  | { ok: true; snippet: PexSourceLocateResult }
  | {
      ok: false;
      reason:
        | 'not_pex'
        | 'mod_not_found'
        | 'string_not_found'
        | 'pex_not_found'
        | 'decompiler_missing'
        | 'decompile_failed'
        | 'literal_not_found';
      message: string;
    };

/**
 * Decompile the owning `.pex` and locate the Papyrus source line for one PEX string row.
 */
export const getPexSourceSnippetForString = async (
  db: Tx,
  modId: number,
  stringId: number,
): Promise<PexSourceSnippetResult> => {
  const { rows } = await db.query<{
    signature: string | null;
    path: string | null;
    text_raw: string;
    context: string | null;
    abs_path: string | null;
  }>(
    `SELECT r.signature, r.path, s.text_raw, s.context, m.abs_path
       FROM strings s
       JOIN records r ON s.record_id = r.id
       JOIN mods m ON r.mod_id = m.id
      WHERE s.id = $1 AND r.mod_id = $2`,
    [stringId, modId],
  );

  const row = rows[0];
  if (!row) {
    return { ok: false, reason: 'string_not_found', message: 'String row not found' };
  }
  if (row.signature !== 'PEX') {
    return { ok: false, reason: 'not_pex', message: 'Not a PEX string row' };
  }

  const stored = parsePexStoredContext(row.context);
  if (stored) {
    return { ok: true, snippet: stored };
  }
  if (!row.abs_path || !fs.existsSync(row.abs_path)) {
    return { ok: false, reason: 'mod_not_found', message: 'Mod plugin file not found on disk' };
  }

  const scriptKey = pexScriptKeyFromRecordPath(row.path ?? '');
  if (!scriptKey) {
    return { ok: false, reason: 'pex_not_found', message: 'Invalid PEX record path' };
  }

  const sources = collectModPexSources(row.abs_path);
  const pexSource = sources.get(scriptKey) ?? null;

  if (!pexSource) {
    return {
      ok: false,
      reason: 'pex_not_found',
      message: `Compiled script not found for ${scriptKey}`,
    };
  }

  try {
    await ensureChampollionInstalled();
  } catch {
    return {
      ok: false,
      reason: 'decompiler_missing',
      message: 'Champollion not available. Rebuild the Docker image.',
    };
  }

  let script: DecompiledPexScript;
  try {
    script = await decompilePexScript(pexSource.data, scriptKey, modId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`PEX decompile failed mod=${modId} script=${scriptKey}: ${message}`);
    const reason = message.includes('Champollion not found')
      ? 'decompiler_missing'
      : 'decompile_failed';
    return { ok: false, reason, message };
  }

  const { headerSourceFile, pscSource } = script;
  const snippet = locatePexLiteralInPsc(pscSource, row.text_raw, {
    scriptLabel: path.basename(headerSourceFile || `${scriptKey}.psc`),
    headerSourceFile,
  });

  if (!snippet) {
    return {
      ok: false,
      reason: 'literal_not_found',
      message: 'Literal not found in decompiled source',
    };
  }

  return { ok: true, snippet };
};

import type { Tx } from '../../db';
import { patchPexBuffer, collectModPexSources } from '../../formats/pex';
import { log } from '../../logger';
import type { ExportedStringsFile } from './exportTypes';

/** Per-script overlay: source literal → export text. */
type PexScriptOverlays = Map<string, Map<string, string>>;

/**
 * Load translation overlays for all PEX rows of a mod.
 *
 * Keys are lowercased script names (`PEX\\{script}` path suffix).
 */
export const getPexTranslationOverlays = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<PexScriptOverlays> => {
  const { rows } = await db.query(
    `SELECT r.path, s.text_raw AS source_text,
            COALESCE(t.text, s.text_raw) AS export_text
     FROM strings s
     JOIN records r ON r.id = s.record_id
     LEFT JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $3
     WHERE r.mod_id = $1 AND r.signature = 'PEX' AND s.lang = $2`,
    [modId, srcLang, targetLang],
  );

  const overlays: PexScriptOverlays = new Map();
  for (const row of rows as Array<{ path: string; source_text: string; export_text: string }>) {
    const match = row.path.match(/^PEX\\(.+)$/i);
    if (!match) continue;
    const scriptKey = match[1]!.toLowerCase();
    if (!overlays.has(scriptKey)) overlays.set(scriptKey, new Map());
    overlays.get(scriptKey)!.set(row.source_text, row.export_text);
  }
  return overlays;
};

/**
 * Export patched `.pex` files with translated string literals.
 *
 * Each returned file uses an archive-relative path such as `Scripts\\Foo.pex`.
 *
 * @param db - Database handle.
 * @param modId - Mod id whose PEX translations should be exported.
 * @param modPath - Absolute path to the imported plugin (used to locate sources).
 * @param srcLang - Source language code.
 * @param targetLang - Target language code.
 */
export const exportPatchedPexFiles = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
): Promise<ExportedStringsFile[]> => {
  const overlays = await getPexTranslationOverlays(db, modId, srcLang, targetLang);
  if (overlays.size === 0) {
    throw new Error(`No PEX strings found for mod ${modId} and locale ${srcLang}`);
  }

  const sources = collectModPexSources(modPath);
  if (sources.size === 0) {
    throw new Error(`No .pex source files found next to ${modPath}`);
  }

  const exported: ExportedStringsFile[] = [];
  for (const [scriptKey, source] of sources) {
    const overlay = overlays.get(scriptKey);
    if (!overlay || overlay.size === 0) continue;

    const patched = patchPexBuffer(source.data, overlay);
    const fileName = source.archivePath.replace(/\\/g, '/').split('/').pop() ?? `${scriptKey}.pex`;
    exported.push({
      fileName: source.archivePath.includes('\\') ? source.archivePath : `Scripts\\${fileName}`,
      size: patched.length,
      contentBase64: patched.toString('base64'),
    });
  }

  if (exported.length === 0) {
    throw new Error(`No matching .pex sources for PEX translations on mod ${modId}`);
  }

  exported.sort((left, right) =>
    left.fileName.localeCompare(right.fileName, undefined, { sensitivity: 'base' }),
  );
  log.info(`PEX export: ${exported.length} script(s) for mod ${modId}`);
  return exported;
};

import type { StringRow } from '../../../../../api';
import {
  formatPexStoredContextLabel,
  parsePexStoredContext,
} from '../../../../../utils/pexStoredContext';

/** Derive a minimal script label from a PEX record path (`PEX\\ScriptName`). */
export const pexScriptLabelFromPath = (recordPath: string): string | null => {
  const trimmed = recordPath.trim();
  if (!trimmed.toUpperCase().startsWith('PEX\\')) return null;
  const scriptKey = trimmed.slice(4).trim();
  if (!scriptKey) return null;
  return /\.psc$/i.test(scriptKey) ? scriptKey : `${scriptKey}.psc`;
};

/** Script context for PEX rows: import-time decompile snippet or legacy fallback. */
export const resolvePexScriptContext = (
  row: Pick<StringRow, 'signature' | 'context' | 'path'>,
): string | null => {
  if (row.signature !== 'PEX') return null;

  const stored = parsePexStoredContext(row.context);
  if (stored) return formatPexStoredContextLabel(stored);

  const legacy = row.context?.trim();
  if (legacy) return legacy;

  return pexScriptLabelFromPath(row.path ?? '');
};

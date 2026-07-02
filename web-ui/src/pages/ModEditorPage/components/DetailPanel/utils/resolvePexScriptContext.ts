import type { StringRow } from '../../../../../api';

/** Derive a minimal script label from a PEX record path (`PEX\\ScriptName`). */
export const pexScriptLabelFromPath = (recordPath: string): string | null => {
  const trimmed = recordPath.trim();
  if (!trimmed.toUpperCase().startsWith('PEX\\')) return null;
  const scriptKey = trimmed.slice(4).trim();
  if (!scriptKey) return null;
  return /\.psc$/i.test(scriptKey) ? scriptKey : `${scriptKey}.psc`;
};

/** Script context for PEX rows: stored context or path fallback for older imports. */
export const resolvePexScriptContext = (
  row: Pick<StringRow, 'signature' | 'context' | 'path'>,
): string | null => {
  if (row.signature !== 'PEX') return null;
  const stored = row.context?.trim();
  if (stored) return stored;
  return pexScriptLabelFromPath(row.path ?? '');
};

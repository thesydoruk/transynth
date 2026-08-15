/**
 * Classify Disco Final Cut `.po` rows into semantic record signatures.
 *
 * Path keys stay `PO\…` for export stability; only `records.signature` changes.
 */
import path from 'node:path';

/** Signatures written for Disco PO packs (includes legacy `PO`). */
export const DISCO_PO_SIGNATURES = ['PO', 'DLG', 'GEN', 'FX'] as const;

export type DiscoPoSignature = (typeof DISCO_PO_SIGNATURES)[number];

/** SQL-ready list for `signature = ANY($n::text[])`. */
export const discoPoSignatureSqlValues = (): string[] => [...DISCO_PO_SIGNATURES];

/**
 * Pick DLG / GEN / FX from the `.po` file name and msgctxt.
 * Falls back to `PO` when the pack layout is unfamiliar.
 */
export const classifyDiscoPoSignature = (relPo: string, msgctxt: string): DiscoPoSignature => {
  const ctx = msgctxt.trim();
  if (/_EFFECT\b/i.test(ctx)) return 'FX';

  const base = path.basename(relPo.replace(/\\/g, '/')).toLowerCase();
  if (base.includes('general') || /(^|[^a-z])ui([^a-z]|$)/i.test(base)) return 'GEN';
  if (base.includes('dialog')) return 'DLG';

  // Spoken lines often use the audio stem as msgctxt (`Kim Kitsuragi-YARD-1`).
  if (ctx.includes('-') || ctx.includes('_')) return 'DLG';

  return 'PO';
};

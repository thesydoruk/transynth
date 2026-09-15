/** Where a translation came from, at the granularity a reviewer acts on. */
export type LineOrigin = 'tm' | 'llm';

/**
 * Group `translations.provenance` into the distinction that changes how a line
 * is read.
 *
 * The column is detailed — `tm_auto_anchor`, `tm_auto_text_norm`,
 * `auto_generated` — and mostly uninteresting: `import_self_translation` alone
 * is the majority of rows and only means the source was carried over, which the
 * status already says. What a reviewer wants to spot is the machine-made ones,
 * so those get a tag and everything else gets none.
 */
export const lineOrigin = (provenance: string | null): LineOrigin | null => {
  if (!provenance) return null;
  if (provenance.startsWith('tm_')) return 'tm';
  if (provenance === 'auto_generated') return 'llm';
  return null;
};

/**
 * Where a string sits in its mod, as the LLM and RAG context see it.
 *
 * `grup` is Creation Engine's word for a record group, and it stuck as the
 * payload key: every game prompt documents it, so both games fill it with
 * whatever their own record types are. Nothing outside a plugin reads the
 * *value* — ask `text.recordKind(grup, field)` when a decision depends on it.
 */
export type RecordLocation = {
  /**
   * The game's own record type. `INFO`, `ARMO`, `WEAP` in a Bethesda plugin;
   * `PO`, `DLG`, `GEN`, `FX` in a Disco `.po` catalogue.
   */
  grup: string | null;
  /**
   * Field within the record. A Bethesda subrecord (`NAM1`, `FULL`, `DESC`),
   * or whatever the game names the slot the text came from.
   */
  field: string | null;
};

/**
 * Derive GRUP and FIELD from stored record metadata.
 *
 * `records.signature` is the GRUP; `records.path` is usually `GRUP\\FIELD`
 * but may be a bare field name when signature is set separately.
 */
export const parseRecordLocation = (
  signature: string | null | undefined,
  path: string | null | undefined,
): RecordLocation => {
  const grup = signature?.trim() || null;
  const rawPath = path?.trim() || null;

  if (!rawPath) {
    return { grup, field: null };
  }

  const segments = rawPath.split(/\\+/).filter(Boolean);
  if (segments.length === 0) {
    return { grup, field: null };
  }

  const rawField = segments[segments.length - 1] ?? null;
  const field = rawField?.includes('::')
    ? rawField.slice(0, rawField.indexOf('::')) || rawField
    : rawField;
  if (grup) {
    return { grup, field };
  }

  if (segments.length === 1) {
    return { grup: null, field };
  }

  return {
    grup: segments[0] ?? null,
    field,
  };
};

/** Parsed Bethesda record location for LLM / RAG context. */
export type RecordLocation = {
  /** Record type (GRUP), e.g. INFO, ARMO, WEAP. */
  grup: string | null;
  /** Subrecord / field name, e.g. NAM1, FULL, DESC. */
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

  const field = segments[segments.length - 1] ?? null;
  if (grup) {
    return { grup, field };
  }

  if (segments.length === 1) {
    return { grup: null, field: segments[0] ?? null };
  }

  return {
    grup: segments[0] ?? null,
    field,
  };
};

/**
 * Which subrecords of an ESP/ESM record hold translatable text.
 *
 * Every Creation Engine title ships a JSON config declaring the record types
 * to read and, within each, the subrecords that carry player-facing strings.
 * This module turns one such config into the lookup the ESP reader consults
 * per subrecord — it holds no per-title data itself, so a new title is a JSON
 * file next to its plugin, not an edit here.
 */

/** Map from subrecord signature to enabled/disabled toggle. */
type SubrecordToggleMap = Record<string, boolean>;

/** Per-record read flag and its subrecord toggles. */
interface RecordToggleConfig {
  read: boolean;
  subrecords: SubrecordToggleMap;
}

/** Full subrecord configuration for a single title, as stored in JSON. */
export interface GameSubrecordsConfig {
  game: string;
  records: Record<string, RecordToggleConfig>;
}

/** Compiled lookups the ESP reader asks per record and subrecord. */
export interface TranslatableSubrecords {
  /** True when this record type must be skipped entirely. */
  isIgnoredRecord(recordSig: string): boolean;
  /** True when this subrecord of this record holds translatable text. */
  isTranslatable(recordSig: string, subrecordSig: string): boolean;
}

/**
 * Compile a JSON config into {@link TranslatableSubrecords}.
 *
 * Compilation is eager (two small maps) and cached by the caller — a title
 * descriptor compiles once at module load and reuses the result for every
 * plugin it reads.
 */
export const compileSubrecordConfig = (config: GameSubrecordsConfig): TranslatableSubrecords => {
  const translatable = new Map<string, ReadonlySet<string>>();
  const ignored = new Set<string>();

  for (const [record, toggles] of Object.entries(config.records)) {
    if (!toggles.read) ignored.add(record);
    translatable.set(
      record,
      new Set(
        Object.entries(toggles.subrecords)
          .filter(([, enabled]) => enabled)
          .map(([subrecord]) => subrecord),
      ),
    );
  }

  return {
    isIgnoredRecord: (recordSig) => ignored.has(recordSig),
    isTranslatable: (recordSig, subrecordSig) =>
      translatable.get(recordSig)?.has(subrecordSig) ?? false,
  };
};

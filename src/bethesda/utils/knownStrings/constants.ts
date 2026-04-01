import type { GameType } from '../../../types';
import fo4ConfigJson from '../../subrecords/fo4.json' with { type: 'json' };
import fo76ConfigJson from '../../subrecords/fo76.json' with { type: 'json' };
import fo3ConfigJson from '../../subrecords/fo3.json' with { type: 'json' };
import fnvConfigJson from '../../subrecords/fnv.json' with { type: 'json' };
import obConfigJson from '../../subrecords/ob.json' with { type: 'json' };
import mwConfigJson from '../../subrecords/mw.json' with { type: 'json' };
import sseConfigJson from '../../subrecords/sse.json' with { type: 'json' };
import sleConfigJson from '../../subrecords/sle.json' with { type: 'json' };

type SubrecordToggleMap = Record<string, boolean>;

interface RecordToggleConfig {
  read: boolean;
  subrecords: SubrecordToggleMap;
}

export interface GameSubrecordsConfig {
  game: GameType;
  records: Record<string, RecordToggleConfig>;
}

export const GAME_SUBRECORDS_CONFIG_BY_GAME: Record<GameType, GameSubrecordsConfig> = {
  fo4: fo4ConfigJson as GameSubrecordsConfig,
  fo76: fo76ConfigJson as GameSubrecordsConfig,
  fo3: fo3ConfigJson as GameSubrecordsConfig,
  fnv: fnvConfigJson as GameSubrecordsConfig,
  ob: obConfigJson as GameSubrecordsConfig,
  mw: mwConfigJson as GameSubrecordsConfig,
  sse: sseConfigJson as GameSubrecordsConfig,
  sle: sleConfigJson as GameSubrecordsConfig,
};

export const TRANSLATABLE_SUBRECORDS_BY_GAME: Record<GameType, Record<string, Set<string>>> = Object.fromEntries(
  (Object.keys(GAME_SUBRECORDS_CONFIG_BY_GAME) as GameType[]).map((game) => {
    const config = GAME_SUBRECORDS_CONFIG_BY_GAME[game];
    const recordMap = Object.fromEntries(
      Object.entries(config.records).map(([record, toggleConfig]) => [
        record,
        new Set(
          Object.entries(toggleConfig.subrecords)
            .filter(([, enabled]) => enabled)
            .map(([subrecord]) => subrecord),
        ),
      ]),
    ) as Record<string, Set<string>>;
    return [game, recordMap];
  }),
) as Record<GameType, Record<string, Set<string>>>;

export const IGNORED_RECORDS_BY_GAME: Record<GameType, ReadonlySet<string>> = Object.fromEntries(
  (Object.keys(GAME_SUBRECORDS_CONFIG_BY_GAME) as GameType[]).map((game) => {
    const config = GAME_SUBRECORDS_CONFIG_BY_GAME[game];
    const ignored = new Set(
      Object.entries(config.records)
        .filter(([, toggleConfig]) => !toggleConfig.read)
        .map(([record]) => record),
    );
    return [game, ignored as ReadonlySet<string>];
  }),
) as Record<GameType, ReadonlySet<string>>;

export const FO4_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.fo4;
export const FO76_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.fo76;
export const SSE_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.sse;
export const FO3_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.fo3;
export const FNV_TRANSLATABLE_SUBRECORDS = TRANSLATABLE_SUBRECORDS_BY_GAME.fnv;

/**
 * Backward-compatible alias - points to the FO4 table.
 * @deprecated Use `getTranslatableSubrecords(game)` instead.
 */
export const TRANSLATABLE_SUBRECORDS = FO4_TRANSLATABLE_SUBRECORDS;

/**
 * Where one Creation Engine title keeps the record facts the import reads
 * beyond plain translatable strings — speakers, voice types, dialogue order,
 * scene actions, and how a FormID names its master.
 *
 * The readers in this folder were written against Fallout 4 / Skyrim layouts.
 * A title whose records differ (Starfield) hands the readers its own layout
 * instead of the readers branching on a game id; {@link DEFAULT_ESP_RECORD_LAYOUT}
 * is exactly what they did before layouts existed.
 */
import type { SceneActionKind } from '../types';

/** Size class of a plugin, from its TES4 header flags. */
export type PluginKind = 'full' | 'small' | 'medium';

export type EspRecordLayout = {
  plugin: {
    /** TES4 flag bit of a small (ESL-style) plugin; 0 when the title has none. */
    smallFlag: number;
    /** TES4 flag bit of a medium plugin; 0 when the title has none. */
    mediumFlag: number;
    /**
     * How the FormIDs stored inside a plugin name their master:
     *   - `plain`: the top byte indexes the `MAST` list; past its end is the
     *     plugin's own record.
     *   - `byKind`: `FE` + 12-bit slot indexes the small masters, `FD` + 8-bit
     *     slot the medium masters, any other top byte the full masters — each
     *     counted separately, in `MAST` order. See `formIdMasterIndex`.
     */
    formIdMasterSlots: 'plain' | 'byKind';
  };
  /**
   * Subrecords that open and close one embedded base-form component. Fields
   * inside a component reuse top-level signatures (an animation-graph
   * component carries a `DNAM` string, for example), so structural readers
   * skip them. Null when the title has no components.
   */
  baseFormComponents: { begin: string; end: string } | null;
  /** Exact size of the VTYP `DNAM` flags subrecord, or null to accept any non-empty one. */
  voiceTypeFlagsSize: number | null;
  /**
   * Where the order of a topic's INFOs lives:
   *   - `infoPreviousInfo`: each INFO names its predecessor in a 4-byte `PNAM`;
   *   - `topicInfoList`: the DIAL lists its INFOs in a `TIFL` FormID array.
   */
  infoOrder: 'infoPreviousInfo' | 'topicInfoList';
  /**
   * Subrecord inside each INFO response (after its `TRDA`) listing the voice
   * types that say the response, 8 bytes per entry with the VTYP FormID first.
   * Null when the title's INFOs carry no such list and a line's voice types
   * are known only from the folders its takes sit in.
   */
  infoResponseVoiceTypes: string | null;
  scene: {
    /** SCEN action `ANAM` type word → kind; a type missing here is dropped. */
    actionKinds: Readonly<Record<number, SceneActionKind>>;
    /** Subrecords that carry a DIAL topic inside an action. `DATA` is the primary topic. */
    topicSubrecords: readonly string[];
    /** Subrecords that carry the SCEN a start-scene action starts. */
    startSceneSubrecords: readonly string[];
    /**
     * Topic subrecords of a player-dialogue action whose lines the player
     * says (a subset of `topicSubrecords`). The action's alias is the NPC the
     * player talks to, so these topics are bound to the player alias instead.
     * Empty: every topic of an action is bound to the action's alias.
     */
    playerTopicSubrecords: readonly string[];
  };
};

/** Fallout 4 / Skyrim / older titles: what the readers did before layouts existed. */
export const DEFAULT_ESP_RECORD_LAYOUT: EspRecordLayout = {
  plugin: { smallFlag: 0, mediumFlag: 0, formIdMasterSlots: 'plain' },
  baseFormComponents: null,
  voiceTypeFlagsSize: null,
  infoOrder: 'infoPreviousInfo',
  infoResponseVoiceTypes: null,
  scene: {
    // Types 3–6 exist only in Fallout 4.
    actionKinds: {
      0: 'dialogue',
      1: 'package',
      2: 'timer',
      3: 'player_dialogue',
      4: 'start_scene',
      5: 'npc_response',
      6: 'radio',
    },
    // DIAL slots on FO4 player-dialogue / NPC-response actions, plus DATA.
    topicSubrecords: ['DATA', 'PTOP', 'NTOP', 'NETO', 'QTOP', 'NPOT', 'NNGT', 'NNUT', 'NQUT'],
    startSceneSubrecords: ['LCEP'],
    // Fallout 4's player topics (PTOP, NTOP, …) carry player voice folders,
    // which already mark their lines; kept as it was read before.
    playerTopicSubrecords: [],
  },
};

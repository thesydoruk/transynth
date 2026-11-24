/**
 * Record layouts of the Creation Engine titles whose plugins differ from
 * Fallout 4 in what the import reads beyond plain strings. A title sets one on
 * `CreationEngineTitle.records`; a title without one reads as Fallout 4.
 *
 * Source: xEdit's `wbDefinitionsSF1.pas` (TES5Edit `dev-4.1.6`).
 */
import type { EspRecordLayout } from '../../../formats/esp';

/**
 * Starfield.
 *
 * - TES4 flag 0x100 marks a small plugin and 0x400 a medium one; FormIDs in a
 *   plugin number small (`FE`), medium (`FD`) and full masters separately.
 * - QUST, DIAL, INFO, NPC_, VTYP and INNR nest base-form components between
 *   `BFCB` and `BFCE`.
 * - VTYP `DNAM` is one flag byte.
 * - INFO has no previous-INFO `PNAM`; the DIAL lists its INFOs in `TIFL`.
 * - Each INFO response lists the voice types that say it in `TROT` (VTYP
 *   FormID + float). xEdit leaves the struct unnamed; on `Starfield.esm` the
 *   list matches the stated speaker (`ANAM`) on 828 of 874 responses that have
 *   both, but only 68,055 of the 109,399 responses with a take carry one — the
 *   folders holding the take fill the rest.
 * - SCEN action types: 0 dialogue, 1 package, 2 timer, 3 player dialogue,
 *   4 start scene, 5 radio, then move, camera, FX, animation and timeline,
 *   which have no counterpart here and are dropped. A player-dialogue choice
 *   names its topics in `ESCE` (player) and `ESCS` (NPC response); the
 *   action's `ALID` is the NPC (5,379 of 5,379 in `Starfield.esm`), so `ESCE`
 *   topics belong to the player alias. A start-scene action names its scene
 *   in `LCEP` or `STSC`.
 */
export const STARFIELD_RECORD_LAYOUT: EspRecordLayout = {
  plugin: { smallFlag: 0x100, mediumFlag: 0x400, formIdMasterSlots: 'byKind' },
  baseFormComponents: { begin: 'BFCB', end: 'BFCE' },
  voiceTypeFlagsSize: 1,
  infoOrder: 'topicInfoList',
  infoResponseVoiceTypes: 'TROT',
  scene: {
    actionKinds: {
      0: 'dialogue',
      1: 'package',
      2: 'timer',
      3: 'player_dialogue',
      4: 'start_scene',
      5: 'radio',
    },
    topicSubrecords: ['DATA', 'ESCE', 'ESCS'],
    startSceneSubrecords: ['LCEP', 'STSC'],
    playerTopicSubrecords: ['ESCE'],
  },
};

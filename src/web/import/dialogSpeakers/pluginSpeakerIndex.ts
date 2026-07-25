/**
 * Speaker facts collected from the plugin itself.
 *
 * Built once per import so the finalize pass can attribute a gender to every
 * dialog speaker without re-reading the plugin.
 */
import {
  genderFromVoiceTypeName,
  isPlayerVoiceType,
  type GenderSource,
  type SpeakerGender,
} from '../../../dialog';
import type { EspActorIndex, VoiceTypeRecord } from '../../../formats/esp';

/** Everything known about one actor record. */
export type ActorSpeakerInfo = {
  gender: SpeakerGender;
  source: GenderSource | null;
  voiceType: string | null;
  name: string | null;
  isPlayer: boolean;
};

/** Gender a voice type implies, and what said so. */
export type VoiceTypeGender = {
  gender: SpeakerGender;
  source: GenderSource | null;
};

export type PluginSpeakerIndex = {
  /** Actor FormID → resolved facts. */
  actors: Map<string, ActorSpeakerInfo>;
  /** Lower-6 INFO FormID → raw voice folder name. */
  voiceFolders: Map<string, string>;
  /** Lower-cased voice type name → the gender its record proves. */
  voiceTypeGenders: Map<string, VoiceTypeGender>;
};

export type BuildPluginSpeakerIndexOptions = {
  actorIndex: EspActorIndex;
  /** English string table, used to resolve FULL names of localized plugins. */
  englishStrings: Map<number, string> | null;
  /** Display names of vanilla actors the mod references but does not define. */
  npcReferenceNames: Map<string, string>;
  voiceFolders: Map<string, string>;
};

/**
 * Gender of one voice type, from its name and then its DNAM flag.
 *
 * The name wins where it says anything, because a handful of vanilla records
 * carry the wrong flag — `NPCFScribeNeriah` and `NPCFProctorIngram` are both
 * women whose voice type is not flagged female.
 */
const voiceTypeGender = (record: VoiceTypeRecord): VoiceTypeGender => {
  const named = genderFromVoiceTypeName(record.edid);
  if (named !== 'unknown') {
    return { gender: named, source: isPlayerVoiceType(record.edid) ? 'player' : 'voice_type' };
  }
  if (record.isFemale == null) return { gender: 'unknown', source: null };
  return { gender: record.isFemale ? 'female' : 'male', source: 'voice_type_flag' };
};

/**
 * Gender implied by a voice type or voice folder name.
 *
 * Falls back to the name alone for folders whose VTYP record lives in a master
 * this plugin does not define.
 */
export const genderFromVoiceTypeIndex = (
  index: PluginSpeakerIndex,
  name: string | null | undefined,
): VoiceTypeGender => {
  const trimmed = name?.trim();
  if (!trimmed) return { gender: 'unknown', source: null };

  const known = index.voiceTypeGenders.get(trimmed.toLowerCase());
  if (known && known.gender !== 'unknown') return known;

  const named = genderFromVoiceTypeName(trimmed);
  if (named === 'unknown') return { gender: 'unknown', source: null };
  return { gender: named, source: isPlayerVoiceType(trimmed) ? 'player' : 'voice_type' };
};

const actorName = (
  actor: EspActorIndex['actors'][number],
  englishStrings: Map<number, string> | null,
  npcReferenceNames: Map<string, string>,
): string | null => {
  if (actor.nameText) return actor.nameText;
  if (actor.nameLStringId != null) {
    const resolved = englishStrings?.get(actor.nameLStringId);
    if (resolved) return resolved;
  }
  return npcReferenceNames.get(actor.formId) ?? null;
};

/**
 * Collect actor gender, voice type and display name from plugin records.
 *
 * The ACBS Female flag is authoritative and present on every well-formed NPC_
 * record. The voice type name only steps in for records that omit it, which in
 * practice means overrides that carry nothing but a name change.
 */
export const buildPluginSpeakerIndex = (
  opts: BuildPluginSpeakerIndexOptions,
): PluginSpeakerIndex => {
  const voiceTypeNames = new Map(
    opts.actorIndex.voiceTypes.map((voiceType) => [voiceType.formId, voiceType.edid]),
  );
  const voiceTypeGenders = new Map(
    opts.actorIndex.voiceTypes
      .filter((voiceType) => voiceType.edid)
      .map((voiceType) => [voiceType.edid.toLowerCase(), voiceTypeGender(voiceType)]),
  );

  const actors = new Map<string, ActorSpeakerInfo>();
  for (const actor of opts.actorIndex.actors) {
    const voiceType = actor.voiceTypeFormId
      ? (voiceTypeNames.get(actor.voiceTypeFormId) ?? null)
      : null;

    let gender: SpeakerGender = 'unknown';
    let source: GenderSource | null = null;

    if (actor.isFemale != null) {
      gender = actor.isFemale ? 'female' : 'male';
      source = 'plugin';
    } else if (voiceType) {
      const fromVoiceType = voiceTypeGenders.get(voiceType.toLowerCase());
      gender = fromVoiceType?.gender ?? 'unknown';
      source = fromVoiceType?.source ?? null;
    }

    const isPlayer = voiceType ? isPlayerVoiceType(voiceType) : false;
    if (isPlayer) {
      gender = 'any';
      source = 'player';
    }

    actors.set(actor.formId, {
      gender,
      source,
      voiceType,
      name: actorName(actor, opts.englishStrings, opts.npcReferenceNames),
      isPlayer,
    });
  }

  return { actors, voiceFolders: opts.voiceFolders, voiceTypeGenders };
};

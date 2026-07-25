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
import type { EspActorIndex } from '../../../formats/esp';

/** Everything known about one actor record. */
export type ActorSpeakerInfo = {
  gender: SpeakerGender;
  source: GenderSource | null;
  voiceType: string | null;
  name: string | null;
  isPlayer: boolean;
};

export type PluginSpeakerIndex = {
  /** Actor FormID → resolved facts. */
  actors: Map<string, ActorSpeakerInfo>;
  /** Lower-6 INFO FormID → raw voice folder name. */
  voiceFolders: Map<string, string>;
};

export type BuildPluginSpeakerIndexOptions = {
  actorIndex: EspActorIndex;
  /** English string table, used to resolve FULL names of localized plugins. */
  englishStrings: Map<number, string> | null;
  /** Display names of vanilla actors the mod references but does not define. */
  npcReferenceNames: Map<string, string>;
  voiceFolders: Map<string, string>;
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
      gender = genderFromVoiceTypeName(voiceType);
      if (gender !== 'unknown') source = 'voice_type';
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

  return { actors, voiceFolders: opts.voiceFolders };
};

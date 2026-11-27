/**
 * Who says a line, from the voice types the plugin and its takes name for it.
 *
 * Fallout 4 names a take after its line, so the folder it sits in is the
 * line's voice type (`speakerMaps.buildVoiceFolderMap`). Starfield names takes
 * by WEM id and lists, per response, the voice types that say it (`TROT`).
 * One line can then have many voice types — a generic greeting is recorded by
 * dozens — while the speaker table keys a line by one voice folder. This picks
 * that one, or none when the voice types disagree on sex, and names the voice
 * types that belong to one character.
 *
 * Measured on `Starfield.esm` against the 3,175 responses whose INFO states
 * its speaker (`ANAM`): the response's own list where it has one, else the
 * folders of its take, is exactly that speaker's voice type on 3,091.
 */
import { isPlayerVoiceType } from '../../../dialog';
import type { InfoResponseVoiceTypes } from '../../../formats/esp';
import { cleanVoiceFolderName, type TakeFoldersByLine } from '../../../import/mod/speakerMaps';
import {
  genderFromVoiceTypeIndex,
  type PluginSpeakerIndex,
} from '../../../import/dialogSpeakers/pluginSpeakerIndex';

export type LineVoiceTypeSources = {
  /** Per INFO, the VTYP FormIDs each response lists. */
  listed: InfoResponseVoiceTypes;
  /** VTYP FormID → EDID, from the plugin and the masters it could read. */
  voiceTypeNames: ReadonlyMap<string, string>;
  /** Per line, the voice folders holding each response's take. */
  takeFolders: TakeFoldersByLine;
  /**
   * Lines a scene gives the player to say (lower-6 INFO FormID). They take the
   * player's voice types in place of their own.
   */
  playerLineKeys?: ReadonlySet<string>;
};

/** Per line, the voice type standing for its speaker and the label to show. */
export type LineVoiceFolders = {
  /** Lower-6 INFO FormID → voice type (folder) name. */
  voiceFolders: Map<string, string>;
  /** Lower-6 INFO FormID → speaker display name. */
  speakerNames: Map<string, string>;
};

const lineKeyOf = (formId: string): string => formId.substring(2).toUpperCase();

const byLowerName = (a: string, b: string): number =>
  a.toLowerCase().localeCompare(b.toLowerCase());

const addResponse = (
  names: Map<string, string>,
  listed: readonly string[] | undefined,
  folders: ReadonlySet<string> | undefined,
  sources: LineVoiceTypeSources,
  spelling: ReadonlyMap<string, string>,
): void => {
  // The response's own list first; the folders of its take where it has none.
  const fromList = (listed ?? [])
    .map((formId) => sources.voiceTypeNames.get(formId))
    .filter((name): name is string => !!name);
  const chosen = fromList.length > 0 ? fromList : [...(folders ?? [])];
  for (const name of chosen) {
    const lower = name.toLowerCase();
    if (!names.has(lower)) names.set(lower, spelling.get(lower) ?? name);
  }
};

/** Every voice type that says each line: lower-6 INFO FormID → names. */
export const collectLineVoiceTypes = (sources: LineVoiceTypeSources): Map<string, string[]> => {
  const spelling = new Map(
    [...sources.voiceTypeNames.values()].map((name) => [name.toLowerCase(), name]),
  );
  const listedByLine = new Map<string, string[][]>();
  for (const [formId, responses] of sources.listed) {
    listedByLine.set(lineKeyOf(formId), responses);
  }

  const lines = new Map<string, string[]>();
  for (const lineKey of new Set([...listedByLine.keys(), ...sources.takeFolders.keys()])) {
    const listed = listedByLine.get(lineKey) ?? [];
    const folders = sources.takeFolders.get(lineKey) ?? new Map<number, Set<string>>();
    const count = Math.max(listed.length, ...folders.keys(), 0);
    const names = new Map<string, string>();
    for (let response = 1; response <= count; response += 1) {
      addResponse(names, listed[response - 1], folders.get(response), sources, spelling);
    }
    if (names.size > 0) lines.set(lineKey, [...names.values()]);
  }

  // A scene puts these lines in the player's mouth. The few that carry an NPC
  // voice type anyway (10 of 25,540 in `Starfield.esm`) would otherwise mark
  // that NPC as the player wherever it speaks.
  const player = [...spelling.values()].filter(isPlayerVoiceType).sort(byLowerName);
  if (player.length > 0) {
    for (const lineKey of sources.playerLineKeys ?? []) lines.set(lineKey, player);
  }
  return lines;
};

/**
 * The one voice type a line is filed under, or null when its voice types
 * disagree on sex (or say nothing of it). Of several that agree the first by
 * name stands for them: right for grammar, though the label is one of many.
 */
export const pickLineVoiceType = (
  names: readonly string[],
  index: PluginSpeakerIndex,
): string | null => {
  if (names.length === 0) return null;
  if (names.length === 1) return names[0]!;
  const genders = new Set(names.map((name) => genderFromVoiceTypeIndex(index, name).gender));
  if (genders.size !== 1 || genders.has('unknown')) return null;
  return [...names].sort(byLowerName)[0]!;
};

const letters = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The character a voice type belongs to: the only name its actors carry, or —
 * when a few roles share it (`NPCFAndreja` is also "The Emissary") — the one
 * name its own EDID spells out. Generic voice types name no one.
 */
const characterName = (voiceType: string, counts: Map<string, number>): string | null => {
  const names = [...counts.keys()];
  if (names.length === 1) return names[0]!;
  const spelled = letters(voiceType);
  const inEdid = names.filter(
    (name) => letters(name).length >= 3 && spelled.includes(letters(name)),
  );
  if (new Set(inEdid.map(letters)).size !== 1) return null;
  return inEdid.sort((a, b) => counts.get(b)! - counts.get(a)!)[0]!;
};

/** Lower-cased voice type name → the character it belongs to, where there is one. */
export const voiceTypeCharacterNames = (index: PluginSpeakerIndex): Map<string, string> => {
  const byVoiceType = new Map<string, { voiceType: string; counts: Map<string, number> }>();
  for (const actor of index.actors.values()) {
    if (!actor.voiceType || !actor.name || actor.isPlayer) continue;
    const key = actor.voiceType.toLowerCase();
    let entry = byVoiceType.get(key);
    if (!entry) byVoiceType.set(key, (entry = { voiceType: actor.voiceType, counts: new Map() }));
    entry.counts.set(actor.name, (entry.counts.get(actor.name) ?? 0) + 1);
  }

  const names = new Map<string, string>();
  for (const [key, { voiceType, counts }] of byVoiceType) {
    const name = characterName(voiceType, counts);
    if (name) names.set(key, name);
  }
  return names;
};

/** Resolve every line to one voice folder and a speaker label. */
export const resolveLineVoiceFolders = (
  sources: LineVoiceTypeSources,
  index: PluginSpeakerIndex,
): LineVoiceFolders => {
  const characters = voiceTypeCharacterNames(index);
  const voiceFolders = new Map<string, string>();
  const speakerNames = new Map<string, string>();
  for (const [lineKey, names] of collectLineVoiceTypes(sources)) {
    const voiceType = pickLineVoiceType(names, index);
    if (!voiceType) continue;
    voiceFolders.set(lineKey, voiceType);
    // The label follows the voice type, not the line, so every line filed
    // under one speaker key offers the speaker table the same name.
    speakerNames.set(
      lineKey,
      characters.get(voiceType.toLowerCase()) ?? cleanVoiceFolderName(voiceType),
    );
  }
  return { voiceFolders, speakerNames };
};

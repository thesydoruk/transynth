/**
 * An imported master's takes, as a patch borrows them.
 *
 * A patch that overrides a master's INFO and changes its translation owes that
 * line a dub, but ships no audio of its own: the reference is the master's
 * take. These helpers find that take, place it in the patch's own voice tree,
 * and read the master's text for it — the transcript of the borrowed audio.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { resolveModDirectoryFromPath } from '../formats/mcm';
import { pluginRelPath } from '../modImport/packages';
import { resolveModStoredPath } from '../modStorage';
import { resolveVoiceRootRel, type VoiceFileEntry } from './discoverVoiceFiles';
import {
  findImportedMasterMods,
  findMasterByOrigin,
  loadInheritedVoiceLookup,
  lookupInheritedVoiceLine,
  type InheritedVoiceLookup,
  type MasterModRef,
} from './inheritedVoiceText';
import { voiceTranslationMapKey } from './loadVoiceTranslations';
import { groupVoiceFilesBySpeaker, voiceSpeakerKey } from './speakerReference/grouping';
import { FUZ_TAKES, type VoiceTakeFormat } from './takeFormat';
import { normalizeVoiceOrigin } from './voiceOrigin';

/** An imported master's takes, indexed for lending them to a patch. */
export type MasterVoiceContext = {
  master: MasterModRef;
  packageDir: string;
  pluginRel: string;
  voiceRootRel: string;
  /** `<origin>/<FORMID6>:<variant>` → one take per speaker folder. */
  byLine: Map<string, VoiceFileEntry[]>;
  bySpeaker: Map<string, VoiceFileEntry[]>;
};

export const loadMasterVoiceContext = (
  master: MasterModRef,
  takes: VoiceTakeFormat = FUZ_TAKES,
): MasterVoiceContext | null => {
  const pluginPath = resolveModStoredPath(master.absPath);
  if (!fs.existsSync(pluginPath)) return null;
  const packageDir = resolveModDirectoryFromPath(pluginPath);
  const pluginRel = pluginRelPath(packageDir, pluginPath);
  const voiceRootRel = resolveVoiceRootRel(pluginRel);
  const entries = takes.discover(packageDir, pluginRel);
  const byLine = new Map<string, VoiceFileEntry[]>();
  for (const entry of entries) {
    const key = voiceTranslationMapKey(entry.lineKey, entry.variant, entry.originPlugin);
    const list = byLine.get(key) ?? [];
    list.push(entry);
    byLine.set(key, list);
  }
  return {
    master,
    packageDir,
    pluginRel,
    voiceRootRel,
    byLine,
    bySpeaker: groupVoiceFilesBySpeaker(entries, voiceRootRel),
  };
};

/**
 * A master's take as the dubbing mod sees it: the same file to clone from, at
 * the path it has in the mod's own voice tree, so the dub lands in the mod's
 * localize tree (`Data/Sound/Voice/…` when the mod keeps a `Data/` folder).
 *
 * `ownFileName` is the name the dubbing mod's own plugin gives the take, for a
 * format whose names are not the line's (`VoiceTakeFormat.ownTakeFileName`):
 * the dub is written under that name, while the audio is still read from the
 * master's file.
 */
export const asDubbingEntry = (
  take: VoiceFileEntry,
  ctx: MasterVoiceContext,
  voiceRootRel: string,
  ownFileName?: string | null,
): VoiceFileEntry => {
  const masterTree = path.posix.dirname(ctx.voiceRootRel);
  const below = path.posix.relative(masterTree, take.relPath.replace(/\\/g, '/'));
  const relPath = path.posix.join(path.posix.dirname(voiceRootRel), below);
  if (!ownFileName || ownFileName.toLowerCase() === take.fileName.toLowerCase()) {
    return { ...take, relPath };
  }
  return {
    ...take,
    relPath: path.posix.join(path.posix.dirname(relPath), ownFileName),
    fileName: ownFileName,
  };
};

/**
 * The origin master's own text for a line: the transcript of the take it lends.
 * A DLC that overrides the same line must not answer here — its words are not
 * what the borrowed audio says.
 */
export const lookupOriginMasterLine = (
  inherited: InheritedVoiceLookup,
  lineKey: string,
  variant: number,
  origin: string,
) => {
  const master = findMasterByOrigin(inherited.masters, origin);
  return master
    ? lookupInheritedVoiceLine({ ...inherited, masters: [master] }, lineKey, variant, origin)
    : null;
};

export type MasterBackedTake = {
  entry: VoiceFileEntry;
  context: MasterVoiceContext;
  /** The master's own text for the line, for the reference transcript. */
  referenceSource: string | null;
  masterTranslation: string | null;
};

/**
 * One line of an imported master, as a take this mod may dub against: the
 * master's file for (origin, FormID, response), optionally of one speaker.
 */
export const findMasterBackedTake = async (
  db: Tx,
  input: {
    modId: number;
    pluginPath: string;
    originPlugin: string;
    lineKey: string;
    variant: number;
    speakerKey?: string | null;
    srcLang: string;
    tgtLang: string;
    /** How the game stores takes; `.fuz` when omitted. */
    takes?: VoiceTakeFormat;
  },
): Promise<MasterBackedTake | null> => {
  const takeFormat = input.takes ?? FUZ_TAKES;
  const origin = normalizeVoiceOrigin(input.originPlugin);
  if (!origin) return null;
  const masters = await findImportedMasterMods(db, input.pluginPath, input.modId);
  const master = findMasterByOrigin(masters, origin);
  if (!master) return null;
  const context = loadMasterVoiceContext(master, takeFormat);
  if (!context) return null;

  const takes = context.byLine.get(voiceTranslationMapKey(input.lineKey, input.variant, origin));
  const wantSpeaker = input.speakerKey?.trim();
  const take = takes?.find(
    (candidate) => !wantSpeaker || voiceSpeakerKey(candidate, context.voiceRootRel) === wantSpeaker,
  );
  if (!take) return null;
  const packageDir = resolveModDirectoryFromPath(input.pluginPath);
  const voiceRootRel = resolveVoiceRootRel(pluginRelPath(packageDir, input.pluginPath));

  const inherited = await loadInheritedVoiceLookup(db, [master], input.srcLang, input.tgtLang);
  const line = lookupInheritedVoiceLine(inherited, input.lineKey, input.variant, origin);
  const ownFileName = takeFormat.ownTakeFileName?.(input.pluginPath, take);
  // The mod's own plugin names no file for this response: there is nothing to dub.
  if (ownFileName === null) return null;
  return {
    entry: asDubbingEntry(take, context, voiceRootRel, ownFileName),
    context,
    referenceSource: line?.source ?? null,
    masterTranslation: line?.translation ?? null,
  };
};

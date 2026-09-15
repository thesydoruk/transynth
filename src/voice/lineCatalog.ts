/**
 * Everything the editor's voice tab needs about one mod, in one shape.
 *
 * Each game builds this from its own sources — a Creation Engine mod walks its
 * `Sound/Voice/` tree and joins INFO records, Disco Elysium reads the clip rows
 * recorded at import — but the editor renders one catalog either way. The few
 * places where the games still differ are functions on the catalog rather than
 * branches in the editor code.
 */
import type { VoiceFileEntry } from './discoverVoiceFiles';
import type { InheritedVoiceLookup } from './inheritedVoiceText';
import type { VoiceSourceDetailRow, VoiceTranslationRow } from './loadVoiceTranslations';
import type { VoiceTtsMarkupStyle } from './prepareVoiceTtsText';
import type { VoiceSpeakerRefMap } from './voiceSpeakerRefs';
import type { VoiceSimilarityMap } from './voiceSynthesisState';
import type { VoicePackageContext } from '../web/voice/preview/context';
import type { VoiceFolderGender } from '../web/voice/preview/speakerGender';

/** Why a mod has no voice catalog to show. */
export type VoiceLineCatalogError = {
  ok: false;
  reason: 'mod_not_found' | 'no_plugin_path' | 'plugin_missing' | 'no_voice_files';
  message: string;
};

export type VoiceLineCatalog = {
  ok: true;
  modId: number;
  ctx: VoicePackageContext;
  /** Package-relative root of the mod's voice tree, e.g. `Sound/Voice` or `Audio`. */
  voiceRootRel: string;
  voiceFiles: VoiceFileEntry[];
  sources: Map<string, VoiceSourceDetailRow>;
  translations: Map<string, VoiceTranslationRow>;
  /** Lines inherited from an imported master plugin, when the mod has any. */
  inheritedLookup: InheritedVoiceLookup | null;
  /**
   * FormIDs that have source text. Audio whose FormID is missing here is
   * orphaned — the game ships a take for a line that no longer exists.
   */
  sourceFormids: Set<string>;
  speakerRefs: VoiceSpeakerRefMap;
  /** Speaker gender, keyed the same way as {@link speakerKeyOf}. */
  folderGenders: Map<string, VoiceFolderGender>;
  voiceSimilarities: VoiceSimilarityMap;
  /** TTS text-prep rules for this game's lines. */
  markupStyle: VoiceTtsMarkupStyle;
  /** Which speaker a take belongs to. */
  speakerKeyOf: (entry: VoiceFileEntry) => string;
  /** Human-readable speaker name for the editor's speaker list. */
  speakerDisplayName: (speakerKey: string, lineKey: string) => string;
  /** True when a synthesized take already exists for this source file. */
  hasLocalizedTake: (entry: VoiceFileEntry) => boolean;
};

export type VoiceLineCatalogResult = VoiceLineCatalog | VoiceLineCatalogError;

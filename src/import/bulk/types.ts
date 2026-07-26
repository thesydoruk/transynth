import type { CsvRow } from '../../types';
import type { PluginSpeakerIndex } from '../dialogSpeakers';

export type ModImportBulkRow = {
  csvRow: CsvRow;
  locale: string;
  context: string | null;
  sourceKind?: string;
};

export type ModImportBulkResult = {
  recordId: number;
  stringId: number;
  row: ModImportBulkRow;
};

export type DialogGraphImportContext = {
  dialogEdidByFormId: Map<string, string>;
  speakerMap: Map<string, string>;
  voiceSpeakerMap: Map<string, string>;
  /** Lower-6 INFO FormID → raw voice folder name, used to key voice speakers. */
  voiceFolderMap: Map<string, string>;
  /** Actor genders and voice types read from the plugin. */
  speakerIndex: PluginSpeakerIndex;
  topicIdCache: Map<string, number>;
};

export type DialogInfoImportRow = {
  topicFormId: string;
  infoFormId: string;
  speakerFormId: string | null;
  speakerName: string | null;
  speakerKey: string | null;
  previousInfoFormId: string | null;
};

export type PruneStaleModImportResult = {
  deletedStrings: number;
  deletedRecords: number;
  dialogGraph: PruneDialogGraphResult;
};

export type PruneDialogGraphResult = {
  deletedNodes: number;
  deletedEdges: number;
  deletedTopics: number;
  deletedScenes: number;
  deletedBranches: number;
  deletedQuests: number;
};

export type BulkTranslationRow = {
  srcStringId: number;
  text: string;
};

export type SqlConvertImportTranslationsResult = {
  inserted: number;
  skippedWithoutSource: number;
  locales: string[];
  resolvedSourceLocale: string;
};

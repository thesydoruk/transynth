/**
 * The game plugin contract.
 *
 * Pure types, no runtime dependencies on any plugin — so both a plugin and the
 * shared pipeline can import from here without a cycle.
 */
export type { GameCatalogueEntry } from './catalogue';
export type { EditorMode, GameEditorCapabilities, RecordPathStyle } from './editor';
export type {
  GameRecordKind,
  GameTextAdapter,
  MaskedText,
  VerifyGuardItem,
  VerifyGuardVerdict,
} from './text';
export type { EnglishPromptSections, GamePromptAdapter, GamePromptRules } from './prompts';
export type {
  AnchorDescription,
  GameImportAdapter,
  ImportRunState,
  ModImportRunContext,
  DialogSpeakerRefresh,
  DialogSpeakerRefreshContext,
} from './importing';
export type { ExportedZip, GameExportAdapter, ModExportContext } from './exporting';
export type {
  GameVoiceAdapter,
  VoiceJobScope,
  VoiceLineRequest,
  VoiceLinePreviewBuild,
  VoiceLocalizeRequest,
  VoiceLocalizeSink,
  SourceTakeLocation,
  VoiceTake,
  VoiceTakeQuery,
} from './voice';
export type { DialogAdapterGroup, DialogParticipantsSqlContext, GameDialogAdapter } from './dialog';
export type { GameDeploymentAdapter } from './deployment';
export type { GamePlugin } from './plugin';

export * from './types';
export { BASE, req, downloadBinary } from './client';
export { voiceAudioUrl, voiceTranslationAudioUrl, voiceRegeneratePreviewUrl } from './voiceUrls';
export type { VoiceRegenerateParams, VoiceRegeneratePreview } from './types/pexVoice';

import { modsEndpoints } from './endpoints/mods';
import { statsEndpoints } from './endpoints/stats';
import { opsEndpoints } from './endpoints/ops';
import { stringsEndpoints } from './endpoints/strings';
import { searchEndpoints } from './endpoints/search';
import { dialogsEndpoints } from './endpoints/dialogs';
import { glossaryEndpoints } from './endpoints/glossary';
import { eetEndpoints } from './endpoints/eet';
import { csvEndpoints } from './endpoints/csv';
import { modImportEndpoints } from './endpoints/modImport';
import { activityEndpoints } from './endpoints/activity';
import { qaRulesEndpoints } from './endpoints/qaRules';
import { coherenceEndpoints } from './endpoints/coherence';
import { innrEndpoints } from './endpoints/innr';
import { settingsEndpoints } from './endpoints/settings';
import { projectSettingsEndpoints } from './endpoints/projectSettings';
import { gamesEndpoints } from './endpoints/games';
import { llmVerifyEndpoints } from './endpoints/llmVerify';
import { llmSkipDetectEndpoints } from './endpoints/llmSkipDetect';
import { llmGenderDetectEndpoints } from './endpoints/llmGenderDetect';
import { tmApplyEndpoints } from './endpoints/tmApply';
import { llmTranslateEndpoints } from './endpoints/llmTranslate';
import { voiceGenerateEndpoints } from './endpoints/voiceGenerate';
import { modAiJobsEndpoints } from './endpoints/modAiJobs';

export const api = {
  mods: modsEndpoints,
  stats: statsEndpoints,
  ops: opsEndpoints,
  strings: stringsEndpoints,
  search: searchEndpoints,
  dialogs: dialogsEndpoints,
  glossary: glossaryEndpoints,
  eet: eetEndpoints,
  csv: csvEndpoints,
  modImport: modImportEndpoints,
  activity: activityEndpoints,
  qaRules: qaRulesEndpoints,
  coherence: coherenceEndpoints,
  innr: innrEndpoints,
  settings: settingsEndpoints,
  projectSettings: projectSettingsEndpoints,
  games: gamesEndpoints,
  llmVerify: llmVerifyEndpoints,
  llmSkipDetect: llmSkipDetectEndpoints,
  llmGenderDetect: llmGenderDetectEndpoints,
  tmApply: tmApplyEndpoints,
  llmTranslate: llmTranslateEndpoints,
  voiceGenerate: voiceGenerateEndpoints,
  modAiJobs: modAiJobsEndpoints,
};

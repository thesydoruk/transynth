import { useTranslation } from 'react-i18next';
import type { Mod, ModImportJob } from '../../api';
import { getModAiJob } from '../../modAiJobsStore';
import {
  toggleModAiTranslate,
  toggleModAiTranslateTm,
  stopModAiTranslate,
} from '../../modAiTranslateRunner';
import { toggleModAiVoice, stopModAiVoice } from '../../modAiVoiceRunner';
import { startModAiSkipDetect, stopModAiSkipDetect } from '../../modAiSkipDetectRunner';
import { toggleModAiGenderDetect, stopModAiGenderDetect } from '../../modAiGenderDetectRunner';
import { ModWorkspaceRow } from './ModWorkspaceRow';
import type { ModExportAction } from './modsShared';
import { formatModDisplayName, groupModVersions } from './modVersions';
import pageS from './ModsPage.module.scss';

type ModWorkspaceListProps = {
  mods: Mod[];
  importJobByModId: Map<number, ModImportJob>;
  srcLang: string;
  targetLang: string;
  selectedModIds: Set<number>;
  multiSelectActive: boolean;
  clearingModId: number | null;
  deletingAll: boolean;
  buildExportActions: (
    modId: number,
    labelName: string,
    exportSrcLang: string,
    exportTgtLang: string,
    busyPrefix: string,
  ) => ModExportAction[];
  selectedModsForDelete: () => Array<{ id: number; name: string }>;
  onOpenMod: (modId: number) => void;
  onOpenAiPanel: (modId: number) => void;
  onToggleSelection: (modId: number, selected: boolean) => void;
  onClearRows: (modId: number, name: string) => void;
  onDeleteAll: (mods: Array<{ id: number; name: string }>) => void;
  onDeleteImport: (job: ModImportJob) => void;
  onExportLangpack?: () => void;
  exportingLangpack?: boolean;
};

export const ModWorkspaceList = (props: ModWorkspaceListProps) => {
  const { t } = useTranslation();
  const groups = groupModVersions(props.mods);

  const renderRow = (mod: Mod, nested: boolean) => {
    const importJob = props.importJobByModId.get(mod.id) ?? null;
    const displayName = formatModDisplayName(mod);
    const exportActions = props.buildExportActions(
      mod.id,
      displayName,
      props.srcLang,
      props.targetLang,
      `mod-${mod.id}`,
    );
    const isSelected = props.selectedModIds.has(mod.id);

    return (
      <ModWorkspaceRow
        key={`mod-${mod.id}`}
        mod={mod}
        importJob={importJob}
        exportActions={exportActions}
        clearingRows={props.clearingModId === mod.id}
        deletingAll={props.deletingAll}
        selected={isSelected}
        nested={nested}
        multiSelectActive={props.multiSelectActive}
        onSelectedChange={(selected) => props.onToggleSelection(mod.id, selected)}
        onOpen={() => props.onOpenMod(mod.id)}
        onAiTranslateTm={() =>
          toggleModAiTranslateTm(
            mod.id,
            props.srcLang,
            props.targetLang,
            getModAiJob(mod.id, 'translate'),
          )
        }
        onAiTranslateLlm={() =>
          toggleModAiTranslate(
            mod.id,
            props.srcLang,
            props.targetLang,
            getModAiJob(mod.id, 'translate'),
          )
        }
        onAiTranslateStop={() => void stopModAiTranslate(mod.id, getModAiJob(mod.id, 'translate'))}
        onAiVerify={() => props.onOpenAiPanel(mod.id)}
        onSkipDetectHeuristic={() =>
          void startModAiSkipDetect(
            mod.id,
            props.srcLang,
            false,
            getModAiJob(mod.id, 'skip-detect'),
          )
        }
        onSkipDetectWithLlm={() =>
          void startModAiSkipDetect(mod.id, props.srcLang, true, getModAiJob(mod.id, 'skip-detect'))
        }
        onSkipDetectStop={() =>
          void stopModAiSkipDetect(mod.id, getModAiJob(mod.id, 'skip-detect').jobId)
        }
        onGenderDetect={() =>
          toggleModAiGenderDetect(mod.id, props.srcLang, getModAiJob(mod.id, 'gender-detect'))
        }
        onGenderDetectStop={() =>
          void stopModAiGenderDetect(mod.id, getModAiJob(mod.id, 'gender-detect').jobId)
        }
        onAiVoiceMissing={() =>
          toggleModAiVoice(
            mod.id,
            props.srcLang,
            props.targetLang,
            getModAiJob(mod.id, 'voice'),
            'missing',
          )
        }
        onAiVoiceAll={() =>
          toggleModAiVoice(
            mod.id,
            props.srcLang,
            props.targetLang,
            getModAiJob(mod.id, 'voice'),
            'all',
          )
        }
        onAiVoiceStop={() => void stopModAiVoice(mod.id, getModAiJob(mod.id, 'voice').jobId)}
        onClearRows={() => props.onClearRows(mod.id, displayName)}
        onDeleteAll={() =>
          props.onDeleteAll(
            props.multiSelectActive && isSelected
              ? props.selectedModsForDelete()
              : [{ id: mod.id, name: displayName }],
          )
        }
        onDeleteImport={importJob ? () => props.onDeleteImport(importJob) : undefined}
        onExportLangpack={props.onExportLangpack}
        exportingLangpack={props.exportingLangpack}
      />
    );
  };

  return groups.map((group) => (
    <div key={`family-${group.current.id}`} className={pageS.versionGroup}>
      {renderRow(group.current, false)}
      {group.previous.length > 0 && (
        <details className={pageS.previousVersions}>
          <summary>{t('mods.previousVersions', { count: group.previous.length })}</summary>
          <div className={pageS.previousList}>
            {group.previous.map((mod) => renderRow(mod, true))}
          </div>
        </details>
      )}
    </div>
  ));
};

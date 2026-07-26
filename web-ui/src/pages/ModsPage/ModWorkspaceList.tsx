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

type ExportAction = {
  key: 'langpack' | 'fullMod';
  icon: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
};

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
  ) => ExportAction[];
  selectedModsForDelete: () => Array<{ id: number; name: string }>;
  onOpenMod: (modId: number) => void;
  onOpenAiPanel: (modId: number) => void;
  onToggleSelection: (modId: number, selected: boolean) => void;
  onClearRows: (modId: number, name: string) => void;
  onDeleteAll: (mods: Array<{ id: number; name: string }>) => void;
  onDeleteImport: (job: ModImportJob) => void;
};

export const ModWorkspaceList = ({
  mods,
  importJobByModId,
  srcLang,
  targetLang,
  selectedModIds,
  multiSelectActive,
  clearingModId,
  deletingAll,
  buildExportActions,
  selectedModsForDelete,
  onOpenMod,
  onOpenAiPanel,
  onToggleSelection,
  onClearRows,
  onDeleteAll,
  onDeleteImport,
}: ModWorkspaceListProps) =>
  mods.map((mod) => {
    const importJob = importJobByModId.get(mod.id) ?? null;
    const exportActions = buildExportActions(
      mod.id,
      mod.name,
      srcLang,
      targetLang,
      `mod-${mod.id}`,
    );
    const isSelected = selectedModIds.has(mod.id);

    return (
      <ModWorkspaceRow
        key={`mod-${mod.id}`}
        mod={mod}
        importJob={importJob}
        exportActions={exportActions}
        clearingRows={clearingModId === mod.id}
        deletingAll={deletingAll}
        selected={isSelected}
        multiSelectActive={multiSelectActive}
        onSelectedChange={(selected) => onToggleSelection(mod.id, selected)}
        onOpen={() => onOpenMod(mod.id)}
        onAiTranslateTm={() =>
          toggleModAiTranslateTm(mod.id, srcLang, targetLang, getModAiJob(mod.id, 'translate'))
        }
        onAiTranslateLlm={() =>
          toggleModAiTranslate(mod.id, srcLang, targetLang, getModAiJob(mod.id, 'translate'))
        }
        onAiTranslateStop={() => void stopModAiTranslate(mod.id, getModAiJob(mod.id, 'translate'))}
        onAiVerify={() => onOpenAiPanel(mod.id)}
        onSkipDetectHeuristic={() =>
          void startModAiSkipDetect(mod.id, srcLang, false, getModAiJob(mod.id, 'skip-detect'))
        }
        onSkipDetectWithLlm={() =>
          void startModAiSkipDetect(mod.id, srcLang, true, getModAiJob(mod.id, 'skip-detect'))
        }
        onSkipDetectStop={() =>
          void stopModAiSkipDetect(mod.id, getModAiJob(mod.id, 'skip-detect').jobId)
        }
        onGenderDetect={() =>
          toggleModAiGenderDetect(mod.id, srcLang, getModAiJob(mod.id, 'gender-detect'))
        }
        onGenderDetectStop={() =>
          void stopModAiGenderDetect(mod.id, getModAiJob(mod.id, 'gender-detect').jobId)
        }
        onAiVoiceMissing={() =>
          toggleModAiVoice(mod.id, srcLang, targetLang, getModAiJob(mod.id, 'voice'), 'missing')
        }
        onAiVoiceAll={() =>
          toggleModAiVoice(mod.id, srcLang, targetLang, getModAiJob(mod.id, 'voice'), 'all')
        }
        onAiVoiceStop={() => void stopModAiVoice(mod.id, getModAiJob(mod.id, 'voice').jobId)}
        onClearRows={() => onClearRows(mod.id, mod.name)}
        onDeleteAll={() =>
          onDeleteAll(
            multiSelectActive && isSelected
              ? selectedModsForDelete()
              : [{ id: mod.id, name: mod.name }],
          )
        }
        onDeleteImport={importJob ? () => onDeleteImport(importJob) : undefined}
      />
    );
  });

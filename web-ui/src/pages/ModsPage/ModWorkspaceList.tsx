import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Mod } from '../../api';
import { getModAiJob } from '../../modAiJobsStore';
import {
  toggleModAiTranslate,
  toggleModAiTranslateTm,
  stopModAiTranslate,
} from '../../modAiTranslateRunner';
import { toggleModAiVoice, stopModAiVoice } from '../../modAiVoiceRunner';
import { startModAiSkipDetect, stopModAiSkipDetect } from '../../modAiSkipDetectRunner';
import { toggleModAiGenderDetect, stopModAiGenderDetect } from '../../modAiGenderDetectRunner';
import { VoiceResynthDialog } from '../../components/VoiceResynthDialog';
import { ModWorkspaceRow } from './ModWorkspaceRow';
import { useModsWorkspace } from './ModsWorkspaceContext';
import { formatModDisplayName, groupModVersions } from './modVersions';
import pageS from './ModsPage.module.scss';

/** Mod rows with older versions folded under the current one; everything else comes from the page context. */
export const ModWorkspaceList = ({ mods }: { mods: Mod[] }) => {
  const { t } = useTranslation();
  const {
    srcLang,
    targetLang,
    selection,
    deleteActions,
    buildExportActions,
    exportSelected,
    exportingLangpack,
    importJobByModId,
    openMod,
    openAiPanel,
    vortexGroupLabel,
    setContentKind,
  } = useModsWorkspace();
  const groups = groupModVersions(mods);
  const [resynthModId, setResynthModId] = useState<number | null>(null);

  const renderRow = (mod: Mod, nested: boolean) => {
    const importJob = importJobByModId.get(mod.id) ?? null;
    const displayName = formatModDisplayName(mod);
    const exportActions = buildExportActions(
      mod.id,
      displayName,
      srcLang,
      targetLang,
      `mod-${mod.id}`,
    );
    const isSelected = selection.selectedModIds.has(mod.id);

    return (
      <ModWorkspaceRow
        key={`mod-${mod.id}`}
        mod={mod}
        importJob={importJob}
        exportActions={exportActions}
        clearingRows={deleteActions.clearingModId === mod.id}
        deletingAll={deleteActions.deletingAll}
        selected={isSelected}
        nested={nested}
        multiSelectActive={selection.multiSelectActive}
        onSelectedChange={(selected) => selection.toggleModSelection(mod.id, selected)}
        onOpen={() => openMod(mod.id)}
        onAiTranslateTm={() =>
          toggleModAiTranslateTm(mod.id, srcLang, targetLang, getModAiJob(mod.id, 'translate'))
        }
        onAiTranslateLlm={() =>
          toggleModAiTranslate(mod.id, srcLang, targetLang, getModAiJob(mod.id, 'translate'))
        }
        onAiTranslateStop={() => void stopModAiTranslate(mod.id, getModAiJob(mod.id, 'translate'))}
        onAiVerify={() => openAiPanel(mod.id)}
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
        onAiVoiceLowSimilarity={() => setResynthModId(mod.id)}
        onAiVoiceStop={() => void stopModAiVoice(mod.id, getModAiJob(mod.id, 'voice').jobId)}
        onClearRows={() => deleteActions.setPendingClear({ id: mod.id, name: displayName })}
        onDeleteAll={() =>
          deleteActions.requestDeleteMods(
            selection.multiSelectActive && isSelected
              ? selection.selectedModsForDelete()
              : [{ id: mod.id, name: displayName }],
          )
        }
        onDeleteImport={importJob ? () => deleteActions.setDeleteModalJob(importJob) : undefined}
        onExportLangpack={exportSelected}
        exportingLangpack={exportingLangpack}
        vortexLabel={vortexGroupLabel(mod.vortex_group_id)}
        onContentKindChange={(kind) => void setContentKind(mod.id, kind)}
      />
    );
  };

  return (
    <>
      {groups.map((group) => (
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
      ))}
      <VoiceResynthDialog
        open={resynthModId != null}
        onClose={() => setResynthModId(null)}
        modId={resynthModId ?? 0}
        srcLang={srcLang}
        targetLang={targetLang}
        onStart={(params) => {
          if (resynthModId == null) return;
          toggleModAiVoice(
            resynthModId,
            srcLang,
            targetLang,
            getModAiJob(resynthModId, 'voice'),
            'low-similarity',
            undefined,
            params,
          );
          setResynthModId(null);
        }}
      />
    </>
  );
};
